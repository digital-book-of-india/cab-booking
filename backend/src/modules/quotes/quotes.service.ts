import type { Types } from 'mongoose';
import type { Role } from '../../common/enums';
import { AppError } from '../../common/errors';
import { fromPoint, toPoint } from '../../common/geo';
import { publicId } from '../../common/ids';
import type { MapsProvider } from '../../providers';
import { CabCategory } from '../categories/cabCategory.model';
import { calculateFare } from '../pricing/fare';
import { FareConfig } from '../pricing/fareConfig.model';
import type { PricingService } from '../pricing/pricing.service';
import { isWithinOperatingHours, type ZonesService } from '../zones/zones.service';
import type { CouponsService } from '../coupons/coupons.service';
import type { TripsService } from '../trips/trips.service';
import {
  calendarDays,
  outstationEstimate,
  rentalEstimate,
  type OutstationSnapshot,
  type RentalSnapshot,
} from '../trips/tripFares';
import { FareQuote } from './fareQuote.model';
import { routeThrough } from './route';
import type { CreateQuoteInput, ServiceabilityQuery } from './quotes.schemas';

export const QUOTE_TTL_MS = 10 * 60_000;
/** Trips shorter than this are almost certainly a mistake; longer ones are out of MVP scope. */
export const MIN_TRIP_METERS = 100;
export const MAX_TRIP_METERS = 150_000;

type QuoteDoc = {
  publicId: string;
  categoryId: Types.ObjectId;
  configVersion: number;
  pickup: { label?: string | null; location: { coordinates: number[] } };
  drop: { label?: string | null; location: { coordinates: number[] } };
  stops?: { label?: string | null; location: { coordinates: number[] } }[];
  distanceMeters: number;
  durationSeconds: number;
  breakdown: unknown;
  currency?: string | null;
  expiresAt: Date;
  usedAt?: Date | null;
  coupon?: { code: string } | null;
  discountPaise?: number | null;
  scheduledFor?: Date | null;
  estimatedTotalPaise?: number;
  tripKind?: string | null;
  rental?: RentalSnapshot | null;
  outstation?: (OutstationSnapshot & { returnAt?: Date | null }) | null;
};

export function quoteView(raw: unknown, now: Date) {
  const q = raw as QuoteDoc;
  const status = q.usedAt ? 'USED' : q.expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : 'ACTIVE';
  return {
    quoteId: q.publicId,
    status,
    currency: q.currency ?? 'INR',
    categoryId: q.categoryId.toString(),
    pickup: { ...fromPoint(q.pickup.location), label: q.pickup.label ?? null },
    drop: { ...fromPoint(q.drop.location), label: q.drop.label ?? null },
    stops: (q.stops ?? []).map((s) => ({ ...fromPoint(s.location), label: s.label ?? null })),
    estimatedDistanceMeters: q.distanceMeters,
    estimatedDurationSeconds: q.durationSeconds,
    breakdown: q.breakdown,
    // What the rider would pay after their coupon (the real discount is set when the ride ends).
    coupon: q.coupon ? { code: q.coupon.code, discountPaise: q.discountPaise ?? 0 } : null,
    estimatedPayablePaise: (q.estimatedTotalPaise ?? 0) - (q.discountPaise ?? 0),
    scheduledFor: q.scheduledFor ?? null,
    tripKind: q.tripKind ?? 'CITY',
    rental: q.rental ?? null,
    outstation: q.outstation
      ? {
          tripType: q.outstation.tripType,
          returnAt: q.outstation.returnAt ?? null,
          days: q.outstation.days,
          nights: q.outstation.nights,
          routeMeters: q.outstation.routeMeters,
          estimatedKm: q.outstation.estimatedKm,
          perKmPaise: q.outstation.perKmPaise,
        }
      : null,
    configVersion: q.configVersion,
    expiresAt: q.expiresAt,
  };
}

