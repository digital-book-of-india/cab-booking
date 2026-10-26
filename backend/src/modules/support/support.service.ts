import type { Types } from 'mongoose';
import { z } from 'zod';
import type { Actor } from '../../common/actor';
import { SUPPORT_ROLES } from '../../common/enums';
import { AppError } from '../../common/errors';
import { publicId } from '../../common/ids';
import { pageMeta, paginationSchema } from '../../common/pagination';
import { escapeRegex, objectId } from '../../common/zod';
import type { AuditService } from '../audit/audit.service';
import { Booking } from '../bookings/booking.model';
import { Refund } from '../payments/refund.model';
import { DriverProfile } from '../drivers/driverProfile.model';
import type { FlagsService } from '../flags/flags.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { User } from '../users/user.model';
import {
  SupportTicket,
  TicketCategories,
  TicketOutcomes,
  TicketPriorities,
  TicketStatuses,
} from './supportTicket.model';

const MAX_OPEN_PER_USER = 10;
const MAX_MESSAGES = 200;
const OPEN_STATES = ['OPEN', 'IN_PROGRESS', 'WAITING_USER'];

export const createTicketSchema = z
  .object({
    category: z.enum(TicketCategories),
    subject: z.string().trim().min(3).max(120),
    message: z.string().trim().min(3).max(2000),
    bookingId: z
      .string()
      .regex(/^bk_[0-9a-f]{12}$/)
      .optional(),
  })
  .strict();
export const messageSchema = z.object({ text: z.string().trim().min(1).max(2000) }).strict();
export const ticketListQuerySchema = paginationSchema.extend({
  status: z.enum(TicketStatuses).optional(),
});
export const staffTicketListQuerySchema = paginationSchema.extend({
  status: z.enum(TicketStatuses).optional(),
  category: z.enum(TicketCategories).optional(),
  priority: z.enum(TicketPriorities).optional(),
  assignedTo: z.union([z.literal('me'), objectId]).optional(),
  unassigned: z.enum(['true']).optional(),
  q: z.string().trim().min(1).max(60).optional(),
});
export const staffMessageSchema = z
  .object({ text: z.string().trim().min(1).max(2000), internal: z.boolean().default(false) })
  .strict();
export const assignSchema = z.object({ assigneeId: objectId.optional() }).strict();
export const updateTicketSchema = z
  .object({
    status: z.enum(['IN_PROGRESS', 'WAITING_USER']).optional(),
    priority: z.enum(TicketPriorities).optional(),
  })
  .strict()
  .refine((v) => v.status !== undefined || v.priority !== undefined, {
    message: 'nothing to change',
  });
export const resolveTicketSchema = z
  .object({ outcome: z.enum(TicketOutcomes), note: z.string().trim().min(3).max(1000) })
  .strict();

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type TicketListQuery = z.infer<typeof ticketListQuerySchema>;
export type StaffTicketListQuery = z.infer<typeof staffTicketListQuerySchema>;
export type StaffMessageInput = z.infer<typeof staffMessageSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;
export type ResolveTicketInput = z.infer<typeof resolveTicketSchema>;

type TicketDoc = {
  publicId: string;
  userId: Types.ObjectId;
  userRole: string;
  bookingPublicId?: string | null;
  category: string;
  subject: string;
  status: string;
  priority: string;
  assignedTo?: Types.ObjectId | null;
  messages: {
    id: string;
    by: string;
    authorId: Types.ObjectId;
    text: string;
    internal?: boolean;
    at: Date;
  }[];
  outcome?: string | null;
  resolutionNote?: string | null;
  firstResponseAt?: Date | null;
  resolvedAt?: Date | null;
  lastActivityAt: Date;
  createdAt: Date;
};

