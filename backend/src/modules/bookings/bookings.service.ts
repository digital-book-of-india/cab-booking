import { createHash } from 'node:crypto';
import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import { fromPoint } from '../../common/geo';
import { publicId } from '../../common/ids';
import { normalizePhone } from '../../common/phone';
import type { Logger } from 'pino';
import { pageMeta } from '../../common/pagination';
import type { DispatchService } from '../dispatch/dispatch.service';
import type { CouponsService } from '../coupons/coupons.service';
import { amountDue } from '../payments/amountDue';
import type { BalancesService } from '../balances/balances.service';
import type { CommissionService } from '../ledger/commission.service';
import type { CancellationPolicyService } from '../pricing/cancellationPolicy.service';
import type { QuotesService } from '../quotes/quotes.service';
import { CustomerProfile } from '../customers/customerProfile.model';
import { Ride } from '../rides/ride.model';
import { driverCard } from '../rides/rides.views';
import { Booking } from './booking.model';
import { BookingEvent } from './bookingEvent.model';
import type { CorporateService } from '../corporate/corporate.service';
import type { BookingListQuery, CreateBookingInput } from './bookings.schemas';

/** Roles that may read any customer's booking. Drivers get access once assigned (Phase 3). */
export const BOOKING_ADMIN_ROLES = ['OPS', 'SUPPORT', 'SUPER_ADMIN'] as const;

const COORD_TOLERANCE = 1e-5; // ~1 m

type BookingLean = {
  rideId?: string | null;
  finalFarePaise?: number | null;
  completedAt?: Date | null;
  cancellation?: { actor?: string | null; reasonCode?: string | null; at?: Date | null } | null;
  publicId: string;
  quoteId: string;
  categoryId: { toString(): string };
  status: string;
  paymentStatus?: string | null;
  paymentMethod: string;
  rideType?: string | null;
  scheduledFor?: Date | null;
  corporateId?: unknown;
  corporateReference?: string | null;
  estimatedFarePaise: number;
  fareSnapshot: unknown;
  pickup: {
    label?: string | null;
    contactName?: string | null;
    contactPhone?: string | null;
    location: { coordinates: number[] };
  };
  drop: { label?: string | null; location: { coordinates: number[] } };
  stops?: { label?: string | null; location: { coordinates: number[] } }[];
  tripKind?: string | null;
  rental?: unknown;
  outstation?: unknown;
  fee?: { type: string; amountPaise: number; status: string } | null;
  receipt?: { number?: string | null } | null;
  coupon?: { code: string; estimatedDiscountPaise?: number | null } | null;
  discountPaise?: number | null;
  grossFarePaise?: number | null;
  notes?: string | null;
  requestedAt: Date;
};

export function bookingView(raw: unknown) {
  const b = raw as BookingLean;
  return {
    bookingId: b.publicId,
    status: b.status,
    paymentStatus: b.paymentStatus ?? 'NOT_DUE',
    paymentMethod: b.paymentMethod,
    rideType: b.rideType ?? 'INSTANT',
    scheduledFor: b.scheduledFor ?? null,
    billedToCompany: Boolean(b.corporateId),
    corporateReference: b.corporateReference ?? null,
    quoteId: b.quoteId,
    categoryId: b.categoryId.toString(),
    estimatedFarePaise: b.estimatedFarePaise,
    currency: 'INR',
    pickup: {
      ...fromPoint(b.pickup.location),
      label: b.pickup.label ?? null,
      contactName: b.pickup.contactName ?? null,
      contactPhone: b.pickup.contactPhone ?? null,
    },
    drop: { ...fromPoint(b.drop.location), label: b.drop.label ?? null },
    stops: (b.stops ?? []).map((s) => ({ ...fromPoint(s.location), label: s.label ?? null })),
    tripKind: b.tripKind ?? 'CITY',
    rental: b.rental ?? null,
    outstation: b.outstation ?? null,
    fare: b.fareSnapshot,
    notes: b.notes ?? null,
    createdAt: b.requestedAt,
    rideId: b.rideId ?? null,
    finalFarePaise: b.finalFarePaise ?? null,
    completedAt: b.completedAt ?? null,
    fee: b.fee ? { type: b.fee.type, amountPaise: b.fee.amountPaise, status: b.fee.status } : null,
    receiptNumber: b.receipt?.number ?? null,
    coupon: b.coupon
      ? { code: b.coupon.code, estimatedDiscountPaise: b.coupon.estimatedDiscountPaise ?? 0 }
      : null,
    grossFarePaise: b.grossFarePaise ?? null,
    discountPaise: b.discountPaise ?? null,
    // What the rider can pay right now (0 when nothing is waiting for payment).
    amountDuePaise: amountDue(b)?.amountPaise ?? 0,
    cancellation: b.cancellation?.actor
      ? {
          actor: b.cancellation.actor,
          reasonCode: b.cancellation.reasonCode ?? null,
          at: b.cancellation.at ?? null,
        }
      : null,
  };
}

