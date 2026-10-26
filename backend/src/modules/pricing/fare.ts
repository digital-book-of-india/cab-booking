import { roundToRupee } from '../../common/geo';

export type FareRates = {
  baseFarePaise: number;
  perKmPaise: number;
  perMinutePaise: number;
  minimumFarePaise: number;
  roundingMode: 'NEAREST_RUPEE' | 'NONE';
};

export type FareBreakdown = {
  baseFarePaise: number;
  distanceFarePaise: number;
  timeFarePaise: number;
  waitingFarePaise: number;
  tollEstimatePaise: number;
  demandAdjustmentPaise: number;
  discountPaise: number;
  taxPaise: number;
  /** Top-up applied when the metered fare is below the configured minimum. */
  minimumFareAdjustmentPaise: number;
  roundingAdjustmentPaise: number;
  estimatedTotalPaise: number;
};

/**
 * Pure fare estimate. Everything is integer paise; each component is rounded once.
 * Waiting is billed only when the caller passes the (server-measured) billable waiting seconds.
 * Tolls, demand adjustment and discounts are 0 until their phases land. Tax is added on top when taxBp is set.
 */
export function calculateFare(
  rates: FareRates,
  distanceMeters: number,
  durationSeconds: number,
  waiting?: { billableSeconds: number; perMinutePaise: number },
  taxBp = 0,
): FareBreakdown {
  if (
    !Number.isFinite(distanceMeters) ||
    distanceMeters < 0 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 0
  ) {
    throw new Error('distance and duration must be non-negative finite numbers');
  }
  const distanceFarePaise = Math.round((rates.perKmPaise * distanceMeters) / 1000);
  const timeFarePaise = Math.round((rates.perMinutePaise * durationSeconds) / 60);
  const waitingFarePaise = waiting
    ? Math.round((waiting.perMinutePaise * Math.max(0, waiting.billableSeconds)) / 60)
    : 0;
  const metered = rates.baseFarePaise + distanceFarePaise + timeFarePaise + waitingFarePaise;
  const minimumFareAdjustmentPaise = Math.max(0, rates.minimumFarePaise - metered);
  const beforeRounding = metered + minimumFareAdjustmentPaise;
  const total =
    rates.roundingMode === 'NEAREST_RUPEE' ? roundToRupee(beforeRounding) : beforeRounding;

  return withTax(
    {
      baseFarePaise: rates.baseFarePaise,
      distanceFarePaise,
      timeFarePaise,
      waitingFarePaise,
      tollEstimatePaise: 0,
      demandAdjustmentPaise: 0,
      discountPaise: 0,
      taxPaise: 0,
      minimumFareAdjustmentPaise,
      roundingAdjustmentPaise: total - beforeRounding,
      estimatedTotalPaise: total,
    },
    taxBp,
  );
}

/**
 * Tax (GST) added ON TOP of a fare: `taxBp` basis points (500 = 5%) of the fare before tax, in whole
 * paise and exact (never rounded to a rupee, so the tax line is what is reported to the tax office).
 * `estimatedTotalPaise` becomes what the rider pays, tax included. 0 = no tax.
 */
export function withTax<T extends { taxPaise: number; estimatedTotalPaise: number }>(
  breakdown: T,
  taxBp: number,
): T {
  if (!taxBp) return breakdown;
  const taxPaise = Math.round((breakdown.estimatedTotalPaise * taxBp) / 10_000);
  return { ...breakdown, taxPaise, estimatedTotalPaise: breakdown.estimatedTotalPaise + taxPaise };
}

export type WaitingSummary = {
  pickupWaitSeconds: number;
  stopWaitSeconds: number;
  totalWaitSeconds: number;
  freeSecondsPerStop: number;
  /** Seconds actually charged: what is left after each free allowance, capped. */
  billableSeconds: number;
  cappedAtSeconds: number;
};

/**
 * Waiting the rider pays for. The pickup wait and every stop each get their own free allowance;
 * only the time beyond it is billed, and the total billed is capped. Pure, integer seconds.
 */
export function computeWaiting(input: {
  pickupWaitSeconds: number;
  stopWaitSeconds: number[];
  freeSeconds: number;
  capSeconds: number;
}): WaitingSummary {
  const clean = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  const pickup = clean(input.pickupWaitSeconds);
  const stops = input.stopWaitSeconds.map(clean);
  const free = clean(input.freeSeconds);
  const over = (n: number) => Math.max(0, n - free);
  const uncapped = over(pickup) + stops.reduce((sum, n) => sum + over(n), 0);
  const stopTotal = stops.reduce((sum, n) => sum + n, 0);
  return {
    pickupWaitSeconds: pickup,
    stopWaitSeconds: stopTotal,
    totalWaitSeconds: pickup + stopTotal,
    freeSecondsPerStop: free,
    billableSeconds: Math.min(uncapped, clean(input.capSeconds)),
    cappedAtSeconds: clean(input.capSeconds),
  };
}
