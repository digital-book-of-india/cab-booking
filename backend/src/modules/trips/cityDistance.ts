/**
 * Which distance a city ride is billed on. Pure: no database, no clock.
 *
 * A city fare is locked from the quote (the route distance the rider was shown). The server also
 * records where the car really went (the GPS trail it sampled itself, never a number typed in by
 * the driver or rider). This decides whether the two should be reconciled:
 *
 *  - QUOTED (the default): bill the quoted distance. The measured distance is only recorded, and a
 *    big difference is flagged for staff.
 *  - RECONCILED: bill the quoted distance unless the trail is clearly longer (a long detour) or
 *    clearly shorter (the ride ended early), and then bill the measured distance, kept between a
 *    floor and a ceiling so one bad trail can never make a fare absurd. A trail with too few
 *    points to trust is ignored.
 */
export type CityDistanceRules = {
  mode: 'QUOTED' | 'RECONCILED';
  /** Longer than quoted by more than this (basis points, 2000 = 20%) counts as a detour. */
  detourBp: number;
  /** Shorter than quoted by more than this counts as an early finish. */
  shortBp: number;
  /** Never bill less than this share of the quoted distance (basis points, 5000 = 50%). */
  floorBp: number;
  /** Never bill more than this share of the quoted distance (20000 = 2x). */
  ceilingBp: number;
  /** A trail with fewer accepted points than this is not trusted. */
  minPings: number;
  /** A difference bigger than this (basis points) is flagged even in QUOTED mode. */
  flagBp: number;
};

export type CityDistanceResult = {
  billableMeters: number;
  basis: 'QUOTED' | 'MEASURED_LONGER' | 'MEASURED_SHORTER';
  measuredMeters: number;
  /** Why the measured distance was not used, when it was ignored. */
  ignoredBecause: 'MODE_QUOTED' | 'TRAIL_TOO_SPARSE' | 'WITHIN_TOLERANCE' | null;
  /** The trail disagrees with the quote by more than flagBp (either direction). */
  mismatch: boolean;
};

const bp = (meters: number, basisPoints: number) => Math.round((meters * basisPoints) / 10_000);

export function reconcileCityDistance(
  input: { quotedMeters: number; measuredMeters: number; pings: number },
  rules: CityDistanceRules,
): CityDistanceResult {
  const quoted = Math.max(0, Math.round(input.quotedMeters));
  const measured = Math.max(0, Math.round(input.measuredMeters));
  const trusted = input.pings >= rules.minPings && measured > 0;
  const mismatch =
    trusted &&
    quoted > 0 &&
    (measured > quoted + bp(quoted, rules.flagBp) || measured < quoted - bp(quoted, rules.flagBp));
  const result = (
    billableMeters: number,
    basis: CityDistanceResult['basis'],
    ignoredBecause: CityDistanceResult['ignoredBecause'],
  ): CityDistanceResult => ({
    billableMeters,
    basis,
    measuredMeters: measured,
    ignoredBecause,
    mismatch,
  });

  if (rules.mode === 'QUOTED') return result(quoted, 'QUOTED', 'MODE_QUOTED');
  if (!trusted || quoted === 0) return result(quoted, 'QUOTED', 'TRAIL_TOO_SPARSE');

  if (measured > quoted + bp(quoted, rules.detourBp)) {
    return result(Math.min(measured, bp(quoted, rules.ceilingBp)), 'MEASURED_LONGER', null);
  }
  if (measured < quoted - bp(quoted, rules.shortBp)) {
    return result(Math.max(measured, bp(quoted, rules.floorBp)), 'MEASURED_SHORTER', null);
  }
  return result(quoted, 'QUOTED', 'WITHIN_TOLERANCE');
}
