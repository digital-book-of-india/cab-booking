import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/auditLog.model';
import { DriverProfile } from '../src/modules/drivers/driverProfile.model';
import {
  NEAR_CP,
  assignTo,
  createDriver,
  loginAs,
  loginAsAdmin,
  nextPhone,
  requestRide,
  seedWorld,
  sleep,
  startTestEnv,
  type TestEnv,
  type TestSocket,
} from './helpers';

let env: TestEnv;
let world: Awaited<ReturnType<typeof seedWorld>>;

beforeAll(async () => {
  env = await startTestEnv(
    {},
    {
      dispatchConfig: {
        minLocationIntervalMs: 0,
        trackMinIntervalMs: 0,
        trailMinIntervalMs: 0,
        persistMinDistanceMeters: 0,
        persistMinIntervalMs: 0,
      },
    },
  );
});

afterAll(() => env.stop());

beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
});

let T0 = new Date();
const at = (ms: number) => env.setNow(new Date(T0.getTime() + ms));
const start = () => {
  T0 = new Date();
  at(0);
};

const here = (northMetres: number) => ({
  lat: NEAR_CP.lat + northMetres / 111_000,
  lng: NEAR_CP.lng,
});

const emitAck = <T>(socket: TestSocket['socket'], event: string, payload: unknown) =>
  new Promise<T>((resolve) => socket.emit(event, payload, resolve));

describe('Phase 3: Secure ops:simulate_driver_location', () => {
  it('rejects simulation from CUSTOMER, DRIVER, OPS, and SUPPORT roles with FORBIDDEN', async () => {
    start();
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const driver = await createDriver(env, world);
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const support = await loginAsAdmin(env, nextPhone(), 'SUPPORT');

    const customerSock = await env.connect(customer.accessToken);
    const driverSock = await env.connect(driver.accessToken);
    const opsSock = await env.connect(ops.accessToken);
    const supportSock = await env.connect(support.accessToken);

    const targetPayload = {
      driverId: driver.driverId,
      lat: NEAR_CP.lat,
      lng: NEAR_CP.lng,
    };

    const roles = [
      { name: 'CUSTOMER', sock: customerSock },
      { name: 'DRIVER', sock: driverSock },
      { name: 'OPS', sock: opsSock },
      { name: 'SUPPORT', sock: supportSock },
    ];

    for (const { name, sock } of roles) {
      const res = await emitAck<{ ok: boolean; error?: { code: string } }>(
        sock.socket,
        'ops:simulate_driver_location',
        targetPayload,
      );
      expect(res.ok, `${name} should not be allowed to simulate`).toBe(false);
      expect(res.error?.code).toBe('FORBIDDEN');
    }
  });

  it('rejects simulation requests with invalid or out-of-range coordinates', async () => {
    start();
    const superAdmin = await loginAsAdmin(env, nextPhone(), 'SUPER_ADMIN');
    const driver = await createDriver(env, world);
    const adminSock = await env.connect(superAdmin.accessToken);

    // Invalid lat > 90
    const res1 = await emitAck<{ ok: boolean; error?: { code: string } }>(
      adminSock.socket,
      'ops:simulate_driver_location',
      { driverId: driver.driverId, lat: 95.5, lng: NEAR_CP.lng },
    );
    expect(res1.ok).toBe(false);
    expect(res1.error?.code).toBe('VALIDATION_ERROR');

    // Invalid lng < -180
    const res2 = await emitAck<{ ok: boolean; error?: { code: string } }>(
      adminSock.socket,
      'ops:simulate_driver_location',
      { driverId: driver.driverId, lat: NEAR_CP.lat, lng: -185 },
    );
    expect(res2.ok).toBe(false);
    expect(res2.error?.code).toBe('VALIDATION_ERROR');

    // Missing driverId
    const res3 = await emitAck<{ ok: boolean; error?: { code: string } }>(
      adminSock.socket,
      'ops:simulate_driver_location',
      { lat: NEAR_CP.lat, lng: NEAR_CP.lng },
    );
    expect(res3.ok).toBe(false);
    expect(res3.error?.code).toBe('VALIDATION_ERROR');

    // Extra forbidden property (strict schema)
    const res4 = await emitAck<{ ok: boolean; error?: { code: string } }>(
      adminSock.socket,
      'ops:simulate_driver_location',
      { driverId: driver.driverId, lat: NEAR_CP.lat, lng: NEAR_CP.lng, inject: 'evil' },
    );
    expect(res4.ok).toBe(false);
    expect(res4.error?.code).toBe('VALIDATION_ERROR');
  });

  it('allows SUPER_ADMIN to simulate location, creates an audit log, and labels event with simulated: true', async () => {
    start();
    const superAdmin = await loginAsAdmin(env, nextPhone(), 'SUPER_ADMIN');
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const driver = await createDriver(env, world);

    const adminSock = await env.connect(superAdmin.accessToken);
    const opsSock = await env.connect(ops.accessToken);

    const initialProfile = await DriverProfile.findById(driver.driverId).lean();
    const initialCoords = initialProfile?.currentLocation?.coordinates;

    const simLat = NEAR_CP.lat + 0.05;
    const simLng = NEAR_CP.lng + 0.05;

    const res = await emitAck<{ ok: boolean; data?: { simulated: boolean } }>(
      adminSock.socket,
      'ops:simulate_driver_location',
      {
        driverId: driver.driverId,
        lat: simLat,
        lng: simLng,
        headingDegrees: 180,
        speedKmh: 45,
      },
    );

    expect(res.ok).toBe(true);
    expect(res.data?.simulated).toBe(true);

    // Verify ops room receives driver.location.updated with simulated: true
    const opsEvent = await opsSock.waitFor('driver.location.updated');
    expect(opsEvent.data).toMatchObject({
      driverId: driver.driverId,
      lat: simLat,
      lng: simLng,
      headingDegrees: 180,
      speedKmh: 45,
      simulated: true,
    });

    // Verify ops room NEVER receives driver:location for simulation
    expect(opsSock.count('driver:location')).toBe(0);

    // Verify DriverProfile was NOT mutated by the simulation (isolated)
    const updatedProfile = await DriverProfile.findById(driver.driverId).lean();
    expect(updatedProfile?.currentLocation?.coordinates).toEqual(initialCoords);

    // Verify AuditLog entry was written
    const audit = await AuditLog.findOne({
      action: 'driver.location.simulate',
      targetId: driver.driverId,
    }).lean();

    expect(audit).not.toBeNull();
    expect(audit?.actorUserId.toString()).toBe(superAdmin.userId);
    expect(audit?.actorRole).toBe('SUPER_ADMIN');
    expect(audit?.targetType).toBe('DRIVER');
    expect(audit?.metadata).toMatchObject({
      lat: simLat,
      lng: simLng,
      simulated: true,
    });
  });
});

