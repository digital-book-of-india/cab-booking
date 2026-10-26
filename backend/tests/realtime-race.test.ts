import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  NEARISH_CP,
  NEAR_CP,
  acceptOffer,
  createDriver,
  currentOffer,
  loginAs,
  nextPhone,
  requestRide,
  seedWorld,
  startTestEnv,
  type TestEnv,
} from './helpers';

// batchSize 2: the offer goes to two drivers at once, so one of them loses the race.
let env: TestEnv;
let world: Awaited<ReturnType<typeof seedWorld>>;
beforeAll(async () => {
  env = await startTestEnv({}, { dispatchConfig: { batchSize: 2 } });
});
afterAll(() => env.stop());
beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
});

describe('losing the race for a ride', () => {
  it('the driver who lost is told the offer is gone because it was taken', async () => {
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const winner = await createDriver(env, world, { at: NEAR_CP });
    const loser = await createDriver(env, world, { at: NEARISH_CP });
    const w = await env.connect(winner.accessToken);
    const l = await env.connect(loser.accessToken);

    await requestRide(env, world, customer);
    await w.waitFor('offer:new');
    const losingOffer = await l.waitFor('offer:new');

    const res = await acceptOffer(env, winner, (await currentOffer(env, winner))!.offerId);
    expect(res.status).toBe(200);

    const closed = await l.waitFor('offer:closed');
    expect(closed.data).toMatchObject({
      offerId: (losingOffer.data as { offerId: string }).offerId,
      reason: 'TAKEN',
    });
    // The winner is not told their own offer closed.
    expect(w.count('offer:closed')).toBe(0);
  });
});
