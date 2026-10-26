import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DriverProfile } from '../src/modules/drivers/driverProfile.model';
import { Rating } from '../src/modules/ratings/rating.model';
import type { RatingsService } from '../src/modules/ratings/ratings.service';
import {
  NEAR_CP,
  completedRide,
  createDriver,
  loginAs,
  loginAsAdmin,
  nextPhone,
  seedWorld,
  startTestEnv,
  type Session,
  type TestDriver,
  type TestEnv,
} from './helpers';

let env: TestEnv;
let world: Awaited<ReturnType<typeof seedWorld>>;
let rider: Session;
let driver: TestDriver;
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(() => env.stop());
beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
  rider = await loginAs(env, nextPhone(), 'CUSTOMER');
  driver = await createDriver(env, world, { at: NEAR_CP });
});

const api = () => request(env.app);
const rate = (who: Session, rideId: string, body: object) =>
  api().post(`/api/v1/rides/${rideId}/rating`).set(who.auth).send(body);

describe('ratings', () => {
  it('each side rates once after the ride; the other side tags are refused', async () => {
    const { rideId } = await completedRide(env, world, rider, driver);
    const before = await api().get(`/api/v1/rides/${rideId}/rating`).set(rider.auth);
    expect(before.body.data).toMatchObject({ rated: false, canRate: true });
    expect(before.body.data.tags).toContain('SAFE_DRIVING');

    expect((await rate(rider, rideId, { stars: 0 })).status).toBe(400);
    expect((await rate(rider, rideId, { stars: 5, extra: 1 })).status).toBe(400);
    expect((await rate(rider, rideId, { stars: 5, tags: ['MESSY'] })).status).toBe(422);
    const ok = await rate(rider, rideId, {
      stars: 5,
      tags: ['POLITE', 'POLITE'],
      comment: 'Smooth',
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.tags).toEqual(['POLITE']);
    expect((await rate(rider, rideId, { stars: 1 })).status).toBe(409);

    expect((await rate(driver, rideId, { stars: 4, tags: ['ON_TIME'] })).status).toBe(201);
    expect((await rate(driver, rideId, { stars: 4 })).status).toBe(409);

    const after = await api().get(`/api/v1/rides/${rideId}/rating`).set(rider.auth);
    expect(after.body.data).toMatchObject({ rated: true, canRate: false });
    expect(await Rating.countDocuments({})).toBe(2);
  });

  it('only people on a completed ride, within a week; can be switched off', async () => {
    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    const theirs = await completedRide(env, world, other, driver);
    expect((await rate(rider, theirs.rideId, { stars: 5 })).status).toBe(404);

    const mine = await completedRide(env, world, rider, driver);
    env.setNow(new Date(Date.now() + 8 * 86_400_000));
    expect((await rate(rider, mine.rideId, { stars: 5 })).status).toBe(422);
    const state = await api().get(`/api/v1/rides/${mine.rideId}/rating`).set(rider.auth);
    expect(state.body.data.canRate).toBe(false);
    env.setNow(null);

    const config = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    await api()
      .put('/api/v1/admin/feature-flags/RATINGS')
      .set(config.auth)
      .send({ enabled: false });
    expect((await rate(rider, mine.rideId, { stars: 5 })).body.error.code).toBe('FEATURE_DISABLED');
  });

  it('a driver average counts, shows to riders only after 5 ratings, and heals after a crash', async () => {
    const { rideId } = await completedRide(env, world, rider, driver);
    await rate(rider, rideId, { stars: 4 });
    const summary = await api().get('/api/v1/drivers/me/ratings').set(driver.auth);
    expect(summary.body.data).toMatchObject({ average: 4, count: 1 });
    expect(summary.body.data.distribution['4']).toBe(1);
    // One rating is not enough to brand a driver: the ride card shows none yet.
    const card = await api().get(`/api/v1/rides/${rideId}`).set(rider.auth);
    expect(card.body.data.driver.rating).toBeNull();

    await DriverProfile.updateOne({ _id: driver.driverId }, { ratingCount: 5, ratingSum: 21 });
    const shown = await api().get(`/api/v1/rides/${rideId}`).set(rider.auth);
    expect(shown.body.data.driver.rating).toEqual({ average: 4.2, count: 5 });

    // Simulate a crash that lost the count: the housekeeping repair restores it from the ratings.
    await DriverProfile.updateOne({ _id: driver.driverId }, { ratingCount: 0, ratingSum: 0 });
    const ratings = (env.app.locals['services'] as { ratings: RatingsService }).ratings;
    expect(await ratings.reconcile()).toEqual({ fixed: 1 });
    expect((await DriverProfile.findById(driver.driverId))!.ratingCount).toBe(1);
    expect(await ratings.reconcile()).toEqual({ fixed: 0 });
  });

  it('staff review low ratings and can hide an abusive comment without changing the stars', async () => {
    const { rideId } = await completedRide(env, world, rider, driver);
    await rate(rider, rideId, { stars: 1, comment: 'Awful, abusive words' });
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const low = await api().get('/api/v1/admin/ratings').set(ops.auth);
    expect(low.body.data).toHaveLength(1);
    expect(low.body.data[0].comment).toContain('Awful');
    const id = low.body.data[0].ratingId as string;

    const hide = (who: Session, body: object) =>
      api().patch(`/api/v1/admin/ratings/${id}`).set(who.auth).send(body);
    expect((await hide(ops, { hidden: true })).status).toBe(400);
    expect((await hide(ops, { hidden: true, reason: 'Abusive language' })).body.data.hidden).toBe(
      true,
    );
    const driverSees = await api().get('/api/v1/drivers/me/ratings').set(driver.auth);
    expect(driverSees.body.data.recent[0].comment).toBeNull();
    expect(driverSees.body.data.recent[0].stars).toBe(1);
    expect(JSON.stringify(driverSees.body)).not.toContain(rider.userId);

    const support = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    expect((await api().get('/api/v1/admin/ratings').set(support.auth)).status).toBe(200);
    expect((await hide(support, { hidden: false, reason: 'nope' })).status).toBe(403);
    expect((await api().get('/api/v1/admin/ratings').set(rider.auth)).status).toBe(403);
  });
});
