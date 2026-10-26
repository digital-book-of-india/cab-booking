import type { Types } from 'mongoose';
import { z } from 'zod';
import type { Logger } from 'pino';
import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import { publicId } from '../../common/ids';
import { pageMeta, paginationSchema } from '../../common/pagination';
import { normalizePhone } from '../../common/phone';
import { escapeRegex } from '../../common/zod';
import type { AuditService } from '../audit/audit.service';
import { Booking } from '../bookings/booking.model';
import type { FlagsService } from '../flags/flags.service';
import { Accounts } from '../ledger/accounts';
import type { LedgerService } from '../ledger/ledger.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { EmailProvider } from '../../providers';
import type { FinanceConfig } from '../ledger/finance.config';
import { User } from '../users/user.model';
import {
  Company,
  CompanyStatuses,
  Invoice,
  InvoiceCounter,
  InvoiceStatuses,
  MemberRoles,
  Membership,
} from './corporate.models';

const DAY = 86_400_000;
const DUPLICATE_KEY = 11000;
const IST_MS = 330 * 60_000;

/* ---------------- input ---------------- */

const money = z.number().int().min(0).max(1_000_000_000);
export const createCompanySchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    legalName: z.string().trim().min(2).max(160).optional(),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[0-9A-Z]{15}$/, 'A GSTIN has 15 letters and digits')
      .optional(),
    billingEmail: z.string().trim().pipe(z.email().max(160)),
    adminPhone: z.string().trim().min(5).max(20),
    adminName: z.string().trim().min(2).max(100).optional(),
    creditLimitPaise: money.default(5_000_000),
    paymentTermsDays: z.number().int().min(0).max(120).default(15),
    defaultEmployeeMonthlyLimitPaise: money.default(1_000_000),
    perRideCapPaise: z.number().int().min(1).max(1_000_000_000).nullable().optional(),
  })
  .strict();
export const updateCompanySchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    legalName: z.string().trim().min(2).max(160).optional(),
    billingEmail: z.string().trim().pipe(z.email().max(160)).optional(),
    status: z.enum(CompanyStatuses).optional(),
    creditLimitPaise: money.optional(),
    paymentTermsDays: z.number().int().min(0).max(120).optional(),
    defaultEmployeeMonthlyLimitPaise: money.optional(),
    perRideCapPaise: z.number().int().min(1).max(1_000_000_000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });
export const companyListQuerySchema = paginationSchema.extend({
  status: z.enum(CompanyStatuses).optional(),
  q: z.string().trim().min(1).max(60).optional(),
});
export const inviteSchema = z
  .object({
    phone: z.string().trim().min(5).max(20),
    name: z.string().trim().min(2).max(100).optional(),
    role: z.enum(MemberRoles).default('EMPLOYEE'),
    monthlyLimitPaise: money.nullable().optional(),
  })
  .strict();
export const updateMemberSchema = z
  .object({
    role: z.enum(MemberRoles).optional(),
    status: z.literal('REMOVED').optional(),
    monthlyLimitPaise: money.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });
export const generateInvoiceSchema = z
  .object({ from: z.coerce.date(), to: z.coerce.date() })
  .strict()
  .refine((v) => v.to.getTime() > v.from.getTime(), {
    message: 'to must be after from',
    path: ['to'],
  })
  .refine((v) => v.to.getTime() - v.from.getTime() <= 366 * DAY, {
    message: 'An invoice covers at most a year',
    path: ['to'],
  });
export const invoicePaymentSchema = z
  .object({
    amountPaise: z.number().int().min(1).max(1_000_000_000),
    reference: z.string().trim().min(3).max(100),
  })
  .strict();
