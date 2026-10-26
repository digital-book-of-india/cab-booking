import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rideWithTrail } from './cityTrail';
import { startTestEnv, type TestEnv } from './helpers';

// The default policy: the quoted distance is what is billed. The trail is only recorded and flagged.
describe('a city ride, end to end (default: bill the quote)', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startTestEnv();
  });
  afterAll(() => env.stop());

  it('bills the quoted distance even when the trail is far longer, and flags the mismatch', async () => {
    const r = await rideWithTrail(env, 20);
    expect(r.fare.basis).toBe('QUOTED_DISTANCE_MEASURED_TIME');
    expect(r.fare.distanceBasis).toBe('QUOTED');
    expect(r.fare.billableDistanceMeters).toBe(r.fare.quotedDistanceMeters);
    expect(r.fare.measuredDistanceMeters).toBeGreaterThan(r.fare.quotedDistanceMeters * 2);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.metadata).toMatchObject({ basis: 'QUOTED' });
  });

  it('records no mismatch when there is no trail to compare', async () => {
    const r = await rideWithTrail(env, 0);
    expect(r.fare.billableDistanceMeters).toBe(r.fare.quotedDistanceMeters);
    expect(r.events).toHaveLength(0);
  });
});
