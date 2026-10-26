import { z } from 'zod';
import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import { pageMeta, paginationSchema } from '../../common/pagination';
import { objectId } from '../../common/zod';
import type { AuditService } from '../audit/audit.service';
import { Booking } from '../bookings/booking.model';
import { CustomerProfile } from '../customers/customerProfile.model';
import { DriverProfile } from '../drivers/driverProfile.model';
import { requireDriverProfile } from '../drivers/drivers.service';
import type { FlagsService } from '../flags/flags.service';
import { Ride } from '../rides/ride.model';
import { DriverToRiderTags, Rating, RiderToDriverTags } from './rating.model';

const DUPLICATE_KEY = 11000;
const RECENT_SHOWN = 20;

export const ratingSchema = z
  .object({
    stars: z.number().int().min(1).max(5),
    tags: z.array(z.string().trim().min(2).max(30)).max(5).optional(),
    comment: z.string().trim().min(1).max(300).optional(),
  })
  .strict();
export const lowRatingsQuerySchema = paginationSchema.extend({
  maxStars: z.coerce.number().int().min(1).max(5).default(2),
  hidden: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export const hideSchema = z
  .object({ hidden: z.boolean(), reason: z.string().trim().min(3).max(300) })
  .strict();

export type RatingInput = z.infer<typeof ratingSchema>;
export type LowRatingsQuery = z.infer<typeof lowRatingsQuerySchema>;
export type HideInput = z.infer<typeof hideSchema>;

export function createRatingsService(deps: {
  flags: FlagsService;
  audit: AuditService;
  now: () => Date;
  /** How long after a ride either side may still rate it. */
  windowMs: number;
  /** A driver's average is shown to riders only once this many people have rated them. */
  minRatingsShown: number;
}) {
  const { flags, audit, now, windowMs } = deps;

  async function participant(actor: Actor, ridePublicId: string) {
    const ride = await Ride.findOne({ publicId: ridePublicId });
    if (!ride) throw new AppError('NOT_FOUND', 'Ride not found.');
    const booking = await Booking.findById(ride.bookingId);
    if (!booking) throw new AppError('NOT_FOUND', 'Ride not found.');
    const asRider = actor.role === 'CUSTOMER' && ride.customerId.toString() === actor.userId;
    const asDriver =
      actor.role === 'DRIVER' &&
      ride.driverUserId.toString() === actor.userId &&
      Boolean(booking.assignedDriverId?.equals(ride.driverId));
    if (!asRider && !asDriver) throw new AppError('NOT_FOUND', 'Ride not found.');
    return { ride, booking, asRider };
  }

  const view = (r: {
    stars: number;
    tags: string[];
    comment?: string | null;
    hidden?: boolean;
    createdAt: Date;
  }) => ({
    stars: r.stars,
    tags: r.tags,
    comment: r.hidden ? null : (r.comment ?? null),
    createdAt: r.createdAt,
  });

  const average = (count: number, sum: number) =>
    count > 0 ? Math.round((sum / count) * 100) / 100 : null;

  return {
    /** Average shown on a driver card: only once enough people have rated, so one rating can't brand someone. */
    publicSummary(count: number | null | undefined, sum: number | null | undefined) {
      const c = count ?? 0;
      return c >= deps.minRatingsShown ? { average: average(c, sum ?? 0), count: c } : null;
    },

    async rate(actor: Actor, ridePublicId: string, input: RatingInput) {
      await flags.assertEnabled('RATINGS', actor.role);
      const { ride, booking, asRider } = await participant(actor, ridePublicId);
      if (booking.status !== 'COMPLETED' || !booking.completedAt) {
        throw new AppError('RIDE_INVALID_STATE', 'You can rate a ride once it is completed.');
      }
      if (now().getTime() - booking.completedAt.getTime() > windowMs) {
        throw new AppError('UNPROCESSABLE', 'The time to rate this ride has passed.');
      }
      const allowed: readonly string[] = asRider ? RiderToDriverTags : DriverToRiderTags;
      const bad = (input.tags ?? []).filter((t) => !allowed.includes(t));
      if (bad.length > 0) {
        throw new AppError('UNPROCESSABLE', undefined, [
          {
            field: 'tags',
            message: `Unknown tag(s): ${bad.join(', ')}. Allowed: ${allowed.join(', ')}`,
          },
        ]);
      }

      let created;
      try {
        created = await Rating.create({
          bookingId: booking._id,
          bookingPublicId: booking.publicId,
          ridePublicId: ride.publicId,
          raterRole: asRider ? 'CUSTOMER' : 'DRIVER',
          raterUserId: actor.userId,
          rateeUserId: asRider ? ride.driverUserId : ride.customerId,
          ...(asRider ? { rateeDriverId: ride.driverId } : {}),
          stars: input.stars,
          tags: [...new Set(input.tags ?? [])],
          ...(input.comment ? { comment: input.comment } : {}),
        });
      } catch (err) {
        if ((err as { code?: number }).code === DUPLICATE_KEY) {
          throw new AppError('CONFLICT', 'You have already rated this ride.');
        }
        throw err;
      }
      // Claim the "counted" flag first, so a repeat can never add the same rating twice.
      const claimed = await Rating.updateOne(
        { _id: created._id, counted: false },
        { counted: true },
      );
      if (claimed.modifiedCount === 1) {
        if (asRider) {
          await DriverProfile.updateOne(
            { _id: ride.driverId },
            { $inc: { ratingCount: 1, ratingSum: input.stars } },
          );
        } else {
          await CustomerProfile.updateOne(
            { userId: ride.customerId },
            { $inc: { ratingCount: 1, ratingSum: input.stars } },
            { upsert: true },
          );
        }
      }
      return view(created);
    },

    /** My rating of this ride, and whether I can still give one. */
    async mine(actor: Actor, ridePublicId: string) {
      const { booking, asRider } = await participant(actor, ridePublicId);
      const given = await Rating.findOne({
        bookingId: booking._id,
        raterRole: asRider ? 'CUSTOMER' : 'DRIVER',
      }).lean();
      const open =
        booking.status === 'COMPLETED' &&
        Boolean(booking.completedAt) &&
        now().getTime() - booking.completedAt!.getTime() <= windowMs;
      return {
        rated: Boolean(given),
        rating: given ? view(given) : null,
        canRate: !given && open,
        tags: asRider ? RiderToDriverTags : DriverToRiderTags,
      };
    },

    /** A driver's own report card. Riders are never identified. */
    async driverSummary(userId: string) {
      const profile = await requireDriverProfile(userId);
      const [dist, recent] = await Promise.all([
        Rating.aggregate<{ _id: number; n: number }>([
          { $match: { rateeDriverId: profile._id } },
          { $group: { _id: '$stars', n: { $sum: 1 } } },
        ]),
        Rating.find({ rateeDriverId: profile._id })
          .sort({ createdAt: -1 })
          .limit(RECENT_SHOWN)
          .lean(),
      ]);
      const count = profile.ratingCount ?? 0;
      return {
        average: average(count, profile.ratingSum ?? 0),
        count,
        distribution: Object.fromEntries(
          [1, 2, 3, 4, 5].map((s) => [s, dist.find((d) => d._id === s)?.n ?? 0]),
        ),
        recent: recent.map(view),
      };
    },

    /** Low ratings for staff to look at. */
    async lowRatings(query: LowRatingsQuery) {
      const filter: Record<string, unknown> = { stars: { $lte: query.maxStars } };
      if (query.hidden !== undefined) filter['hidden'] = query.hidden;
      const [total, rows] = await Promise.all([
        Rating.countDocuments(filter),
        Rating.find(filter)
          .sort({ createdAt: -1 })
          .skip((query.page - 1) * query.limit)
          .limit(query.limit)
          .lean(),
      ]);
      return {
        items: rows.map((r) => ({
          ratingId: r._id.toString(),
          bookingId: r.bookingPublicId,
          rideId: r.ridePublicId,
          raterRole: r.raterRole,
          raterUserId: r.raterUserId.toString(),
          rateeUserId: r.rateeUserId.toString(),
          rateeDriverId: r.rateeDriverId?.toString() ?? null,
          stars: r.stars,
          tags: r.tags,
          comment: r.comment ?? null,
          hidden: r.hidden,
          createdAt: r.createdAt,
        })),
        meta: pageMeta(query.page, query.limit, total),
      };
    },

    async hide(actor: Actor, ratingId: string, input: HideInput) {
      objectId.parse(ratingId);
      const r = await Rating.findOneAndUpdate(
        { _id: ratingId },
        input.hidden
          ? { hidden: true, hiddenBy: actor.userId, hiddenReason: input.reason }
          : { hidden: false, $unset: { hiddenBy: 1, hiddenReason: 1 } },
        { returnDocument: 'after' },
      );
      if (!r) throw new AppError('NOT_FOUND');
      await audit.record(actor, {
        action: input.hidden ? 'rating.hide' : 'rating.unhide',
        targetType: 'Rating',
        targetId: ratingId,
        metadata: { reason: input.reason },
      });
      return { ratingId, hidden: r.hidden };
    },

    /**
     * Safety net: recompute the averages of anyone rated recently from the ratings themselves and
     * fix a profile that disagrees (a crash between saving a rating and counting it).
     */
    async reconcile(): Promise<{ fixed: number }> {
      const since = new Date(now().getTime() - 15 * 60_000);
      let fixed = 0;
      const drivers = await Rating.aggregate<{ _id: unknown }>([
        { $match: { rateeDriverId: { $exists: true }, createdAt: { $gte: since } } },
        { $group: { _id: '$rateeDriverId' } },
      ]);
      for (const d of drivers) {
        const all = await Rating.aggregate<{ n: number; sum: number }>([
          { $match: { rateeDriverId: d._id } },
          { $group: { _id: null, n: { $sum: 1 }, sum: { $sum: '$stars' } } },
        ]);
        const total = all[0] ?? { n: 0, sum: 0 };
        const res = await DriverProfile.updateOne(
          {
            _id: d._id,
            $or: [{ ratingCount: { $ne: total.n } }, { ratingSum: { $ne: total.sum } }],
          },
          { ratingCount: total.n, ratingSum: total.sum },
        );
        fixed += res.modifiedCount;
      }
      return { fixed };
    },
  };
}

export type RatingsService = ReturnType<typeof createRatingsService>;
