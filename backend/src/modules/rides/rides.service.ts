import { randomBytes } from 'node:crypto';
import type { Types } from 'mongoose';
import type { Actor } from '../../common/actor';
import { hmac, safeEqual } from '../../common/crypto';
import { AppError } from '../../common/errors';
import { fromPoint, haversineMeters, toPoint } from '../../common/geo';
import { publicId } from '../../common/ids';
import { pageMeta } from '../../common/pagination';
import type { MapsProvider } from '../../providers';
import { Booking, type BookingStatus } from '../bookings/booking.model';
import { recordEvent, transitionBooking, type ActorType } from '../bookings/transitions';
import type { DispatchConfig } from '../dispatch/dispatch.config';
import type { DispatchService } from '../dispatch/dispatch.service';
import { DriverProfile } from '../drivers/driverProfile.model';
import { requireDriverProfile } from '../drivers/drivers.service';
import {
  DEFAULT_POLICY,
  assessCustomerCancellation,
  noShowEligibility,
} from '../pricing/cancellation';
import { computeDiscount } from '../coupons/coupons.service';
import type { LedgerService } from '../ledger/ledger.service';
import { calculateFare, computeWaiting } from '../pricing/fare';
import { FareConfig } from '../pricing/fareConfig.model';
import { MAX_TRIP_METERS, MIN_TRIP_METERS, type QuotesService } from '../quotes/quotes.service';
import { routeThrough } from '../quotes/route';
import { Ride } from './ride.model';
import { reconcileCityDistance, type CityDistanceResult } from '../trips/cityDistance';
import { trailMeters, trailSummary } from '../trips/tripDistance';
import {
  outstationFinal,
  rentalFinal,
  type OutstationSnapshot,
  type RentalSnapshot,
} from '../trips/tripFares';
import { historyRow, receiptView, rideView, type Viewer } from './rides.views';
import type { Notifier } from '../../realtime/notifier';
import type {
  ArrivedInput,
  CompleteInput,
  CustomerCancelInput,
  DestinationRequestInput,
  DriverCancelInput,
  HistoryQuery,
  StartInput,
} from './rides.schemas';

/** Staff who may read any ride (support/ops). Drivers and customers only ever see their own. */
const RIDE_ADMIN_ROLES = ['OPS', 'SUPPORT', 'SUPER_ADMIN'];
/** Pickup OTP re-issue cooldown. */
const OTP_REISSUE_MS = 30_000;
const TRACKABLE: readonly BookingStatus[] = [
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVING',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
];

export function deriveOtp(secret: string, ridePublicId: string, nonce: string): string {
  const hex = hmac(secret, `pickup-otp:${ridePublicId}:${nonce}`);
  return String(parseInt(hex.slice(0, 10), 16) % 1_000_000).padStart(6, '0');
}

