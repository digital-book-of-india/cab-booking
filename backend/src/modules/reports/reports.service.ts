import { z } from 'zod';
import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import { objectId } from '../../common/zod';
import type { AuditService } from '../audit/audit.service';
import { Booking } from '../bookings/booking.model';
import { RideOffer } from '../dispatch/rideOffer.model';
import { DriverProfile } from '../drivers/driverProfile.model';
import { LedgerTransaction } from '../ledger/ledgerTransaction.model';
import { Payment } from '../payments/payment.model';
import { Settlement } from '../settlements/settlement.model';
import { User } from '../users/user.model';

const DAY = 86_400_000;
const MAX_RANGE_DAYS = 92;
export const MAX_EXPORT_ROWS = 50_000;

export const ExportKinds = ['rides', 'payments', 'settlements', 'ledger'] as const;
export type ExportKind = (typeof ExportKinds)[number];

export const rangeQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  zoneId: objectId.optional(),
});
export type RangeQuery = z.infer<typeof rangeQuerySchema>;

/** Spreadsheet programs run text starting with = + - @ as a formula: make such text harmless. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s) && typeof value === 'string') s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function createReportsService(deps: { audit: AuditService; now: () => Date }) {
  const { audit, now } = deps;

  /** The period asked for (default the last 7 days), never longer than about three months. */
  function period(q: RangeQuery) {
    const to = q.to ?? now();
    const from = q.from ?? new Date(to.getTime() - 7 * DAY);
    if (from.getTime() >= to.getTime()) {
      throw new AppError('VALIDATION_ERROR', undefined, [
        { field: 'from', message: 'Must be before to' },
      ]);
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY) {
      throw new AppError('VALIDATION_ERROR', undefined, [
        { field: 'from', message: `The period can be at most ${MAX_RANGE_DAYS} days` },
      ]);
    }
    return { from, to };
  }

  type Spec = {
    headers: string[];
    count: (r: { from: Date; to: Date }) => Promise<number>;
    rows: (r: { from: Date; to: Date }) => AsyncGenerator<unknown[]>;
  };

  const specs: Record<ExportKind, Spec> = {
    rides: {
      headers: [
        'bookingId',
        'status',
        'requestedAt',
        'completedAt',
        'customerId',
        'driverId',
        'paymentMethod',
        'paymentStatus',
        'finalFarePaise',
        'commissionPaise',
        'driverSharePaise',
        'feeType',
        'feeAmountPaise',
        'feeStatus',
        'cancelledBy',
      ],
      count: ({ from, to }) => Booking.countDocuments({ requestedAt: { $gte: from, $lt: to } }),
      async *rows({ from, to }) {
        for await (const b of Booking.find({ requestedAt: { $gte: from, $lt: to } })
          .sort({ requestedAt: 1 })
          .lean()
          .cursor()) {
          yield [
            b.publicId,
            b.status,
            b.requestedAt,
            b.completedAt,
            b.customerId.toString(),
            b.assignedDriverId?.toString(),
            b.paymentMethod,
            b.paymentStatus,
            b.finalFarePaise,
            b.accrual?.commissionPaise,
            b.accrual?.driverSharePaise,
            b.fee?.type,
            b.fee?.amountPaise,
            b.fee?.status,
            b.cancellation?.actor,
          ];
        }
      },
    },
    payments: {
      headers: [
        'paymentId',
        'bookingId',
        'customerId',
        'status',
        'purpose',
        'amountPaise',
        'refundedPaise',
        'createdAt',
        'paidAt',
      ],
      count: ({ from, to }) => Payment.countDocuments({ createdAt: { $gte: from, $lt: to } }),
      async *rows({ from, to }) {
        for await (const p of Payment.find({ createdAt: { $gte: from, $lt: to } })
          .sort({ createdAt: 1 })
          .lean()
          .cursor()) {
          yield [
            p.publicId,
            p.bookingPublicId,
            p.customerId.toString(),
            p.status,
            p.purpose,
            p.amountPaise,
            p.refundedPaise,
            p.createdAt,
            p.paidAt,
          ];
        }
      },
    },
    settlements: {
      headers: [
        'settlementId',
        'driverId',
        'status',
        'payablePaise',
        'cashHeldPaise',
        'nettedPaise',
        'payoutPaise',
        'depositDuePaise',
        'payoutReference',
        'createdAt',
        'paidAt',
      ],
      count: ({ from, to }) => Settlement.countDocuments({ createdAt: { $gte: from, $lt: to } }),
      async *rows({ from, to }) {
        for await (const s of Settlement.find({ createdAt: { $gte: from, $lt: to } })
          .sort({ createdAt: 1 })
          .lean()
          .cursor()) {
          yield [
            s.publicId,
            s.driverId.toString(),
            s.status,
            s.payablePaise,
            s.cashHeldPaise,
            s.nettedPaise,
            s.payoutPaise,
            s.depositDuePaise,
            s.payoutReference,
            s.createdAt,
            s.paidAt,
          ];
        }
      },
    },
    ledger: {
      headers: [
        'txnId',
        'kind',
        'at',
        'bookingId',
        'driverId',
        'account',
        'amountPaise',
        'description',
      ],
      count: ({ from, to }) => LedgerTransaction.countDocuments({ at: { $gte: from, $lt: to } }),
      async *rows({ from, to }) {
        for await (const t of LedgerTransaction.find({ at: { $gte: from, $lt: to } })
          .sort({ at: 1 })
          .lean()
          .cursor()) {
          for (const e of t.entries) {
            yield [
              t.txnId,
              t.kind,
              t.at,
              t.bookingPublicId,
              t.driverId?.toString(),
              e.account,
              e.amountPaise,
              t.description,
            ];
          }
        }
      },
    },
  };

  return {
    /** The numbers an operations lead looks at: volume, how it ended, money, and how quickly we find drivers. */
    async summary(query: RangeQuery) {
      const { from, to } = period(query);
      const match: Record<string, unknown> = { requestedAt: { $gte: from, $lt: to } };
      if (query.zoneId) match['zoneId'] = query.zoneId;

      const [byStatus, money, assign, perDay, activeDrivers, offers, newCustomers, newDrivers] =
        await Promise.all([
          Booking.aggregate<{ _id: string; n: number }>([
            { $match: match },
            { $group: { _id: '$status', n: { $sum: 1 } } },
          ]),
          Booking.aggregate<{
            gross: number;
            tax: number;
            discounts: number;
            commission: number;
            driverShare: number;
            feesDue: number;
            feesWaived: number;
          }>([
            { $match: match },
            {
              $group: {
                _id: null,
                gross: {
                  $sum: {
                    $cond: [
                      { $eq: ['$status', 'COMPLETED'] },
                      { $ifNull: ['$grossFarePaise', { $ifNull: ['$finalFarePaise', 0] }] },
                      0,
                    ],
                  },
                },
                tax: {
                  $sum: {
                    $cond: [{ $eq: ['$status', 'COMPLETED'] }, { $ifNull: ['$taxPaise', 0] }, 0],
                  },
                },
                discounts: { $sum: { $ifNull: ['$discountPaise', 0] } },
                commission: { $sum: { $ifNull: ['$accrual.commissionPaise', 0] } },
                driverShare: { $sum: { $ifNull: ['$accrual.driverSharePaise', 0] } },
                feesDue: {
                  $sum: { $cond: [{ $eq: ['$fee.status', 'DUE'] }, '$fee.amountPaise', 0] },
                },
                feesWaived: {
                  $sum: { $cond: [{ $eq: ['$fee.status', 'WAIVED'] }, '$fee.amountPaise', 0] },
                },
              },
            },
          ]),
          Booking.aggregate<{ avgSeconds: number | null; n: number }>([
            { $match: { ...match, assignedAt: { $exists: true } } },
            {
              $group: {
                _id: null,
                avgSeconds: {
                  $avg: { $divide: [{ $subtract: ['$assignedAt', '$requestedAt'] }, 1000] },
                },
                n: { $sum: 1 },
              },
            },
          ]),
          Booking.aggregate<{
            _id: string;
            requested: number;
            completed: number;
            cancelled: number;
            gross: number;
          }>([
            { $match: match },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: '%Y-%m-%d',
                    date: '$requestedAt',
                    timezone: 'Asia/Kolkata',
                  },
                },
                requested: { $sum: 1 },
                completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
                cancelled: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] } },
                gross: {
                  $sum: {
                    $cond: [
                      { $eq: ['$status', 'COMPLETED'] },
                      { $ifNull: ['$finalFarePaise', 0] },
                      0,
                    ],
                  },
                },
              },
            },
            { $sort: { _id: 1 } },
          ]),
          Booking.aggregate<{ _id: unknown }>([
            { $match: { ...match, status: 'COMPLETED' } },
            { $group: { _id: '$assignedDriverId' } },
          ]),
          RideOffer.aggregate<{ _id: string; n: number }>([
            { $match: { createdAt: { $gte: from, $lt: to } } },
            { $group: { _id: '$status', n: { $sum: 1 } } },
          ]),
          User.countDocuments({ role: 'CUSTOMER', createdAt: { $gte: from, $lt: to } }),
          DriverProfile.countDocuments({ createdAt: { $gte: from, $lt: to } }),
        ]);

      const count = (s: string) => byStatus.find((x) => x._id === s)?.n ?? 0;
      const total = byStatus.reduce((n, x) => n + x.n, 0);
      const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10_000) / 10_000 : null);
      const offerCount = (s: string) => offers.find((x) => x._id === s)?.n ?? 0;
      const answered = offerCount('ACCEPTED') + offerCount('REJECTED') + offerCount('EXPIRED');
      return {
        period: { from, to },
        bookings: {
          total,
          byStatus: Object.fromEntries(byStatus.map((x) => [x._id, x.n])),
          completionRate: rate(count('COMPLETED'), total),
          cancelRate: rate(count('CANCELLED'), total),
          noDriverRate: rate(count('NO_DRIVER_FOUND'), total),
        },
        money: {
          currency: 'INR',
          // Gross includes the ride GST; net is the fare before that tax.
          grossFaresPaise: money[0]?.gross ?? 0,
          taxPaise: money[0]?.tax ?? 0,
          netFaresPaise: (money[0]?.gross ?? 0) - (money[0]?.tax ?? 0),
          discountsPaise: money[0]?.discounts ?? 0,
          commissionPaise: money[0]?.commission ?? 0,
          driverEarningsPaise: money[0]?.driverShare ?? 0,
          feesDuePaise: money[0]?.feesDue ?? 0,
          feesWaivedPaise: money[0]?.feesWaived ?? 0,
        },
        dispatch: {
          averageSecondsToAssign:
            assign[0]?.avgSeconds === null || !assign[0] ? null : Math.round(assign[0].avgSeconds),
          offersAnswered: answered,
          offerAcceptanceRate: rate(offerCount('ACCEPTED'), answered),
        },
        people: {
          activeDrivers: activeDrivers.length,
          newCustomers,
          newDriverApplications: newDrivers,
        },
        byDay: perDay.map((d) => ({
          day: d._id,
          requested: d.requested,
          completed: d.completed,
          cancelled: d.cancelled,
          grossFaresPaise: d.gross,
        })),
      };
    },

    /** Check the request and write the audit entry before any byte of the file is sent. */
    async prepareExport(actor: Actor, kind: ExportKind, query: RangeQuery) {
      const range = period(query);
      const spec = specs[kind];
      const total = await spec.count(range);
      if (total > MAX_EXPORT_ROWS) {
        throw new AppError(
          'UNPROCESSABLE',
          `This export has ${total} rows; the limit is ${MAX_EXPORT_ROWS}. Choose a shorter period.`,
        );
      }
      await audit.record(actor, {
        action: 'report.export',
        targetType: 'Export',
        targetId: kind,
        metadata: { from: range.from, to: range.to, rows: total },
      });
      return {
        filename: `${kind}_${range.from.toISOString().slice(0, 10)}_${range.to.toISOString().slice(0, 10)}.csv`,
        headers: spec.headers,
        rows: spec.rows(range),
      };
    },
  };
}

export type ReportsService = ReturnType<typeof createReportsService>;
