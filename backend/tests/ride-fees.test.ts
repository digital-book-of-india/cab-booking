import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/auditLog.model';
import { Booking } from '../src/modules/bookings/booking.model';
import { BookingEvent } from '../src/modules/bookings/bookingEvent.model';
import { DriverProfile } from '../src/modules/drivers/driverProfile.model';
import { Notification } from '../src/modules/notifications/notification.model';
import { toPoint } from '../src/common/geo';
import {
  CP,
  NEARISH_CP,
  NEAR_CP,
  assignTo,
  createDriver,
  loginAs,
  loginAsAdmin,
  nextPhone,
  pickupOtpOf,
  requestRide,
  rideCall,
  seedWorld,
  startTestEnv,
  type Session,
  type TestDriver,
  type TestEnv,
} from './helpers';

let env: TestEnv;
let world: Awaited<ReturnType<typeof seedWorld>>;
let customer: Session;
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(() => env.stop());
beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
  customer = await loginAs(env, nextPhone(), 'CUSTOMER');
});

const api = () => request(env.app);
let T0 = new Date();
const at = (seconds: number) => env.setNow(new Date(T0.getTime() + seconds * 1000));
const ping = (d: Session, p: { lat: number; lng: number }) =>
  api().post('/api/v1/drivers/me/location').set(d.auth).send({ lat: p.lat, lng: p.lng });
const cancel = (bookingId: string, reasonCode = 'CHANGED_MIND') =>
  api().post(`/api/v1/bookings/${bookingId}/cancel`).set(customer.auth).send({ reasonCode });
const preview = (bookingId: string) =>
  api().get(`/api/v1/bookings/${bookingId}/cancel-preview`).set(customer.auth);

/** A booking taken by a fresh driver at fake time 0. */
async function assigned() {
  T0 = new Date();
  at(0);
  const driver = await createDriver(env, world);
  const booking = await requestRide(env, world, customer);
  const rideId = await assignTo(env, driver);
  return { driver, booking, rideId };
}
async function enRoute(driver: TestDriver, rideId: string, seconds = 10) {
  at(seconds);
  expect((await rideCall(env, driver, rideId, 'en-route')).status).toBe(200);
}
async function arrive(driver: TestDriver, rideId: string, seconds = 20) {
  at(seconds);
  await ping(driver, CP);
  expect((await rideCall(env, driver, rideId, 'arrived')).status).toBe(200);
}