export function createSupportService(deps: {
  flags: FlagsService;
  audit: AuditService;
  notifications: Pick<NotificationsService, 'notify'>;
  now: () => Date;
  /** A ticket with no staff reply after this long is flagged overdue. */
  firstResponseSlaMs: number;
}) {
  const { flags, audit, notifications, now, firstResponseSlaMs } = deps;

  const view = (t: TicketDoc, forStaff: boolean) => ({
    ticketId: t.publicId,
    category: t.category,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    bookingId: t.bookingPublicId ?? null,
    outcome: t.outcome ?? null,
    resolutionNote: t.resolutionNote ?? null,
    createdAt: t.createdAt,
    lastActivityAt: t.lastActivityAt,
    messages: t.messages
      .filter((m) => forStaff || !m.internal)
      .map((m) => ({
        id: m.id,
        by: m.by,
        text: m.text,
        ...(forStaff ? { internal: Boolean(m.internal), authorId: m.authorId.toString() } : {}),
        at: m.at,
      })),
    ...(forStaff
      ? {
          userId: t.userId.toString(),
          userRole: t.userRole,
          assignedTo: t.assignedTo?.toString() ?? null,
          firstResponseAt: t.firstResponseAt ?? null,
          overdue:
            !t.firstResponseAt &&
            OPEN_STATES.includes(t.status) &&
            now().getTime() - t.createdAt.getTime() > firstResponseSlaMs,
        }
      : {}),
  });

  const row = (t: TicketDoc) => ({
    ...view(t, true),
    messages: undefined,
    messageCount: t.messages.length,
  });

  async function ownTicket(actor: Actor, ticketId: string) {
    const t = await SupportTicket.findOne({ publicId: ticketId, userId: actor.userId });
    if (!t) throw new AppError('NOT_FOUND', 'Ticket not found.');
    return t;
  }

  /** The ticket may only be about a ride the person was actually on. */
  async function involvedBooking(actor: Actor, bookingPublicId: string) {
    const b = await Booking.findOne({ publicId: bookingPublicId }).lean();
    if (!b) throw new AppError('NOT_FOUND', 'Booking not found.');
    if (actor.role === 'CUSTOMER') {
      if (b.customerId.toString() === actor.userId) return b;
    } else {
      const profile = await DriverProfile.findOne({ userId: actor.userId }).select('_id').lean();
      const wasThere =
        profile &&
        (b.assignedDriverId?.equals(profile._id) ||
          b.previousDrivers?.some((p) => p.driverId.equals(profile._id)));
      if (wasThere) return b;
    }
    throw new AppError('NOT_FOUND', 'Booking not found.');
  }

  async function pushMessage(
    ticketId: string,
    message: { by: 'USER' | 'STAFF'; authorId: string; text: string; internal?: boolean },
    extra: Record<string, unknown> = {},
  ) {
    const id = publicId('msg');
    const at = now();
    const updated = await SupportTicket.findOneAndUpdate(
      { publicId: ticketId, $expr: { $lt: [{ $size: '$messages' }, MAX_MESSAGES] } },
      {
        $push: { messages: { id, ...message, internal: message.internal ?? false, at } },
        $set: { lastActivityAt: at, ...extra },
      },
      { returnDocument: 'after' },
    );
    if (!updated)
      throw new AppError(
        'UNPROCESSABLE',
        'This ticket has too many messages. Please open a new one.',
      );
    return { updated, id };
  }

  const tell = (
    userId: Types.ObjectId | string,
    t: TicketDoc,
    id: string,
    title: string,
    body: string,
  ) =>
    notifications.notify(userId.toString(), {
      type: 'support.update',
      title,
      body,
      data: { ticketId: t.publicId },
      dedupeKey: `ticket:${t.publicId}:${id}`,
    });

  return {
    /* ---------------- rider / driver ---------------- */

    async create(actor: Actor, input: CreateTicketInput) {
      await flags.assertEnabled('SUPPORT_TICKETS', actor.role);
      if (
        (await SupportTicket.countDocuments({
          userId: actor.userId,
          status: { $in: OPEN_STATES } as never,
        })) >= MAX_OPEN_PER_USER
      ) {
        throw new AppError(
          'UNPROCESSABLE',
          'You have too many open tickets. Wait for some to be resolved.',
        );
      }
      const booking = input.bookingId ? await involvedBooking(actor, input.bookingId) : null;
      const at = now();
      const t = await SupportTicket.create({
        publicId: publicId('tkt'),
        userId: actor.userId,
        userRole: actor.role as 'CUSTOMER' | 'DRIVER',
        ...(booking ? { bookingId: booking._id, bookingPublicId: booking.publicId } : {}),
        category: input.category,
        subject: input.subject,
        // A safety concern jumps the queue.
        priority: input.category === 'SAFETY_CONCERN' ? 'HIGH' : 'NORMAL',
        messages: [
          {
            id: publicId('msg'),
            by: 'USER',
            authorId: actor.userId,
            text: input.message,
            internal: false,
            at,
          },
        ],
        lastActivityAt: at,
      });
      return view(t as unknown as TicketDoc, false);
    },

    async listOwn(actor: Actor, query: TicketListQuery) {
      const filter: Record<string, unknown> = { userId: actor.userId };
      if (query.status) filter['status'] = query.status;
      const [total, rows] = await Promise.all([
        SupportTicket.countDocuments(filter),
        SupportTicket.find(filter)
          .sort({ lastActivityAt: -1 })
          .skip((query.page - 1) * query.limit)
          .limit(query.limit)
          .lean(),
      ]);
      return {
        items: rows.map((t) => ({
          ...view(t as unknown as TicketDoc, false),
          messages: undefined,
          messageCount: t.messages.filter((m) => !m.internal).length,
        })),
        meta: pageMeta(query.page, query.limit, total),
      };
    },

    async getOwn(actor: Actor, ticketId: string) {
      return view((await ownTicket(actor, ticketId)) as unknown as TicketDoc, false);
    },

    async reply(actor: Actor, ticketId: string, text: string) {
      const t = await ownTicket(actor, ticketId);
      if (t.status === 'CLOSED')
        throw new AppError('CONFLICT', 'This ticket is closed. Please open a new one.');
      // Writing back to a waiting ticket puts it back in the queue; to a resolved one, reopens it.
      const next =
        t.status === 'WAITING_USER' ? 'IN_PROGRESS' : t.status === 'RESOLVED' ? 'OPEN' : t.status;
      const { updated, id } = await pushMessage(
        ticketId,
        { by: 'USER', authorId: actor.userId, text },
        { status: next },
      );
      if (t.assignedTo)
        await tell(
          t.assignedTo,
          updated as unknown as TicketDoc,
          id,
          'Ticket reply',
          `${updated.subject}: the user replied.`,
        );
      return view(updated as unknown as TicketDoc, false);
    },

    async close(actor: Actor, ticketId: string) {
      const t = await SupportTicket.findOneAndUpdate(
        { publicId: ticketId, userId: actor.userId, status: { $ne: 'CLOSED' } },
        { status: 'CLOSED', closedAt: now(), lastActivityAt: now() },
        { returnDocument: 'after' },
      );
      if (!t) {
        await ownTicket(actor, ticketId); // 404 if it is not theirs
        throw new AppError('CONFLICT', 'This ticket is already closed.');
      }
      return view(t as unknown as TicketDoc, false);
    },

    /* ---------------- staff ---------------- */

    async list(actor: Actor, query: StaffTicketListQuery) {
      const filter: Record<string, unknown> = {};
      if (query.status) filter['status'] = query.status;
      if (query.category) filter['category'] = query.category;
      if (query.priority) filter['priority'] = query.priority;
      if (query.assignedTo)
        filter['assignedTo'] = query.assignedTo === 'me' ? actor.userId : query.assignedTo;
      if (query.unassigned) filter['assignedTo'] = { $exists: false };
      if (query.q) {
        const rx = new RegExp(escapeRegex(query.q), 'i');
        filter['$or'] = [{ subject: rx }, { bookingPublicId: rx }, { publicId: rx }];
      }
      const [total, rows] = await Promise.all([
        SupportTicket.countDocuments(filter),
        SupportTicket.find(filter)
          .sort({ priority: -1, createdAt: 1 })
          .skip((query.page - 1) * query.limit)
          .limit(query.limit)
          .lean(),
      ]);
      return {
        items: rows.map((t) => row(t as unknown as TicketDoc)),
        meta: pageMeta(query.page, query.limit, total),
      };
    },

    async detail(ticketId: string) {
      const t = await SupportTicket.findOne({ publicId: ticketId }).lean();
      if (!t) throw new AppError('NOT_FOUND');
      return view(t as unknown as TicketDoc, true);
    },

    async assign(actor: Actor, ticketId: string, assigneeId?: string) {
      const target = assigneeId ?? actor.userId;
      const person = await User.findOne({
        _id: target,
        role: { $in: SUPPORT_ROLES },
        accountStatus: 'ACTIVE',
      })
        .select('_id')
        .lean();
      if (!person) throw new AppError('UNPROCESSABLE', 'That person cannot take support tickets.');
      const t = await SupportTicket.findOneAndUpdate(
        { publicId: ticketId, status: { $ne: 'CLOSED' } },
        [
          {
            $set: {
              assignedTo: person._id,
              lastActivityAt: now(),
              status: { $cond: [{ $eq: ['$status', 'OPEN'] }, 'IN_PROGRESS', '$status'] },
            },
          },
        ],
        { returnDocument: 'after', updatePipeline: true },
      );
      if (!t) {
        if (!(await SupportTicket.exists({ publicId: ticketId }))) throw new AppError('NOT_FOUND');
        throw new AppError('CONFLICT', 'This ticket is closed.');
      }
      await audit.record(actor, {
        action: 'support.assign',
        targetType: 'SupportTicket',
        targetId: ticketId,
        metadata: { assignee: String(person._id) },
      });
      return view(t as unknown as TicketDoc, true);
    },

    async staffReply(actor: Actor, ticketId: string, input: StaffMessageInput) {
      const t = await SupportTicket.findOne({ publicId: ticketId });
      if (!t) throw new AppError('NOT_FOUND');
      if (t.status === 'CLOSED') throw new AppError('CONFLICT', 'This ticket is closed.');
      const answers = !input.internal;
      const { updated, id } = await pushMessage(
        ticketId,
        { by: 'STAFF', authorId: actor.userId, text: input.text, internal: input.internal },
        answers
          ? {
              status: t.status === 'RESOLVED' ? 'RESOLVED' : 'WAITING_USER',
              ...(t.firstResponseAt ? {} : { firstResponseAt: now() }),
            }
          : {},
      );
      if (answers)
        await tell(
          t.userId,
          updated as unknown as TicketDoc,
          id,
          'Support replied',
          `${t.subject}: we have replied to your request.`,
        );
      await audit.record(actor, {
        action: input.internal ? 'support.note' : 'support.reply',
        targetType: 'SupportTicket',
        targetId: ticketId,
      });
      return view(updated as unknown as TicketDoc, true);
    },

    async update(actor: Actor, ticketId: string, input: UpdateTicketInput) {
      const set: Record<string, unknown> = { lastActivityAt: now() };
      if (input.status) set['status'] = input.status;
      if (input.priority) set['priority'] = input.priority;
      const t = await SupportTicket.findOneAndUpdate(
        { publicId: ticketId, status: { $nin: ['CLOSED', 'RESOLVED'] } },
        set,
        { returnDocument: 'after' },
      );
      if (!t) {
        if (!(await SupportTicket.exists({ publicId: ticketId }))) throw new AppError('NOT_FOUND');
        throw new AppError('CONFLICT', 'A resolved or closed ticket cannot be changed.');
      }
      await audit.record(actor, {
        action: 'support.update',
        targetType: 'SupportTicket',
        targetId: ticketId,
        metadata: { ...input },
      });
      return view(t as unknown as TicketDoc, true);
    },

    async resolve(actor: Actor, ticketId: string, input: ResolveTicketInput) {
      // An outcome that says money was given back must be true: the refund or the fee waiver has to
      // exist already (finance / operations do those with their own endpoints and permissions).
      if (input.outcome === 'REFUNDED' || input.outcome === 'FEE_WAIVED') {
        const ticket = await SupportTicket.findOne({ publicId: ticketId })
          .select('bookingId')
          .lean();
        if (!ticket) throw new AppError('NOT_FOUND');
        const problem = (message: string) =>
          new AppError('UNPROCESSABLE', undefined, [{ field: 'outcome', message }]);
        if (!ticket.bookingId) {
          throw problem(`${input.outcome} needs a ticket that is about a ride.`);
        }
        if (input.outcome === 'REFUNDED') {
          const refund = await Refund.exists({
            bookingId: ticket.bookingId,
            status: { $in: ['REQUESTED', 'PROCESSED'] },
          });
          if (!refund)
            throw problem('Refund the payment first (finance), then resolve the ticket.');
        } else {
          const booking = await Booking.findById(ticket.bookingId).select('fee.status').lean();
          if (booking?.fee?.status !== 'WAIVED') {
            throw problem('Waive the fee first (operations), then resolve the ticket.');
          }
        }
      }
      const at = now();
      const t = await SupportTicket.findOneAndUpdate(
        { publicId: ticketId, status: { $nin: ['CLOSED', 'RESOLVED'] } },
        {
          status: 'RESOLVED',
          outcome: input.outcome,
          resolutionNote: input.note,
          resolvedAt: at,
          lastActivityAt: at,
        },
        { returnDocument: 'after' },
      );
      if (!t) {
        if (!(await SupportTicket.exists({ publicId: ticketId }))) throw new AppError('NOT_FOUND');
        throw new AppError('CONFLICT', 'This ticket is already resolved or closed.');
      }
      await audit.record(actor, {
        action: 'support.resolve',
        targetType: 'SupportTicket',
        targetId: ticketId,
        metadata: { outcome: input.outcome },
      });
      await tell(
        t.userId,
        t as unknown as TicketDoc,
        `resolved:${at.getTime()}`,
        'Your request was resolved',
        `${t.subject}: ${input.note}`,
      );
      return view(t as unknown as TicketDoc, true);
    },
  };
}

export type SupportService = ReturnType<typeof createSupportService>;