export function createQuotesService(deps: {
  zones: ZonesService;
  pricing: PricingService;
  maps: MapsProvider;
  now: () => Date;
  coupons: Pick<CouponsService, 'evaluate'>;
  trips: Pick<TripsService, 'rentalPackage' | 'outstationRate'>;
  /** The longest round trip that can be booked, in days. */
  outstationMaxDays: number;
  /** Limits for rides booked for later. */
  schedule: { minLeadMs: number; maxAheadMs: number };
  /** Tax added on top of every fare, in basis points (500 = 5%). 0 or missing = none. */
  taxBp?: number;
}) {
  const { zones, pricing, maps, now, coupons, schedule, trips } = deps;
  const taxBp = deps.taxBp ?? 0;

  /** A ride for later must be neither too soon nor too far ahead. */
  function assertSchedulable(at: Date) {
    const ahead = at.getTime() - now().getTime();
    if (ahead < schedule.minLeadMs || ahead > schedule.maxAheadMs) {
      const mins = Math.round(schedule.minLeadMs / 60_000);
      const days = Math.round(schedule.maxAheadMs / 86_400_000);
      throw new AppError('UNPROCESSABLE', undefined, [
        {
          field: 'scheduledFor',
          message: `Choose a pickup time between ${mins} minutes and ${days} days from now`,
        },
      ]);
    }
  }

  /** Is this point inside an active zone that is open right now? */
  async function checkPoint(lat: number, lng: number, at: Date = now()) {
    const zone = await zones.locate(lat, lng);
    if (!zone) return { serviceable: false as const, reason: 'OUTSIDE_SERVICE_AREA' as const };
    if (!isWithinOperatingHours(zone.operatingHours, at)) {
      return { serviceable: false as const, reason: 'OUTSIDE_OPERATING_HOURS' as const };
    }
    return { serviceable: true as const, zone };
  }

  type Category = { _id: import('mongoose').Types.ObjectId };
  const quoteWindow = () => new Date(now().getTime() + QUOTE_TTL_MS);

  /** A rental: priced from the package; there is no route and no drop (the car comes back to the pickup). */
  async function buildRental(
    customerId: string,
    input: CreateQuoteInput,
    role: Role,
    category: Category,
  ) {
    const rideAt = input.scheduledFor ?? now();
    if (input.scheduledFor) assertSchedulable(input.scheduledFor);
    const pickup = await checkPoint(input.pickup.lat, input.pickup.lng, rideAt);
    if (!pickup.serviceable) {
      throw new AppError('NOT_SERVICEABLE', `Pickup is not serviceable (${pickup.reason}).`);
    }
    const pkg = await trips.rentalPackage(input.rentalPackageId!);
    if (
      !pkg ||
      !pkg.active ||
      pkg.zoneId.toString() !== pickup.zone._id.toString() ||
      pkg.categoryId.toString() !== category._id.toString()
    ) {
      throw new AppError('UNPROCESSABLE', undefined, [
        {
          field: 'rentalPackageId',
          message: 'This package is not available here for this cab type.',
        },
      ]);
    }
    const snapshot: RentalSnapshot = {
      packageId: pkg._id.toString(),
      name: pkg.name,
      hours: pkg.hours,
      includedKm: pkg.includedKm,
      pricePaise: pkg.pricePaise,
      extraKmPaise: pkg.extraKmPaise,
      extraHourPaise: pkg.extraHourPaise,
    };
    const fare = rentalEstimate(snapshot, taxBp);
    const applied = input.couponCode
      ? await coupons.evaluate(role, {
          code: input.couponCode,
          userId: customerId,
          zoneId: pickup.zone._id,
          categoryId: category._id,
          estimatedFarePaise: fare.breakdown.estimatedTotalPaise - fare.breakdown.taxPaise,
        })
      : null;
    return FareQuote.create({
      publicId: publicId('fq'),
      customerId,
      zoneId: pickup.zone._id,
      categoryId: category._id,
      tripKind: 'RENTAL',
      rental: snapshot,
      pickup: { label: input.pickup.label, location: toPoint(input.pickup.lat, input.pickup.lng) },
      // The car returns to the pickup: the "drop" is the same place.
      drop: {
        label: input.pickup.label ?? 'Same as pickup (rental)',
        location: toPoint(input.pickup.lat, input.pickup.lng),
      },
      stops: [],
      distanceMeters: snapshot.includedKm * 1000,
      durationSeconds: snapshot.hours * 3600,
      breakdown: fare.breakdown,
      estimatedTotalPaise: fare.breakdown.estimatedTotalPaise,
      taxBp,
      ...(applied ? { coupon: applied.snapshot, discountPaise: applied.discountPaise } : {}),
      ...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : {}),
      expiresAt: quoteWindow(),
    });
  }

  /** An outstation trip: priced from the route distance (and the days, for a round trip). */
  async function buildOutstation(
    customerId: string,
    input: CreateQuoteInput,
    role: Role,
    category: Category,
  ) {
    const trip = input.outstation!;
    const rideAt = input.scheduledFor ?? now();
    if (input.scheduledFor) assertSchedulable(input.scheduledFor);
    const pickup = await checkPoint(input.pickup.lat, input.pickup.lng, rideAt);
    if (!pickup.serviceable) {
      throw new AppError('NOT_SERVICEABLE', `Pickup is not serviceable (${pickup.reason}).`);
    }
    const rate = await trips.outstationRate(pickup.zone._id, category._id);
    if (!rate) {
      throw new AppError(
        'NOT_SERVICEABLE',
        'Outstation trips are not available from here for this cab type.',
      );
    }
    const drop = input.drop!;
    let route;
    try {
      route = await routeThrough(maps, [input.pickup, drop]);
    } catch {
      throw new AppError('PROVIDER_ERROR', 'Could not compute the route. Please try again.');
    }
    const routeKm = route.distanceMeters / 1000;
    if (routeKm < rate.minKm) {
      throw new AppError('UNPROCESSABLE', undefined, [
        {
          field: 'drop',
          message: `Outstation trips are at least ${rate.minKm} km. For a shorter trip book a city ride.`,
        },
      ]);
    }
    if (routeKm > rate.maxKm) {
      throw new AppError('NOT_SERVICEABLE', `Outstation trips are served up to ${rate.maxKm} km.`);
    }
    let days = 1;
    if (trip.tripType === 'ROUND_TRIP') {
      const returnAt = trip.returnAt!;
      const hoursAway = (returnAt.getTime() - rideAt.getTime()) / 3_600_000;
      if (hoursAway < 2 || hoursAway > deps.outstationMaxDays * 24) {
        throw new AppError('UNPROCESSABLE', undefined, [
          {
            field: 'outstation',
            message: `Choose a return time between 2 hours and ${deps.outstationMaxDays} days after pickup.`,
          },
        ]);
      }
      days = calendarDays(rideAt, returnAt);
    }
    const snapshot: OutstationSnapshot = {
      rateId: rate._id.toString(),
      tripType: trip.tripType,
      routeMeters: route.distanceMeters,
      returnAt: trip.returnAt ?? null,
      days,
      nights: days - 1,
      perKmPaise: trip.tripType === 'ROUND_TRIP' ? rate.roundTripPerKmPaise : rate.oneWayPerKmPaise,
      minKmPerDay: rate.minKmPerDay,
      allowancePerNightPaise: rate.driverAllowancePerNightPaise,
      minimumFarePaise: rate.minimumFarePaise,
      estimatedKm: trip.tripType === 'ROUND_TRIP' ? routeKm * 2 : routeKm,
    };
    const fare = outstationEstimate(snapshot, taxBp);
    const applied = input.couponCode
      ? await coupons.evaluate(role, {
          code: input.couponCode,
          userId: customerId,
          zoneId: pickup.zone._id,
          categoryId: category._id,
          estimatedFarePaise: fare.breakdown.estimatedTotalPaise - fare.breakdown.taxPaise,
        })
      : null;
    return FareQuote.create({
      publicId: publicId('fq'),
      customerId,
      zoneId: pickup.zone._id,
      categoryId: category._id,
      tripKind: 'OUTSTATION',
      outstation: snapshot,
      pickup: { label: input.pickup.label, location: toPoint(input.pickup.lat, input.pickup.lng) },
      drop: { label: drop.label, location: toPoint(drop.lat, drop.lng) },
      stops: [],
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      breakdown: fare.breakdown,
      estimatedTotalPaise: fare.breakdown.estimatedTotalPaise,
      taxBp,
      ...(applied ? { coupon: applied.snapshot, discountPaise: applied.discountPaise } : {}),
      ...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : {}),
      expiresAt: quoteWindow(),
    });
  }

  async function build(customerId: string, input: CreateQuoteInput, role: Role = 'CUSTOMER') {
    const category = await CabCategory.findOne({ _id: input.categoryId, active: true }).lean();
    if (!category) {
      throw new AppError('UNPROCESSABLE', undefined, [
        { field: 'categoryId', message: 'Unknown or inactive category' },
      ]);
    }
    if (input.rentalPackageId) return buildRental(customerId, input, role, category);
    if (input.outstation) return buildOutstation(customerId, input, role, category);
    const dropInput = input.drop!;
    const stops = input.stops ?? [];
    // The zone must be open at pickup time, which for a ride for later is not now.
    if (input.scheduledFor) assertSchedulable(input.scheduledFor);
    const rideAt = input.scheduledFor ?? now();
    const [pickup, drop, ...stopChecks] = await Promise.all([
      checkPoint(input.pickup.lat, input.pickup.lng, rideAt),
      checkPoint(dropInput.lat, dropInput.lng, rideAt),
      ...stops.map((s) => checkPoint(s.lat, s.lng, rideAt)),
    ]);
    if (!pickup.serviceable) {
      throw new AppError('NOT_SERVICEABLE', `Pickup is not serviceable (${pickup.reason}).`);
    }
    if (!drop.serviceable) {
      throw new AppError('NOT_SERVICEABLE', `Drop is not serviceable (${drop.reason}).`);
    }
    for (const [i, check] of stopChecks.entries()) {
      if (!check.serviceable) {
        throw new AppError(
          'NOT_SERVICEABLE',
          `Stop ${i + 1} is not serviceable (${check.reason}).`,
        );
      }
    }

    const at = now();
    // Pricing follows the pickup zone.
    const config = await pricing.getActiveConfig(pickup.zone._id, category._id, rideAt);
    if (!config) {
      throw new AppError('NOT_SERVICEABLE', 'This category is not available in the pickup zone.');
    }

    let route;
    try {
      route = await routeThrough(maps, [input.pickup, ...stops, dropInput]);
    } catch {
      throw new AppError('PROVIDER_ERROR', 'Could not compute the route. Please try again.');
    }
    if (route.distanceMeters < MIN_TRIP_METERS) {
      throw new AppError('UNPROCESSABLE', 'Pickup and drop are too close together.');
    }
    if (route.distanceMeters > MAX_TRIP_METERS) {
      throw new AppError('NOT_SERVICEABLE', 'This trip is longer than we currently serve.');
    }

    const breakdown = calculateFare(
      {
        baseFarePaise: config.baseFarePaise,
        perKmPaise: config.perKmPaise,
        perMinutePaise: config.perMinutePaise,
        minimumFarePaise: config.minimumFarePaise,
        roundingMode: (config.roundingMode ?? 'NEAREST_RUPEE') as 'NEAREST_RUPEE' | 'NONE',
      },
      route.distanceMeters,
      route.durationSeconds,
      undefined,
      taxBp,
    );

    // A coupon is checked now (so the rider sees the price they will pay) and frozen on the quote.
    const applied = input.couponCode
      ? await coupons.evaluate(role, {
          code: input.couponCode,
          userId: customerId,
          zoneId: pickup.zone._id,
          categoryId: category._id,
          estimatedFarePaise: breakdown.estimatedTotalPaise - breakdown.taxPaise,
        })
      : null;

    const created = await FareQuote.create({
      publicId: publicId('fq'),
      customerId,
      zoneId: pickup.zone._id,
      categoryId: category._id,
      configId: config._id,
      configVersion: config.version,
      pickup: { label: input.pickup.label, location: toPoint(input.pickup.lat, input.pickup.lng) },
      drop: { label: dropInput.label, location: toPoint(dropInput.lat, dropInput.lng) },
      stops: stops.map((s) => ({ label: s.label, location: toPoint(s.lat, s.lng) })),
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      breakdown,
      estimatedTotalPaise: breakdown.estimatedTotalPaise,
      taxBp,
      ...(applied ? { coupon: applied.snapshot, discountPaise: applied.discountPaise } : {}),
      ...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : {}),
      expiresAt: new Date(at.getTime() + QUOTE_TTL_MS),
    });
    return created;
  }

  async function findOwned(customerId: string, quoteId: string) {
    // Scoped by customer: someone else's quote is simply "not found".
    const quote = await FareQuote.findOne({ publicId: quoteId, customerId });
    if (!quote) throw new AppError('NOT_FOUND', 'Fare quote not found.');
    return quote;
  }

  return {
    checkPoint,
    assertSchedulable,

    async serviceability(query: ServiceabilityQuery) {
      const [pickup, drop] = await Promise.all([
        checkPoint(query.pickupLat, query.pickupLng),
        checkPoint(query.dropLat, query.dropLng),
      ]);
      const side = (r: Awaited<ReturnType<typeof checkPoint>>) =>
        r.serviceable
          ? { serviceable: true, zoneId: r.zone._id.toString(), zoneName: r.zone.name }
          : { serviceable: false, reason: r.reason };

      let categories: { categoryId: string; code: string; name: string; available: boolean }[] = [];
      if (pickup.serviceable) {
        const [cats, configs] = await Promise.all([
          CabCategory.find({ active: true }).sort({ displayOrder: 1, name: 1 }).lean(),
          FareConfig.distinct('categoryId', {
            zoneId: pickup.zone._id,
            effectiveFrom: { $lte: now() },
          }),
        ]);
        const priced = new Set(configs.map((c) => c.toString()));
        categories = cats.map((c) => ({
          categoryId: c._id.toString(),
          code: c.code,
          name: c.name,
          available: priced.has(c._id.toString()),
        }));
      }
      return {
        serviceable: pickup.serviceable && drop.serviceable,
        pickup: side(pickup),
        drop: side(drop),
        categories,
      };
    },

    async createQuote(customerId: string, input: CreateQuoteInput) {
      const quote = await build(customerId, input);
      return quoteView(quote, now());
    },

    async getQuote(customerId: string, quoteId: string) {
      return quoteView(await findOwned(customerId, quoteId), now());
    },

    /** Re-price the same trip (e.g. after expiry) as a brand-new quote. */
    async refreshQuote(customerId: string, quoteId: string) {
      const old = await findOwned(customerId, quoteId);
      if (old.usedAt) throw new AppError('QUOTE_ALREADY_USED');
      const quote = await build(customerId, {
        pickup: {
          ...fromPoint(old.pickup.location!),
          ...(old.pickup.label ? { label: old.pickup.label } : {}),
        },
        ...(old.tripKind === 'RENTAL'
          ? { rentalPackageId: (old.rental as RentalSnapshot).packageId }
          : {
              drop: {
                ...fromPoint(old.drop.location!),
                ...(old.drop.label ? { label: old.drop.label } : {}),
              },
            }),
        ...(old.tripKind === 'OUTSTATION'
          ? {
              outstation: {
                tripType: old.outstation!.tripType,
                ...(old.outstation!.returnAt ? { returnAt: old.outstation!.returnAt } : {}),
              },
            }
          : {}),
        stops: (old.stops ?? []).map((s) => ({
          ...fromPoint(s.location!),
          ...(s.label ? { label: s.label } : {}),
        })),
        categoryId: old.categoryId.toString(),
        ...(old.coupon ? { couponCode: old.coupon.code } : {}),
        ...(old.scheduledFor ? { scheduledFor: old.scheduledFor } : {}),
      });
      return quoteView(quote, now());
    },

    /** Read a quote for booking validation without consuming it. */
    findOwned,

    /**
     * Atomically mark a quote used. Only one caller can win, so a quote can never back two bookings.
     * Returns the consumed quote.
     */
    async consume(customerId: string, quoteId: string, bookingId: string, idempotencyKey: string) {
      const at = now();
      const consumed = await FareQuote.findOneAndUpdate(
        { publicId: quoteId, customerId, usedAt: null, expiresAt: { $gt: at } },
        { usedAt: at, bookingId, usedByKey: idempotencyKey },
        { returnDocument: 'after' },
      );
      if (consumed) return consumed;
      const quote = await FareQuote.findOne({ publicId: quoteId, customerId }).lean();
      if (!quote) throw new AppError('NOT_FOUND', 'Fare quote not found.');
      if (quote.usedAt) throw new AppError('QUOTE_ALREADY_USED');
      throw new AppError('QUOTE_EXPIRED');
    },

    /** Compensating action if booking creation fails after the quote was consumed. */
    async release(quoteId: string) {
      await FareQuote.updateOne(
        { publicId: quoteId },
        { usedAt: null, $unset: { bookingId: 1, usedByKey: 1 } },
      );
    },
  };
}

export type QuotesService = ReturnType<typeof createQuotesService>;
