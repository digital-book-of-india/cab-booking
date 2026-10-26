import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Booking } from '../src/modules/bookings/booking.model';
import { AuditLog } from '../src/modules/audit/auditLog.model';
import { DriverProfile } from '../src/modules/drivers/driverProfile.model';
import { LocationPing } from '../src/modules/tracking/locationPing.model';
import {
  NEAR_CP,
  assignTo,
  createDriver,
  loginAs,
  loginAsAdmin,
  nextPhone,
  requestRide,
  rideCall,
  seedWorld,
  sleep,
  startRide,
  startTestEnv,
  type Session,
  type TestDriver,
  type TestEnv,
} from './helpers';

// Real throttles, so the rules below are the production rules.
let env: TestEnv;
let world: Awaited<ReturnType<typeof seedWorld>>;
beforeAll(async () => {
  env = await startTestEnv(
    {},
    {
      dispatchConfig: {
        minLocationIntervalMs: 1000,
        trackMinIntervalMs: 2000,
        trailMinIntervalMs: 10_000,
        persistMinDistanceMeters: 25,
        persistMinIntervalMs: 10_000,
      },
    },
  );
});
afterAll(() => env.stop());
beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
});

const api = () => request(env.app);
let T0 = new Date();
/** Move the app's clock to T0 + ms. Every test drives time explicitly. */
const at = (ms: number) => env.setNow(new Date(T0.getTime() + ms));
const start = () => {
  T0 = new Date();
  at(0);
};
/** A GPS fix `northMetres` north of the pickup-side start point. */
const here = (northMetres: number) => ({
  lat: NEAR_CP.lat + northMetres / 111_000,
  lng: NEAR_CP.lng,
});
const ping = (d: Session, north: number) =>
  api().post('/api/v1/drivers/me/location').set(d.auth).send(here(north));
const emit = <T>(s: { emit: (e: string, ...a: unknown[]) => void }, payload: unknown) =>
  new Promise<T>((resolve) => s.emit('location:update', payload, resolve));

async function rideInProgress(): Promise<{
  customer: Session;
  driver: TestDriver;
  rideId: string;
}> {
  const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
  const driver = await createDriver(env, world);
  await requestRide(env, world, customer);
  const rideId = await assignTo(env, driver);
  return { customer, driver, rideId };
}

describe('the rider watching the driver', () => {
  it('sees the driver only from assignment, and at most every 2 seconds', async () => {
    start();
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const driver = await createDriver(env, world);
    const rider = await env.connect(customer.accessToken);
    await requestRide(env, world, customer);

    // Searching: the driver moves, the rider must not see them.
    at(1200);
    expect((await ping(driver, 30)).status).toBe(200);
    await sleep(150);
    expect(rider.count('driver:location')).toBe(0);

    const rideId = await assignTo(env, driver);
    at(3500);
    expect((await ping(driver, 60)).status).toBe(200);
    const first = await rider.waitFor('driver:location');
    expect(first.data).toMatchObject({ rideId, lat: here(60).lat, lng: here(60).lng });
    expect(Object.keys(first.data as object).sort()).toEqual([
      'bookingId',
      'lat',
      'lng',
      'recordedAt',
      'rideId',
    ]);

    at(4700); // only 1.2 s after the last one: stored, but not sent again
    expect((await ping(driver, 90)).status).toBe(200);
    await sleep(150);
    expect(rider.count('driver:location')).toBe(1);

    at(6000);
    expect((await ping(driver, 120)).status).toBe(200);
    await rider.waitFor('driver:location', 3000, 1 + rider.events.findIndex((e) => e === first));
    expect(rider.count('driver:location')).toBe(2);
  });

  it('nobody else sees the position', async () => {
    start();
    const { customer, driver } = await rideInProgress();
    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    const otherDriver = await createDriver(env, world);
    const rider = await env.connect(customer.accessToken);
    const stranger = await env.connect(other.accessToken);
    const rival = await env.connect(otherDriver.accessToken);

    at(2000);
    await ping(driver, 50);
    await rider.waitFor('driver:location');
    await sleep(150);
    expect(stranger.count('driver:location')).toBe(0);
    expect(rival.count('driver:location')).toBe(0);
  });

  it('stops the moment the ride ends', async () => {
    start();
    const { customer, driver, rideId } = await rideInProgress();
    const rider = await env.connect(customer.accessToken);

    at(2000);
    await startRide(env, customer, driver, rideId);
    at(4000);
    await ping(driver, 80);
    await rider.waitFor('driver:location');
    const before = rider.count('driver:location');

    expect((await rideCall(env, driver, rideId, 'complete')).status).toBe(200);
    at(9000);
    expect((await ping(driver, 160)).status).toBe(200);
    await sleep(200);
    expect(rider.count('driver:location')).toBe(before);
  });

  it('checks the ride state itself: a leftover driver lock never leaks a position', async () => {
    start();
    const { customer, driver } = await rideInProgress();
    const rider = await env.connect(customer.accessToken);
    // Crash simulation: the ride is over but the driver's lock was never released.
    await Booking.updateMany({}, { status: 'COMPLETED' });
    at(3000);
    expect((await ping(driver, 60)).status).toBe(200);
    await sleep(200);
    expect(rider.count('driver:location')).toBe(0);
  });

  it('stops when the ride is cancelled', async () => {
    start();
    const { customer, driver, rideId } = await rideInProgress();
    const rider = await env.connect(customer.accessToken);
    at(2000);
    await ping(driver, 60);
    await rider.waitFor('driver:location');
    const before = rider.count('driver:location');

    await rideCall(env, driver, rideId, 'cancel', { reasonCode: 'VEHICLE_ISSUE' });
    at(8000);
    await ping(driver, 120);
    await sleep(200);
    expect(rider.count('driver:location')).toBe(before);
  });
});

