import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reconcileCityDistance, type CityDistanceRules } from '../src/modules/trips/cityDistance';
import { rideWithTrail } from './cityTrail';
import { startTestEnv, type TestEnv } from './helpers';

const RULES: CityDistanceRules = {
  mode: 'RECONCILED',
  detourBp: 2000,
  shortBp: 2000,
  floorBp: 5000,
  ceilingBp: 20_000,
  minPings: 5,
  flagBp: 3000,
};

describe('reconcileCityDistance (the rule)', () => {
  const run = (quoted: number, measured: number, pings = 20, rules = RULES) =>
    reconcileCityDistance({ quotedMeters: quoted, measuredMeters: measured, pings }, rules);

  it('keeps the quote when the trail agrees with it', () => {
    expect(run(10_000, 10_900)).toMatchObject({
      billableMeters: 10_000,
      basis: 'QUOTED',
      ignoredBecause: 'WITHIN_TOLERANCE',
      mismatch: false,
    });
    expect(run(10_000, 8_100)).toMatchObject({ billableMeters: 10_000, basis: 'QUOTED' });
  });

  it('bills the trail when it is clearly longer, never above the ceiling', () => {
    expect(run(10_000, 13_000)).toMatchObject({
      billableMeters: 13_000,
      basis: 'MEASURED_LONGER',
      mismatch: false,
    });
    // 40 km measured on a 10 km quote: capped at twice the quote, and flagged.
    expect(run(10_000, 40_000)).toMatchObject({
      billableMeters: 20_000,
      basis: 'MEASURED_LONGER',
      mismatch: true,
    });
  });

  it('bills the trail when the ride ended early, never below the floor', () => {
    expect(run(10_000, 6_000)).toMatchObject({ billableMeters: 6_000, basis: 'MEASURED_SHORTER' });
    expect(run(10_000, 1_000)).toMatchObject({
      billableMeters: 5_000,
      basis: 'MEASURED_SHORTER',
      mismatch: true,
    });
  });

  it('ignores a trail with too few points, or an empty one', () => {
    expect(run(10_000, 40_000, 3)).toMatchObject({
      billableMeters: 10_000,
      basis: 'QUOTED',
      ignoredBecause: 'TRAIL_TOO_SPARSE',
      mismatch: false,
    });
    expect(run(10_000, 0, 50)).toMatchObject({ billableMeters: 10_000, basis: 'QUOTED' });
  });

  it('in QUOTED mode always bills the quote but still flags a big difference', () => {
    const r = run(10_000, 40_000, 20, { ...RULES, mode: 'QUOTED' });
    expect(r).toMatchObject({
      billableMeters: 10_000,
      basis: 'QUOTED',
      ignoredBecause: 'MODE_QUOTED',
      measuredMeters: 40_000,
      mismatch: true,
    });
  });

  it('copes with a zero quote', () => {
    expect(run(0, 5_000)).toMatchObject({ billableMeters: 0, basis: 'QUOTED' });
  });
});

describe('a city ride, end to end (reconciling on)', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startTestEnv({}, { dispatchConfig: { cityDistanceBilling: 'RECONCILED' } });
  });
  afterAll(() => env.stop());

  it('bills a much longer trail at the ceiling (twice the quote) and flags it', async () => {
    const r = await rideWithTrail(env, 20);
    expect(r.fare.distanceBasis).toBe('MEASURED_LONGER');
    expect(r.fare.basis).toBe('MEASURED_DISTANCE_AND_TIME');
    expect(r.fare.billableDistanceMeters).toBe(Math.round(r.fare.quotedDistanceMeters * 2));
    expect(r.fare.measuredDistanceMeters).toBeGreaterThan(r.fare.quotedDistanceMeters * 2);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.metadata).toMatchObject({ basis: 'MEASURED_LONGER' });
  });

  it('ignores a trail that is too thin to trust', async () => {
    const r = await rideWithTrail(env, 2);
    expect(r.fare.distanceBasis).toBe('QUOTED');
    expect(r.fare.billableDistanceMeters).toBe(r.fare.quotedDistanceMeters);
    expect(r.events).toHaveLength(0);
  });

  it('a ride with no trail at all still ends and bills the quote', async () => {
    const r = await rideWithTrail(env, 0);
    expect(r.fare.distanceBasis).toBe('QUOTED');
    expect(r.total).toBeGreaterThan(0);
  });
});