export function createRidesService(deps: {
  now: () => Date;
  config: DispatchConfig;
  maps: MapsProvider;
  dispatch: DispatchService;
  otpSecret: string;
  notifier: Pick<Notifier, 'bookingChanged' | 'rideUpdated'>;
  quotes: Pick<QuotesService, 'checkPoint'>;
  ledger: Pick<LedgerService, 'accrueRideSafe' | 'accrueFeeSafe'>;
}) {
  const { now, config, maps, dispatch, otpSecret, notifier, quotes, ledger } = deps;

  /** Write the timeline entry, then tell the people involved (live and by push). */
  const record = async (entry: Parameters<typeof recordEvent>[0]) => {
    const eventId = await recordEvent(entry);
    await notifier.bookingChanged(entry.bookingId, {
      eventId,
      type: entry.type,
      toStatus: entry.toStatus,
      actorType: entry.actorType,
    });
  };

  const invalidState = (message?: string) => new AppError('RIDE_INVALID_STATE', message);

  /** The driver's own ride (404 when it belongs to someone else, so existence isn't leaked). */
  async function loadDriverRide(userId: string, ridePublicId: string) {
    const ride = await Ride.findOne({ publicId: ridePublicId, driverUserId: userId });
    if (!ride) throw new AppError('NOT_FOUND', 'Ride not found.');
    const booking = await Booking.findById(ride.bookingId);
    if (!booking || !booking.assignedDriverId?.equals(ride.driverId)) {
      // After a re-dispatch the booking belongs to another driver: this one no longer sees it.
      throw new AppError('NOT_FOUND', 'Ride not found.');
    }
    return { ride, booking };
  }

  async function loadCustomerRide(customerId: string, ridePublicId: string) {
    const ride = await Ride.findOne({ publicId: ridePublicId, customerId });
    if (!ride) throw new AppError('NOT_FOUND', 'Ride not found.');
    const booking = await Booking.findById(ride.bookingId);
    if (!booking) throw new AppError('NOT_FOUND', 'Ride not found.');
    return { ride, booking };
  }

  /** The driver's server-held position must be fresh and within the arrival radius of `target`. */
  async function requireDriverNear(
    driverId: Types.ObjectId,
    target: { coordinates: number[] },
    code: 'NOT_AT_PICKUP' | 'NOT_AT_STOP',
  ) {
    const t = now();
    const driver = await DriverProfile.findById(driverId).lean();
    const fresh =
      driver?.locationUpdatedAt &&
      t.getTime() - driver.locationUpdatedAt.getTime() <= config.locationFreshMs;
    if (!driver?.currentLocation || !fresh) {
      throw new AppError(code, 'We could not confirm your location. Check GPS and try again.');
    }
    const here = fromPoint(driver.currentLocation);
    if (haversineMeters(here, fromPoint(target)) > config.arrivalRadiusMeters) {
      throw new AppError(code);
    }
    return here;
  }

  /** The two ways a booking can end owing money: a late rider cancel, or a rider no-show. */
  const feeFields = (
    type: 'CANCELLATION' | 'NO_SHOW',
    amountPaise: number,
    at: Date,
    method?: string | null,
  ): Record<string, unknown> =>
    amountPaise > 0
      ? {
          fee: { type, amountPaise, status: 'DUE', at },
          // A company-billed ride is never "due" from the rider.
          paymentStatus: method === 'CORPORATE' ? 'BILLED' : 'DUE',
          'receipt.number': publicId('rcpt'),
          'receipt.issuedAt': at,
        }
      : {};

  /** Close a booking as CANCELLED and release everything it held. */
  async function cancelBooking(
    filter: Record<string, unknown>,
    from: readonly BookingStatus[],
    actorType: ActorType,
    actorId: string,
    reason: { reasonCode: string; note?: string },
    options: { chargeRider?: boolean } = {},
  ) {
    const at = now();
    const before = await Booking.findOne(filter)
      .select('status assignedAt policy paymentMethod')
      .lean();
    // Only the rider can be charged, and only by the rules frozen onto the booking when they booked.
    const assessment =
      options.chargeRider && before
        ? assessCustomerCancellation(
            before.policy ?? DEFAULT_POLICY,
            { status: before.status, assignedAt: before.assignedAt },
            at,
          )
        : null;
    const cancelled = await transitionBooking(filter, from, 'CANCELLED', {
      set: {
        cancellation: {
          actor: actorType,
          reasonCode: reason.reasonCode,
          ...(reason.note ? { note: reason.note } : {}),
          at,
        },
        ...(assessment
          ? feeFields('CANCELLATION', assessment.amountPaise, at, before?.paymentMethod)
          : {}),
      },
    });
    if (!cancelled) throw invalidState('This ride can no longer be cancelled.');

    await dispatch.withdrawOffers(cancelled._id, undefined, 'CANCELLED');
    if (cancelled.assignedDriverId) {
      await dispatch.releaseDriver(cancelled.assignedDriverId, cancelled._id);
    }
    await Ride.updateOne({ bookingId: cancelled._id }, { cancelledAt: at });
    await record({
      bookingId: cancelled._id,
      type: 'CANCELLED',
      fromStatus: before?.status as BookingStatus | undefined,
      toStatus: 'CANCELLED',
      actorType,
      actorId,
      at,
      metadata: {
        reasonCode: reason.reasonCode,
        ...(cancelled.fee ? { feePaise: cancelled.fee.amountPaise } : {}),
      },
    });
    if (cancelled.fee) await ledger.accrueFeeSafe(cancelled._id);
    return cancelled;
  }

  /** Seconds between two instants, never negative. */
  const secondsBetween = (from: Date, to: Date) =>
    Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));

  return {
    /* ---------- reading ---------- */

    async get(actor: Actor, ridePublicId: string) {
      const ride = await Ride.findOne({ publicId: ridePublicId });
      if (!ride) throw new AppError('NOT_FOUND', 'Ride not found.');
      let viewer: Viewer;
      if (actor.role === 'CUSTOMER' && ride.customerId.toString() === actor.userId)
        viewer = 'CUSTOMER';
      else if (actor.role === 'DRIVER' && ride.driverUserId.toString() === actor.userId)
        viewer = 'DRIVER';
      else if (RIDE_ADMIN_ROLES.includes(actor.role)) viewer = 'ADMIN';
      else throw new AppError('NOT_FOUND', 'Ride not found.');
      const booking = await Booking.findById(ride.bookingId);
      if (!booking) throw new AppError('NOT_FOUND', 'Ride not found.');
      // A driver who cancelled (the booking went back to the search) no longer sees the ride,
      // and with it the rider's contact details.
      if (viewer === 'DRIVER' && !booking.assignedDriverId?.equals(ride.driverId)) {
        throw new AppError('NOT_FOUND', 'Ride not found.');
      }
      return rideView(viewer, booking, ride);
    },

    async customerHistory(customerId: string, query: HistoryQuery) {
      const filter = { customerId, ...(query.status ? { status: query.status } : {}) };
      const [total, rows] = await Promise.all([
        Booking.countDocuments(filter),
        Booking.find(filter)
          .sort({ createdAt: -1 })
          .skip((query.page - 1) * query.limit)
          .limit(query.limit)
          .lean(),
      ]);
      return { items: rows.map(historyRow), meta: pageMeta(query.page, query.limit, total) };
    },

    async driverHistory(userId: string, query: HistoryQuery) {
      const profile = await requireDriverProfile(userId);
      const filter = {
        assignedDriverId: profile._id,
        ...(query.status ? { status: query.status } : {}),
      };
      const [total, rows] = await Promise.all([
        Booking.countDocuments(filter),
        Booking.find(filter)
          .sort({ createdAt: -1 })
          .skip((query.page - 1) * query.limit)
          .limit(query.limit)
          .lean(),
      ]);
      return { items: rows.map(historyRow), meta: pageMeta(query.page, query.limit, total) };
    },

    /* ---------- pickup OTP (customer) ---------- */

    async pickupOtp(customerId: string, ridePublicId: string) {
      const { ride, booking } = await loadCustomerRide(customerId, ridePublicId);
      if (!['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'].includes(booking.status)) {
        throw invalidState('The pickup OTP is only available before the ride starts.');
      }
      return {
        pickupOtp: deriveOtp(otpSecret, ride.publicId, ride.otp!.nonce),
        expiresAt: ride.otp!.expiresAt,
        attemptsRemaining: Math.max(0, config.otpMaxAttempts - (ride.otp!.attempts ?? 0)),
      };
    },

    /** Issue a fresh OTP (new nonce, attempts reset), e.g. after expiry or too many wrong tries. */
    async resendOtp(customerId: string, ridePublicId: string) {
      const { ride, booking } = await loadCustomerRide(customerId, ridePublicId);
      if (!['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'].includes(booking.status)) {
        throw invalidState('The pickup OTP can only be re-issued before the ride starts.');
      }
      const t = now();
      const issued = ride.otp!.issuedAt?.getTime() ?? 0;
      if (t.getTime() - issued < OTP_REISSUE_MS) {
        throw new AppError('RATE_LIMITED', 'Please wait before requesting a new OTP.');
      }
      const nonce = randomBytes(8).toString('hex');
      const updated = await Ride.findOneAndUpdate(
        { _id: ride._id, 'otp.issuedAt': ride.otp!.issuedAt },
        {
          'otp.nonce': nonce,
          'otp.attempts': 0,
          'otp.issuedAt': t,
          'otp.expiresAt': new Date(t.getTime() + config.otpTtlMs),
        },
        { returnDocument: 'after' },
      );
      if (!updated) throw new AppError('CONFLICT', 'The OTP was just re-issued. Fetch it again.');
      return {
        pickupOtp: deriveOtp(otpSecret, ride.publicId, nonce),
        expiresAt: updated.otp!.expiresAt,
      };
    },

    /* ---------- driver actions ---------- */

    async enRoute(userId: string, ridePublicId: string) {
      const { ride, booking } = await loadDriverRide(userId, ridePublicId);
      const t = now();
      const moved = await transitionBooking(
        { _id: booking._id, assignedDriverId: ride.driverId },
        ['DRIVER_ASSIGNED'],
        'DRIVER_ARRIVING',
      );
      if (!moved) throw invalidState();
      await Ride.updateOne({ _id: ride._id }, { enRouteAt: t });
      await record({
        bookingId: booking._id,
        type: 'DRIVER_EN_ROUTE',
        fromStatus: 'DRIVER_ASSIGNED',
        toStatus: 'DRIVER_ARRIVING',
        actorType: 'DRIVER',
        actorId: userId,
        at: t,
      });
      return { rideId: ride.publicId, status: 'DRIVER_ARRIVING' as const };
    },

    async arrived(userId: string, ridePublicId: string, _input: ArrivedInput) {
      const { ride, booking } = await loadDriverRide(userId, ridePublicId);
      if (booking.status !== 'DRIVER_ARRIVING') throw invalidState();

      // Arrival is judged from the position the SERVER holds for the driver, not a number the app sends.
      const t = now();
      const driver = await DriverProfile.findById(ride.driverId).lean();
      const fresh =
        driver?.locationUpdatedAt &&
        t.getTime() - driver.locationUpdatedAt.getTime() <= config.locationFreshMs;
      if (!driver?.currentLocation || !fresh) {
        throw new AppError(
          'NOT_AT_PICKUP',
          'We could not confirm your location. Check GPS and try again.',
        );
      }
      const here = fromPoint(driver.currentLocation);
      const distance = haversineMeters(here, fromPoint(booking.pickup.location!));
      if (distance > config.arrivalRadiusMeters) {
        throw new AppError('NOT_AT_PICKUP');
      }

      const moved = await transitionBooking(
        { _id: booking._id, assignedDriverId: ride.driverId },
        ['DRIVER_ARRIVING'],
        'DRIVER_ARRIVED',
      );
      if (!moved) throw invalidState();
      await Ride.updateOne(
        { _id: ride._id },
        { arrivedAt: t, arrivalLocation: toPoint(here.lat, here.lng) },
      );
      await record({
        bookingId: booking._id,
        type: 'DRIVER_ARRIVED',
        fromStatus: 'DRIVER_ARRIVING',
        toStatus: 'DRIVER_ARRIVED',
        actorType: 'DRIVER',
        actorId: userId,
        at: t,
      });
      return { rideId: ride.publicId, status: 'DRIVER_ARRIVED' as const, arrivedAt: t };
    },

    async start(userId: string, ridePublicId: string, input: StartInput) {
      const { ride, booking } = await loadDriverRide(userId, ridePublicId);
      // Wrong-state calls must not burn OTP attempts.
      if (booking.status !== 'DRIVER_ARRIVED') throw invalidState();
      const t = now();
      if (!ride.otp?.expiresAt || ride.otp.expiresAt.getTime() < t.getTime()) {
        throw new AppError('PICKUP_OTP_EXPIRED');
      }

      // Count the attempt atomically before comparing, so parallel guesses can't beat the cap.
      const counted = await Ride.findOneAndUpdate(
        { _id: ride._id, 'otp.attempts': { $lt: config.otpMaxAttempts }, 'otp.verifiedAt': null },
        { $inc: { 'otp.attempts': 1 } },
        { returnDocument: 'after' },
      );
      if (!counted) {
        // A parallel start may have just succeeded: that is a state conflict, not a lockout.
        const fresh = await Ride.findById(ride._id).select('otp.verifiedAt').lean();
        if (fresh?.otp?.verifiedAt) throw invalidState();
        throw new AppError('PICKUP_OTP_ATTEMPTS_EXCEEDED');
      }
      if (!safeEqual(deriveOtp(otpSecret, ride.publicId, counted.otp!.nonce), input.pickupOtp)) {
        throw new AppError('PICKUP_OTP_INVALID');
      }

      const moved = await transitionBooking(
        { _id: booking._id, assignedDriverId: ride.driverId },
        ['DRIVER_ARRIVED'],
        'IN_PROGRESS',
      );
      if (!moved) throw invalidState();
      const driver = await DriverProfile.findById(ride.driverId).select('currentLocation').lean();
      await Ride.updateOne(
        { _id: ride._id },
        {
          startedAt: t,
          'otp.verifiedAt': t,
          ...(driver?.currentLocation ? { startLocation: driver.currentLocation } : {}),
          ...(input.odometerStartMeters !== undefined
            ? { reportedOdometerStartMeters: input.odometerStartMeters }
            : {}),
        },
      );
      await record({
        bookingId: booking._id,
        type: 'RIDE_STARTED',
        fromStatus: 'DRIVER_ARRIVED',
        toStatus: 'IN_PROGRESS',
        actorType: 'DRIVER',
        actorId: userId,
        at: t,
      });
      return { rideId: ride.publicId, status: 'IN_PROGRESS' as const, startedAt: t };
    },

    async complete(userId: string, ridePublicId: string, input: CompleteInput) {
      const { ride, booking } = await loadDriverRide(userId, ridePublicId);
      if (booking.status !== 'IN_PROGRESS' || !ride.startedAt) throw invalidState();
      const t = now();

      // The fare is recomputed on the server: quoted route distance, MEASURED duration and waiting
      // (server clock), all under the fare config version the customer was quoted. Nothing from the
      // app is used.
      const snapshot = booking.fareSnapshot as {
        currency?: string;
        configId?: string;
        configVersion?: number;
        estimatedDistanceMeters: number;
        estimatedDurationSeconds: number;
        /** Tax rate frozen on the quote, in basis points. */
        taxBp?: number;
        breakdown: { estimatedTotalPaise: number };
      };
      const measured = secondsBetween(ride.startedAt, t);
      // Waiting at the pickup (arrived -> started) and at each stop (arrived -> departed).
      const pickupWait = ride.arrivedAt ? secondsBetween(ride.arrivedAt, ride.startedAt) : 0;
      const stopWaits = (ride.stopLog ?? []).map((st) =>
        secondsBetween(st.arrivedAt, st.departedAt ?? t),
      );
      const stopWaitTotal = stopWaits.reduce((sum, n) => sum + n, 0);
      // Time spent standing at a stop is billed as waiting, not also as ride time.
      const moving = Math.max(0, measured - stopWaitTotal);
      const minSec = Math.round(snapshot.estimatedDurationSeconds * config.durationClampMin);
      const maxSec = Math.round(snapshot.estimatedDurationSeconds * config.durationClampMax);
      const billableDuration = Math.min(Math.max(moving, minSec), maxSec);
      const cfg = snapshot.configId ? await FareConfig.findById(snapshot.configId).lean() : null;

      const waiting = computeWaiting({
        pickupWaitSeconds: pickupWait,
        stopWaitSeconds: stopWaits,
        freeSeconds: cfg?.freeWaitingSeconds ?? 0,
        capSeconds: config.waitingCapSeconds,
      });

      const tripKind = (booking as { tripKind?: string | null }).tripKind ?? 'CITY';
      let tripFinal: Record<string, unknown> | null = null;
      if (tripKind !== 'CITY') {
        // Rentals and outstation trips are billed on what the server saw: the time on the clock and the
        // distance of the recorded route trail. The odometer the driver typed in is kept only as evidence.
        const end = input.endLocation
          ? { lat: input.endLocation.lat, lng: input.endLocation.lng, at: t }
          : null;
        // The trip starts at the pickup point, at the moment the OTP was verified.
        const [pickupLng, pickupLat] = booking.pickup.location!.coordinates as [number, number];
        const measuredMeters = await trailMeters(booking._id, {
          start: { lat: pickupLat, lng: pickupLng, at: ride.startedAt },
          end,
          maxSpeedMps: config.maxSpeedMps,
          maxAccuracyMeters: config.maxAccuracyMeters,
          bookingStatus: 'IN_PROGRESS',
        });
        const rules = {
          rentalGraceMinutes: config.rentalGraceMinutes,
          rentalGraceKm: config.rentalGraceKm,
          oneWayDetourBp: config.oneWayDetourBp,
          taxBp: snapshot.taxBp ?? 0,
        };
        const f =
          tripKind === 'RENTAL'
            ? rentalFinal(
                (booking as unknown as { rental: RentalSnapshot }).rental,
                { elapsedSeconds: measured, measuredMeters },
                rules,
              )
            : outstationFinal(
                (booking as unknown as { outstation: OutstationSnapshot }).outstation,
                { startedAt: ride.startedAt, endedAt: t, measuredMeters },
                rules,
              );
        tripFinal = {
          currency: snapshot.currency ?? 'INR',
          configVersion: snapshot.configVersion ?? null,
          basis:
            tripKind === 'RENTAL' ? 'RENTAL_PACKAGE_AND_USAGE' : 'OUTSTATION_DISTANCE_AND_DAYS',
          billableDistanceMeters: f.billableDistanceMeters,
          billableDurationSeconds: f.billableDurationSeconds,
          measuredDurationSeconds: measured,
          measuredDistanceMeters: measuredMeters,
          waiting: { ...waiting, ratePerMinutePaise: 0, billableSeconds: 0 },
          breakdown: f.breakdown,
          labels: f.labels,
          details: f.details,
          extraLines: f.extraLines,
        };
        const reported = input.odometerEndMeters;
        const reportedStart = (ride as { reportedOdometerStartMeters?: number | null })
          .reportedOdometerStartMeters;
        if (reported !== undefined && reportedStart != null) {
          const driven = reported - reportedStart;
          if (Math.abs(driven - measuredMeters) > Math.max(2000, measuredMeters * 0.15)) {
            await record({
              bookingId: booking._id,
              type: 'ODOMETER_MISMATCH',
              actorType: 'SYSTEM',
              at: t,
              metadata: { reportedMeters: driven, measuredMeters },
            });
          }
        }
      }

      // City rides: weigh the quoted distance against where the car really went (server GPS trail).
      let cityDistance: CityDistanceResult | null = null;
      if (!tripFinal && cfg) {
        const [pickupLng, pickupLat] = booking.pickup.location!.coordinates as [number, number];
        const trail = await trailSummary(booking._id, {
          start: { lat: pickupLat, lng: pickupLng, at: ride.startedAt },
          maxSpeedMps: config.maxSpeedMps,
          maxAccuracyMeters: config.maxAccuracyMeters,
          bookingStatus: 'IN_PROGRESS',
        }).catch(() => ({ meters: 0, pings: 0 })); // a trail problem must never stop a ride from ending
        cityDistance = reconcileCityDistance(
          {
            quotedMeters: snapshot.estimatedDistanceMeters,
            measuredMeters: trail.meters,
            pings: trail.pings,
          },
          {
            mode: config.cityDistanceBilling,
            detourBp: config.cityDetourBp,
            shortBp: config.cityShortBp,
            floorBp: config.cityFloorBp,
            ceilingBp: config.cityCeilingBp,
            minPings: config.cityMinPings,
            flagBp: config.cityFlagBp,
          },
        );
      }

      const finalFare = tripFinal
        ? tripFinal
        : cfg
          ? {
              currency: snapshot.currency ?? 'INR',
              configVersion: cfg.version,
              basis:
                cityDistance!.basis === 'QUOTED'
                  ? 'QUOTED_DISTANCE_MEASURED_TIME'
                  : 'MEASURED_DISTANCE_AND_TIME',
              billableDistanceMeters: cityDistance!.billableMeters,
              quotedDistanceMeters: snapshot.estimatedDistanceMeters,
              measuredDistanceMeters: cityDistance!.measuredMeters,
              distanceBasis: cityDistance!.basis,
              billableDurationSeconds: billableDuration,
              measuredDurationSeconds: measured,
              waiting: { ...waiting, ratePerMinutePaise: cfg.waitingPerMinutePaise ?? 0 },
              breakdown: calculateFare(
                {
                  baseFarePaise: cfg.baseFarePaise,
                  perKmPaise: cfg.perKmPaise,
                  perMinutePaise: cfg.perMinutePaise,
                  minimumFarePaise: cfg.minimumFarePaise,
                  roundingMode: (cfg.roundingMode ?? 'NEAREST_RUPEE') as 'NEAREST_RUPEE' | 'NONE',
                },
                cityDistance!.billableMeters,
                billableDuration,
                {
                  billableSeconds: waiting.billableSeconds,
                  perMinutePaise: cfg.waitingPerMinutePaise ?? 0,
                },
                snapshot.taxBp ?? 0,
              ),
            }
          : {
              // Config no longer available: honour the price the customer was quoted.
              currency: snapshot.currency ?? 'INR',
              configVersion: snapshot.configVersion ?? null,
              basis: 'QUOTED_ESTIMATE',
              billableDistanceMeters: snapshot.estimatedDistanceMeters,
              billableDurationSeconds: snapshot.estimatedDurationSeconds,
              measuredDurationSeconds: measured,
              waiting: { ...waiting, ratePerMinutePaise: 0, billableSeconds: 0 },
              breakdown: snapshot.breakdown,
            };
      // The full fare is what the driver's pay and the platform's cut are based on. A coupon (rule
      // frozen at booking) lowers only what the RIDER owes; the platform funds the difference.
      // The gross fare is what the rider would pay without a coupon: the fare plus tax. Tax is the
      // government's, so the driver's pay, the commission and the coupon are all worked out on the fare before tax.
      const finalBreakdown = finalFare['breakdown' as keyof typeof finalFare] as {
        estimatedTotalPaise: number;
        taxPaise?: number;
      };
      const grossFarePaise = finalBreakdown.estimatedTotalPaise;
      const taxPaise = finalBreakdown.taxPaise ?? 0;
      const discountPaise = booking.coupon
        ? computeDiscount(booking.coupon, grossFarePaise - taxPaise)
        : 0;
      const finalFarePaise = grossFarePaise - discountPaise;
      Object.assign(finalFare, {
        grossFarePaise,
        discountPaise,
        ...(booking.coupon && discountPaise > 0 ? { couponCode: booking.coupon.code } : {}),
      });

      const moved = await transitionBooking(
        { _id: booking._id, assignedDriverId: ride.driverId },
        ['IN_PROGRESS'],
        'COMPLETED',
        {
          // Completing never marks anything PAID; payment is its own state machine.
          set: {
            completedAt: t,
            paymentStatus: booking.paymentMethod === 'CORPORATE' ? 'BILLED' : 'DUE',
            finalFarePaise,
            grossFarePaise,
            taxPaise,
            discountPaise,
            finalFare,
            'receipt.number': publicId('rcpt'),
            'receipt.issuedAt': t,
          },
          // A change of destination still waiting for an answer is void once the ride is over.
          unset: { destinationChange: 1 },
        },
      );
      if (!moved) throw invalidState();

      await Ride.updateOne(
        { _id: ride._id },
        {
          completedAt: t,
          finalFare,
          ...(input.endLocation
            ? { endLocation: toPoint(input.endLocation.lat, input.endLocation.lng) }
            : {}),
          ...(input.odometerEndMeters !== undefined
            ? { reportedOdometerEndMeters: input.odometerEndMeters }
            : {}),
          ...(input.driverNote ? { driverNote: input.driverNote } : {}),
        },
      );
      await dispatch.releaseDriver(ride.driverId as Types.ObjectId, booking._id);
      await record({
        bookingId: booking._id,
        type: 'RIDE_COMPLETED',
        fromStatus: 'IN_PROGRESS',
        toStatus: 'COMPLETED',
        actorType: 'DRIVER',
        actorId: userId,
        at: t,
        metadata: { finalFarePaise },
      });
      if (cityDistance?.mismatch) {
        // For staff: the trail and the quote disagree by a lot. Nothing is changed by this alone.
        await record({
          bookingId: booking._id,
          type: 'DISTANCE_MISMATCH',
          actorType: 'SYSTEM',
          at: t,
          metadata: {
            quotedMeters: snapshot.estimatedDistanceMeters,
            measuredMeters: cityDistance.measuredMeters,
            billedMeters: cityDistance.billableMeters,
            basis: cityDistance.basis,
          },
        });
      }
      await ledger.accrueRideSafe(booking._id);
      return {
        rideId: ride.publicId,
        status: 'COMPLETED' as const,
        paymentStatus: (booking.paymentMethod === 'CORPORATE' ? 'BILLED' : 'DUE') as
          'BILLED' | 'DUE',
        fare: finalFare,
        finalFarePaise,
        grossFarePaise,
        taxPaise,
        discountPaise,
        receiptNumber: moved.receipt?.number ?? null,
      };
    },

    /* ---------- cancellation ---------- */

    async driverCancel(userId: string, ridePublicId: string, input: DriverCancelInput) {
      const { ride, booking } = await loadDriverRide(userId, ridePublicId);
      const cancellable = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'] as const;

      // The rider is not left stranded by a driver's cancel: the booking goes back to the search
      // (excluding this driver) a limited number of times; after that it ends as cancelled.
      if ((booking.redispatchCount ?? 0) < config.maxRedispatches) {
        const t = now();
        const moved = await transitionBooking(
          { _id: booking._id, assignedDriverId: ride.driverId },
          cancellable,
          'DISPATCHING',
          {
            set: { assignedDriverId: null, 'dispatch.startedAt': t, 'dispatch.lockUntil': null },
            inc: { redispatchCount: 1, 'dispatch.round': 1 },
            unset: { assignedAt: 1, rideId: 1 },
            push: {
              previousDrivers: {
                driverId: ride.driverId,
                cancelledAt: t,
                reasonCode: input.reasonCode,
              },
            },
            addToSet: { excludedDriverIds: ride.driverId },
          },
        );
        if (!moved) throw invalidState('This ride can no longer be cancelled.');
        await dispatch.releaseDriver(ride.driverId as Types.ObjectId, booking._id);
        await record({
          bookingId: booking._id,
          type: 'DRIVER_CANCELLED_REDISPATCH',
          fromStatus: booking.status as BookingStatus,
          toStatus: 'DISPATCHING',
          actorType: 'DRIVER',
          actorId: userId,
          at: t,
          metadata: { reasonCode: input.reasonCode, redispatch: moved.redispatchCount },
        });
        await dispatch.runRound(booking._id);
        return {
          rideId: ride.publicId,
          status: 'CANCELLED' as const,
          bookingContinues: true,
          fee: null,
        };
      }

      await cancelBooking(
        { _id: booking._id, assignedDriverId: ride.driverId },
        cancellable,
        'DRIVER',
        userId,
        input,
      );
      return {
        rideId: ride.publicId,
        status: 'CANCELLED' as const,
        bookingContinues: false,
        fee: null,
      };
    },

    async customerCancel(customerId: string, bookingPublicId: string, input: CustomerCancelInput) {
      const owned = await Booking.exists({ publicId: bookingPublicId, customerId });
      if (!owned) throw new AppError('NOT_FOUND', 'Booking not found.');
      const cancelled = await cancelBooking(
        { publicId: bookingPublicId, customerId },
        [
          'SCHEDULED',
          'REQUESTED',
          'DISPATCHING',
          'DRIVER_ASSIGNED',
          'DRIVER_ARRIVING',
          'DRIVER_ARRIVED',
        ],
        'CUSTOMER',
        customerId,
        input,
        { chargeRider: true },
      );
      return {
        bookingId: bookingPublicId,
        status: 'CANCELLED' as const,
        fee: cancelled.fee
          ? {
              type: cancelled.fee.type,
              amountPaise: cancelled.fee.amountPaise,
              status: cancelled.fee.status,
            }
          : null,
      };
    },

    /** What cancelling would cost the rider right now. The same rule as the real cancel. */
    async cancelPreview(customerId: string, bookingPublicId: string) {
      const b = await Booking.findOne({ publicId: bookingPublicId, customerId }).lean();
      if (!b) throw new AppError('NOT_FOUND', 'Booking not found.');
      const canCancel = [
        'SCHEDULED',
        'REQUESTED',
        'DISPATCHING',
        'DRIVER_ASSIGNED',
        'DRIVER_ARRIVING',
        'DRIVER_ARRIVED',
      ].includes(b.status);
      const a = assessCustomerCancellation(
        b.policy ?? DEFAULT_POLICY,
        { status: b.status, assignedAt: b.assignedAt },
        now(),
      );
      return {
        bookingId: b.publicId,
        canCancel,
        feePaise: canCancel ? a.amountPaise : 0,
        currency: 'INR',
        reason: a.reason,
        freeUntil: canCancel ? a.freeUntil : null,
      };
    },

    /** The rider was not at the pickup: close the ride after the policy's waiting time and charge the fee. */
    async noShow(userId: string, ridePublicId: string) {
      const { ride, booking } = await loadDriverRide(userId, ridePublicId);
      if (booking.status !== 'DRIVER_ARRIVED' || !ride.arrivedAt) throw invalidState();
      const t = now();
      const policy = booking.policy ?? DEFAULT_POLICY;
      const wait = noShowEligibility(policy, ride.arrivedAt, t);
      if (!wait.allowed) {
        const minutes = Math.ceil((policy.noShowWaitSeconds - wait.waitedSeconds) / 60);
        throw new AppError(
          'NO_SHOW_TOO_EARLY',
          `Please wait about ${minutes} more minute(s) before marking a no-show.`,
        );
      }
      // The driver must still be at the pickup, judged from the position the server holds.
      await requireDriverNear(
        ride.driverId as Types.ObjectId,
        booking.pickup.location!,
        'NOT_AT_PICKUP',
      );

      const moved = await transitionBooking(
        { _id: booking._id, assignedDriverId: ride.driverId },
        ['DRIVER_ARRIVED'],
        'NO_SHOW',
        { set: feeFields('NO_SHOW', policy.noShowFeePaise, t, booking.paymentMethod) },
      );
      if (!moved) throw invalidState();
      await Ride.updateOne({ _id: ride._id }, { noShowAt: t });
      await dispatch.releaseDriver(ride.driverId as Types.ObjectId, booking._id);
      await record({
        bookingId: booking._id,
        type: 'RIDER_NO_SHOW',
        fromStatus: 'DRIVER_ARRIVED',
        toStatus: 'NO_SHOW',
        actorType: 'DRIVER',
        actorId: userId,
        at: t,
        metadata: { waitedSeconds: wait.waitedSeconds, feePaise: moved.fee?.amountPaise ?? 0 },
      });
      if (moved.fee) await ledger.accrueFeeSafe(moved._id);
      return {
        rideId: ride.publicId,
        status: 'NO_SHOW' as const,
        fee: moved.fee
          ? { type: moved.fee.type, amountPaise: moved.fee.amountPaise, status: moved.fee.status }
          : null,
      };
    },

    /* ---------- intermediate stops (driver) ---------- */

    async stopArrived(userId: string, ridePublicId: string, index: number) {
      const { ride, booking } = await loadDriverRide(userId, ridePublicId);
      if (booking.status !== 'IN_PROGRESS')
        throw invalidState('Stops are visited during the trip.');
      const stop = booking.stops?.[index];
      if (!stop) throw new AppError('NOT_FOUND', 'This booking has no such stop.');
      const log = ride.stopLog ?? [];
      if (log.length > index) throw invalidState('You have already arrived at this stop.');
      if (log.length < index) throw invalidState('Visit the earlier stops first.');
      if (index > 0 && !log[index - 1]?.departedAt) {
        throw invalidState('Leave the previous stop first.');
      }
      await requireDriverNear(ride.driverId as Types.ObjectId, stop.location!, 'NOT_AT_STOP');

      const t = now();
      // The size check makes a double tap, or a replay, change nothing.
      const res = await Ride.updateOne(
        { _id: ride._id, $expr: { $eq: [{ $size: '$stopLog' }, index] } },
        { $push: { stopLog: { index, arrivedAt: t, departedAt: null } } },
      );
      if (res.modifiedCount !== 1) throw invalidState('You have already arrived at this stop.');
      const eventId = await recordEvent({
        bookingId: booking._id,
        type: 'STOP_ARRIVED',
        actorType: 'DRIVER',
        actorId: userId,
        at: t,
        metadata: { index },
      });
      await notifier.rideUpdated(booking._id, {
        eventId,
        kind: 'STOP_ARRIVED',
        data: { index },
        toRider: true,
      });
      return { rideId: ride.publicId, stop: { index, arrivedAt: t } };
    },

    async stopDeparted(userId: string, ridePublicId: string, index: number) {
      const { ride, booking } = await loadDriverRide(userId, ridePublicId);
      if (booking.status !== 'IN_PROGRESS')
        throw invalidState('Stops are visited during the trip.');
      const t = now();
      const res = await Ride.updateOne(
        { _id: ride._id, stopLog: { $elemMatch: { index, departedAt: null } } },
        { $set: { 'stopLog.$.departedAt': t } },
      );
      if (res.modifiedCount !== 1) throw invalidState('You are not waiting at that stop.');
      const eventId = await recordEvent({
        bookingId: booking._id,
        type: 'STOP_DEPARTED',
        actorType: 'DRIVER',
        actorId: userId,
        at: t,
        metadata: { index },
      });
      await notifier.rideUpdated(booking._id, {
        eventId,
        kind: 'STOP_DEPARTED',
        data: { index },
        toRider: true,
      });
      return { rideId: ride.publicId, stop: { index, departedAt: t } };
    },

    /* ---------- destination change ---------- */

    /**
     * The rider asks to go somewhere else. The server prices the new route (same fare version as
     * the booking); the driver has a short time to accept. Nothing changes until they do.
     */
    async requestDestination(
      customerId: string,
      ridePublicId: string,
      input: DestinationRequestInput,
    ) {
      const { booking } = await loadCustomerRide(customerId, ridePublicId);
      const allowed = [
        'DRIVER_ASSIGNED',
        'DRIVER_ARRIVING',
        'DRIVER_ARRIVED',
        'IN_PROGRESS',
      ] as const;
      if (!allowed.includes(booking.status as (typeof allowed)[number])) {
        throw invalidState('The destination can only be changed while a driver is assigned.');
      }
      if ((booking.fareAmendments?.length ?? 0) >= config.maxDestinationChanges) {
        throw new AppError('UNPROCESSABLE', 'The destination has been changed too many times.');
      }
      const check = await quotes.checkPoint(input.drop.lat, input.drop.lng);
      if (!check.serviceable) {
        throw new AppError(
          'NOT_SERVICEABLE',
          `That drop-off is not serviceable (${check.reason}).`,
        );
      }
      const snapshot = booking.fareSnapshot as { configId?: string };
      const cfg = snapshot.configId ? await FareConfig.findById(snapshot.configId).lean() : null;
      if (!cfg) {
        throw new AppError('UNPROCESSABLE', 'Pricing for this booking is no longer available.');
      }

      // Priced as a fresh route from the pickup, through the same stops, to the new drop-off.
      let route;
      try {
        route = await routeThrough(maps, [
          fromPoint(booking.pickup.location!),
          ...(booking.stops ?? []).map((st) => fromPoint(st.location!)),
          input.drop,
        ]);
      } catch {
        throw new AppError('PROVIDER_ERROR', 'Could not compute the route. Please try again.');
      }
      if (route.distanceMeters < MIN_TRIP_METERS) {
        throw new AppError('UNPROCESSABLE', 'The new drop-off is too close to the pickup.');
      }
      if (route.distanceMeters > MAX_TRIP_METERS) {
        throw new AppError('NOT_SERVICEABLE', 'That trip is longer than we currently serve.');
      }
      const breakdown = calculateFare(
        {
          baseFarePaise: cfg.baseFarePaise,
          perKmPaise: cfg.perKmPaise,
          perMinutePaise: cfg.perMinutePaise,
          minimumFarePaise: cfg.minimumFarePaise,
          roundingMode: (cfg.roundingMode ?? 'NEAREST_RUPEE') as 'NEAREST_RUPEE' | 'NONE',
        },
        route.distanceMeters,
        route.durationSeconds,
        undefined,
        (booking.fareSnapshot as { taxBp?: number } | undefined)?.taxBp ?? 0,
      );

      const t = now();
      const requestId = publicId('dcr');
      const expiresAt = new Date(t.getTime() + config.destinationChangeTtlMs);
      const updated = await Booking.findOneAndUpdate(
        {
          _id: booking._id,
          customerId,
          status: { $in: allowed },
          // Only one request at a time; an unanswered one frees the slot when it expires.
          $or: [
            { destinationChange: { $exists: false } },
            { 'destinationChange.expiresAt': { $lte: t } },
          ],
        },
        {
          $set: {
            destinationChange: {
              requestId,
              requestedAt: t,
              expiresAt,
              drop: { label: input.drop.label, location: toPoint(input.drop.lat, input.drop.lng) },
              distanceMeters: route.distanceMeters,
              durationSeconds: route.durationSeconds,
              breakdown,
              estimatedTotalPaise: breakdown.estimatedTotalPaise,
            },
          },
        },
        { returnDocument: 'after' },
      );
      if (!updated) {
        throw new AppError('CONFLICT', 'A destination change is already waiting for your driver.');
      }
      const eventId = await recordEvent({
        bookingId: booking._id,
        type: 'DESTINATION_CHANGE_REQUESTED',
        actorType: 'CUSTOMER',
        actorId: customerId,
        at: t,
        metadata: { requestId, estimatedTotalPaise: breakdown.estimatedTotalPaise },
      });
      await notifier.rideUpdated(booking._id, {
        eventId,
        kind: 'DESTINATION_REQUESTED',
        data: {
          requestId,
          drop: { ...input.drop },
          estimatedTotalPaise: breakdown.estimatedTotalPaise,
          expiresAt: expiresAt.toISOString(),
        },
        toDriver: true,
        expiresAt,
      });
      return {
        requestId,
        expiresAt,
        currentEstimatedFarePaise: booking.estimatedFarePaise,
        newEstimatedFarePaise: breakdown.estimatedTotalPaise,
        newEstimatedDistanceMeters: route.distanceMeters,
        newEstimatedDurationSeconds: route.durationSeconds,
      };
    },

    async respondDestination(userId: string, ridePublicId: string, accept: boolean) {
      const { ride, booking } = await loadDriverRide(userId, ridePublicId);
      const t = now();
      const fresh = await Booking.findById(booking._id).lean();
      const pending = fresh?.destinationChange;
      if (!fresh || !pending || pending.expiresAt.getTime() <= t.getTime()) {
        throw new AppError('CONFLICT', 'There is no destination change waiting for you.');
      }
      const match = {
        _id: booking._id,
        assignedDriverId: ride.driverId,
        'destinationChange.requestId': pending.requestId,
        'destinationChange.expiresAt': { $gt: t },
      };

      if (!accept) {
        const res = await Booking.updateOne(match, { $unset: { destinationChange: 1 } });
        if (res.modifiedCount !== 1) {
          throw new AppError('CONFLICT', 'There is no destination change waiting for you.');
        }
        const eventId = await recordEvent({
          bookingId: booking._id,
          type: 'DESTINATION_CHANGE_DECLINED',
          actorType: 'DRIVER',
          actorId: userId,
          at: t,
          metadata: { requestId: pending.requestId },
        });
        await notifier.rideUpdated(booking._id, {
          eventId,
          kind: 'DESTINATION_DECLINED',
          data: { requestId: pending.requestId },
          toRider: true,
        });
        return { accepted: false };
      }

      const previous = fresh.fareSnapshot as {
        estimatedDistanceMeters: number;
        estimatedDurationSeconds: number;
      };
      const amended = await Booking.findOneAndUpdate(
        {
          ...match,
          status: { $in: ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS'] },
        },
        {
          $set: {
            drop: pending.drop,
            estimatedFarePaise: pending.estimatedTotalPaise,
            'fareSnapshot.estimatedDistanceMeters': pending.distanceMeters,
            'fareSnapshot.estimatedDurationSeconds': pending.durationSeconds,
            'fareSnapshot.breakdown': pending.breakdown,
          },
          $push: {
            fareAmendments: {
              at: t,
              reason: 'DESTINATION_CHANGE',
              requestId: pending.requestId,
              previous: {
                drop: {
                  ...fromPoint(fresh.drop.location!),
                  label: fresh.drop.label ?? null,
                },
                estimatedFarePaise: fresh.estimatedFarePaise,
                distanceMeters: previous.estimatedDistanceMeters,
                durationSeconds: previous.estimatedDurationSeconds,
              },
              next: {
                drop: {
                  ...fromPoint(pending.drop.location!),
                  label: pending.drop.label ?? null,
                },
                estimatedFarePaise: pending.estimatedTotalPaise,
                distanceMeters: pending.distanceMeters,
                durationSeconds: pending.durationSeconds,
              },
            },
          },
          $unset: { destinationChange: 1 },
        },
        { returnDocument: 'after' },
      );
      if (!amended) {
        throw new AppError('CONFLICT', 'There is no destination change waiting for you.');
      }
      const eventId = await recordEvent({
        bookingId: booking._id,
        type: 'DESTINATION_CHANGED',
        actorType: 'DRIVER',
        actorId: userId,
        at: t,
        metadata: {
          requestId: pending.requestId,
          estimatedTotalPaise: pending.estimatedTotalPaise,
        },
      });
      await notifier.rideUpdated(booking._id, {
        eventId,
        kind: 'DESTINATION_ACCEPTED',
        data: {
          requestId: pending.requestId,
          estimatedTotalPaise: pending.estimatedTotalPaise,
          drop: { ...fromPoint(pending.drop.location!), label: pending.drop.label ?? null },
        },
        toRider: true,
        toDriver: true,
      });
      return {
        accepted: true,
        estimatedFarePaise: pending.estimatedTotalPaise,
        drop: { ...fromPoint(pending.drop.location!), label: pending.drop.label ?? null },
      };
    },

    /* ---------- receipt ---------- */

    async receipt(actor: Actor, ridePublicId: string) {
      const ride = await Ride.findOne({ publicId: ridePublicId });
      if (!ride) throw new AppError('NOT_FOUND', 'Ride not found.');
      let viewer: Viewer;
      if (actor.role === 'CUSTOMER' && ride.customerId.toString() === actor.userId) {
        viewer = 'CUSTOMER';
      } else if (actor.role === 'DRIVER' && ride.driverUserId.toString() === actor.userId) {
        viewer = 'DRIVER';
      } else if (RIDE_ADMIN_ROLES.includes(actor.role)) viewer = 'ADMIN';
      else throw new AppError('NOT_FOUND', 'Ride not found.');
      let booking = await Booking.findById(ride.bookingId);
      if (!booking) throw new AppError('NOT_FOUND', 'Ride not found.');
      if (viewer === 'DRIVER' && !booking.assignedDriverId?.equals(ride.driverId)) {
        throw new AppError('NOT_FOUND', 'Ride not found.');
      }
      const billable =
        booking.status === 'COMPLETED' ||
        (['CANCELLED', 'NO_SHOW'].includes(booking.status) && Boolean(booking.fee));
      if (!billable) throw invalidState('A receipt is available once the ride is completed.');

      if (!booking.receipt?.number) {
        // Issued exactly once, even if two people open it at the same moment.
        const at = now();
        await Booking.updateOne(
          { _id: booking._id, 'receipt.number': { $exists: false } },
          { $set: { 'receipt.number': publicId('rcpt'), 'receipt.issuedAt': at } },
        );
        booking = (await Booking.findById(booking._id)) ?? booking;
      }
      return receiptView(viewer, booking.toObject(), ride.toObject());
    },

    /* ---------- tracking (customer, active ride only) ---------- */

    async track(customerId: string, ridePublicId: string) {
      const { ride, booking } = await loadCustomerRide(customerId, ridePublicId);
      if (!TRACKABLE.includes(booking.status as BookingStatus)) {
        throw invalidState('Tracking is only available while the ride is active.');
      }
      const driver = await DriverProfile.findById(ride.driverId)
        .select('currentLocation locationUpdatedAt headingDegrees')
        .lean();
      if (!driver?.currentLocation) {
        return { rideId: ride.publicId, status: booking.status, driver: null, etaSeconds: null };
      }
      const here = fromPoint(driver.currentLocation);
      const toDrop = booking.status === 'IN_PROGRESS';
      const target = fromPoint((toDrop ? booking.drop : booking.pickup).location!);
      let etaSeconds: number | null;
      try {
        etaSeconds = (await maps.route(here, target)).durationSeconds;
      } catch {
        etaSeconds = null;
      }
      const updatedAt = driver.locationUpdatedAt ?? null;
      return {
        rideId: ride.publicId,
        status: booking.status,
        driver: {
          ...here,
          headingDegrees: driver.headingDegrees ?? null,
          updatedAt,
          stale: !updatedAt || now().getTime() - updatedAt.getTime() > config.locationFreshMs,
        },
        etaSeconds,
        etaTarget: toDrop ? ('DROP' as const) : ('PICKUP' as const),
      };
    },
  };
}

export type RidesService = ReturnType<typeof createRidesService>;