describe('sending positions over the socket', () => {
  it('a driver can stream a fix with the same rules as REST; the rider sees it', async () => {
    start();
    const { customer, driver } = await rideInProgress();
    const rider = await env.connect(customer.accessToken);
    const driving = await env.connect(driver.accessToken);

    at(2000);
    const ok = await emit<{ ok: boolean; data?: { recordedAt: string } }>(driving.socket, here(70));
    expect(ok.ok).toBe(true);
    expect((await rider.waitFor('driver:location')).data).toMatchObject({ lat: here(70).lat });

    // The same second again is too frequent, exactly like REST.
    const tooFast = await emit<{ ok: boolean; error?: { code: string } }>(driving.socket, here(75));
    expect(tooFast).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
  });

  it('refuses riders, junk, unknown fields and impossible jumps', async () => {
    start();
    const { customer, driver } = await rideInProgress();
    const rider = await env.connect(customer.accessToken);
    const driving = await env.connect(driver.accessToken);

    at(2000);
    const code = async (s: typeof rider.socket, payload: unknown) =>
      (await emit<{ error?: { code: string } }>(s, payload)).error?.code;
    expect(await code(rider.socket, here(10))).toBe('FORBIDDEN');
    expect(await code(driving.socket, { lat: 999, lng: 1 })).toBe('VALIDATION_ERROR');
    expect(await code(driving.socket, { ...here(10), role: 'ADMIN' })).toBe('VALIDATION_ERROR');
    expect(await code(driving.socket, 'hello')).toBe('VALIDATION_ERROR');
    at(3500);
    expect(await code(driving.socket, { lat: 40, lng: 100 })).toBe('LOCATION_REJECTED');
  });

  it('an offline driver cannot send positions', async () => {
    start();
    const offline = await createDriver(env, world, { online: false });
    const s = await env.connect(offline.accessToken);
    at(1500);
    const ack = await emit<{ ok: boolean; error?: { code: string } }>(s.socket, here(10));
    expect(ack).toMatchObject({ ok: false, error: { code: 'DRIVER_NOT_ELIGIBLE' } });
  });
});

describe('the route trail', () => {
  it('records sampled points only during an active ride, for staff to review', async () => {
    start();
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const driver = await createDriver(env, world);
    await requestRide(env, world, customer);

    at(1200);
    await ping(driver, 30); // still searching
    expect(await LocationPing.countDocuments()).toBe(0);

    const rideId = await assignTo(env, driver);
    at(3500);
    await ping(driver, 60); // sampled
    at(4700);
    await ping(driver, 90); // too soon after the last sample
    at(6000);
    await ping(driver, 120); // still too soon
    at(14_000);
    await ping(driver, 150); // 10.5 s later: sampled
    expect(await LocationPing.countDocuments()).toBe(2);

    const support = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    const res = await api().get(`/api/v1/admin/rides/${rideId}/trail`).set(support.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(2);
    const points = res.body.data.points as {
      lat: number;
      recordedAt: string;
      bookingStatus: string;
    }[];
    expect(points.map((p) => p.lat)).toEqual([here(60).lat, here(150).lat]);
    expect(points[0]!.recordedAt < points[1]!.recordedAt).toBe(true);
    expect(points[0]!.bookingStatus).toBe('DRIVER_ASSIGNED');
    expect(await AuditLog.countDocuments({ action: 'RIDE_TRAIL_VIEWED', targetId: rideId })).toBe(
      1,
    );
  });

  it('is closed to riders, drivers and finance, and unknown rides are not found', async () => {
    start();
    const { customer, driver, rideId } = await rideInProgress();
    const finance = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    for (const who of [customer, driver, finance]) {
      expect((await api().get(`/api/v1/admin/rides/${rideId}/trail`).set(who.auth)).status).toBe(
        403,
      );
    }
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    expect(
      (await api().get('/api/v1/admin/rides/ride_doesnotexist/trail').set(ops.auth)).status,
    ).toBe(404);
    expect((await api().get(`/api/v1/admin/rides/${rideId}/trail`).set(ops.auth)).status).toBe(200);
  });
});

describe('writing positions to the database', () => {
  it('skips tiny movements, stores real ones and refreshes at least every 10 seconds', async () => {
    start();
    const driver = await createDriver(env, world);
    const stored = async () => {
      const p = await DriverProfile.findById(driver.driverId).lean();
      return { at: p?.locationUpdatedAt?.getTime(), lat: p?.currentLocation?.coordinates[1] };
    };
    const base = await stored();

    at(1500);
    expect((await ping(driver, 3)).status).toBe(200); // 3 m: not worth a write
    expect(await stored()).toEqual(base);

    at(3000);
    expect((await ping(driver, 70)).status).toBe(200); // 70 m: stored
    expect((await stored()).lat).toBe(here(70).lat);

    at(4500);
    await ping(driver, 72); // 2 m further: skipped
    expect((await stored()).at).toBe(T0.getTime() + 3000);

    at(14_000);
    await ping(driver, 72); // not moved, but 11 s since the last write: refreshed
    expect((await stored()).at).toBe(T0.getTime() + 14_000);
  });

  it('a parked driver stays eligible for offers however little they move', async () => {
    start();
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const driver = await createDriver(env, world);
    // Heartbeats every 3 s for a minute, never moving: the stored fix must stay fresh (< 60 s).
    for (let s = 3; s <= 70; s += 3) {
      at(s * 1000);
      expect((await ping(driver, 1)).status).toBe(200);
    }
    await requestRide(env, world, customer);
    await env.sweep();
    expect((await api().get('/api/v1/drivers/me/offers').set(driver.auth)).body.data.length).toBe(
      1,
    );
  });
});