export const creditSchema = z
  .object({
    amountPaise: z.number().int().min(1).max(1_000_000_000),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();
export const invoiceListQuerySchema = paginationSchema.extend({
  status: z.enum(InvoiceStatuses).optional(),
  companyId: z
    .string()
    .regex(/^corp_[0-9a-f]{12}$/)
    .optional(),
  overdue: z.enum(['true']).optional(),
});
export const companyRidesQuerySchema = paginationSchema.extend({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/* ---------------- views ---------------- */

type CompanyLean = {
  _id: Types.ObjectId;
  publicId: string;
  name: string;
  legalName?: string | null;
  gstin?: string | null;
  billingEmail: string;
  status: string;
  creditLimitPaise: number;
  paymentTermsDays: number;
  defaultEmployeeMonthlyLimitPaise: number;
  perRideCapPaise?: number | null;
  createdAt: Date;
};
const companyView = (c: CompanyLean) => ({
  companyId: c.publicId,
  name: c.name,
  legalName: c.legalName ?? null,
  gstin: c.gstin ?? null,
  billingEmail: c.billingEmail,
  status: c.status,
  creditLimitPaise: c.creditLimitPaise,
  paymentTermsDays: c.paymentTermsDays,
  defaultEmployeeMonthlyLimitPaise: c.defaultEmployeeMonthlyLimitPaise,
  perRideCapPaise: c.perRideCapPaise ?? null,
  createdAt: c.createdAt,
});

type MemberLean = {
  publicId: string;
  phone: string;
  name?: string | null;
  role: string;
  status: string;
  monthlyLimitPaise?: number | null;
  userId?: Types.ObjectId | null;
  acceptedAt?: Date | null;
};
const memberView = (m: MemberLean, company: CompanyLean, usedPaise?: number) => ({
  membershipId: m.publicId,
  phone: m.phone,
  name: m.name ?? null,
  role: m.role,
  status: m.status,
  monthlyLimitPaise: m.monthlyLimitPaise ?? company.defaultEmployeeMonthlyLimitPaise,
  usesCompanyDefault: m.monthlyLimitPaise === null || m.monthlyLimitPaise === undefined,
  ...(usedPaise === undefined ? {} : { usedThisMonthPaise: usedPaise }),
  acceptedAt: m.acceptedAt ?? null,
});

type InvoiceLean = {
  publicId: string;
  number?: string | null;
  companyId: Types.ObjectId;
  status: string;
  from: Date;
  to: Date;
  lines: {
    bookingId: string;
    kind: string;
    at: Date;
    rider?: string | null;
    from?: string | null;
    to?: string | null;
    reference?: string | null;
    amountPaise: number;
  }[];
  subtotalPaise: number;
  taxPaise: number;
  taxBp?: number | null;
  taxLabel?: string | null;
  seller?: {
    name?: string | null;
    gstin?: string | null;
    address?: string | null;
    sacCode?: string | null;
  } | null;
  totalPaise: number;
  paidPaise: number;
  issuedAt?: Date | null;
  dueAt?: Date | null;
  paidAt?: Date | null;
  createdAt: Date;
};
const invoiceView = (i: InvoiceLean, company?: CompanyLean | null, withLines = true) => ({
  invoiceId: i.publicId,
  number: i.number ?? null,
  company: company
    ? { companyId: company.publicId, name: company.name, gstin: company.gstin ?? null }
    : null,
  status: i.status,
  period: { from: i.from, to: i.to },
  currency: 'INR',
  subtotalPaise: i.subtotalPaise,
  // Tax at the rate set when the invoice was issued (0 until an accountant sets the rules).
  taxBp: i.taxBp ?? 0,
  taxLabel: i.taxLabel ?? null,
  taxPaise: i.taxPaise,
  seller: i.seller?.name
    ? {
        name: i.seller.name,
        gstin: i.seller.gstin ?? null,
        address: i.seller.address ?? null,
        sacCode: i.seller.sacCode ?? null,
      }
    : null,
  totalPaise: i.totalPaise,
  paidPaise: i.paidPaise,
  balancePaise: i.totalPaise - i.paidPaise,
  issuedAt: i.issuedAt ?? null,
  dueAt: i.dueAt ?? null,
  paidAt: i.paidAt ?? null,
  lineCount: i.lines.length,
  ...(withLines
    ? {
        lines: i.lines.map((l) => ({
          bookingId: l.bookingId,
          kind: l.kind,
          at: l.at,
          rider: l.rider ?? null,
          from: l.from ?? null,
          to: l.to ?? null,
          reference: l.reference ?? null,
          amountPaise: l.amountPaise,
        })),
      }
    : {}),
});

/**
 * Corporate accounts: a company's employees ride on the company's account, and the company is
 * billed. Limits are checked when a ride is booked; the money is recorded in the ledger as owed
 * by the company; finance turns it into numbered invoices and records the company's payments.
 */
export function createCorporateService(deps: {
  ledger: Pick<LedgerService, 'balances' | 'post'>;
  flags: FlagsService;
  audit: AuditService;
  notifications: Pick<NotificationsService, 'notify'>;
  now: () => Date;
  logger: Logger;
  /** Payment records wait this long before the repair job posts them. */
  reconcileGraceMs: number;
  email: EmailProvider;
  finance: Pick<FinanceConfig, 'invoiceTaxBp' | 'invoiceTaxLabel' | 'seller'>;
}) {
  const { ledger, flags, audit, notifications, now, logger } = deps;

  /** Put the tax on an issued invoice in the ledger: the company owes it, we owe it onward. Safe to repeat. */
  async function postTax(inv: {
    publicId: string;
    companyId: Types.ObjectId;
    taxPaise: number;
    number?: string | null;
  }) {
    if (inv.taxPaise > 0) {
      await ledger.post({
        kind: 'INVOICE_TAX',
        idempotencyKey: `inv-tax:${inv.publicId}`,
        entries: [
          {
            account: Accounts.corporateReceivable(inv.companyId.toString()),
            amountPaise: inv.taxPaise,
          },
          { account: Accounts.taxPayable, amountPaise: -inv.taxPaise },
        ],
        description: `Tax on invoice ${inv.number ?? inv.publicId}`,
        at: now(),
      });
    }
    await Invoice.updateOne(
      { publicId: inv.publicId, taxLedgerAt: { $exists: false } },
      { taxLedgerAt: now() },
    );
  }

  const monthStart = () => {
    const ist = new Date(now().getTime() + IST_MS);
    return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST_MS);
  };

  async function companyByPublicId(id: string) {
    const c = await Company.findOne({ publicId: id });
    if (!c) throw new AppError('NOT_FOUND', 'Company not found.');
    return c;
  }

  /** What one person has used (or will use) of this company's account this month. */
  async function usedThisMonth(companyId: Types.ObjectId, userId: Types.ObjectId): Promise<number> {
    const rows = await Booking.aggregate<{ total: number }>([
      {
        $match: {
          corporateId: companyId,
          customerId: userId,
          requestedAt: { $gte: monthStart() },
          status: { $nin: ['CANCELLED', 'NO_DRIVER_FOUND'] },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ['$finalFarePaise', '$estimatedFarePaise'] } },
        },
      },
    ]);
    // A cancelled ride that carried a fee still cost something.
    const fees = await Booking.aggregate<{ total: number }>([
      {
        $match: {
          corporateId: companyId,
          customerId: userId,
          requestedAt: { $gte: monthStart() },
          status: { $in: ['CANCELLED', 'NO_SHOW'] },
          'fee.status': 'DUE',
        },
      },
      { $group: { _id: null, total: { $sum: '$fee.amountPaise' } } },
    ]);
    return (rows[0]?.total ?? 0) + (fees[0]?.total ?? 0);
  }

  /** How much the company owes now and how much is on rides still to be billed. */
  async function exposure(company: { _id: Types.ObjectId }) {
    const account = Accounts.corporateReceivable(company._id.toString());
    const owed = (await ledger.balances([account]))[account]!;
    const open = await Booking.aggregate<{ total: number }>([
      {
        $match: {
          corporateId: company._id,
          'accrual.at': { $exists: false },
          status: {
            $in: [
              'SCHEDULED',
              'REQUESTED',
              'DISPATCHING',
              'DRIVER_ASSIGNED',
              'DRIVER_ARRIVING',
              'DRIVER_ARRIVED',
              'IN_PROGRESS',
              'COMPLETED',
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ['$finalFarePaise', '$estimatedFarePaise'] } },
        },
      },
    ]);
    return { owedPaise: owed, openRidesPaise: open[0]?.total ?? 0 };
  }

  async function activeMembership(userId: string) {
    return Membership.findOne({ userId, status: 'ACTIVE' });
  }

  async function adminOf(userId: string) {
    const m = await activeMembership(userId);
    if (!m || m.role !== 'ADMIN') {
      throw new AppError('CORPORATE_NOT_ALLOWED', 'Only a company admin can do this.');
    }
    const company = await Company.findById(m.companyId);
    if (!company) throw new AppError('NOT_FOUND', 'Company not found.');
    return { membership: m, company };
  }

  const rupees = (p: number) => `₹${(p / 100).toFixed(0)}`;

  async function postCompanyPayment(
    invoiceId: string,
    entry: { key: string; amountPaise: number; reference: string; at: Date },
    companyId: Types.ObjectId,
    number: string | null | undefined,
  ) {
    await ledger.post({
      kind: 'CORPORATE_PAYMENT',
      idempotencyKey: `corp-pay:${invoiceId}:${entry.key}`,
      entries: [
        { account: Accounts.bank, amountPaise: entry.amountPaise },
        {
          account: Accounts.corporateReceivable(companyId.toString()),
          amountPaise: -entry.amountPaise,
        },
      ],
      description: `Payment from company for invoice ${number ?? invoiceId} (${entry.reference})`,
      at: entry.at,
    });
    await Invoice.updateOne(
      { publicId: invoiceId, 'payments.key': entry.key },
      { $set: { 'payments.$.ledgerAt': now() } },
    );
  }

  return {
    /* ---------------- used when a ride is booked ---------------- */

    /**
     * May this rider book this ride on the company's account? Checks the person, the company,
     * the per-ride cap, the person's monthly limit and the company's credit limit. (Two bookings
     * at the very same moment can overshoot a limit slightly; the credit limit is a guard rail,
     * not an exact meter.)
     */
    async authorizeBooking(customerId: string, estimatePaise: number) {
      await flags.assertEnabled('CORPORATE', 'CUSTOMER');
      const m = await activeMembership(customerId);
      if (!m) throw new AppError('CORPORATE_NOT_ALLOWED', 'You are not part of a company account.');
      const company = await Company.findById(m.companyId);
      if (!company || company.status !== 'ACTIVE') {
        throw new AppError('CORPORATE_NOT_ALLOWED', 'Your company account is not active.');
      }
      const over = (message: string) =>
        new AppError('CORPORATE_LIMIT_EXCEEDED', undefined, [{ field: 'paymentMethod', message }]);
      if (company.perRideCapPaise && estimatePaise > company.perRideCapPaise) {
        throw over(
          `A ride on the company account can cost at most ${rupees(company.perRideCapPaise)}.`,
        );
      }
      const limit = m.monthlyLimitPaise ?? company.defaultEmployeeMonthlyLimitPaise;
      const used = await usedThisMonth(company._id, m.userId!);
      if (used + estimatePaise > limit) {
        throw over(
          `This would take you over your monthly limit of ${rupees(limit)} (used ${rupees(used)}).`,
        );
      }
      const { owedPaise, openRidesPaise } = await exposure(company);
      if (owedPaise + openRidesPaise + estimatePaise > company.creditLimitPaise) {
        throw over('Your company has reached its credit limit. Please ask your company admin.');
      }
      return { companyId: company._id, membershipId: m._id };
    },

    /* ---------------- the rider and the company admin ---------------- */

    async me(userId: string) {
      const user = await User.findById(userId).select('phone').lean();
      const m = await activeMembership(userId);
      let current = null;
      if (m) {
        const company = await Company.findById(m.companyId).lean();
        if (company) {
          const used = await usedThisMonth(company._id, m.userId!);
          const limit = m.monthlyLimitPaise ?? company.defaultEmployeeMonthlyLimitPaise;
          current = {
            company: companyView(company as unknown as CompanyLean),
            membership: memberView(m, company as unknown as CompanyLean, used),
            remainingThisMonthPaise: Math.max(0, limit - used),
          };
        }
      }
      const invited = user
        ? await Membership.find({ phone: user.phone, status: 'INVITED' }).lean()
        : [];
      const companies = new Map(
        (await Company.find({ _id: { $in: invited.map((i) => i.companyId) } }).lean()).map((c) => [
          c._id.toString(),
          c,
        ]),
      );
      return {
        current,
        invitations: invited.flatMap((i) => {
          const c = companies.get(i.companyId.toString());
          return c ? [{ membershipId: i.publicId, companyName: c.name, role: i.role }] : [];
        }),
      };
    },

    async accept(userId: string, membershipId: string) {
      const user = await User.findById(userId).select('phone name').lean();
      if (!user) throw new AppError('NOT_FOUND');
      try {
        const m = await Membership.findOneAndUpdate(
          { publicId: membershipId, phone: user.phone, status: 'INVITED' },
          {
            status: 'ACTIVE',
            userId,
            acceptedAt: now(),
            ...(user.name ? { name: user.name } : {}),
          },
          { returnDocument: 'after' },
        );
        if (!m) throw new AppError('NOT_FOUND', 'Invitation not found.');
        return this.me(userId);
      } catch (err) {
        if ((err as { code?: number }).code === DUPLICATE_KEY) {
          throw new AppError(
            'CONFLICT',
            'You are already part of a company account. Leave it first.',
          );
        }
        throw err;
      }
    },

    async leave(userId: string) {
      const m = await activeMembership(userId);
      if (!m) throw new AppError('NOT_FOUND', 'You are not part of a company account.');
      if (m.role === 'ADMIN') {
        const others = await Membership.countDocuments({
          companyId: m.companyId,
          role: 'ADMIN',
          status: 'ACTIVE',
          _id: { $ne: m._id },
        });
        if (others === 0) {
          throw new AppError(
            'UNPROCESSABLE',
            'You are the only admin. Make someone else an admin first.',
          );
        }
      }
      await Membership.updateOne(
        { _id: m._id, status: 'ACTIVE' },
        { status: 'REMOVED', removedAt: now() },
      );
      return { left: true };
    },

    async employees(adminUserId: string) {
      const { company } = await adminOf(adminUserId);
      const rows = await Membership.find({ companyId: company._id, status: { $ne: 'REMOVED' } })
        .sort({ createdAt: 1 })
        .lean();
      const items = [];
      for (const m of rows) {
        const used = m.userId ? await usedThisMonth(company._id, m.userId) : 0;
        items.push(memberView(m, company as unknown as CompanyLean, used));
      }
      return items;
    },

    async invite(adminUserId: string, input: z.infer<typeof inviteSchema>) {
      const { company } = await adminOf(adminUserId);
      if (company.status !== 'ACTIVE')
        throw new AppError('CORPORATE_NOT_ALLOWED', 'The company account is not active.');
      const phone = normalizePhone(input.phone);
      if (!phone) {
        throw new AppError('VALIDATION_ERROR', undefined, [
          { field: 'phone', message: 'Invalid phone number' },
        ]);
      }
      try {
        const m = await Membership.create({
          publicId: publicId('mem'),
          companyId: company._id,
          phone,
          ...(input.name ? { name: input.name } : {}),
          role: input.role,
          monthlyLimitPaise: input.monthlyLimitPaise ?? null,
          invitedBy: adminUserId,
        });
        await this.tellInvited(phone, company.name, m.publicId);
        return memberView(m, company as unknown as CompanyLean);
      } catch (err) {
        if ((err as { code?: number }).code === DUPLICATE_KEY) {
          throw new AppError('CONFLICT', 'This person is already invited or part of the company.');
        }
        throw err;
      }
    },

    async tellInvited(phone: string, companyName: string, membershipId: string) {
      const user = await User.findOne({ phone }).select('_id').lean();
      if (!user) return; // they will see the invitation when they sign up
      await notifications
        .notify(user._id.toString(), {
          type: 'corporate.invited',
          title: 'You were invited to a company account',
          body: `${companyName} invited you to ride on their account. Open the app to accept.`,
          data: { membershipId },
          dedupeKey: `corp-invite:${membershipId}`,
        })
        .catch((err) => logger.error({ err }, 'could not send a company invitation'));
    },

    async updateMember(
      adminUserId: string,
      membershipId: string,
      input: z.infer<typeof updateMemberSchema>,
    ) {
      const { company, membership: me } = await adminOf(adminUserId);
      const target = await Membership.findOne({
        publicId: membershipId,
        companyId: company._id,
        status: { $ne: 'REMOVED' },
      });
      if (!target) throw new AppError('NOT_FOUND', 'Employee not found.');
      if (
        target._id.equals(me._id) &&
        (input.status === 'REMOVED' || (input.role && input.role !== 'ADMIN'))
      ) {
        throw new AppError(
          'UNPROCESSABLE',
          'You cannot remove or demote yourself. Ask another admin.',
        );
      }
      const set: Record<string, unknown> = {};
      if (input.role) set['role'] = input.role;
      if (input.monthlyLimitPaise !== undefined) set['monthlyLimitPaise'] = input.monthlyLimitPaise;
      if (input.status === 'REMOVED') {
        set['status'] = 'REMOVED';
        set['removedAt'] = now();
      }
      const updated = await Membership.findOneAndUpdate(
        { _id: target._id, status: { $ne: 'REMOVED' } },
        { $set: set },
        { returnDocument: 'after' },
      );
      if (!updated) throw new AppError('CONFLICT', 'This person was already removed.');
      return memberView(updated, company as unknown as CompanyLean);
    },

    async companyRides(adminUserId: string, q: z.infer<typeof companyRidesQuerySchema>) {
      const { company } = await adminOf(adminUserId);
      const filter: Record<string, unknown> = { corporateId: company._id };
      if (q.from || q.to) {
        filter['requestedAt'] = {
          ...(q.from ? { $gte: q.from } : {}),
          ...(q.to ? { $lt: q.to } : {}),
        };
      }
      const [total, rows] = await Promise.all([
        Booking.countDocuments(filter),
        Booking.find(filter)
          .sort({ requestedAt: -1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
      ]);
      const users = new Map(
        (
          await User.find({ _id: { $in: rows.map((r) => r.customerId) } })
            .select('name phone')
            .lean()
        ).map((u) => [u._id.toString(), u]),
      );
      return {
        items: rows.map((b) => ({
          bookingId: b.publicId,
          status: b.status,
          at: b.requestedAt,
          rider:
            users.get(b.customerId.toString())?.name ??
            users.get(b.customerId.toString())?.phone ??
            null,
          from: b.pickup.label ?? null,
          to: b.drop.label ?? null,
          reference: b.corporateReference ?? null,
          amountPaise: b.finalFarePaise ?? b.fee?.amountPaise ?? b.estimatedFarePaise,
          invoiced: Boolean(b.invoicedIn),
        })),
        meta: pageMeta(q.page, q.limit, total),
      };
    },

    async companyInvoices(adminUserId: string, q: z.infer<typeof invoiceListQuerySchema>) {
      const { company } = await adminOf(adminUserId);
      const filter = {
        companyId: company._id,
        status: { $in: ['ISSUED', 'PAID'] },
        ...(q.status && ['ISSUED', 'PAID'].includes(q.status) ? { status: q.status } : {}),
      };
      const [total, rows] = await Promise.all([
        Invoice.countDocuments(filter as never),
        Invoice.find(filter as never)
          .sort({ issuedAt: -1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
      ]);
      return {
        items: rows.map((i) => invoiceView(i as unknown as InvoiceLean, company, false)),
        meta: pageMeta(q.page, q.limit, total),
      };
    },

    async companyInvoice(adminUserId: string, invoiceId: string) {
      const { company } = await adminOf(adminUserId);
      const i = await Invoice.findOne({
        publicId: invoiceId,
        companyId: company._id,
        status: { $in: ['ISSUED', 'PAID'] },
      }).lean();
      if (!i) throw new AppError('NOT_FOUND', 'Invoice not found.');
      return invoiceView(i as unknown as InvoiceLean, company);
    },

    /* ---------------- finance and operations ---------------- */

    async createCompany(actor: Actor, input: z.infer<typeof createCompanySchema>) {
      const phone = normalizePhone(input.adminPhone);
      if (!phone) {
        throw new AppError('VALIDATION_ERROR', undefined, [
          { field: 'adminPhone', message: 'Invalid phone number' },
        ]);
      }
      const company = await Company.create({
        publicId: publicId('corp'),
        name: input.name,
        ...(input.legalName ? { legalName: input.legalName } : {}),
        ...(input.gstin ? { gstin: input.gstin } : {}),
        billingEmail: input.billingEmail,
        creditLimitPaise: input.creditLimitPaise,
        paymentTermsDays: input.paymentTermsDays,
        defaultEmployeeMonthlyLimitPaise: input.defaultEmployeeMonthlyLimitPaise,
        perRideCapPaise: input.perRideCapPaise ?? null,
        createdBy: actor.userId,
      });
      const admin = await Membership.create({
        publicId: publicId('mem'),
        companyId: company._id,
        phone,
        ...(input.adminName ? { name: input.adminName } : {}),
        role: 'ADMIN',
        invitedBy: actor.userId,
      });
      await this.tellInvited(phone, company.name, admin.publicId);
      await audit.record(actor, {
        action: 'corporate.company.create',
        targetType: 'Company',
        targetId: company.publicId,
        metadata: { name: company.name, creditLimitPaise: company.creditLimitPaise },
      });
      return {
        ...companyView(company as unknown as CompanyLean),
        firstAdmin: memberView(admin, company as unknown as CompanyLean),
      };
    },

    async listCompanies(q: z.infer<typeof companyListQuerySchema>) {
      const filter: Record<string, unknown> = {};
      if (q.status) filter['status'] = q.status;
      if (q.q) filter['name'] = new RegExp(escapeRegex(q.q), 'i');
      const [total, rows] = await Promise.all([
        Company.countDocuments(filter),
        Company.find(filter)
          .sort({ name: 1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
      ]);
      return {
        items: rows.map((c) => companyView(c as unknown as CompanyLean)),
        meta: pageMeta(q.page, q.limit, total),
      };
    },

    async companyDetail(companyId: string) {
      const company = await companyByPublicId(companyId);
      const [{ owedPaise, openRidesPaise }, employees, admins, unpaid] = await Promise.all([
        exposure(company),
        Membership.countDocuments({ companyId: company._id, status: 'ACTIVE' }),
        Membership.find({
          companyId: company._id,
          role: 'ADMIN',
          status: { $ne: 'REMOVED' },
        }).lean(),
        Invoice.aggregate<{ total: number }>([
          { $match: { companyId: company._id, status: 'ISSUED' } },
          { $group: { _id: null, total: { $sum: { $subtract: ['$totalPaise', '$paidPaise'] } } } },
        ]),
      ]);
      return {
        ...companyView(company as unknown as CompanyLean),
        activeEmployees: employees,
        admins: admins.map((a) => memberView(a, company as unknown as CompanyLean)),
        exposure: {
          owedPaise,
          openRidesPaise,
          availableCreditPaise: Math.max(0, company.creditLimitPaise - owedPaise - openRidesPaise),
          invoicedUnpaidPaise: unpaid[0]?.total ?? 0,
        },
      };
    },

    async updateCompany(
      actor: Actor,
      companyId: string,
      input: z.infer<typeof updateCompanySchema>,
    ) {
      const company = await companyByPublicId(companyId);
      const updated = await Company.findOneAndUpdate(
        { _id: company._id },
        { $set: input },
        { returnDocument: 'after' },
      );
      await audit.record(actor, {
        action: 'corporate.company.update',
        targetType: 'Company',
        targetId: companyId,
        metadata: { ...input },
      });
      return companyView(updated as unknown as CompanyLean);
    },

    /** Gather the company's billed rides and fees in a period into a draft invoice. */
    async generateInvoice(
      actor: Actor,
      companyId: string,
      input: z.infer<typeof generateInvoiceSchema>,
    ) {
      const company = await companyByPublicId(companyId);
      const invoice = await Invoice.create({
        publicId: publicId('inv'),
        companyId: company._id,
        from: input.from,
        to: input.to,
        subtotalPaise: 0,
        totalPaise: 0,
        createdBy: actor.userId,
      });
      // Claim the rides first (a ride can be on one invoice only), then read back what was claimed.
      const claimed = await Booking.updateMany(
        {
          corporateId: company._id,
          'accrual.at': { $gte: input.from, $lt: input.to },
          invoicedIn: { $exists: false },
        },
        { invoicedIn: invoice.publicId },
      );
      if (claimed.modifiedCount === 0) {
        await Invoice.deleteOne({ _id: invoice._id });
        throw new AppError('UNPROCESSABLE', 'There is nothing to invoice in this period.');
      }
      const rows = await Booking.find({ invoicedIn: invoice.publicId })
        .sort({ 'accrual.at': 1 })
        .lean();
      const users = new Map(
        (
          await User.find({ _id: { $in: rows.map((r) => r.customerId) } })
            .select('name phone')
            .lean()
        ).map((u) => [u._id.toString(), u]),
      );
      const lines = rows.map((b) => ({
        bookingId: b.publicId,
        kind: b.accrual!.kind,
        at: b.accrual!.at,
        rider:
          users.get(b.customerId.toString())?.name ?? users.get(b.customerId.toString())?.phone,
        from: b.pickup.label ?? undefined,
        to: b.drop.label ?? undefined,
        reference: b.corporateReference ?? undefined,
        amountPaise: b.accrual!.amountPaise - (b.corporateCreditedPaise ?? 0),
      }));
      const subtotal = lines.reduce((n, l) => n + l.amountPaise, 0);
      const saved = await Invoice.findOneAndUpdate(
        { _id: invoice._id },
        { lines, subtotalPaise: subtotal, totalPaise: subtotal },
        { returnDocument: 'after' },
      );
      await audit.record(actor, {
        action: 'corporate.invoice.generate',
        targetType: 'Invoice',
        targetId: invoice.publicId,
        metadata: { companyId, lines: lines.length, totalPaise: subtotal },
      });
      return invoiceView(saved as unknown as InvoiceLean, company);
    },

    /** Give a draft invoice its number and due date and send it to the company. */
    async issueInvoice(actor: Actor, invoiceId: string) {
      const draft = await Invoice.findOne({ publicId: invoiceId, status: 'DRAFT' });
      if (!draft) {
        if (!(await Invoice.exists({ publicId: invoiceId }))) throw new AppError('NOT_FOUND');
        throw new AppError('CONFLICT', 'Only a draft invoice can be issued.');
      }
      if (draft.totalPaise <= 0) {
        throw new AppError(
          'UNPROCESSABLE',
          'An invoice with nothing to pay cannot be issued. Void it.',
        );
      }
      const company = await Company.findById(draft.companyId);
      if (!company) throw new AppError('NOT_FOUND', 'Company not found.');
      const at = now();
      const year = new Date(at.getTime() + IST_MS).getUTCFullYear();
      const counter = await InvoiceCounter.findOneAndUpdate(
        { _id: `CI-${year}` },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'after' },
      );
      const number = `CI-${year}-${String(counter.seq).padStart(6, '0')}`;
      const taxPaise = Math.round((draft.subtotalPaise * deps.finance.invoiceTaxBp) / 10_000);
      const issued = await Invoice.findOneAndUpdate(
        { _id: draft._id, status: 'DRAFT' },
        {
          status: 'ISSUED',
          number,
          issuedAt: at,
          dueAt: new Date(at.getTime() + company.paymentTermsDays * DAY),
          taxBp: deps.finance.invoiceTaxBp,
          taxLabel: deps.finance.invoiceTaxLabel,
          taxPaise,
          totalPaise: draft.subtotalPaise + taxPaise,
          seller: deps.finance.seller,
        },
        { returnDocument: 'after' },
      );
      if (!issued) throw new AppError('CONFLICT', 'Only a draft invoice can be issued.');
      await postTax(issued);
      // Tell the company by email (the invoice itself is in their app).
      await deps.email
        .send({
          to: company.billingEmail,
          subject: `Invoice ${number} from ${deps.finance.seller.name}`,
          text: `Invoice ${number}\nAmount due: ₹${(issued.totalPaise / 100).toFixed(2)}${taxPaise > 0 ? ` (including ${deps.finance.invoiceTaxLabel} ₹${(taxPaise / 100).toFixed(2)})` : ''}\nDue date: ${issued.dueAt!.toISOString().slice(0, 10)}\n\nOpen the app (company account > Invoices) to see every ride on it.`,
        })
        .catch((err) => logger.error({ err, invoiceId }, 'could not email an invoice notice'));
      await audit.record(actor, {
        action: 'corporate.invoice.issue',
        targetType: 'Invoice',
        targetId: invoiceId,
        metadata: { number, totalPaise: issued.totalPaise },
      });
      return invoiceView(issued as unknown as InvoiceLean, company);
    },

    /** Cancel a draft or an issued-but-unpaid invoice: its rides become available for a new one. */
    async voidInvoice(actor: Actor, invoiceId: string) {
      const voided = await Invoice.findOneAndUpdate(
        { publicId: invoiceId, status: { $in: ['DRAFT', 'ISSUED'] }, paidPaise: 0 },
        { status: 'VOID', voidedAt: now() },
        { returnDocument: 'after' },
      );
      if (!voided) {
        if (!(await Invoice.exists({ publicId: invoiceId }))) throw new AppError('NOT_FOUND');
        throw new AppError('CONFLICT', 'Only an unpaid draft or issued invoice can be voided.');
      }
      // Tax already in the ledger comes back out.
      if (voided.taxPaise > 0 && voided.taxLedgerAt) {
        await ledger.post({
          kind: 'INVOICE_TAX',
          idempotencyKey: `inv-tax-void:${voided.publicId}`,
          entries: [
            {
              account: Accounts.corporateReceivable(voided.companyId.toString()),
              amountPaise: -voided.taxPaise,
            },
            { account: Accounts.taxPayable, amountPaise: voided.taxPaise },
          ],
          description: `Tax reversed: invoice ${voided.number ?? voided.publicId} cancelled`,
          at: now(),
        });
      }
      await Booking.updateMany({ invoicedIn: invoiceId }, { $unset: { invoicedIn: 1 } });
      await audit.record(actor, {
        action: 'corporate.invoice.void',
        targetType: 'Invoice',
        targetId: invoiceId,
      });
      return invoiceView(voided as unknown as InvoiceLean, null, false);
    },

    /** The company paid (all or part) by bank transfer: record it. Safe to repeat with the same key. */
    async recordPayment(
      actor: Actor,
      invoiceId: string,
      input: z.infer<typeof invoicePaymentSchema>,
      key: string,
    ) {
      const inv = await Invoice.findOne({ publicId: invoiceId });
      if (!inv) throw new AppError('NOT_FOUND');
      const company = await Company.findById(inv.companyId);
      if (inv.payments.some((p) => p.key === key)) {
        return invoiceView(inv as unknown as InvoiceLean, company, false); // the same request again
      }
      if (inv.status !== 'ISSUED') {
        throw new AppError('CONFLICT', 'Only an issued invoice can be paid.');
      }
      const at = now();
      const entry = {
        key,
        amountPaise: input.amountPaise,
        reference: input.reference,
        at,
        by: actor.userId,
      };
      const updated = await Invoice.findOneAndUpdate(
        {
          _id: inv._id,
          status: 'ISSUED',
          'payments.key': { $ne: key },
          $expr: { $lte: [{ $add: ['$paidPaise', input.amountPaise] }, '$totalPaise'] },
        },
        { $push: { payments: entry }, $inc: { paidPaise: input.amountPaise } },
        { returnDocument: 'after' },
      );
      if (!updated) {
        throw new AppError('UNPROCESSABLE', undefined, [
          { field: 'amountPaise', message: 'More than is left to pay on this invoice' },
        ]);
      }
      await postCompanyPayment(inv.publicId, entry, inv.companyId, inv.number);
      let final = updated;
      if (updated.paidPaise >= updated.totalPaise) {
        final =
          (await Invoice.findOneAndUpdate(
            { _id: inv._id, status: 'ISSUED' },
            { status: 'PAID', paidAt: at },
            { returnDocument: 'after' },
          )) ?? updated;
      }
      await audit.record(actor, {
        action: 'corporate.invoice.payment',
        targetType: 'Invoice',
        targetId: invoiceId,
        metadata: { amountPaise: input.amountPaise, reference: input.reference },
      });
      return invoiceView(final as unknown as InvoiceLean, company, false);
    },

    async listInvoices(q: z.infer<typeof invoiceListQuerySchema>) {
      const filter: Record<string, unknown> = {};
      if (q.status) filter['status'] = q.status;
      if (q.companyId) {
        const c = await Company.findOne({ publicId: q.companyId }).select('_id').lean();
        filter['companyId'] = c?._id ?? null;
      }
      if (q.overdue) {
        filter['status'] = 'ISSUED';
        filter['dueAt'] = { $lt: now() };
      }
      const [total, rows] = await Promise.all([
        Invoice.countDocuments(filter),
        Invoice.find(filter)
          .sort({ createdAt: -1 })
          .skip((q.page - 1) * q.limit)
          .limit(q.limit)
          .lean(),
      ]);
      const companies = new Map(
        (await Company.find({ _id: { $in: rows.map((r) => r.companyId) } }).lean()).map((c) => [
          c._id.toString(),
          c,
        ]),
      );
      return {
        items: rows.map((i) =>
          invoiceView(
            i as unknown as InvoiceLean,
            (companies.get(i.companyId.toString()) ?? null) as unknown as CompanyLean | null,
            false,
          ),
        ),
        meta: pageMeta(q.page, q.limit, total),
      };
    },

    async invoiceDetail(invoiceId: string) {
      const i = await Invoice.findOne({ publicId: invoiceId }).lean();
      if (!i) throw new AppError('NOT_FOUND');
      const company = await Company.findById(i.companyId).lean();
      return invoiceView(i as unknown as InvoiceLean, company as unknown as CompanyLean | null);
    },

    /** Take (part of) a ride's charge off what the company owes, before it is invoiced. */
    async creditBooking(
      actor: Actor,
      bookingPublicId: string,
      input: z.infer<typeof creditSchema>,
    ) {
      const b = await Booking.findOne({
        publicId: bookingPublicId,
        corporateId: { $exists: true },
      });
      if (!b || !b.accrual?.at)
        throw new AppError('NOT_FOUND', 'No billed company ride with that id.');
      if (b.invoicedIn) {
        throw new AppError(
          'CONFLICT',
          'This ride is already on an invoice. Void the invoice first, or settle it with the company.',
        );
      }
      const updated = await Booking.findOneAndUpdate(
        {
          _id: b._id,
          invoicedIn: { $exists: false },
          $expr: {
            $lte: [
              { $add: [{ $ifNull: ['$corporateCreditedPaise', 0] }, input.amountPaise] },
              '$accrual.amountPaise',
            ],
          },
        },
        { $inc: { corporateCreditedPaise: input.amountPaise } },
        { returnDocument: 'after' },
      );
      if (!updated) {
        throw new AppError('UNPROCESSABLE', undefined, [
          { field: 'amountPaise', message: 'More than is left to credit on this ride' },
        ]);
      }
      try {
        await ledger.post({
          kind: 'CORPORATE_CREDIT',
          idempotencyKey: `corp-credit:${b.publicId}:${updated.corporateCreditedPaise}`,
          entries: [
            {
              account: Accounts.corporateReceivable(b.corporateId!.toString()),
              amountPaise: -input.amountPaise,
            },
            { account: Accounts.refunds, amountPaise: input.amountPaise },
          ],
          bookingId: b._id,
          bookingPublicId: b.publicId,
          description: `Credit to company: ${input.reason}`,
          at: now(),
        });
      } catch (err) {
        await Booking.updateOne(
          { _id: b._id },
          { $inc: { corporateCreditedPaise: -input.amountPaise } },
        );
        throw err;
      }
      await audit.record(actor, {
        action: 'corporate.credit',
        targetType: 'Booking',
        targetId: bookingPublicId,
        metadata: { amountPaise: input.amountPaise, reason: input.reason },
      });
      return { bookingId: bookingPublicId, creditedPaise: updated.corporateCreditedPaise ?? 0 };
    },

    /** Repair: a company payment that was saved but never reached the ledger. */
    async reconcile(): Promise<{ posted: number }> {
      const cutoff = new Date(now().getTime() - deps.reconcileGraceMs);
      // Tax on an issued invoice that never reached the ledger.
      const untaxed = await Invoice.find({
        status: { $in: ['ISSUED', 'PAID'] },
        taxPaise: { $gt: 0 },
        taxLedgerAt: { $exists: false },
        issuedAt: { $lte: cutoff },
      }).limit(50);
      for (const inv of untaxed) await postTax(inv);
      const pending = await Invoice.find({
        payments: { $elemMatch: { ledgerAt: { $exists: false }, at: { $lte: cutoff } } },
      }).limit(50);
      let posted = 0;
      for (const inv of pending) {
        for (const p of inv.payments) {
          if (!(p as { ledgerAt?: Date }).ledgerAt && p.at <= cutoff) {
            await postCompanyPayment(inv.publicId, p, inv.companyId, inv.number);
            posted += 1;
          }
        }
      }
      return { posted };
    },
  };
}

export type CorporateService = ReturnType<typeof createCorporateService>;