describe('late cancellation fee', () => {
  it('is free in the first two minutes, then charged once the driver is on the way', async () => {
    const { driver, booking, rideId } = await assigned();
    await enRoute(driver, rideId, 10);

    at(100);
    const early = await preview(booking.bookingId);
    expect(early.body.data).toMatchObject({
      canCancel: true,
      feePaise: 0,
      reason: 'WITHIN_FREE_WINDOW',
    });
    expect(new Date(early.body.data.freeUntil).getTime()).toBe(T0.getTime() + 120_000);

    at(200);
    const late = await preview(booking.bookingId);
    expect(late.body.data).toMatchObject({ feePaise: 3000, reason: 'AFTER_FREE_WINDOW' });

    // What was previewed is exactly what is charged.
    const res = await cancel(booking.bookingId);
    expect(res.status).toBe(200);
    expect(res.body.data.fee).toEqual({ type: 'CANCELLATION', amountPaise: 3000, status: 'DUE' });
    const view = (await api().get(`/api/v1/bookings/${booking.bookingId}`).set(customer.auth)).body
      .data;
    expect(view).toMatchObject({ status: 'CANCELLED', paymentStatus: 'DUE' });
    expect(view.fee).toEqual({ type: 'CANCELLATION', amountPaise: 3000, status: 'DUE' });
    expect(view.receiptNumber).toMatch(/^rcpt_[0-9a-f]{12}$/);
  });

  it('costs nothing inside the free window, before a driver is assigned, or while the driver has not set off', async () => {
    const { driver, booking, rideId } = await assigned();
    await enRoute(driver, rideId, 10);
    at(100);
    const free = await cancel(booking.bookingId);
    expect(free.body.data.fee).toBeNull();
    expect(
      (await api().get(`/api/v1/bookings/${booking.bookingId}`).set(customer.auth)).body.data
        .paymentStatus,
    ).toBe('NOT_DUE');

    // Not yet moving, even an hour after assignment.
    at(150);
    await ping(driver, NEAR_CP);
    const second = await requestRide(env, world, customer);
    await assignTo(env, driver);
    at(3600);
    await ping(driver, NEAR_CP);
    const stationary = await cancel(second.bookingId);
    expect(stationary.body.data.fee).toBeNull();

    // Still searching.
    const third = await requestRide(env, world, customer);
    expect((await cancel(third.bookingId)).body.data.fee).toBeNull();
  });

  it('is never charged when the driver cancels', async () => {
    const { driver, booking, rideId } = await assigned();
    await enRoute(driver, rideId, 10);
    at(900);
    const res = await rideCall(env, driver, rideId, 'cancel', { reasonCode: 'VEHICLE_ISSUE' });
    expect(res.status).toBe(200);
    expect(res.body.data.fee).toBeNull();
    const doc = await Booking.findOne({ publicId: booking.bookingId }).lean();
    expect(doc?.fee).toBeUndefined();
    expect(doc?.paymentStatus).toBe('NOT_DUE');
  });

  it('only the rider can preview, and only their own booking', async () => {
    const { booking } = await assigned();
    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    const res = await api()
      .get(`/api/v1/bookings/${booking.bookingId}/cancel-preview`)
      .set(other.auth);
    expect(res.status).toBe(404);
    const driver = await createDriver(env, world);
    expect(
      (await api().get(`/api/v1/bookings/${booking.bookingId}/cancel-preview`).set(driver.auth))
        .status,
    ).toBe(403);
  });

  it('a booking keeps the rules it was made under, even after the policy changes', async () => {
    const config = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    const { driver, booking, rideId } = await assigned();
    await enRoute(driver, rideId, 10);

    const v1 = await api()
      .post('/api/v1/admin/pricing/cancellation-policies')
      .set(config.auth)
      .send({
        zoneId: world.zoneId,
        freeCancelWindowSeconds: 0,
        cancelFeePaise: 9900,
        noShowWaitSeconds: 60,
        noShowFeePaise: 9900,
        changeReason: 'Stricter',
      });
    expect(v1.status).toBe(201);
    expect(v1.body.data.version).toBe(1);

    // The booking made before the change still gets the old default (Rs 30 after 2 minutes).
    at(200);
    expect((await preview(booking.bookingId)).body.data.feePaise).toBe(3000);

    // A booking made after it carries the new rules from the start.
    await cancel(booking.bookingId); // frees the driver
    await ping(driver, NEAR_CP);
    const fresh = await requestRide(env, world, customer);
    const rideId2 = await assignTo(env, driver);
    await enRoute(driver, rideId2, 210);
    at(215);
    expect((await preview(fresh.bookingId)).body.data.feePaise).toBe(9900);
    const doc = await Booking.findOne({ publicId: fresh.bookingId }).lean();
    expect(doc?.policy).toMatchObject({ version: 1, cancelFeePaise: 9900, noShowFeePaise: 9900 });
  });
});

describe('cancellation policy admin', () => {
  const body = (extra: object = {}) => ({
    zoneId: world.zoneId,
    freeCancelWindowSeconds: 120,
    cancelFeePaise: 3000,
    noShowWaitSeconds: 300,
    noShowFeePaise: 5000,
    changeReason: 'Launch policy',
    ...extra,
  });
  const create = (who: Session, extra: object = {}) =>
    api().post('/api/v1/admin/pricing/cancellation-policies').set(who.auth).send(body(extra));

  it('versions are append-only, numbered per zone, and audited', async () => {
    const config = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    expect((await create(config)).body.data.version).toBe(1);
    expect((await create(config, { cancelFeePaise: 4000 })).body.data.version).toBe(2);
    const list = await api().get('/api/v1/admin/pricing/cancellation-policies').set(config.auth);
    expect(list.body.data.map((p: { version: number }) => p.version)).toEqual([2, 1]);
    expect(await AuditLog.countDocuments({ action: 'pricing.cancellation_policy.create' })).toBe(2);
  });

  it('two admins creating at once get different versions', async () => {
    const a = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    const b = await loginAsAdmin(env, nextPhone(), 'SUPER_ADMIN');
    const [x, y] = await Promise.all([create(a), create(b, { cancelFeePaise: 3500 })]);
    expect([x.status, y.status]).toEqual([201, 201]);
    expect([x.body.data.version, y.body.data.version].sort()).toEqual([1, 2]);
  });

  it('is limited to configuration admins and validates input', async () => {
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    expect((await create(customer)).status).toBe(403);
    expect((await create(ops)).status).toBe(403);
    const config = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    expect((await create(config, { cancelFeePaise: -1 })).status).toBe(400);
    expect((await create(config, { cancelFeePaise: 1.5 })).status).toBe(400);
    expect((await create(config, { surprise: true })).status).toBe(400);
    expect((await create(config, { zoneId: '507f1f77bcf86cd799439011' })).status).toBe(422);
    const past = new Date(Date.now() - 3_600_000).toISOString();
    expect((await create(config, { effectiveFrom: past })).status).toBe(422);
  });
});