const near = (a: number, b: number) => Math.abs(a - b) <= COORD_TOLERANCE;

export function createBookingsService(deps: {
  quotes: QuotesService;
  policy: Pick<CancellationPolicyService, 'activeSnapshot'>;
  commission: Pick<CommissionService, 'activeSnapshot'>;
  balances: Pick<BalancesService, 'assertCanBook'>;
  coupons: Pick<CouponsService, 'reserve' | 'release'>;
  corporate: Pick<CorporateService, 'authorizeBooking'>;
  dispatch: DispatchService;
  logger: Logger;
  now: () => Date;
  /** How many rides for later one rider may have waiting. */
  maxScheduledPerRider: number;
  /** One rider's scheduled rides must be at least this far apart. */
  scheduleOverlapMs: number;
}) {
  const { quotes, policy, commission, balances, coupons, dispatch, logger, now } = deps;

  /** A rider cannot be in two places at once: scheduled rides need some distance in time. */
  async function assertNoOverlap(customerId: string, at: Date, exceptId?: string) {
    const clash = await Booking.exists({
      customerId,
      status: 'SCHEDULED',
      ...(exceptId ? { _id: { $ne: exceptId } } : {}),
      scheduledFor: {
        $gt: new Date(at.getTime() - deps.scheduleOverlapMs),
        $lt: new Date(at.getTime() + deps.scheduleOverlapMs),
      },
    });
    if (clash) {
      throw new AppError('UNPROCESSABLE', undefined, [
        {
          field: 'scheduledFor',
          message: `You already have a scheduled ride within ${Math.round(deps.scheduleOverlapMs / 60_000)} minutes of this time`,
        },
      ]);
    }
  }

  async function visibleBooking(actor: Actor, bookingId: string) {
    const isAdmin = (BOOKING_ADMIN_ROLES as readonly string[]).includes(actor.role);
    // A customer only ever matches their own bookings; anything else is "not found".
    const filter = isAdmin
      ? { publicId: bookingId }
      : { publicId: bookingId, customerId: actor.userId };
    const booking = await Booking.findOne(filter);
    if (!booking) throw new AppError('NOT_FOUND', 'Booking not found.');
    return booking;
  }

  return {
    async create(customerId: string, idempotencyKey: string, input: CreateBookingInput) {
      // A rider with an old unpaid ride pays it first. (A retry of an existing booking still replays.)
      const alreadyBooked = await Booking.exists({ customerId, idempotencyKey });
      if (!alreadyBooked) {
        await balances.assertCanBook(customerId);
        const customerProfile = await CustomerProfile.findOne({ userId: customerId })
          .select('bookingRestricted bookingRestrictionReason')
          .lean();
        if (customerProfile?.bookingRestricted) {
          throw new AppError(
            'BOOKING_RESTRICTED',
            customerProfile.bookingRestrictionReason || 'Your account is restricted from creating bookings.',
          );
        }

        // Hardening (Phase 10): Configurable single active booking concurrency guard
        if (process.env.STRICT_SINGLE_ACTIVE_BOOKING === 'true') {
          const hasActiveBooking = await Booking.exists({
            customerId,
            status: {
              $in: [
                'REQUESTED',
                'DISPATCHING',
                'DRIVER_ASSIGNED',
                'DRIVER_ARRIVING',
                'DRIVER_ARRIVED',
                'IN_PROGRESS',
              ],
            },
          });
          if (hasActiveBooking) {
            throw new AppError(
              'CONCURRENT_BOOKING_NOT_ALLOWED',
              'You already have an active booking in progress. Please complete or cancel it before booking again.',
            );
          }
        }
      }
      let contactPhone: string | undefined;
      if (input.pickup?.contactPhone) {
        const normalized = normalizePhone(input.pickup.contactPhone);
        if (!normalized) {
          throw new AppError('VALIDATION_ERROR', undefined, [
            { field: 'pickup.contactPhone', message: 'Invalid phone number' },
          ]);
        }
        contactPhone = normalized;
      }

      // Fingerprint of what the customer actually asked for, to catch key reuse with a different body.
      const requestHash = createHash('sha256')
        .update(
          JSON.stringify({
            quoteId: input.quoteId,
            paymentMethod: input.paymentMethod,
            rideType: input.rideType,
            scheduledFor: input.scheduledFor?.toISOString() ?? null,
            corporateReference: input.corporateReference ?? null,
            notes: input.notes ?? null,
            contactName: input.pickup?.contactName ?? null,
            contactPhone: contactPhone ?? null,
          }),
        )
        .digest('hex');

      const replay = async () => {
        const existing = await Booking.findOne({ customerId, idempotencyKey });
        if (!existing) return null;
        if (existing.requestHash !== requestHash) throw new AppError('IDEMPOTENCY_KEY_REUSED');
        return { booking: bookingView(existing.toObject()), replayed: true };
      };

      const already = await replay();
      if (already) return already;

      const quote = await quotes.findOwned(customerId, input.quoteId);

      // Echoed fields must agree with the quote; the quote is the source of truth.
      const [qp, qd] = [quote.pickup.location!.coordinates, quote.drop.location!.coordinates];
      if (
        (input.pickup && (!near(input.pickup.lng, qp[0]!) || !near(input.pickup.lat, qp[1]!))) ||
        (input.drop && (!near(input.drop.lng, qd[0]!) || !near(input.drop.lat, qd[1]!))) ||
        (input.categoryId && input.categoryId !== quote.categoryId.toString()) ||
        (input.tripKind && input.tripKind !== (quote.tripKind ?? 'CITY'))
      ) {
        throw new AppError('QUOTE_MISMATCH');
      }

      // A ride for later is priced for its pickup time, so the quote and the booking must agree on
      // whether it is for later and for when. (A quote is the source of truth.)
      const wantsLater = input.rideType === 'SCHEDULED';
      if (
        wantsLater !== Boolean(quote.scheduledFor) ||
        (wantsLater &&
          (!input.scheduledFor || input.scheduledFor.getTime() !== quote.scheduledFor!.getTime()))
      ) {
        throw new AppError('QUOTE_MISMATCH');
      }
      if (wantsLater) {
        quotes.assertSchedulable(quote.scheduledFor!);
        await assertNoOverlap(customerId, quote.scheduledFor!);
        const waiting = await Booking.countDocuments({ customerId, status: 'SCHEDULED' });
        if (waiting >= deps.maxScheduledPerRider) {
          throw new AppError(
            'UNPROCESSABLE',
            `You can have at most ${deps.maxScheduledPerRider} scheduled rides at a time.`,
          );
        }
      }

      // A ride on the company's account: the rider must be a member and inside every limit. This
      // is checked before the quote is used up, so a refusal does not cost the rider their quote.
      let corporate: {
        companyId: import('mongoose').Types.ObjectId;
        membershipId: import('mongoose').Types.ObjectId;
      } | null = null;
      if (input.paymentMethod === 'CORPORATE') {
        if (quote.coupon) {
          throw new AppError('UNPROCESSABLE', undefined, [
            {
              field: 'paymentMethod',
              message: 'Coupons cannot be used on a company-account ride.',
            },
          ]);
        }
        corporate = await deps.corporate.authorizeBooking(customerId, quote.estimatedTotalPaise);
      } else if (input.corporateReference) {
        throw new AppError('UNPROCESSABLE', undefined, [
          { field: 'corporateReference', message: 'Only for rides on a company account.' },
        ]);
      }

      const quoteStops = quote.stops ?? [];
      if (
        input.stops &&
        (input.stops.length !== quoteStops.length ||
          input.stops.some(
            (s, i) =>
              !near(s.lng, quoteStops[i]!.location!.coordinates[0]!) ||
              !near(s.lat, quoteStops[i]!.location!.coordinates[1]!),
          ))
      ) {
        throw new AppError('QUOTE_MISMATCH');
      }

      const id = publicId('bk');
      try {
        await quotes.consume(customerId, input.quoteId, id, idempotencyKey);
      } catch (err) {
        // A concurrent retry with the same key may have just consumed it and created the booking.
        const raced = await replay();
        if (raced) return raced;
        // If the quote was consumed by THIS key, an identical request is still creating the booking:
        // wait for it instead of failing the retry. A different key means a genuine conflict.
        const holder = await quotes.findOwned(customerId, input.quoteId).catch(() => null);
        if (holder?.usedByKey === idempotencyKey) {
          for (let i = 0; i < 50; i++) {
            await new Promise((r) => setTimeout(r, 100));
            const later = await replay();
            if (later) return later;
          }
        }
        throw err;
      }

      const at = now();
      let couponReserved = false;
      try {
        // A coupon use is taken now (limits are enforced atomically); it is given back if the booking fails.
        if (quote.coupon) {
          await coupons.reserve(quote.coupon.couponId, customerId);
          couponReserved = true;
        }
        // The cancellation rules in force today are frozen onto the booking, like the fare.
        const policySnapshot = await policy.activeSnapshot(quote.zoneId, at);
        const booking = await Booking.create({
          publicId: id,
          customerId,
          quoteId: quote.publicId,
          categoryId: quote.categoryId,
          zoneId: quote.zoneId,
          pickup: {
            label: input.pickup?.label ?? quote.pickup.label,
            contactName: input.pickup?.contactName,
            contactPhone,
            location: quote.pickup.location,
          },
          drop: { label: input.drop?.label ?? quote.drop.label, location: quote.drop.location },
          stops: quoteStops.map((s) => ({ label: s.label, location: s.location })),
          tripKind: quote.tripKind ?? 'CITY',
          ...(quote.rental ? { rental: quote.rental } : {}),
          ...(quote.outstation ? { outstation: quote.outstation } : {}),
          policy: policySnapshot,
          ...(quote.coupon
            ? {
                coupon: {
                  couponId: quote.coupon.couponId,
                  code: quote.coupon.code,
                  type: quote.coupon.type,
                  value: quote.coupon.value,
                  maxDiscountPaise: quote.coupon.maxDiscountPaise,
                  minFarePaise: quote.coupon.minFarePaise,
                  estimatedDiscountPaise: quote.discountPaise ?? 0,
                },
              }
            : {}),
          commission: await commission.activeSnapshot(quote.zoneId, at),
          rideType: input.rideType,
          ...(wantsLater ? { scheduledFor: quote.scheduledFor } : {}),
          paymentMethod: input.paymentMethod,
          ...(corporate
            ? {
                corporateId: corporate.companyId,
                corporateMembershipId: corporate.membershipId,
                ...(input.corporateReference
                  ? { corporateReference: input.corporateReference }
                  : {}),
              }
            : {}),
          status: wantsLater ? 'SCHEDULED' : 'REQUESTED',
          paymentStatus: 'NOT_DUE',
          estimatedFarePaise: quote.estimatedTotalPaise,
          fareSnapshot: {
            currency: quote.currency,
            configId: quote.configId?.toString() ?? null,
            configVersion: quote.configVersion,
            estimatedDistanceMeters: quote.distanceMeters,
            estimatedDurationSeconds: quote.durationSeconds,
            taxBp: quote.taxBp ?? 0,
            breakdown: quote.breakdown,
          },
          notes: input.notes,
          idempotencyKey,
          requestHash,
          requestedAt: at,
        });
        await BookingEvent.create({
          bookingId: booking._id,
          type: 'BOOKING_CREATED',
          toStatus: wantsLater ? 'SCHEDULED' : 'REQUESTED',
          actorType: 'CUSTOMER',
          actorId: customerId,
          at,
        });
        // Hand the booking to dispatch. A failure here must not lose the booking: the sweeper
        // picks up any REQUESTED booking that never started.
        // (A ride for later waits; the scheduled-rides job starts its search near pickup time.)
        if (!wantsLater) {
          try {
            await dispatch.start(booking.publicId);
          } catch (err) {
            logger.error({ err, bookingId: booking.publicId }, 'dispatch start failed');
          }
        }
        const fresh = await Booking.findById(booking._id);
        return { booking: bookingView((fresh ?? booking).toObject()), replayed: false };
      } catch (err) {
        if ((err as { code?: number }).code === 11000) {
          const raced = await replay();
          if (raced) return raced;
        }
        // Give the quote (and any coupon use) back so the customer can retry rather than lose it.
        if (couponReserved) await coupons.release(quote.coupon!.couponId, customerId);
        await quotes.release(quote.publicId);
        throw err;
      }
    },

    /** Move a ride that is still waiting (SCHEDULED) to another pickup time. */
    async reschedule(customerId: string, bookingId: string, scheduledFor: Date) {
      const booking = await Booking.findOne({ publicId: bookingId, customerId });
      if (!booking) throw new AppError('NOT_FOUND', 'Booking not found.');
      if (booking.status !== 'SCHEDULED') {
        throw new AppError('RIDE_INVALID_STATE', 'Only a scheduled ride can be moved.');
      }
      quotes.assertSchedulable(scheduledFor);
      await assertNoOverlap(customerId, scheduledFor, booking._id.toString());
      // The zone must be open at the new time, at both ends.
      const [lng, lat] = booking.pickup.location!.coordinates as [number, number];
      const [dLng, dLat] = booking.drop.location!.coordinates as [number, number];
      for (const [la, ln] of [
        [lat, lng],
        [dLat, dLng],
      ] as const) {
        const check = await quotes.checkPoint(la, ln, scheduledFor);
        if (!check.serviceable) {
          throw new AppError('NOT_SERVICEABLE', `Not serviceable at that time (${check.reason}).`);
        }
      }
      const from = booking.scheduledFor;
      const moved = await Booking.findOneAndUpdate(
        { _id: booking._id, status: 'SCHEDULED' },
        { scheduledFor, $unset: { scheduleReminderSentAt: 1 } },
        { returnDocument: 'after' },
      );
      if (!moved) {
        throw new AppError('RIDE_INVALID_STATE', 'This ride has already started being arranged.');
      }
      await BookingEvent.create({
        bookingId: booking._id,
        type: 'RESCHEDULED',
        actorType: 'CUSTOMER',
        actorId: customerId,
        at: now(),
        metadata: { from, to: scheduledFor },
      });
      return bookingView(moved.toObject());
    },

    /** The rider's own bookings. Waiting scheduled rides come soonest-first; everything else newest-first. */
    async list(customerId: string, query: BookingListQuery) {
      const filter = { customerId, ...(query.status ? { status: query.status } : {}) };
      const upcoming = query.status === 'SCHEDULED';
      const [total, rows] = await Promise.all([
        Booking.countDocuments(filter),
        Booking.find(filter)
          .sort(upcoming ? { scheduledFor: 1 } : { requestedAt: -1 })
          .skip((query.page - 1) * query.limit)
          .limit(query.limit)
          .lean(),
      ]);
      return {
        items: rows.map((b) => bookingView(b)),
        meta: pageMeta(query.page, query.limit, total),
      };
    },

    async get(actor: Actor, bookingId: string) {
      const booking = await visibleBooking(actor, bookingId);
      const view = bookingView(booking.toObject());
      if (!booking.rideId) return { ...view, driver: null };
      const ride = await Ride.findOne({ bookingId: booking._id }).lean();
      return { ...view, driver: ride ? await driverCard(ride) : null };
    },

    async events(actor: Actor, bookingId: string) {
      const booking = await visibleBooking(actor, bookingId);
      const rows = await BookingEvent.find({ bookingId: booking._id }).sort({ at: 1 }).lean();
      return rows.map((e) => ({
        type: e.type,
        fromStatus: e.fromStatus ?? null,
        toStatus: e.toStatus ?? null,
        actorType: e.actorType,
        at: e.at,
      }));
    },
  };
}

export type BookingsService = ReturnType<typeof createBookingsService>;
