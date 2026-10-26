import { z } from 'zod';
import { AppError } from '../../common/errors';
import { objectId } from '../../common/zod';
import { Booking } from '../bookings/booking.model';
import { RideOffer } from '../dispatch/rideOffer.model';
import { DriverProfile } from '../drivers/driverProfile.model';
import { Payment } from '../payments/payment.model';
import { Refund } from '../payments/refund.model';
import { Tip } from '../tips/tip.model';
import { User } from '../users/user.model';
import { ServiceZone } from '../zones/serviceZone.model';

const DAY = 86_400_000;
const MAX_RANGE_DAYS = 92;
const TZ = 'Asia/Kolkata';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const analyticsRangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  zoneId: objectId.optional(),
});
export const driversQuerySchema = analyticsRangeSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const retentionQuerySchema = z.object({
  weeks: z.coerce.number().int().min(2).max(12).default(8),
});
export type AnalyticsRange = z.infer<typeof analyticsRangeSchema>;

/** Management numbers over time: when demand peaks, how well it is served, why rides are lost, where the money goes, who comes back. */
export function createAnalyticsService(deps: { now: () => Date }) {
  const { now } = deps;

  function period(q: AnalyticsRange) {
    const to = q.to ?? now();
    const from = q.from ?? new Date(to.getTime() - 28 * DAY);
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

  const bookingMatch = (q: AnalyticsRange, from: Date, to: Date) => ({
    requestedAt: { $gte: from, $lt: to },
    ...(q.zoneId ? { zoneId: q.zoneId } : {}),
  });
  const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10_000) / 10_000 : null);
  const is = (status: string) => ({ $cond: [{ $eq: ['$status', status] }, 1, 0] });

  return {
    /** When people ask for rides: a week-by-hour grid (India time) and the split by zone. */
    async demand(q: AnalyticsRange) {
      const { from, to } = period(q);
      const match = bookingMatch(q, from, to);
      const [grid, zones] = await Promise.all([
        Booking.aggregate<{ _id: { d: number; h: number }; requests: number; completed: number }>([
          { $match: match },
          {
            $group: {
              _id: {
                d: { $dayOfWeek: { date: '$requestedAt', timezone: TZ } },
                h: { $hour: { date: '$requestedAt', timezone: TZ } },
              },
              requests: { $sum: 1 },
              completed: { $sum: is('COMPLETED') },
            },
          },
        ]),
        Booking.aggregate<{ _id: unknown; requests: number; completed: number; noDriver: number }>([
          { $match: match },
          {
            $group: {
              _id: '$zoneId',
              requests: { $sum: 1 },
              completed: { $sum: is('COMPLETED') },
              noDriver: { $sum: is('NO_DRIVER_FOUND') },
            },
          },
          { $sort: { requests: -1 } },
        ]),
      ]);
      const names = new Map(
        (
          await ServiceZone.find({ _id: { $in: zones.map((z) => z._id) } })
            .select('code name')
            .lean()
        ).map((z) => [z._id.toString(), z]),
      );
      const cells = new Map(grid.map((g) => [`${g._id.d}-${g._id.h}`, g]));
      return {
        period: { from, to },
        timezone: TZ,
        total: grid.reduce((n, g) => n + g.requests, 0),
        // Monday first; every hour of every day is present, zero when nothing happened.
        grid: [1, 2, 3, 4, 5, 6, 0].flatMap((dow) =>
          Array.from({ length: 24 }, (_, hour) => {
            const g = cells.get(`${dow + 1}-${hour}`);
            return {
              day: WEEKDAYS[dow]!,
              hour,
              requests: g?.requests ?? 0,
              completed: g?.completed ?? 0,
            };
          }),
        ),
        byZone: zones.map((z) => ({
          zoneId: String(z._id),
          code: names.get(String(z._id))?.code ?? null,
          requests: z.requests,
          completed: z.completed,
          noDriver: z.noDriver,
          noDriverRate: rate(z.noDriver, z.requests),
        })),
      };
    },

    /** How well demand is served, hour by hour: drivers found, how fast, and rides lost. */
    async fulfilment(q: AnalyticsRange) {
      const { from, to } = period(q);
      const rows = await Booking.aggregate<{
        _id: number;
        requests: number;
        completed: number;
        noDriver: number;
        cancelled: number;
        assignedCount: number;
        assignSeconds: number;
      }>([
        { $match: bookingMatch(q, from, to) },
        {
          $group: {
            _id: { $hour: { date: '$requestedAt', timezone: TZ } },
            requests: { $sum: 1 },
            completed: { $sum: is('COMPLETED') },
            noDriver: { $sum: is('NO_DRIVER_FOUND') },
            cancelled: { $sum: is('CANCELLED') },
            assignedCount: { $sum: { $cond: [{ $ifNull: ['$assignedAt', false] }, 1, 0] } },
            assignSeconds: {
              $sum: {
                $cond: [
                  { $ifNull: ['$assignedAt', false] },
                  { $divide: [{ $subtract: ['$assignedAt', '$requestedAt'] }, 1000] },
                  0,
                ],
              },
            },
          },
        },
      ]);
      const byHour = new Map(rows.map((r) => [r._id, r]));
      return {
        period: { from, to },
        timezone: TZ,
        hours: Array.from({ length: 24 }, (_, hour) => {
          const r = byHour.get(hour);
          return {
            hour,
            requests: r?.requests ?? 0,
            completed: r?.completed ?? 0,
            noDriver: r?.noDriver ?? 0,
            cancelled: r?.cancelled ?? 0,
            completionRate: rate(r?.completed ?? 0, r?.requests ?? 0),
            noDriverRate: rate(r?.noDriver ?? 0, r?.requests ?? 0),
            averageSecondsToAssign:
              r && r.assignedCount > 0 ? Math.round(r.assignSeconds / r.assignedCount) : null,
          };
        }),
      };
    },

    /** Why rides are lost: who cancelled, with which reason, how soon, and what it cost. */
    async cancellations(q: AnalyticsRange) {
      const { from, to } = period(q);
      const match = { ...bookingMatch(q, from, to), status: 'CANCELLED' };
      const [byReason, fees, total] = await Promise.all([
        Booking.aggregate<{
          _id: { actor: string | null; reason: string | null };
          n: number;
          minutes: number;
        }>([
          { $match: match },
          {
            $group: {
              _id: { actor: '$cancellation.actor', reason: '$cancellation.reasonCode' },
              n: { $sum: 1 },
              minutes: {
                $avg: { $divide: [{ $subtract: ['$cancellation.at', '$requestedAt'] }, 60_000] },
              },
            },
          },
          { $sort: { n: -1 } },
        ]),
        Booking.aggregate<{ _id: string; n: number; amount: number }>([
          { $match: { ...bookingMatch(q, from, to), 'fee.status': { $exists: true } } },
          { $group: { _id: '$fee.status', n: { $sum: 1 }, amount: { $sum: '$fee.amountPaise' } } },
        ]),
        Booking.countDocuments(bookingMatch(q, from, to)),
      ]);
      const cancelled = byReason.reduce((n, r) => n + r.n, 0);
      const actors = new Map<string, number>();
      for (const r of byReason)
        actors.set(r._id.actor ?? 'UNKNOWN', (actors.get(r._id.actor ?? 'UNKNOWN') ?? 0) + r.n);
      return {
        period: { from, to },
        requests: total,
        cancelled,
        cancelRate: rate(cancelled, total),
        byActor: [...actors].map(([actor, n]) => ({ actor, count: n, share: rate(n, cancelled) })),
        byReason: byReason.map((r) => ({
          actor: r._id.actor ?? 'UNKNOWN',
          reasonCode: r._id.reason ?? 'UNKNOWN',
          count: r.n,
          averageMinutesAfterRequest: r.minutes === null ? null : Math.round(r.minutes * 10) / 10,
        })),
        fees: Object.fromEntries(fees.map((f) => [f._id, { count: f.n, amountPaise: f.amount }])),
      };
    },

    /** Where the money goes, day by day (India time): fares, discounts, commission, tips, refunds, how it was paid. */
    async revenue(q: AnalyticsRange) {
      const { from, to } = period(q);
      const day = (field: string) => ({
        $dateToString: { format: '%Y-%m-%d', date: field, timezone: TZ },
      });
      const [rides, tips, refunds, methods] = await Promise.all([
        Booking.aggregate<{
          _id: string;
          rides: number;
          gross: number;
          tax: number;
          discounts: number;
          commission: number;
          earnings: number;
        }>([
          { $match: { ...bookingMatch(q, from, to), status: 'COMPLETED' } },
          {
            $group: {
              _id: day('$completedAt'),
              rides: { $sum: 1 },
              gross: {
                $sum: { $ifNull: ['$grossFarePaise', { $ifNull: ['$finalFarePaise', 0] }] },
              },
              tax: { $sum: { $ifNull: ['$taxPaise', 0] } },
              discounts: { $sum: { $ifNull: ['$discountPaise', 0] } },
              commission: { $sum: { $ifNull: ['$accrual.commissionPaise', 0] } },
              earnings: { $sum: { $ifNull: ['$accrual.driverSharePaise', 0] } },
            },
          },
        ]),
        Tip.aggregate<{ _id: string; amount: number; n: number }>([
          { $match: { status: 'PAID', source: { $ne: 'CASH' }, paidAt: { $gte: from, $lt: to } } },
          { $group: { _id: day('$paidAt'), amount: { $sum: '$amountPaise' }, n: { $sum: 1 } } },
        ]),
        Refund.aggregate<{ _id: string; amount: number; n: number }>([
          { $match: { status: 'PROCESSED', processedAt: { $gte: from, $lt: to } } },
          {
            $group: { _id: day('$processedAt'), amount: { $sum: '$amountPaise' }, n: { $sum: 1 } },
          },
        ]),
        Payment.aggregate<{ _id: { method: string; purpose: string }; amount: number; n: number }>([
          { $match: { status: 'PAID', paidAt: { $gte: from, $lt: to } } },
          {
            $group: {
              _id: { method: { $ifNull: ['$method', 'GATEWAY'] }, purpose: '$purpose' },
              amount: { $sum: '$amountPaise' },
              n: { $sum: 1 },
            },
          },
        ]),
      ]);
      const days = new Map<string, Record<string, number>>();
      const slot = (d: string) => {
        const row = days.get(d) ?? {
          rides: 0,
          grossFaresPaise: 0,
          taxPaise: 0,
          netFaresPaise: 0,
          discountsPaise: 0,
          commissionPaise: 0,
          driverEarningsPaise: 0,
          tipsPaise: 0,
          refundsPaise: 0,
        };
        days.set(d, row);
        return row;
      };
      for (const r of rides)
        Object.assign(slot(r._id), {
          rides: r.rides,
          grossFaresPaise: r.gross,
          taxPaise: r.tax,
          netFaresPaise: r.gross - r.tax,
          discountsPaise: r.discounts,
          commissionPaise: r.commission,
          driverEarningsPaise: r.earnings,
        });
      for (const t of tips) slot(t._id)['tipsPaise'] = t.amount;
      for (const f of refunds) slot(f._id)['refundsPaise'] = f.amount;
      const perDay = [...days]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([d, v]) => ({ day: d, ...v }));
      const sum = (key: string) =>
        perDay.reduce((n, d) => n + ((d as Record<string, unknown>)[key] as number), 0);
      return {
        period: { from, to },
        currency: 'INR',
        totals: {
          rides: sum('rides'),
          // Gross includes the ride GST; net is the fare before that tax.
          grossFaresPaise: sum('grossFaresPaise'),
          taxPaise: sum('taxPaise'),
          netFaresPaise: sum('netFaresPaise'),
          discountsPaise: sum('discountsPaise'),
          commissionPaise: sum('commissionPaise'),
          driverEarningsPaise: sum('driverEarningsPaise'),
          tipsPaise: sum('tipsPaise'),
          refundsPaise: sum('refundsPaise'),
        },
        // Money collected through the app, by how it was paid and what for.
        collected: methods.map((m) => ({
          method: m._id.method,
          purpose: m._id.purpose,
          payments: m.n,
          amountPaise: m.amount,
        })),
        perDay,
      };
    },

    /** Who is active now, and how many new riders come back (weekly groups, India time). */
    async retention(q: z.infer<typeof retentionQuerySchema>) {
      const t = now();
      const active = async (days: number) => {
        const since = new Date(t.getTime() - days * DAY);
        const [riders, drivers] = await Promise.all([
          Booking.distinct('customerId', { requestedAt: { $gte: since, $lte: t } }),
          Booking.distinct('assignedDriverId', {
            status: 'COMPLETED',
            completedAt: { $gte: since, $lte: t },
          }),
        ]);
        return { riders: riders.length, drivers: drivers.filter(Boolean).length };
      };
      const [d1, d7, d30] = await Promise.all([active(1), active(7), active(30)]);

      // Weekly cohorts: riders grouped by the week of their first completed ride.
      const since = new Date(t.getTime() - q.weeks * 7 * DAY);
      const weekOf = {
        $dateTrunc: { date: '$completedAt', unit: 'week', timezone: TZ, startOfWeek: 'monday' },
      };
      const pairs = await Booking.aggregate<{ _id: { c: unknown; w: Date } }>([
        { $match: { status: 'COMPLETED', completedAt: { $gte: since, $lte: t } } },
        { $group: { _id: { c: '$customerId', w: weekOf } } },
        { $limit: 100_000 },
      ]);
      const firstEver = new Map(
        (
          await Booking.aggregate<{ _id: unknown; first: Date }>([
            {
              $match: {
                status: 'COMPLETED',
                customerId: { $in: [...new Set(pairs.map((p) => p._id.c))] },
              },
            },
            { $group: { _id: '$customerId', first: { $min: '$completedAt' } } },
          ])
        ).map((r) => [String(r._id), r.first]),
      );
      const weekStart = (d: Date) => {
        const ist = new Date(d.getTime() + 330 * 60_000);
        const dow = (ist.getUTCDay() + 6) % 7; // Monday = 0
        return (
          Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - dow) - 330 * 60_000
        );
      };
      const ridersByWeek = new Map<number, Set<string>>();
      for (const p of pairs) {
        const w = weekStart(p._id.w);
        const set = ridersByWeek.get(w) ?? new Set<string>();
        set.add(String(p._id.c));
        ridersByWeek.set(w, set);
      }
      const cohorts = new Map<number, Set<string>>();
      for (const [customer, first] of firstEver) {
        const w = weekStart(first);
        if (w < weekStart(since)) continue;
        const set = cohorts.get(w) ?? new Set<string>();
        set.add(customer);
        cohorts.set(w, set);
      }
      const weeks = [...cohorts]
        .sort(([a], [b]) => a - b)
        .map(([w, members]) => ({
          weekStarting: new Date(w).toISOString(),
          newRiders: members.size,
          // Share of this group who rode again in each of the following weeks.
          returned: Array.from(
            { length: Math.min(q.weeks - 1, Math.floor((weekStart(t) - w) / (7 * DAY))) },
            (_, i) => {
              const next = ridersByWeek.get(w + (i + 1) * 7 * DAY) ?? new Set<string>();
              const back = [...members].filter((m) => next.has(m)).length;
              return { weeksLater: i + 1, riders: back, share: rate(back, members.size) };
            },
          ),
        }));
      return {
        asOf: t,
        timezone: TZ,
        active: { last24Hours: d1, last7Days: d7, last30Days: d30 },
        cohorts: weeks,
      };
    },

    /** Drivers ranked by completed rides: earnings, tips, how often they accept, their rating. */
    async drivers(q: z.infer<typeof driversQuerySchema>) {
      const { from, to } = period(q);
      const rides = await Booking.aggregate<{ _id: unknown; rides: number; earnings: number }>([
        {
          $match: {
            ...bookingMatch(q, from, to),
            status: 'COMPLETED',
            assignedDriverId: { $ne: null },
          },
        },
        {
          $group: {
            _id: '$assignedDriverId',
            rides: { $sum: 1 },
            earnings: { $sum: { $ifNull: ['$accrual.driverSharePaise', 0] } },
          },
        },
        { $sort: { rides: -1, earnings: -1 } },
        { $limit: q.limit },
      ]);
      const ids = rides.map((r) => r._id);
      const [offers, tips, profiles] = await Promise.all([
        RideOffer.aggregate<{ _id: { d: unknown; s: string }; n: number }>([
          { $match: { driverId: { $in: ids }, createdAt: { $gte: from, $lt: to } } },
          { $group: { _id: { d: '$driverId', s: '$status' }, n: { $sum: 1 } } },
        ]),
        Tip.aggregate<{ _id: unknown; amount: number }>([
          {
            $match: {
              driverId: { $in: ids },
              status: 'PAID',
              source: { $ne: 'CASH' },
              paidAt: { $gte: from, $lt: to },
            },
          },
          { $group: { _id: '$driverId', amount: { $sum: '$amountPaise' } } },
        ]),
        DriverProfile.find({ _id: { $in: ids } })
          .select('userId ratingCount ratingSum')
          .lean(),
      ]);
      const users = new Map(
        (
          await User.find({ _id: { $in: profiles.map((p) => p.userId) } })
            .select('name')
            .lean()
        ).map((u) => [u._id.toString(), u.name]),
      );
      const profile = new Map(profiles.map((p) => [p._id.toString(), p]));
      const tipBy = new Map(tips.map((t) => [String(t._id), t.amount]));
      const offerStat = (id: string, status: string) =>
        offers.find((o) => String(o._id.d) === id && o._id.s === status)?.n ?? 0;
      return {
        period: { from, to },
        items: rides.map((r) => {
          const id = String(r._id);
          const p = profile.get(id);
          const accepted = offerStat(id, 'ACCEPTED');
          const answered = accepted + offerStat(id, 'REJECTED') + offerStat(id, 'EXPIRED');
          return {
            driverId: id,
            name: p ? (users.get(p.userId.toString()) ?? null) : null,
            rides: r.rides,
            earningsPaise: r.earnings,
            tipsPaise: tipBy.get(id) ?? 0,
            offersAnswered: answered,
            acceptanceRate: rate(accepted, answered),
            rating:
              p && (p.ratingCount ?? 0) > 0
                ? Math.round(((p.ratingSum ?? 0) / p.ratingCount!) * 100) / 100
                : null,
            ratingCount: p?.ratingCount ?? 0,
          };
        }),
      };
    },
  };
}

export type AnalyticsService = ReturnType<typeof createAnalyticsService>;
