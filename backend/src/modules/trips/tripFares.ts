import { roundToRupee } from '../../common/geo';
import { withTax } from '../pricing/fare';

/**
 * Fares for rentals and outstation trips. Pure functions: no database, no clock. Every number is
 * integer paise; distance used for billing comes from the server's own GPS trail, never from a
 * number the driver or rider typed in.
 */

export type RentalSnapshot = {
  packageId: string;
  name: string;
  hours: number;
  includedKm: number;
  pricePaise: number;
  extraKmPaise: number;
  extraHourPaise: number;
};

export type OutstationSnapshot = {
  rateId: string;
  tripType: 'ONE_WAY' | 'ROUND_TRIP';
  /** The route distance from pickup to drop when it was quoted. */
  routeMeters: number;
  returnAt?: Date | null;
  days: number;
  nights: number;
  perKmPaise: number;
  minKmPerDay: number;
  allowancePerNightPaise: number;
  minimumFarePaise: number;
  /** The distance the estimate was based on (twice the route for a round trip). */
  estimatedKm: number;
};

export type TripRules = {
  /** A rental may run this many minutes over its hours before extra time is charged. */
  rentalGraceMinutes: number;
  /** ...and this many km over its included distance. */
  rentalGraceKm: number;
  /** Tax added on top of the fare, in basis points (500 = 5%). 0 or missing = none. */
  taxBp?: number;
  /** One way: only if the real distance is this much more than quoted (basis points over, 2000 = 20%) is the real distance charged. */
  oneWayDetourBp: number;
};

export type ExtraLine = { code: string; label: string; amountPaise: number; detail?: string };

export type TripBreakdown = {
  baseFarePaise: number;
  distanceFarePaise: number;
  timeFarePaise: number;
  waitingFarePaise: number;
  tollEstimatePaise: number;
  demandAdjustmentPaise: number;
  discountPaise: number;
  taxPaise: number;
  minimumFareAdjustmentPaise: number;
  roundingAdjustmentPaise: number;
  estimatedTotalPaise: number;
};

export type TripFare = {
  breakdown: TripBreakdown;
  /** Words for the receipt: what "base", "distance" and "time" mean on this kind of trip. */
  labels: { base: string; distance?: string; time?: string };
  details: { base?: string; distance?: string; time?: string };
  extraLines: ExtraLine[];
  billableDistanceMeters: number;
  billableDurationSeconds: number;
};

/** The same fare with tax added on top (see withTax). */
function taxed(fare: TripFare, taxBp: number | undefined): TripFare {
  return taxBp ? { ...fare, breakdown: withTax(fare.breakdown, taxBp) } : fare;
}

const zeroes = {
  waitingFarePaise: 0,
  tollEstimatePaise: 0,
  demandAdjustmentPaise: 0,
  discountPaise: 0,
  taxPaise: 0,
};

export const IST_MS = 330 * 60_000;
/** The calendar day (India time) a moment falls on, as a day number. */
export const istDay = (d: Date) => Math.floor((d.getTime() + IST_MS) / 86_400_000);
/** How many calendar days (India time) a trip touches, from its start to its end, inclusive. */
export const calendarDays = (start: Date, end: Date) =>
  Math.max(1, istDay(end) - istDay(start) + 1);

const km = (meters: number) => meters / 1000;
const rupees = (paise: number) => `₹${(paise / 100).toFixed(0)}`;

/* ---------------- rentals ---------------- */

/** What a rental costs if nothing goes over: the package price. */
function rentalEstimatePlain(s: RentalSnapshot): TripFare {
  return {
    breakdown: {
      baseFarePaise: s.pricePaise,
      distanceFarePaise: 0,
      timeFarePaise: 0,
      minimumFareAdjustmentPaise: 0,
      roundingAdjustmentPaise: 0,
      estimatedTotalPaise: s.pricePaise,
      ...zeroes,
    },
    labels: { base: `Package: ${s.name}`, distance: 'Extra distance', time: 'Extra time' },
    details: { base: `${s.hours} h / ${s.includedKm} km` },
    extraLines: [],
    billableDistanceMeters: s.includedKm * 1000,
    billableDurationSeconds: s.hours * 3600,
  };
}

/** What a finished rental costs: the package plus time and distance over it. */
function rentalFinalPlain(
  s: RentalSnapshot,
  usage: { elapsedSeconds: number; measuredMeters: number },
  rules: TripRules,
): TripFare {
  const overSeconds = Math.max(
    0,
    usage.elapsedSeconds - s.hours * 3600 - rules.rentalGraceMinutes * 60,
  );
  const extraMinutes = Math.ceil(overSeconds / 60);
  const extraTime = Math.round((extraMinutes * s.extraHourPaise) / 60);
  const overKm = Math.max(0, km(usage.measuredMeters) - s.includedKm - rules.rentalGraceKm);
  // Billed to the metre: no rounding up of the distance.
  const extraKm = Math.round(overKm * s.extraKmPaise);
  const before = s.pricePaise + extraTime + extraKm;
  const total = roundToRupee(before);
  return {
    breakdown: {
      baseFarePaise: s.pricePaise,
      distanceFarePaise: extraKm,
      timeFarePaise: extraTime,
      minimumFareAdjustmentPaise: 0,
      roundingAdjustmentPaise: total - before,
      estimatedTotalPaise: total,
      ...zeroes,
    },
    labels: { base: `Package: ${s.name}`, distance: 'Extra distance', time: 'Extra time' },
    details: {
      base: `${s.hours} h / ${s.includedKm} km`,
      distance: `${overKm.toFixed(1)} km over (${km(usage.measuredMeters).toFixed(1)} km driven)`,
      time: `${extraMinutes} min over`,
    },
    extraLines: [],
    billableDistanceMeters: usage.measuredMeters,
    billableDurationSeconds: usage.elapsedSeconds,
  };
}