describe('waiving a fee', () => {
  async function lateCancelled() {
    const { driver, booking, rideId } = await assigned();
    await enRoute(driver, rideId, 10);
    at(200);
    expect((await cancel(booking.bookingId)).body.data.fee.amountPaise).toBe(3000);
    return booking;
  }
  const waive = (who: Session, bookingId: string, reason = 'Driver went to the wrong gate') =>
    api().post(`/api/v1/admin/bookings/${bookingId}/fee/waive`).set(who.auth).send({ reason });

  it('clears what is owed, is audited, and tells the rider', async () => {
    const booking = await lateCancelled();
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const res = await waive(ops, booking.bookingId);
    expect(res.status).toBe(200);
    expect(res.body.data.fee).toMatchObject({ amountPaise: 3000, status: 'WAIVED' });

    const doc = await Booking.findOne({ publicId: booking.bookingId }).lean();
    expect(doc?.paymentStatus).toBe('NOT_DUE');
    expect(doc?.fee).toMatchObject({
      status: 'WAIVED',
      waivedReason: 'Driver went to the wrong gate',
    });
    const audit = await AuditLog.findOne({ action: 'booking.fee.waive' }).lean();
    expect(audit).toMatchObject({ actorRole: 'OPS', targetId: booking.bookingId });
    expect(audit?.metadata).toMatchObject({ amountPaise: 3000, type: 'CANCELLATION' });
    expect(
      await Notification.countDocuments({ userId: customer.userId, type: 'booking.fee_waived' }),
    ).toBe(1);
    expect(await BookingEvent.countDocuments({ type: 'FEE_WAIVED' })).toBe(1);

    // The receipt shows the fee as waived, not owed.
    const receipt = await api().get(`/api/v1/rides/${doc!.rideId}/receipt`).set(customer.auth);
    expect(receipt.body.data.totalPaise).toBe(0);
    expect(receipt.body.data.lines[0]).toMatchObject({
      code: 'CANCELLATION_FEE',
      detail: 'waived',
    });
  });

  it('works once only, even when two staff click at the same moment', async () => {
    const booking = await lateCancelled();
    const a = await loginAsAdmin(env, nextPhone(), 'OPS');
    const b = await loginAsAdmin(env, nextPhone(), 'SUPER_ADMIN');
    const [x, y] = await Promise.all([waive(a, booking.bookingId), waive(b, booking.bookingId)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(await AuditLog.countDocuments({ action: 'booking.fee.waive' })).toBe(1);
  });

  it('needs a fee to waive, a reason, and the right role', async () => {
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const { booking } = await assigned();
    expect((await waive(ops, booking.bookingId)).status).toBe(409); // nothing owed
    expect((await waive(ops, 'bk_000000000000')).status).toBe(404);
    const owed = await lateCancelled();
    expect((await waive(ops, owed.bookingId, 'x')).status).toBe(400); // reason too short
    const support = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    expect((await waive(support, owed.bookingId)).status).toBe(403);
    expect((await waive(customer, owed.bookingId)).status).toBe(403);
  });
});

describe('rider no-show', () => {
  async function waiting(seconds = 20) {
    const { driver, booking, rideId } = await assigned();
    await enRoute(driver, rideId, 10);
    await arrive(driver, rideId, seconds);
    return { driver, booking, rideId };
  }
  const noShow = (d: Session, rideId: string) =>
    api().post(`/api/v1/rides/${rideId}/no-show`).set(d.auth).send({});

  it('needs the full wait at the pickup, then closes the ride and charges the fee', async () => {
    const { driver, booking, rideId } = await waiting(20);

    at(20 + 120);
    await ping(driver, CP);
    const early = await noShow(driver, rideId);
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('NO_SHOW_TOO_EARLY');
    expect(
      (await api().get(`/api/v1/bookings/${booking.bookingId}`).set(customer.auth)).body.data
        .status,
    ).toBe('DRIVER_ARRIVED');

    at(20 + 300);
    await ping(driver, CP);
    const res = await noShow(driver, rideId);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'NO_SHOW',
      fee: { type: 'NO_SHOW', amountPaise: 5000, status: 'DUE' },
    });

    const doc = await Booking.findOne({ publicId: booking.bookingId }).lean();
    expect(doc).toMatchObject({ status: 'NO_SHOW', paymentStatus: 'DUE' });
    expect((await DriverProfile.findById(driver.driverId).lean())?.activeRideId).toBeNull();
    expect(await BookingEvent.countDocuments({ type: 'RIDER_NO_SHOW' })).toBe(1);

    // A second try changes nothing.
    expect((await noShow(driver, rideId)).status).toBe(409);
    // The driver is free for the next ride.
    expect((await DriverProfile.findById(driver.driverId).lean())?.onlineStatus).toBe('ONLINE');
  });

  it('is refused unless the driver is still at the pickup', async () => {
    const { driver, rideId } = await waiting(20);
    at(20 + 400);
    // The server's own record of the driver's position says they are 13 km away.
    await DriverProfile.updateOne(
      { _id: driver.driverId },
      {
        currentLocation: toPoint(28.75, 77.2167),
        locationUpdatedAt: new Date(T0.getTime() + 420_000),
      },
    );
    const res = await noShow(driver, rideId);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NOT_AT_PICKUP');
  });

  it('is only for the assigned driver, only once they have arrived', async () => {
    const { driver, rideId } = await assigned();
    await enRoute(driver, rideId, 10);
    at(1000);
    expect((await noShow(driver, rideId)).status).toBe(409); // on the way, not arrived
    expect(
      (await api().post(`/api/v1/rides/${rideId}/no-show`).set(customer.auth).send({})).status,
    ).toBe(403);
    const other = await createDriver(env, world, { at: NEARISH_CP });
    expect((await noShow(other, rideId)).status).toBe(404);
  });

  it('the rider turning up at the last moment and the driver giving up cannot both win', async () => {
    const { driver, booking, rideId } = await waiting(20);
    at(20 + 310);
    await ping(driver, CP);
    const otp = await pickupOtpOf(env, customer, rideId);
    const [start, gone] = await Promise.all([
      rideCall(env, driver, rideId, 'start', { pickupOtp: otp }),
      noShow(driver, rideId),
    ]);
    expect([start.status, gone.status].sort()).toEqual([200, 409]);
    const doc = await Booking.findOne({ publicId: booking.bookingId }).lean();
    if (start.status === 200) {
      expect(doc?.status).toBe('IN_PROGRESS');
      expect(doc?.fee).toBeUndefined();
    } else {
      expect(doc?.status).toBe('NO_SHOW');
      expect(doc?.fee?.amountPaise).toBe(5000);
    }
  });

  it('tells both sides, live and by push', async () => {
    const rider = await env.connect(customer.accessToken);
    const { driver, rideId } = await waiting(20);
    at(20 + 300);
    await ping(driver, CP);
    await noShow(driver, rideId);
    await rider.waitFor('booking:status');
    expect(
      rider.events
        .filter((e) => e.type === 'booking:status')
        .map((e) => (e.data as { status: string }).status),
    ).toContain('NO_SHOW');
    const note = await Notification.findOne({
      userId: customer.userId,
      type: 'ride.no_show',
    }).lean();
    expect(note?.body).toContain('₹50');
  });
});

