import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DriverProfile } from '../src/modules/drivers/driverProfile.model';
import {
  NEAR_CP,
  createDriver,
  loginAs,
  nextPhone,
  seedWorld,
  startTestEnv,
  type TestEnv,
} from './helpers';

let env: TestEnv;
let world: Awaited<ReturnType<typeof seedWorld>>;
beforeAll(async () => {
  env = await startTestEnv({}, { dispatchConfig: { minLocationIntervalMs: 1000 } });
});
afterAll(() => env.stop());
beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
});

const api = () => request(env.app);

describe('going online', () => {
  it('requires an approved driver', async () => {
    const d = await createDriver(env, world, { approve: false, online: false });
    const res = await api()
      .post('/api/v1/drivers/me/presence')
      .set(d.auth)
      .send({ status: 'ONLINE', location: NEAR_CP });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DRIVER_NOT_ELIGIBLE');
    expect(res.body.error.message).toContain('NOT_APPROVED');
  });

  it('requires a verified vehicle', async () => {
    const d = await createDriver(env, world, { verifyVehicle: false, online: false });
    const res = await api()
      .post('/api/v1/drivers/me/presence')
      .set(d.auth)
      .send({ status: 'ONLINE', location: NEAR_CP });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('NO_VERIFIED_VEHICLE');
  });

  it('requires a location, and rejects another driver’s vehicle', async () => {
    const a = await createDriver(env, world, { online: false });
    const b = await createDriver(env, world, { online: false });
    expect(
      (await api().post('/api/v1/drivers/me/presence').set(a.auth).send({ status: 'ONLINE' }))
        .status,
    ).toBe(400);
    const stolen = await api()
      .post('/api/v1/drivers/me/presence')
      .set(a.auth)
      .send({ status: 'ONLINE', vehicleId: b.vehicleId, location: NEAR_CP });
    expect(stolen.status).toBe(422);
  });

  it('goes online, reports eligibility, and goes offline', async () => {
    const d = await createDriver(env, world, { online: false });
    const before = await api().get('/api/v1/drivers/me/presence').set(d.auth);
    expect(before.body.data).toMatchObject({ status: 'OFFLINE', eligible: true, issues: [] });

    const on = await api()
      .post('/api/v1/drivers/me/presence')
      .set(d.auth)
      .send({ status: 'ONLINE', location: NEAR_CP });
    expect(on.status).toBe(200);
    expect(on.body.data).toMatchObject({ status: 'ONLINE', vehicleId: d.vehicleId });

    const doc = await DriverProfile.findOne({ userId: d.userId }).lean();
    expect(doc?.currentLocation?.coordinates).toEqual([NEAR_CP.lng, NEAR_CP.lat]);

    const off = await api()
      .post('/api/v1/drivers/me/presence')
      .set(d.auth)
      .send({ status: 'OFFLINE' });
    expect(off.body.data.status).toBe('OFFLINE');
    const after = await DriverProfile.findOne({ userId: d.userId }).lean();
    expect(after?.currentLocation).toBeUndefined();
  });

  it('flags stale GPS once the heartbeat stops', async () => {
    const d = await createDriver(env, world);
    expect(
      (await api().get('/api/v1/drivers/me/presence').set(d.auth)).body.data.locationStale,
    ).toBe(false);
    env.setNow(new Date(Date.now() + 61_000));
    expect(
      (await api().get('/api/v1/drivers/me/presence').set(d.auth)).body.data.locationStale,
    ).toBe(true);
  });

  it('is for drivers only', async () => {
    const c = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect(
      (await api().post('/api/v1/drivers/me/presence').set(c.auth).send({ status: 'OFFLINE' }))
        .status,
    ).toBe(403);
    expect(
      (await api().post('/api/v1/drivers/me/location').set(c.auth).send({ lat: 28, lng: 77 }))
        .status,
    ).toBe(403);
  });
});

describe('location updates', () => {
  const update = (d: { auth: object }, body: object) =>
    api()
      .post('/api/v1/drivers/me/location')
      .set(d.auth as Record<string, string>)
      .send(body);

  it('requires the driver to be online', async () => {
    const d = await createDriver(env, world, { online: false });
    expect((await update(d, { lat: 28.63, lng: 77.21 })).status).toBe(403);
  });

  it('stores a plausible update and throttles rapid ones', async () => {
    const t0 = new Date();
    env.setNow(t0);
    const d = await createDriver(env, world);

    env.setNow(new Date(t0.getTime() + 500));
    const tooSoon = await update(d, { lat: 28.6336, lng: 77.2168 });
    expect(tooSoon.status).toBe(429);

    env.setNow(new Date(t0.getTime() + 1500));
    const ok = await update(d, {
      lat: 28.6336,
      lng: 77.2168,
      accuracyMeters: 8,
      headingDegrees: 91,
    });
    expect(ok.status).toBe(200);
    const doc = await DriverProfile.findOne({ userId: d.userId }).lean();
    expect(doc?.currentLocation?.coordinates).toEqual([77.2168, 28.6336]);
    expect(doc?.headingDegrees).toBe(91);
  });

  it('rejects stale, future, inaccurate and impossible updates without storing them', async () => {
    const t0 = new Date();
    env.setNow(t0);
    const d = await createDriver(env, world);
    env.setNow(new Date(t0.getTime() + 2000));

    const reject = async (body: object) => {
      const res = await update(d, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(res.body.error.code).toBe('LOCATION_REJECTED');
    };
    await reject({
      lat: 28.6336,
      lng: 77.2168,
      recordedAt: new Date(t0.getTime() - 120_000).toISOString(),
    });
    await reject({
      lat: 28.6336,
      lng: 77.2168,
      recordedAt: new Date(t0.getTime() + 60_000).toISOString(),
    });
    await reject({ lat: 28.6336, lng: 77.2168, accuracyMeters: 500 });
    await reject({ lat: 19.07, lng: 72.87 }); // Delhi -> Mumbai in 2 seconds

    const doc = await DriverProfile.findOne({ userId: d.userId }).lean();
    expect(doc?.currentLocation?.coordinates).toEqual([NEAR_CP.lng, NEAR_CP.lat]);
  });

  it('validates coordinates and unknown fields', async () => {
    const d = await createDriver(env, world);
    env.setNow(new Date(Date.now() + 2000));
    expect((await update(d, { lat: 95, lng: 77 })).status).toBe(400);
    expect((await update(d, { lat: 28, lng: 77, onlineStatus: 'ONLINE' })).status).toBe(400);
  });
});
