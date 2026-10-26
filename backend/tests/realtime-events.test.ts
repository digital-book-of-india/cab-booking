import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FAR_FROM_CP,
  NEARISH_CP,
  NEAR_CP,
  assignTo,
  createDriver,
  currentOffer,
  loginAs,
  loginAsAdmin,
  nextPhone,
  requestRide,
  rideCall,
  seedWorld,
  sleep,
  startRide,
  startTestEnv,
  until,
  type Session,
  type TestEnv,
  type TestSocket,
} from './helpers';

let env: TestEnv;
let world: Awaited<ReturnType<typeof seedWorld>>;
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(() => env.stop());
beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
});

const api = () => request(env.app);
const statuses = (s: TestSocket, type: string) =>
  s.events.filter((e) => e.type === type).map((e) => (e.data as { status: string }).status);

describe('a whole ride, seen live by both sides', () => {
  it('the rider and the driver are told of every step, in order, exactly once', async () => {
    const customerPhone = nextPhone();
    const customer = await loginAs(env, customerPhone, 'CUSTOMER');
    const driver = await createDriver(env, world);
    const rider = await env.connect(customer.accessToken);
    const driving = await env.connect(driver.accessToken);

    const booking = await requestRide(env, world, customer);
    const offer = await driving.waitFor('offer:new');
    expect(offer.data).toMatchObject({ bookingId: booking.bookingId });
    // Same offer the REST API lists; the live event carries nothing about the rider.
    expect((await currentOffer(env, driver))?.offerId).toBe(
      (offer.data as { offerId: string }).offerId,
    );
    expect(Object.keys(offer.data as object).sort()).toEqual(['bookingId', 'expiresAt', 'offerId']);

    const rideId = await assignTo(env, driver);
    await startRide(env, customer, driver, rideId);
    expect((await rideCall(env, driver, rideId, 'complete')).status).toBe(200);

    await until(
      () => statuses(rider, 'booking:status').includes('COMPLETED'),
      'rider sees COMPLETED',
    );
    await until(
      () => statuses(driving, 'ride:status').includes('COMPLETED'),
      'driver sees COMPLETED',
    );

    expect(statuses(rider, 'booking:status')).toEqual([
      'DISPATCHING',
      'DRIVER_ASSIGNED',
      'DRIVER_ARRIVING',
      'DRIVER_ARRIVED',
      'IN_PROGRESS',
      'COMPLETED',
    ]);
    // The driver is told from the moment they are assigned.
    expect(statuses(driving, 'ride:status')).toEqual([
      'DRIVER_ASSIGNED',
      'DRIVER_ARRIVING',
      'DRIVER_ARRIVED',
      'IN_PROGRESS',
      'COMPLETED',
    ]);
    const assigned = rider.events.find(
      (e) =>
        e.type === 'booking:status' && (e.data as { status: string }).status === 'DRIVER_ASSIGNED',
    );
    expect(assigned?.data).toMatchObject({ bookingId: booking.bookingId, rideId });

    // Every event has its own id, so a client can drop duplicates.
    const ids = rider.events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('nothing in any live event reveals a phone number or the pickup code', async () => {
    const customerPhone = nextPhone();
    const customer = await loginAs(env, customerPhone, 'CUSTOMER');
    const driver = await createDriver(env, world);
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const sockets = [
      await env.connect(customer.accessToken),
      await env.connect(driver.accessToken),
      await env.connect(ops.accessToken),
    ];
    await requestRide(env, world, customer);
    const rideId = await assignTo(env, driver);
    await startRide(env, customer, driver, rideId);
    await rideCall(env, driver, rideId, 'complete');
    await until(() => statuses(sockets[0]!, 'booking:status').includes('COMPLETED'), 'ride done');

    const otp = (await api().get(`/api/v1/rides/${rideId}`).set(customer.auth)).body;
    expect(JSON.stringify(otp)).not.toMatch(/pickupOtp/);
    for (const s of sockets) {
      const text = JSON.stringify(s.events);
      expect(text).not.toMatch(/\+91\d{6,}/);
      expect(text).not.toContain(customerPhone);
      expect(text).not.toMatch(/otp/i);
    }
  });
});

describe('who hears what', () => {
  it('another rider and a driver who was never offered the ride hear nothing about it', async () => {
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const bystander = await loginAs(env, nextPhone(), 'CUSTOMER');
    const driver = await createDriver(env, world);
    const farDriver = await createDriver(env, world, { at: FAR_FROM_CP });
    const mine = await env.connect(customer.accessToken);
    const other = await env.connect(bystander.accessToken);
    const far = await env.connect(farDriver.accessToken);

    await requestRide(env, world, customer);
    const rideId = await assignTo(env, driver);
    await startRide(env, customer, driver, rideId);
    await rideCall(env, driver, rideId, 'complete');
    await until(() => statuses(mine, 'booking:status').includes('COMPLETED'), 'ride done');
    await sleep(150);

    expect(other.events.map((e) => e.type)).toEqual(['hello']);
    expect(far.events.map((e) => e.type)).toEqual(['hello']);
  });

  it('staff see every booking change; riders and drivers never get staff events', async () => {
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const finance = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const driver = await createDriver(env, world);
    const staff = await env.connect(ops.accessToken);
    const money = await env.connect(finance.accessToken);
    const rider = await env.connect(customer.accessToken);
    const driving = await env.connect(driver.accessToken);

    const booking = await requestRide(env, world, customer);
    await assignTo(env, driver);
    await until(() => staff.count('ops:booking') >= 2, 'staff see both changes');
    expect(staff.events.filter((e) => e.type === 'ops:booking').map((e) => e.data)).toEqual([
      { bookingId: booking.bookingId, status: 'DISPATCHING' },
      { bookingId: booking.bookingId, status: 'DRIVER_ASSIGNED' },
    ]);
    await sleep(100);
    expect(rider.count('ops:booking')).toBe(0);
    expect(driving.count('ops:booking')).toBe(0);
    expect(money.count('ops:booking')).toBe(0); // FINANCE is not an operations role
  });
});

describe('offers closing', () => {
  it('an expired offer is closed on that driver and offered to the next', async () => {
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const first = await createDriver(env, world, { at: NEAR_CP });
    const second = await createDriver(env, world, { at: NEARISH_CP });
    const a = await env.connect(first.accessToken);
    const b = await env.connect(second.accessToken);

    await requestRide(env, world, customer);
    const offered = await a.waitFor('offer:new');
    expect(b.count('offer:new')).toBe(0);

    env.setNow(new Date(Date.now() + 25_000)); // past the 20 s offer window
    await env.sweep();
    const closed = await a.waitFor('offer:closed');
    expect(closed.data).toMatchObject({
      offerId: (offered.data as { offerId: string }).offerId,
      reason: 'EXPIRED',
    });
    await b.waitFor('offer:new');
  });

  it('a rider cancelling closes the open offer', async () => {
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const driver = await createDriver(env, world);
    const d = await env.connect(driver.accessToken);
    const booking = await requestRide(env, world, customer);
    await d.waitFor('offer:new');

    const res = await api()
      .post(`/api/v1/bookings/${booking.bookingId}/cancel`)
      .set(customer.auth)
      .send({ reasonCode: 'CHANGED_MIND' });
    expect(res.status).toBe(200);
    expect((await d.waitFor('offer:closed')).data).toMatchObject({ reason: 'CANCELLED' });
  });
});

describe('cancellations and failed searches', () => {
  it('a driver cancelling puts the rider back in the search; a rider cancelling tells the driver', async () => {
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const driver = await createDriver(env, world);
    const rider = await env.connect(customer.accessToken);
    const driving = await env.connect(driver.accessToken);
    await requestRide(env, world, customer);
    const rideId = await assignTo(env, driver);

    expect(
      (await rideCall(env, driver, rideId, 'cancel', { reasonCode: 'VEHICLE_ISSUE' })).status,
    ).toBe(200);
    // The rider sees "searching" again rather than a dead end.
    await until(
      () => statuses(rider, 'booking:status').filter((s) => s === 'DISPATCHING').length === 2,
      'rider back in the search',
    );
    expect(statuses(rider, 'booking:status')).not.toContain('CANCELLED');

    // A second booking, cancelled by the rider after the driver took it.
    const cancelledBefore = statuses(driving, 'ride:status').filter(
      (s) => s === 'CANCELLED',
    ).length;
    const booking2 = await requestRide(env, world, customer);
    await assignTo(env, driver);
    await api()
      .post(`/api/v1/bookings/${booking2.bookingId}/cancel`)
      .set(customer.auth)
      .send({ reasonCode: 'CHANGED_MIND' });
    await until(
      () =>
        statuses(driving, 'ride:status').filter((s) => s === 'CANCELLED').length ===
        cancelledBefore + 1,
      'driver told of the rider cancelling',
    );
  });

  it('the rider is told when no driver was found', async () => {
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const rider = await env.connect(customer.accessToken);
    const booking = await requestRide(env, world, customer);
    env.setNow(new Date(Date.now() + 61_000)); // search window over, nobody online
    await env.sweep();
    const event = await until(
      () => statuses(rider, 'booking:status').includes('NO_DRIVER_FOUND'),
      'rider told',
    ).then(() =>
      rider.events.find((e) => (e.data as { status: string }).status === 'NO_DRIVER_FOUND'),
    );
    expect(event?.data).toMatchObject({ bookingId: booking.bookingId });
  });
});

describe('the REST API is unaffected by who is connected', () => {
  it('works the same with nobody connected, and a dead socket cannot break an action', async () => {
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const driver = await createDriver(env, world);
    const rider = await env.connect(customer.accessToken);
    rider.socket.disconnect(); // gone before anything happens
    await requestRide(env, world, customer);
    const rideId = await assignTo(env, driver);
    expect((await rideCall(env, driver, rideId, 'en-route')).status).toBe(200);
  });
});

export type { Session };