/* ---------------- outstation ---------------- */

function outstationTotals(
  kmCharge: number,
  allowance: number,
  minimumFarePaise: number,
): { before: number; minAdj: number; total: number } {
  const before = kmCharge + allowance;
  const minAdj = Math.max(0, minimumFarePaise - before);
  return { before: before + minAdj, minAdj, total: roundToRupee(before + minAdj) };
}

function outstationFare(
  billableKm: number,
  nights: number,
  days: number,
  s: OutstationSnapshot,
  durationSeconds: number,
  distanceMeters: number,
): TripFare {
  const kmCharge = Math.round(billableKm * s.perKmPaise);
  const allowance = nights * s.allowancePerNightPaise;
  const { before, minAdj, total } = outstationTotals(kmCharge, allowance, s.minimumFarePaise);
  const extraLines: ExtraLine[] =
    allowance > 0
      ? [
          {
            code: 'DRIVER_ALLOWANCE',
            label: 'Driver night allowance',
            amountPaise: allowance,
            detail: `${nights} night(s) x ${rupees(s.allowancePerNightPaise)}`,
          },
        ]
      : [];
  return {
    breakdown: {
      baseFarePaise: kmCharge,
      distanceFarePaise: 0,
      timeFarePaise: 0,
      minimumFareAdjustmentPaise: minAdj,
      roundingAdjustmentPaise: total - before,
      estimatedTotalPaise: total,
      ...zeroes,
    },
    labels: {
      base: s.tripType === 'ROUND_TRIP' ? 'Round trip distance charge' : 'One-way distance charge',
    },
    details: {
      base: `${billableKm.toFixed(1)} km x ${rupees(s.perKmPaise)}/km${s.tripType === 'ROUND_TRIP' ? ` (${days} day(s), min ${s.minKmPerDay} km a day)` : ''}`,
    },
    extraLines,
    billableDistanceMeters: distanceMeters,
    billableDurationSeconds: durationSeconds,
  };
}

/** What an outstation trip is expected to cost, from the route distance and the dates. */
function outstationEstimatePlain(s: OutstationSnapshot): TripFare {
  const billableKm =
    s.tripType === 'ROUND_TRIP'
      ? Math.max(s.estimatedKm, s.minKmPerDay * s.days)
      : km(s.routeMeters);
  return outstationFare(billableKm, s.nights, s.days, s, s.days * 86_400, billableKm * 1000);
}

/** What a finished outstation trip costs, from the distance and days actually used. */
function outstationFinalPlain(
  s: OutstationSnapshot,
  usage: { startedAt: Date; endedAt: Date; measuredMeters: number },
  rules: TripRules,
): TripFare {
  const actualKm = km(usage.measuredMeters);
  const elapsed = Math.round((usage.endedAt.getTime() - usage.startedAt.getTime()) / 1000);
  if (s.tripType === 'ONE_WAY') {
    const quotedKm = km(s.routeMeters);
    // The quoted distance stands, unless the rider asked for a real detour (well over the route).
    const detour = actualKm > quotedKm * (1 + rules.oneWayDetourBp / 10_000);
    const billableKm = detour ? Math.min(actualKm, quotedKm * 2) : quotedKm;
    return outstationFare(billableKm, 0, 1, s, elapsed, usage.measuredMeters);
  }
  // A round trip is charged for the days it actually lasted, if that is more than booked.
  const days = Math.max(s.days, calendarDays(usage.startedAt, usage.endedAt));
  const billableKm = Math.max(actualKm, s.minKmPerDay * days);
  return outstationFare(billableKm, days - 1, days, s, elapsed, usage.measuredMeters);
}

/* ---------------- with tax on top ---------------- */

/** What a rental costs if nothing goes over: the package price, plus tax if `taxBp` is set. */
export const rentalEstimate = (s: RentalSnapshot, taxBp = 0): TripFare =>
  taxed(rentalEstimatePlain(s), taxBp);

/** What a finished rental costs, plus tax if `rules.taxBp` is set. */
export const rentalFinal = (
  s: RentalSnapshot,
  usage: { elapsedSeconds: number; measuredMeters: number },
  rules: TripRules,
): TripFare => taxed(rentalFinalPlain(s, usage, rules), rules.taxBp);

/** What an outstation trip is expected to cost, plus tax if `taxBp` is set. */
export const outstationEstimate = (s: OutstationSnapshot, taxBp = 0): TripFare =>
  taxed(outstationEstimatePlain(s), taxBp);

/** What a finished outstation trip costs, plus tax if `rules.taxBp` is set. */
export const outstationFinal = (
  s: OutstationSnapshot,
  usage: { startedAt: Date; endedAt: Date; measuredMeters: number },
  rules: TripRules,
): TripFare => taxed(outstationFinalPlain(s, usage, rules), rules.taxBp);
