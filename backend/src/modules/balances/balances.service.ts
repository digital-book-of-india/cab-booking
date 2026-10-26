import { z } from 'zod';
import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import { pageMeta, paginationSchema } from '../../common/pagination';
import { escapeRegex, objectId } from '../../common/zod';
import type { AuditService } from '../audit/audit.service';
import { Booking } from '../bookings/booking.model';
import { DriverProfile } from '../drivers/driverProfile.model';
import { requireDriverProfile } from '../drivers/drivers.service';
import { User } from '../users/user.model';
import { Accounts } from '../ledger/accounts';
import type { FinanceConfig } from '../ledger/finance.config';
import type { LedgerService } from '../ledger/ledger.service';
import { Tip } from '../tips/tip.model';
import { LedgerKinds, LedgerTransaction } from '../ledger/ledgerTransaction.model';
import { amountDue, amountOwed } from '../payments/amountDue';
import { Payment } from '../payments/payment.model';
import { Refund } from '../payments/refund.model';
import { Settlement } from '../settlements/settlement.model';

export const earningsQuerySchema = paginationSchema.extend({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const driverBalancesQuerySchema = paginationSchema.extend({
  overLimit: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  q: z.string().trim().min(1).max(50).optional(),
});

export const ledgerQuerySchema = paginationSchema.extend({
  account: z.string().trim().min(1).max(100).optional(),
  bookingId: z
    .string()
    .regex(/^bk_[0-9a-f]{12}$/)
    .optional(),
  driverId: objectId.optional(),
  kind: z.enum(LedgerKinds).optional(),
});

export const writeOffSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

export const disputeSchema = z
  .object({ disputed: z.boolean(), reason: z.string().trim().min(3).max(300) })
  .strict();

export type EarningsQuery = z.infer<typeof earningsQuerySchema>;
export type DriverBalancesQuery = z.infer<typeof driverBalancesQuerySchema>;
export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;
export type WriteOffInput = z.infer<typeof writeOffSchema>;
export type DisputeInput = z.infer<typeof disputeSchema>;

export function createBalancesService(deps: {
  ledger: LedgerService;
  audit: AuditService;
  now: () => Date;
  config: FinanceConfig;
}) {
  const { ledger, audit, now, config } = deps;

  /** Unpaid bookings that are old enough to block the rider from booking again. */
  function overdueFilter(customerId: string): Record<string, unknown> {
    const cutoff = new Date(now().getTime() - config.unpaidGraceMs);
    return {
      customerId,
      paymentStatus: { $in: ['DUE', 'FAILED'] },
      $or: [
        { status: 'COMPLETED', completedAt: { $lte: cutoff } },
        {
          status: { $in: ['CANCELLED', 'NO_SHOW'] },
          'fee.status': 'DUE',
          'fee.at': { $lte: cutoff },
        },
      ],
    };
  }

  return {
    /** Called before a booking is created: a rider with an old unpaid ride must pay it first. */
    async assertCanBook(customerId: string): Promise<void> {
      if (await Booking.exists(overdueFilter(customerId))) throw new AppError('UNPAID_BALANCE');
    },

    async customerBalance(customerId: string) {
      const rows = await Booking.find({
        customerId,
        paymentStatus: { $in: ['DUE', 'FAILED', 'PROCESSING', 'DISPUTED'] },
      })
        .sort({ requestedAt: -1 })
        .limit(50)
        .lean();
      const cutoff = now().getTime() - config.unpaidGraceMs;
      const items = rows.flatMap((b) => {
        const owed = amountOwed(b);
        if (!owed) return [];
        const since = b.status === 'COMPLETED' ? b.completedAt : b.fee?.at;
        return [
          {
            bookingId: b.publicId,
            amountPaise: owed.amountPaise,
            purpose: owed.purpose,
            paymentStatus: b.paymentStatus,
            since: since ?? null,
            overdue: Boolean(
              since &&
              since.getTime() <= cutoff &&
              ['DUE', 'FAILED'].includes(b.paymentStatus ?? ''),
            ),
            payable: amountDue(b) !== null,
          },
        ];
      });
      return {
        currency: 'INR',
        unpaidPaise: items.reduce((n, i) => n + i.amountPaise, 0),
        blocked: items.some((i) => i.overdue),
        items,
      };
    },

    async driverBalance(userId: string) {
      const profile = await requireDriverProfile(userId);
      const position = await ledger.driverPosition(profile._id.toString());
      const open = await Settlement.findOne({ driverId: profile._id, open: true }).lean();
      return {
        currency: 'INR',
        cashHeldPaise: position.cashHeldPaise,
        payablePaise: position.payablePaise,
        netOwedToPlatformPaise: position.netOwedByDriverPaise,
        cashLimitPaise: config.driverCashLimitPaise,
        blockedByCashLimit: position.netOwedByDriverPaise > config.driverCashLimitPaise,
        openSettlementId: open?.publicId ?? null,
      };
    },

    /** Per ride (or fee): what was charged, the platform's cut, and what the driver earned. */
    async earnings(userId: string, query: EarningsQuery) {
      const profile = await requireDriverProfile(userId);
      const filter: Record<string, unknown> = {
        assignedDriverId: profile._id,
        'accrual.at': { $exists: true },
      };
      if (query.from || query.to) {
        filter['accrual.at'] = {
          $exists: true,
          ...(query.from ? { $gte: query.from } : {}),
          ...(query.to ? { $lte: query.to } : {}),
        };
      }
      const [total, rows, sums] = await Promise.all([
        Booking.countDocuments(filter),
        Booking.find(filter)
          .sort({ 'accrual.at': -1 })
          .skip((query.page - 1) * query.limit)
          .limit(query.limit)
          .lean(),
        Booking.aggregate<{ amount: number; commission: number; earned: number }>([
          { $match: filter },
          {
            $group: {
              _id: null,
              amount: { $sum: '$accrual.amountPaise' },
              commission: { $sum: '$accrual.commissionPaise' },
              earned: { $sum: '$accrual.driverSharePaise' },
            },
          },
        ]),
      ]);
      // Tips are the driver's in full, so they are shown beside (not inside) the commission figures.
      const tipRows = await Tip.aggregate<{ total: number; count: number }>([
        {
          $match: {
            driverId: profile._id,
            status: 'PAID',
            source: { $ne: 'CASH' },
            ...(query.from || query.to
              ? {
                  paidAt: {
                    ...(query.from ? { $gte: query.from } : {}),
                    ...(query.to ? { $lte: query.to } : {}),
                  },
                }
              : {}),
          },
        },
        { $group: { _id: null, total: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
      ]);
      return {
        items: rows.map((b) => ({
          bookingId: b.publicId,
          rideId: b.rideId ?? null,
          kind: b.accrual!.kind,
          chargedPaise: b.accrual!.amountPaise,
          grossFarePaise: b.accrual!.grossPaise ?? b.accrual!.amountPaise,
          discountPaise: b.accrual!.discountPaise ?? 0,
          commissionPaise: b.accrual!.commissionPaise,
          // Tax the rider paid on top of the fare (not part of the driver's pay), and the tax on the
          // commission that was taken out of the driver's share.
          taxPaise: b.accrual!.taxPaise ?? 0,
          commissionTaxPaise: b.accrual!.commissionTaxPaise ?? 0,
          earningsPaise: b.accrual!.driverSharePaise,
          paymentMethod: b.paymentMethod,
          paymentStatus: b.paymentStatus,
          at: b.accrual!.at,
        })),
        totals: {
          chargedPaise: sums[0]?.amount ?? 0,
          commissionPaise: sums[0]?.commission ?? 0,
          earningsPaise: sums[0]?.earned ?? 0,
          tipsPaise: tipRows[0]?.total ?? 0,
          tipCount: tipRows[0]?.count ?? 0,
        },
        meta: pageMeta(query.page, query.limit, total),
      };
    },

    /** Everyone's standing, worst first: who holds cash, who is owed money. */
    async driverBalances(query: DriverBalancesQuery) {
      const rows = await LedgerTransaction.aggregate<{ _id: string; total: number }>([
        { $unwind: '$entries' },
        { $match: { 'entries.account': { $regex: '^DRIVER_(CASH|PAYABLE):' } } },
        { $group: { _id: '$entries.account', total: { $sum: '$entries.amountPaise' } } },
      ]);
      const byDriver = new Map<string, { cash: number; payable: number }>();
      for (const r of rows) {
        const [kind, id] = r._id.split(':') as [string, string];
        const cur = byDriver.get(id) ?? { cash: 0, payable: 0 };
        if (kind === 'DRIVER_CASH') cur.cash = r.total;
        else cur.payable = -r.total;
        byDriver.set(id, cur);
      }
      let list = [...byDriver.entries()]
        .map(([driverId, v]) => ({ driverId, ...v, net: v.cash - v.payable }))
        .filter((d) => d.cash !== 0 || d.payable !== 0);
      if (query.overLimit !== undefined) {
        list = list.filter((d) => d.net > config.driverCashLimitPaise === query.overLimit);
      }
      const profiles = await DriverProfile.find({ _id: { $in: list.map((d) => d.driverId) } })
        .select('userId')
        .lean();
      const users = await User.find({ _id: { $in: profiles.map((p) => p.userId) } })
        .select('name phone')
        .lean();
      const userOf = new Map(users.map((u) => [u._id.toString(), u]));
      const profileOf = new Map(profiles.map((p) => [p._id.toString(), p.userId.toString()]));
      let enriched = list.map((d) => {
        const u = userOf.get(profileOf.get(d.driverId) ?? '');
        return {
          driverId: d.driverId,
          name: u?.name ?? null,
          phone: u?.phone ?? null,
          cashHeldPaise: d.cash,
          payablePaise: d.payable,
          netOwedToPlatformPaise: d.net,
          overLimit: d.net > config.driverCashLimitPaise,
        };
      });
      if (query.q) {
        const rx = new RegExp(escapeRegex(query.q), 'i');
        enriched = enriched.filter((d) => rx.test(d.name ?? '') || rx.test(d.phone ?? ''));
      }
      enriched.sort((a, b) => b.netOwedToPlatformPaise - a.netOwedToPlatformPaise);
      const start = (query.page - 1) * query.limit;
      return {
        items: enriched.slice(start, start + query.limit),
        meta: pageMeta(query.page, query.limit, enriched.length),
      };
    },

    async ledgerEntries(query: LedgerQuery) {
      const filter: Record<string, unknown> = {};
      if (query.account) filter['entries.account'] = query.account;
      if (query.bookingId) filter['bookingPublicId'] = query.bookingId;
      if (query.driverId) filter['driverId'] = query.driverId;
      if (query.kind) filter['kind'] = query.kind;
      const [total, rows] = await Promise.all([
        LedgerTransaction.countDocuments(filter),
        LedgerTransaction.find(filter)
          .sort({ at: -1, _id: -1 })
          .skip((query.page - 1) * query.limit)
          .limit(query.limit)
          .lean(),
      ]);
      return {
        items: rows.map((t) => ({
          txnId: t.txnId,
          kind: t.kind,
          bookingId: t.bookingPublicId ?? null,
          driverId: t.driverId?.toString() ?? null,
          description: t.description ?? null,
          entries: t.entries.map((e) => ({ account: e.account, amountPaise: e.amountPaise })),
          at: t.at,
        })),
        meta: pageMeta(query.page, query.limit, total),
      };
    },

    /** The books must balance and nothing may be waiting to be recorded. */
    async consistency() {
      const check = await ledger.checkBalance();
      const cutoff = new Date(now().getTime() - config.reconcileGraceMs);
      const [paymentsNotRecorded, onlineMismatches] = await Promise.all([
        Payment.countDocuments({
          status: 'PAID',
          ledgerRecordedAt: { $exists: false },
          paidAt: { $lte: cutoff },
        }),
        // Money in the gateway account must equal captured payments less processed refunds.
        ledger.balances([Accounts.gateway]),
      ]);
      const [captured, refunded] = await Promise.all([
        Payment.aggregate<{ total: number }>([
          // Wallet payments never touch the gateway, so they are not part of its balance.
          {
            $match: {
              status: 'PAID',
              method: { $ne: 'WALLET' },
              ledgerRecordedAt: { $exists: true },
            },
          },
          { $group: { _id: null, total: { $sum: '$amountPaise' } } },
        ]),
        Refund.aggregate<{ total: number }>([
          // Refunds credited to a wallet stay with us; only refunds sent back leave the gateway.
          { $match: { status: 'PROCESSED', destination: { $ne: 'WALLET' } } },
          { $group: { _id: null, total: { $sum: '$amountPaise' } } },
        ]),
      ]);
      const expectedGateway = (captured[0]?.total ?? 0) - (refunded[0]?.total ?? 0);
      // A wallet is stored as a credit (negative). A positive total would mean more was spent than held.
      const wallets = await LedgerTransaction.aggregate<{ _id: string; total: number }>([
        { $unwind: '$entries' },
        { $match: { 'entries.account': { $regex: '^WALLET:' } } },
        { $group: { _id: '$entries.account', total: { $sum: '$entries.amountPaise' } } },
        { $match: { total: { $gt: 0 } } },
        { $limit: 20 },
      ]);
      const gatewayPaise = onlineMismatches[Accounts.gateway]!;
      const ok =
        check.ledgerTotalPaise === 0 &&
        check.unbalancedTransactions.length === 0 &&
        check.completedRidesWithoutAccrual === 0 &&
        paymentsNotRecorded === 0 &&
        wallets.length === 0 &&
        gatewayPaise === expectedGateway;
      return {
        ok,
        ledgerTotalPaise: check.ledgerTotalPaise,
        unbalancedTransactions: check.unbalancedTransactions,
        completedRidesWithoutAccrual: check.completedRidesWithoutAccrual,
        paymentsNotInLedger: paymentsNotRecorded,
        gatewayBalancePaise: gatewayPaise,
        expectedGatewayPaise: expectedGateway,
        overdrawnWallets: wallets.map((w) => w._id),
      };
    },

    /** Give up on money a rider will not pay. The driver is still paid; the platform takes the loss. */
    async writeOff(actor: Actor, bookingPublicId: string, input: WriteOffInput) {
      const b = await Booking.findOne({ publicId: bookingPublicId });
      if (!b) throw new AppError('NOT_FOUND', 'Booking not found.');
      const owed = amountOwed(b);
      if (!owed) throw new AppError('CONFLICT', 'There is nothing owed on this booking.');
      const settled = await Booking.findOneAndUpdate(
        { _id: b._id, paymentStatus: { $in: ['DUE', 'FAILED', 'DISPUTED'] } },
        { paymentStatus: 'WRITTEN_OFF', paidBy: `WRITE_OFF:${actor.userId}`, paidAt: now() },
        { returnDocument: 'after' },
      );
      if (!settled) {
        throw new AppError('CONFLICT', `A ${b.paymentStatus} booking cannot be written off.`);
      }
      // It must have been recorded as owed before it can be written off.
      if (owed.purpose === 'FARE') await ledger.accrueRide(b._id);
      else await ledger.accrueFee(b._id);
      await ledger.post({
        kind: 'WRITE_OFF',
        idempotencyKey: `writeoff:${b.publicId}`,
        entries: [
          {
            account: Accounts.riderReceivable(b.customerId.toString()),
            amountPaise: -owed.amountPaise,
          },
          { account: Accounts.writeOffs, amountPaise: owed.amountPaise },
        ],
        bookingId: b._id,
        bookingPublicId: b.publicId,
        customerId: b.customerId,
        description: input.reason,
        createdBy: actor.userId,
        at: now(),
      });
      await audit.record(actor, {
        action: 'finance.write_off',
        targetType: 'Booking',
        targetId: b.publicId,
        metadata: { amountPaise: owed.amountPaise, reason: input.reason },
      });
      return {
        bookingId: b.publicId,
        paymentStatus: 'WRITTEN_OFF' as const,
        amountPaise: owed.amountPaise,
      };
    },

    /** Mark an unpaid booking as in dispute (it stops blocking the rider) or put it back to payable. */
    async dispute(actor: Actor, bookingPublicId: string, input: DisputeInput) {
      const from = input.disputed ? ['DUE', 'FAILED'] : ['DISPUTED'];
      const to = input.disputed ? 'DISPUTED' : 'DUE';
      const filter: Record<string, unknown> = {
        publicId: bookingPublicId,
        paymentStatus: { $in: from },
      };
      const b = await Booking.findOneAndUpdate(
        filter,
        { paymentStatus: to },
        { returnDocument: 'after' },
      );
      if (!b) {
        const any = await Booking.exists({ publicId: bookingPublicId });
        if (!any) throw new AppError('NOT_FOUND', 'Booking not found.');
        throw new AppError('CONFLICT', 'This booking is not in a state where that can change.');
      }
      await audit.record(actor, {
        action: input.disputed ? 'finance.dispute.open' : 'finance.dispute.close',
        targetType: 'Booking',
        targetId: bookingPublicId,
        metadata: { reason: input.reason },
      });
      return { bookingId: bookingPublicId, paymentStatus: b.paymentStatus };
    },
  };
}

export type BalancesService = ReturnType<typeof createBalancesService>;
