import { z } from 'zod';
import type { Logger } from 'pino';
import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import type { AuditService } from '../audit/audit.service';
import type { DispatchConfig } from '../dispatch/dispatch.config';
import type { DispatchService } from '../dispatch/dispatch.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { Booking } from './booking.model';
import { recordEvent, transitionBooking } from './transitions';

export const staffCancelSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

const when = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);

/**
 * Rides booked for later. A background job (every 30 seconds) does three things:
 *  - reminds the rider about an hour ahead (only if they booked earlier than that),
 *  - starts the search for a driver shortly before pickup, by moving the ride to REQUESTED and
 *    handing it to dispatch exactly like a ride asked for now,
 *  - cancels a ride nobody could start long after its time (the server was down), and says so.
 * Each step is a conditional update, so two server instances can run it together safely.
 */
export function createScheduledService(deps: {
  dispatch: Pick<DispatchService, 'start'>;
  notifications: Pick<NotificationsService, 'notify'>;
  audit: AuditService;
  config: DispatchConfig;
  now: () => Date;
  logger: Logger;
}) {
  const { dispatch, notifications, audit, config, now, logger } = deps;

  async function tell(
    customerId: string,
    bookingId: string,
    type: string,
    title: string,
    body: string,
    key: string,
  ) {
    await notifications
      .notify(customerId, { type, title, body, data: { bookingId }, dedupeKey: key })
      .catch((err) => logger.error({ err, bookingId }, 'could not send a scheduled-ride message'));
  }

  /** Start the search for one waiting ride: it becomes a normal REQUESTED ride handed to dispatch. */
  async function activate(
    b: {
      _id: import('mongoose').Types.ObjectId;
      publicId: string;
      customerId: { toString(): string };
      scheduledFor?: Date | null;
    },
    actorType: 'SYSTEM' | 'ADMIN',
    actorId?: string,
  ): Promise<boolean> {
    const t = now();
    const moved = await transitionBooking({ _id: b._id }, ['SCHEDULED'], 'REQUESTED', {
      // From here it is a normal ride: it counts as requested now, for dispatch timing and reports.
      set: { requestedAt: t },
    });
    if (!moved) return false; // someone else got it
    await recordEvent({
      bookingId: b._id,
      type: 'SCHEDULE_ACTIVATED',
      fromStatus: 'SCHEDULED',
      toStatus: 'REQUESTED',
      actorType,
      ...(actorId ? { actorId } : {}),
      at: t,
    });
    await tell(
      b.customerId.toString(),
      b.publicId,
      'booking.searching',
      'Finding your driver',
      `We are finding a driver for your ${b.scheduledFor ? when(b.scheduledFor) : ''} ride.`,
      `sched-search:${b.publicId}`,
    );
    try {
      await dispatch.start(b.publicId);
    } catch (err) {
      // Not lost: the dispatch sweeper starts any REQUESTED booking that never started.
      logger.error(
        { err, bookingId: b.publicId },
        'could not start the search for a scheduled ride',
      );
    }
    return true;
  }

  return {
    /** Operations: start the search for a waiting ride now (for example the job was down). */
    async startNow(actor: Actor, bookingPublicId: string) {
      const b = await Booking.findOne({ publicId: bookingPublicId }).lean();
      if (!b) throw new AppError('NOT_FOUND', 'Booking not found.');
      if (b.status !== 'SCHEDULED' || !(await activate(b, 'ADMIN', actor.userId))) {
        throw new AppError('RIDE_INVALID_STATE', 'Only a waiting scheduled ride can be started.');
      }
      await audit.record(actor, {
        action: 'booking.scheduled.start_now',
        targetType: 'Booking',
        targetId: bookingPublicId,
      });
      return { bookingId: bookingPublicId, status: 'DISPATCHING' as const };
    },

    /** Support/operations: cancel a waiting ride on the rider's behalf. Free, and the rider is told. */
    async cancelByStaff(actor: Actor, bookingPublicId: string, reason: string) {
      const t = now();
      const b = await Booking.findOne({ publicId: bookingPublicId }).lean();
      if (!b) throw new AppError('NOT_FOUND', 'Booking not found.');
      const cancelled =
        b.status === 'SCHEDULED'
          ? await transitionBooking({ _id: b._id }, ['SCHEDULED'], 'CANCELLED', {
              set: { cancellation: { actor: 'ADMIN', reasonCode: 'STAFF', note: reason, at: t } },
            })
          : null;
      if (!cancelled) {
        throw new AppError(
          'RIDE_INVALID_STATE',
          'Only a waiting scheduled ride can be cancelled here.',
        );
      }
      await recordEvent({
        bookingId: b._id,
        type: 'CANCELLED',
        fromStatus: 'SCHEDULED',
        toStatus: 'CANCELLED',
        actorType: 'ADMIN',
        actorId: actor.userId,
        at: t,
        metadata: { reasonCode: 'STAFF' },
      });
      await audit.record(actor, {
        action: 'booking.scheduled.cancel',
        targetType: 'Booking',
        targetId: bookingPublicId,
        metadata: { reason },
      });
      await tell(
        b.customerId.toString(),
        b.publicId,
        'booking.cancelled_by_staff',
        'Your scheduled ride was cancelled',
        `Your ride for ${when(b.scheduledFor!)} was cancelled by our team. You were not charged.`,
        `sched-staff-cancel:${b.publicId}`,
      );
      return { bookingId: bookingPublicId, status: 'CANCELLED' as const };
    },

    async run(): Promise<{ reminded: number; activated: number; missed: number }> {
      const t = now();
      let reminded = 0;
      let activated = 0;
      let missed = 0;

      // 1. Missed: far past pickup time and still waiting.
      const late = await Booking.find({
        status: 'SCHEDULED',
        scheduledFor: { $lt: new Date(t.getTime() - config.scheduleMissedGraceMs) },
      })
        .limit(50)
        .lean();
      for (const b of late) {
        const cancelled = await transitionBooking({ _id: b._id }, ['SCHEDULED'], 'CANCELLED', {
          set: { cancellation: { actor: 'SYSTEM', reasonCode: 'SCHEDULE_MISSED', at: t } },
        });
        if (!cancelled) continue;
        missed += 1;
        await recordEvent({
          bookingId: b._id,
          type: 'CANCELLED',
          fromStatus: 'SCHEDULED',
          toStatus: 'CANCELLED',
          actorType: 'SYSTEM',
          at: t,
          metadata: { reasonCode: 'SCHEDULE_MISSED' },
        });
        await tell(
          b.customerId.toString(),
          b.publicId,
          'booking.schedule_missed',
          'Your scheduled ride was cancelled',
          `We could not arrange your ride for ${when(b.scheduledFor!)}. You were not charged.`,
          `sched-missed:${b.publicId}`,
        );
      }

      // 2. Start the search for rides that are close enough.
      const due = await Booking.find({
        status: 'SCHEDULED',
        scheduledFor: {
          $lte: new Date(t.getTime() + config.scheduleSearchLeadMs),
          $gte: new Date(t.getTime() - config.scheduleMissedGraceMs),
        },
      })
        .sort({ scheduledFor: 1 })
        .limit(50)
        .lean();
      for (const b of due) {
        const moved = await transitionBooking({ _id: b._id }, ['SCHEDULED'], 'REQUESTED', {
          // From here it is a normal ride: it counts as requested now, for dispatch timing and reports.
          set: { requestedAt: t },
        });
        if (!moved) continue; // another instance got it
        activated += 1;
        await recordEvent({
          bookingId: b._id,
          type: 'SCHEDULE_ACTIVATED',
          fromStatus: 'SCHEDULED',
          toStatus: 'REQUESTED',
          actorType: 'SYSTEM',
          at: t,
        });
        await tell(
          b.customerId.toString(),
          b.publicId,
          'booking.searching',
          'Finding your driver',
          `We are finding a driver for your ${when(b.scheduledFor!)} ride.`,
          `sched-search:${b.publicId}`,
        );
        try {
          await dispatch.start(b.publicId);
        } catch (err) {
          // Not lost: the dispatch sweeper starts any REQUESTED booking that never started.
          logger.error(
            { err, bookingId: b.publicId },
            'could not start the search for a scheduled ride',
          );
        }
      }

      // 3. Reminders, only for rides booked well ahead of the reminder time.
      const remind = await Booking.find({
        status: 'SCHEDULED',
        scheduleReminderSentAt: { $exists: false },
        scheduledFor: { $lte: new Date(t.getTime() + config.scheduleReminderLeadMs), $gt: t },
        $expr: {
          $lte: ['$requestedAt', { $subtract: ['$scheduledFor', config.scheduleReminderLeadMs] }],
        },
      })
        .limit(100)
        .lean();
      for (const b of remind) {
        const marked = await Booking.updateOne(
          { _id: b._id, status: 'SCHEDULED', scheduleReminderSentAt: { $exists: false } },
          { scheduleReminderSentAt: t },
        );
        if (marked.modifiedCount !== 1) continue;
        reminded += 1;
        await tell(
          b.customerId.toString(),
          b.publicId,
          'booking.reminder',
          'Your ride is coming up',
          `Your ride is scheduled for ${when(b.scheduledFor!)}. We start finding your driver about ${Math.round(config.scheduleSearchLeadMs / 60_000)} minutes before.`,
          `sched-remind:${b.publicId}:${b.scheduledFor!.getTime()}`,
        );
      }
      return { reminded, activated, missed };
    },
  };
}

export type ScheduledService = ReturnType<typeof createScheduledService>;