describe('Phase 3: Realtime event deduplication and separation', () => {
  it('emits exactly ONE driver.location.updated to ops room per socket location update', async () => {
    start();
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const driver = await createDriver(env, world);

    const opsSock = await env.connect(ops.accessToken);
    const driverSock = await env.connect(driver.accessToken);

    at(2000);
    const fix = here(50);
    const ack = await emitAck<{ ok: boolean; error?: unknown }>(driverSock.socket, 'location:update', fix);
    expect(ack.ok).toBe(true);

    // Wait for the ops telemetry event
    const ev = await opsSock.waitFor('driver.location.updated');
    expect(ev.data).toMatchObject({
      driverId: driver.driverId,
      lat: fix.lat,
      lng: fix.lng,
    });
    // Real updates are not simulated
    expect((ev.data as { simulated?: boolean }).simulated).toBeFalsy();

    await sleep(200);

    // Ensure exactly ONE driver.location.updated was received by ops, and ZERO driver:location
    expect(opsSock.count('driver.location.updated')).toBe(1);
    expect(opsSock.count('driver:location')).toBe(0);
  });

  it('keeps rider and ops rooms isolated during active rides', async () => {
    start();
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const driver = await createDriver(env, world);
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');

    const riderSock = await env.connect(customer.accessToken);
    const opsSock = await env.connect(ops.accessToken);
    const driverSock = await env.connect(driver.accessToken);

    await requestRide(env, world, customer);
    const rideId = await assignTo(env, driver);

    at(3000);
    const fix = here(10);
    const ack = await emitAck<{ ok: boolean; error?: unknown }>(driverSock.socket, 'location:update', fix);
    expect(ack.ok).toBe(true);

    // Rider receives driver:location with rideId, bookingId, lat, lng (no driverId)
    const riderEv = await riderSock.waitFor('driver:location');
    expect(riderEv.data).toMatchObject({
      rideId,
      lat: fix.lat,
      lng: fix.lng,
    });
    expect(riderEv.data).not.toHaveProperty('driverId');

    // Ops receives driver.location.updated with driverId
    const opsEv = await opsSock.waitFor('driver.location.updated');
    expect(opsEv.data).toMatchObject({
      driverId: driver.driverId,
      lat: fix.lat,
      lng: fix.lng,
    });

    await sleep(200);

    // Rider never receives driver.location.updated
    expect(riderSock.count('driver.location.updated')).toBe(0);
    // Ops never receives driver:location
    expect(opsSock.count('driver:location')).toBe(0);
    // Exactly ONE update to each room
    expect(riderSock.count('driver:location')).toBe(1);
    expect(opsSock.count('driver.location.updated')).toBe(1);
  });
});