describe('a driver cancelling puts the rider back in the search', () => {
  const near = { lat: 28.645, lng: 77.2167 };
  async function threeDrivers() {
    T0 = new Date();
    at(0);
    const a = await createDriver(env, world, { at: NEAR_CP });
    const b = await createDriver(env, world, { at: NEARISH_CP });
    const c = await createDriver(env, world, { at: near });
    return { a, b, c };
  }
  const view = async (bookingId: string) =>
    (await api().get(`/api/v1/bookings/${bookingId}`).set(customer.auth)).body.data;
  const offersOf = async (d: Session) =>
    (await api().get('/api/v1/drivers/me/offers').set(d.auth)).body.data as { offerId: string }[];

  it('finds another driver, never the one who cancelled, and keeps the same ride id', async () => {
    const { a, b } = await threeDrivers();
    const booking = await requestRide(env, world, customer);
    const rideId = await assignTo(env, a);
    const oldOtp = await pickupOtpOf(env, customer, rideId);
    await enRoute(a, rideId, 10);

    const res = await rideCall(env, a, rideId, 'cancel', { reasonCode: 'VEHICLE_ISSUE' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ bookingContinues: true, fee: null });

    // Back in the search: no driver on show, no cancellation recorded, rider is not charged.
    const searching = await view(booking.bookingId);
    expect(searching).toMatchObject({
      status: 'DISPATCHING',
      driver: null,
      rideId: null,
      cancellation: null,
      fee: null,
    });
    // The driver who cancelled is free, but is never offered this booking again.
    expect((await DriverProfile.findById(a.driverId).lean())?.activeRideId).toBeNull();
    await env.sweep();
    expect(await offersOf(a)).toHaveLength(0);
    // ...and can no longer see the ride or the rider's contact details.
    expect((await api().get(`/api/v1/rides/${rideId}`).set(a.auth)).status).toBe(404);
    expect((await rideCall(env, a, rideId, 'cancel', { reasonCode: 'OTHER' })).status).toBe(404);
    // The rider's own view of that ride shows no driver while the search runs.
    expect(
      (await api().get(`/api/v1/rides/${rideId}`).set(customer.auth)).body.data.driver,
    ).toBeNull();

    // The next driver takes it. Same ride id, new driver, new pickup code.
    const rideId2 = await assignTo(env, b);
    expect(rideId2).toBe(rideId);
    const taken = await view(booking.bookingId);
    expect(taken).toMatchObject({ status: 'DRIVER_ASSIGNED', rideId });
    expect(taken.driver).toBeTruthy();
    await enRoute(b, rideId, 30);
    at(40);
    await ping(b, CP);
    expect((await rideCall(env, b, rideId, 'arrived')).status).toBe(200);
    const stale = await rideCall(env, b, rideId, 'start', { pickupOtp: oldOtp });
    expect(stale.status).toBe(422);
    expect(stale.body.error.code).toBe('PICKUP_OTP_INVALID');
    const fresh = await pickupOtpOf(env, customer, rideId);
    expect(fresh).not.toBe(oldOtp);
    expect((await rideCall(env, b, rideId, 'start', { pickupOtp: fresh })).status).toBe(200);

    // The record of who cancelled and when is kept for support.
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const detail = (await api().get(`/api/v1/admin/bookings/${booking.bookingId}`).set(ops.auth))
      .body.data;
    expect(detail.redispatchCount).toBe(1);
    expect(detail.previousDrivers).toEqual([
      expect.objectContaining({ driverId: a.driverId, reasonCode: 'VEHICLE_ISSUE' }),
    ]);
    expect(detail.events.map((e: { type: string }) => e.type)).toContain(
      'DRIVER_CANCELLED_REDISPATCH',
    );
    // The rider was told, by push too.
    expect(
      await Notification.countDocuments({ userId: customer.userId, type: 'ride.driver_cancelled' }),
    ).toBe(1);
  });

  it('gives up after two re-offers: the third cancel ends the booking', async () => {
    const { a, b, c } = await threeDrivers();
    const booking = await requestRide(env, world, customer);
    let rideId = await assignTo(env, a);
    expect(
      (await rideCall(env, a, rideId, 'cancel', { reasonCode: 'OTHER' })).body.data
        .bookingContinues,
    ).toBe(true);
    rideId = await assignTo(env, b);
    expect(
      (await rideCall(env, b, rideId, 'cancel', { reasonCode: 'OTHER' })).body.data
        .bookingContinues,
    ).toBe(true);
    rideId = await assignTo(env, c);
    const last = await rideCall(env, c, rideId, 'cancel', { reasonCode: 'OTHER' });
    expect(last.body.data).toMatchObject({ status: 'CANCELLED', bookingContinues: false });

    const done = await view(booking.bookingId);
    expect(done).toMatchObject({ status: 'CANCELLED' });
    expect(done.cancellation).toMatchObject({ actor: 'DRIVER', reasonCode: 'OTHER' });
    expect(done.fee).toBeNull();
    for (const d of [a, b, c]) {
      expect((await DriverProfile.findById(d.driverId).lean())?.activeRideId).toBeNull();
    }
  });

  it('if nobody else is nearby the rider keeps waiting instead of being dropped', async () => {
    T0 = new Date();
    at(0);
    const only = await createDriver(env, world);
    const booking = await requestRide(env, world, customer);
    const rideId = await assignTo(env, only);
    await rideCall(env, only, rideId, 'cancel', { reasonCode: 'PERSONAL_EMERGENCY' });
    await env.sweep();
    expect((await view(booking.bookingId)).status).toBe('DISPATCHING');
    // After the search window it ends as "no driver found", like any other search.
    at(120);
    await env.sweep();
    expect((await view(booking.bookingId)).status).toBe('NO_DRIVER_FOUND');
  });
});
