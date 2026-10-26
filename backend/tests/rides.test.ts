import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Booking } from '../src/modules/bookings/booking.model';
import { RideOffer } from '../src/modules/dispatch/rideOffer.model';
import { DriverProfile } from '../src/modules/drivers/driverProfile.model';
import { calculateFare } from '../src/modules/pricing/fare';
import { Ride } from '../src/modules/rides/ride.model';
import { DEFAULT_RATES } from '../src/seed/seed';
import {
  CP,
  IGI,
  NEARISH_CP,
  NEAR_CP,
  assignTo,
  createDriver,
  currentOffer,
  loginAs,
  loginAsAdmin,
  nextPhone,
  pickupOtpOf,
  requestRide,
  rideCall,
  seedWorld,
  startRide,
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

async function assignedRide(opts: { at?: { lat: number; lng: number } } = {}) {
  const driver = await createDriver(env, world, { at: opts.at ?? NEAR_CP });
  const booking = await requestRide(env, world, customer);
  const rideId = await assignTo(env, driver);
  return { driver, booking, rideId };
}

async function inProgressRide() {
  const r = await assignedRide();
  await startRide(env, customer, r.driver, r.rideId);
  return r;
}

const bookingDoc = (id: string) => Booking.findOne({ publicId: id }).lean();
const statusOfBooking = async (id: string) => (await bookingDoc(id))!.status;

describe('the happy path', () => {
  it('runs assigned -> en route -> arrived -> in progress -> completed', async () => {
    const { driver, booking, rideId } = await assignedRide();
    const seen = async () =>
      (await api().get(`/api/v1/rides/${rideId}`).set(customer.auth)).body.data.status as string;
    expect(await seen()).toBe('DRIVER_ASSIGNED');

    expect((await rideCall(env, driver, rideId, 'en-route')).body.data.status).toBe(
      'DRIVER_ARRIVING',
    );
    expect(await seen()).toBe('DRIVER_ARRIVING');

    await api()
      .post('/api/v1/drivers/me/location')
      .set(driver.auth)
      .send({ lat: CP.lat, lng: CP.lng });
    expect((await rideCall(env, driver, rideId, 'arrived')).body.data.status).toBe(
      'DRIVER_ARRIVED',
    );
    expect(await seen()).toBe('DRIVER_ARRIVED');

    const otp = await pickupOtpOf(env, customer, rideId);
    expect(otp).toMatch(/^\d{6}$/);
    expect(
      (await rideCall(env, driver, rideId, 'start', { pickupOtp: otp })).body.data.status,
    ).toBe('IN_PROGRESS');
    expect(await seen()).toBe('IN_PROGRESS');

    const done = await rideCall(env, driver, rideId, 'complete');
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ status: 'COMPLETED', paymentStatus: 'DUE' });
    expect(await seen()).toBe('COMPLETED');

    const events = await api()
      .get(`/api/v1/bookings/${booking.bookingId}/events`)
      .set(customer.auth);
    expect(events.body.data.map((e: { type: string }) => e.type)).toEqual([
      'BOOKING_CREATED',
      'DISPATCH_STARTED',
      'DRIVER_ASSIGNED',
      'DRIVER_EN_ROUTE',
      'DRIVER_ARRIVED',
      'RIDE_STARTED',
      'RIDE_COMPLETED',
    ]);
  });
});

describe('state order is enforced', () => {
  it('rejects out-of-order and repeated calls', async () => {
    const { driver, rideId } = await assignedRide();
    for (const action of ['arrived', 'start', 'complete'] as const) {
      const body = action === 'start' ? { pickupOtp: '123456' } : {};
      const res = await rideCall(env, driver, rideId, action, body);
      expect(res.status, action).toBe(409);
      expect(res.body.error.code).toBe('RIDE_INVALID_STATE');
    }
    expect((await rideCall(env, driver, rideId, 'en-route')).status).toBe(200);
    expect((await rideCall(env, driver, rideId, 'en-route')).status).toBe(409);
    // A rejected start (wrong state) must not burn OTP attempts.
    expect((await Ride.findOne({ publicId: rideId }).lean())?.otp?.attempts).toBe(0);
  });

  it('a completed ride cannot be restarted, re-completed or cancelled', async () => {
    const { driver, rideId, booking } = await inProgressRide();
    expect((await rideCall(env, driver, rideId, 'complete')).status).toBe(200);
    const otp = await pickupOtpOf(env, customer, rideId).catch(() => '000000');
    expect((await rideCall(env, driver, rideId, 'start', { pickupOtp: otp })).status).toBe(409);
    expect((await rideCall(env, driver, rideId, 'complete')).status).toBe(409);
    expect((await rideCall(env, driver, rideId, 'cancel', { reasonCode: 'OTHER' })).status).toBe(
      409,
    );
    expect(
      (
        await api()
          .post(`/api/v1/bookings/${booking.bookingId}/cancel`)
          .set(customer.auth)
          .send({ reasonCode: 'OTHER' })
      ).status,
    ).toBe(409);
    expect(await statusOfBooking(booking.bookingId)).toBe('COMPLETED');
  });
});

describe('only the assigned driver can act', () => {
  it('another driver gets 404 on every action, and customers get 403', async () => {
    const { rideId } = await assignedRide();
    const other = await createDriver(env, world, { at: NEARISH_CP });
    for (const [action, body] of [
      ['en-route', {}],
      ['arrived', {}],
      ['start', { pickupOtp: '123456' }],
      ['complete', {}],
      ['cancel', { reasonCode: 'OTHER' }],
    ] as const) {
      expect((await rideCall(env, other, rideId, action, body)).status, action).toBe(404);
      expect((await rideCall(env, customer, rideId, action, body)).status, action).toBe(403);
    }
  });
});

describe('arrival', () => {
  it('requires being at the pickup, judged from the server-held location', async () => {
    const { driver, rideId } = await assignedRide({ at: NEARISH_CP }); // ~900 m away
    await rideCall(env, driver, rideId, 'en-route');
    // Claiming a nearby position in the request body changes nothing.
    const early = await rideCall(env, driver, rideId, 'arrived', {
      location: { lat: CP.lat, lng: CP.lng },
    });
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('NOT_AT_PICKUP');

    // Drive the ~900 m to the pickup (a realistic 30 s), then report the new position.
    env.setNow(new Date(Date.now() + 30_000));
    const moved = await api()
      .post('/api/v1/drivers/me/location')
      .set(driver.auth)
      .send({ lat: CP.lat, lng: CP.lng });
    expect(moved.status).toBe(200);
    expect((await rideCall(env, driver, rideId, 'arrived')).status).toBe(200);
  });

  it('refuses arrival on stale GPS', async () => {
    const { driver, rideId } = await assignedRide({ at: { lat: CP.lat, lng: CP.lng } });
    await rideCall(env, driver, rideId, 'en-route');
    env.setNow(new Date(Date.now() + 61_000));
    expect((await rideCall(env, driver, rideId, 'arrived')).body.error.code).toBe('NOT_AT_PICKUP');
  });
});

describe('pickup OTP', () => {
  async function atPickup() {
    const r = await assignedRide({ at: { lat: CP.lat, lng: CP.lng } });
    await rideCall(env, r.driver, r.rideId, 'en-route');
    await rideCall(env, r.driver, r.rideId, 'arrived');
    return r;
  }

  it('rejects a wrong OTP and counts the attempt', async () => {
    const { driver, rideId } = await atPickup();
    const otp = await pickupOtpOf(env, customer, rideId);
    const wrong = otp === '000000' ? '111111' : '000000';
    const res = await rideCall(env, driver, rideId, 'start', { pickupOtp: wrong });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PICKUP_OTP_INVALID');
    expect((await Ride.findOne({ publicId: rideId }).lean())?.otp?.attempts).toBe(1);
    expect(
      (await api().get(`/api/v1/rides/${rideId}/pickup-otp`).set(customer.auth)).body.data
        .attemptsRemaining,
    ).toBe(4);
  });

  it('locks after 5 wrong attempts, even for the correct OTP, until it is re-issued', async () => {
    const { driver, rideId, booking } = await atPickup();
    const otp = await pickupOtpOf(env, customer, rideId);
    const wrong = otp === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect(
        (await rideCall(env, driver, rideId, 'start', { pickupOtp: wrong })).body.error.code,
      ).toBe('PICKUP_OTP_INVALID');
    }
    const locked = await rideCall(env, driver, rideId, 'start', { pickupOtp: otp });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('PICKUP_OTP_ATTEMPTS_EXCEEDED');
    expect(await statusOfBooking(booking.bookingId)).toBe('DRIVER_ARRIVED');

    // Re-issue has a cooldown, then resets attempts and invalidates the old code.
    expect((await api().post(`/api/v1/rides/${rideId}/otp/resend`).set(customer.auth)).status).toBe(
      429,
    );
    env.setNow(new Date(Date.now() + 31_000));
    const fresh = await api().post(`/api/v1/rides/${rideId}/otp/resend`).set(customer.auth);
    expect(fresh.status).toBe(201);
    expect(fresh.body.data.pickupOtp).not.toBe(otp);
    if (fresh.body.data.pickupOtp !== otp) {
      expect((await rideCall(env, driver, rideId, 'start', { pickupOtp: otp })).status).toBe(422);
    }
    expect(
      (await rideCall(env, driver, rideId, 'start', { pickupOtp: fresh.body.data.pickupOtp }))
        .status,
    ).toBe(200);
  });

  it('rejects an expired OTP', async () => {
    const { driver, rideId } = await atPickup();
    const otp = await pickupOtpOf(env, customer, rideId);
    env.setNow(new Date(Date.now() + 3 * 3_600_000));
    const res = await rideCall(env, driver, rideId, 'start', { pickupOtp: otp });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PICKUP_OTP_EXPIRED');
  });

  it('only one of two parallel correct starts succeeds', async () => {
    const { driver, rideId } = await atPickup();
    const otp = await pickupOtpOf(env, customer, rideId);
    const results = await Promise.all([
      rideCall(env, driver, rideId, 'start', { pickupOtp: otp }),
      rideCall(env, driver, rideId, 'start', { pickupOtp: otp }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('validates the OTP format and rejects unknown fields', async () => {
    const { driver, rideId } = await atPickup();
    for (const body of [
      { pickupOtp: '12345' },
      { pickupOtp: 'abcdef' },
      {},
      { pickupOtp: '123456', status: 'COMPLETED' },
    ]) {
      expect((await rideCall(env, driver, rideId, 'start', body)).status).toBe(400);
    }
  });

  it('is visible only to the rider, only before the ride starts, and is never stored', async () => {
    const { driver, rideId } = await atPickup();
    const otp = await pickupOtpOf(env, customer, rideId);

    expect((await api().get(`/api/v1/rides/${rideId}/pickup-otp`).set(driver.auth)).status).toBe(
      403,
    );
    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await api().get(`/api/v1/rides/${rideId}/pickup-otp`).set(other.auth)).status).toBe(
      404,
    );

    // Not in any ride view, and not in the database.
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    for (const who of [customer, driver, ops]) {
      const body = JSON.stringify((await api().get(`/api/v1/rides/${rideId}`).set(who.auth)).body);
      expect(body).not.toContain(otp);
    }
    expect(JSON.stringify(await Ride.findOne({ publicId: rideId }).lean())).not.toContain(otp);

    await rideCall(env, driver, rideId, 'start', { pickupOtp: otp });
    expect((await api().get(`/api/v1/rides/${rideId}/pickup-otp`).set(customer.auth)).status).toBe(
      409,
    );
  });
});

describe('completing a ride and the final fare', () => {
  it('bills the quoted route with the measured time, and marks payment DUE (never PAID)', async () => {
    const { driver, booking, rideId } = await inProgressRide();
    env.setNow(new Date(Date.now() + booking.fare.estimatedDurationSeconds * 1000));
    const res = await rideCall(env, driver, rideId, 'complete');
    expect(res.status).toBe(200);
    // Same distance, same duration, same price list as the quote -> same fare.
    expect(res.body.data.finalFarePaise).toBe(booking.estimatedFarePaise);
    expect(res.body.data.fare).toMatchObject({
      basis: 'QUOTED_DISTANCE_MEASURED_TIME',
      configVersion: 1,
      billableDistanceMeters: booking.fare.estimatedDistanceMeters,
    });

    const doc = await bookingDoc(booking.bookingId);
    expect(doc).toMatchObject({
      status: 'COMPLETED',
      paymentStatus: 'DUE',
      finalFarePaise: booking.estimatedFarePaise,
    });
    expect(doc?.completedAt).toBeTruthy();
  });

  it('clamps unrealistically short and long trips', async () => {
    const r = DEFAULT_RATES['MINI']!;
    const rates = {
      baseFarePaise: r.base,
      perKmPaise: r.perKm,
      perMinutePaise: r.perMin,
      minimumFarePaise: r.min,
      roundingMode: 'NEAREST_RUPEE' as const,
    };

    const short = await inProgressRide();
    const quick = await rideCall(env, short.driver, short.rideId, 'complete');
    expect(quick.body.data.finalFarePaise).toBe(
      calculateFare(
        rates,
        short.booking.fare.estimatedDistanceMeters,
        Math.round(short.booking.fare.estimatedDurationSeconds * 0.5),
      ).estimatedTotalPaise,
    );

    await env.reset();
    world = await seedWorld();
    customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const long = await inProgressRide();
    env.setNow(new Date(Date.now() + 10 * 3_600_000));
    const slow = await rideCall(env, long.driver, long.rideId, 'complete');
    expect(slow.body.data.fare.measuredDurationSeconds).toBeGreaterThan(30_000);
    expect(slow.body.data.fare.billableDurationSeconds).toBe(
      long.booking.fare.estimatedDurationSeconds * 3,
    );
  });

  it('ignores fare, distance and odometer numbers sent by the app', async () => {
    const { driver, booking, rideId } = await inProgressRide();
    for (const extra of [
      { finalFarePaise: 1 },
      { fare: { estimatedTotalPaise: 1 } },
      { paymentStatus: 'PAID' },
      { distanceMeters: 1 },
    ]) {
      expect(
        (await rideCall(env, driver, rideId, 'complete', extra)).status,
        JSON.stringify(extra),
      ).toBe(400);
    }
    env.setNow(new Date(Date.now() + booking.fare.estimatedDurationSeconds * 1000));
    const res = await rideCall(env, driver, rideId, 'complete', {
      odometerEndMeters: 9_999_999,
      endLocation: { lat: IGI.lat, lng: IGI.lng },
      driverNote: 'smooth trip',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.finalFarePaise).toBe(booking.estimatedFarePaise);
    const ride = await Ride.findOne({ publicId: rideId }).lean();
    expect(ride?.reportedOdometerEndMeters).toBe(9_999_999); // kept as evidence only
  });

  it('is not affected by later price changes', async () => {
    const { driver, booking, rideId } = await inProgressRide();
    const admin = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    await api().post('/api/v1/admin/pricing/configs').set(admin.auth).send({
      zoneId: world.zoneId,
      categoryId: world.cats['MINI'],
      baseFarePaise: 90_000,
      perKmPaise: 9000,
      perMinutePaise: 900,
      minimumFarePaise: 90_000,
      changeReason: 'Price spike',
    });
    env.setNow(new Date(Date.now() + booking.fare.estimatedDurationSeconds * 1000));
    const res = await rideCall(env, driver, rideId, 'complete');
    expect(res.body.data.finalFarePaise).toBe(booking.estimatedFarePaise);
    expect(res.body.data.fare.configVersion).toBe(1);
  });

  it('frees the driver for the next ride', async () => {
    const { driver, rideId } = await inProgressRide();
    // Cannot go offline mid-ride.
    expect(
      (await api().post('/api/v1/drivers/me/presence').set(driver.auth).send({ status: 'OFFLINE' }))
        .status,
    ).toBe(409);
    await rideCall(env, driver, rideId, 'complete');
    expect((await DriverProfile.findById(driver.driverId).lean())?.activeRideId).toBeNull();

    const c2 = await loginAs(env, nextPhone(), 'CUSTOMER');
    await requestRide(env, world, c2);
    expect(await currentOffer(env, driver)).not.toBeNull();
    expect(
      (await api().post('/api/v1/drivers/me/presence').set(driver.auth).send({ status: 'OFFLINE' }))
        .status,
    ).toBe(200);
  });
});

describe('cancellation', () => {
  const cancelAsCustomer = (
    bookingId: string,
    s: Session = customer,
    body: object = { reasonCode: 'CHANGED_MIND' },
  ) => api().post(`/api/v1/bookings/${bookingId}/cancel`).set(s.auth).send(body);

  it('customer can cancel while searching, and pending offers are withdrawn', async () => {
    const d = await createDriver(env, world);
    const booking = await requestRide(env, world, customer);
    expect(await currentOffer(env, d)).not.toBeNull();
    const res = await cancelAsCustomer(booking.bookingId, customer, {
      reasonCode: 'WAIT_TOO_LONG',
      note: 'taking long',
    });
    expect(res.status).toBe(200);
    expect(await statusOfBooking(booking.bookingId)).toBe('CANCELLED');
    expect(await currentOffer(env, d)).toBeNull();
    expect(await RideOffer.countDocuments({ status: 'PENDING' })).toBe(0);
    const view = await api().get(`/api/v1/bookings/${booking.bookingId}`).set(customer.auth);
    expect(view.body.data.cancellation).toMatchObject({
      actor: 'CUSTOMER',
      reasonCode: 'WAIT_TOO_LONG',
    });
  });

  it('customer can cancel after assignment, which frees the driver', async () => {
    for (const stage of ['assigned', 'arriving', 'arrived'] as const) {
      await env.reset();
      world = await seedWorld();
      customer = await loginAs(env, nextPhone(), 'CUSTOMER');
      const { driver, booking, rideId } = await assignedRide({ at: { lat: CP.lat, lng: CP.lng } });
      if (stage !== 'assigned') await rideCall(env, driver, rideId, 'en-route');
      if (stage === 'arrived') await rideCall(env, driver, rideId, 'arrived');

      expect((await cancelAsCustomer(booking.bookingId)).status, stage).toBe(200);
      expect(
        (await DriverProfile.findById(driver.driverId).lean())?.activeRideId,
        stage,
      ).toBeNull();
      // The driver can no longer act on it.
      expect((await rideCall(env, driver, rideId, 'en-route')).status).toBe(409);
    }
  });

  it('customer cannot cancel once the ride is in progress', async () => {
    const { booking } = await inProgressRide();
    const res = await cancelAsCustomer(booking.bookingId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RIDE_INVALID_STATE');
    expect(await statusOfBooking(booking.bookingId)).toBe('IN_PROGRESS');
  });

  it('only the booking owner can cancel, with a valid reason', async () => {
    const booking = await requestRide(env, world, customer);
    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await cancelAsCustomer(booking.bookingId, other)).status).toBe(404);
    const driver = await loginAs(env, nextPhone(), 'DRIVER');
    expect((await cancelAsCustomer(booking.bookingId, driver)).status).toBe(403);
    for (const body of [
      {},
      { reasonCode: 'BECAUSE' },
      { reasonCode: 'OTHER', refund: true },
      { reasonCode: 'CUSTOMER_NOT_REACHABLE' },
    ]) {
      expect(
        (await cancelAsCustomer(booking.bookingId, customer, body)).status,
        JSON.stringify(body),
      ).toBe(400);
    }
    expect(await statusOfBooking(booking.bookingId)).toBe('DISPATCHING');
  });

  it('cancelling twice is refused', async () => {
    const booking = await requestRide(env, world, customer);
    expect((await cancelAsCustomer(booking.bookingId)).status).toBe(200);
    expect((await cancelAsCustomer(booking.bookingId)).status).toBe(409);
  });

  it('the assigned driver can cancel before the ride starts, not after', async () => {
    const { driver, booking, rideId } = await assignedRide();
    const res = await rideCall(env, driver, rideId, 'cancel', {
      reasonCode: 'CUSTOMER_NOT_REACHABLE',
      note: 'No answer',
    });
    expect(res.status).toBe(200);
    // The rider is not left stranded: the booking goes back to the search without this driver.
    expect(res.body.data).toMatchObject({ status: 'CANCELLED', bookingContinues: true });
    const view = await api().get(`/api/v1/bookings/${booking.bookingId}`).set(customer.auth);
    expect(view.body.data.status).toBe('DISPATCHING');
    expect(view.body.data.driver).toBeNull();
    expect(view.body.data.cancellation).toBeNull();
    expect((await DriverProfile.findById(driver.driverId).lean())?.activeRideId).toBeNull();

    await env.reset();
    world = await seedWorld();
    customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const running = await inProgressRide();
    expect(
      (await rideCall(env, running.driver, running.rideId, 'cancel', { reasonCode: 'OTHER' }))
        .status,
    ).toBe(409);
    expect(
      (
        await rideCall(env, running.driver, running.rideId, 'cancel', {
          reasonCode: 'CHANGED_MIND',
        })
      ).status,
    ).toBe(400);
  });
});

describe('who can see a ride', () => {
  it('shapes the view per viewer and hides everyone else', async () => {
    const driver = await createDriver(env, world, { name: 'Ravi Kumar' });
    const q = await api()
      .post('/api/v1/fare-quotes')
      .set(customer.auth)
      .send({ pickup: CP, drop: IGI, categoryId: world.cats['MINI'] });
    await api()
      .post('/api/v1/bookings')
      .set(customer.auth)
      .set('Idempotency-Key', 'contact-test-key-1')
      .send({
        quoteId: q.body.data.quoteId,
        paymentMethod: 'CASH',
        pickup: { ...CP, contactName: 'Asha', contactPhone: '98765 43210' },
      });
    const rideId = await assignTo(env, driver);

    const asCustomer = (await api().get(`/api/v1/rides/${rideId}`).set(customer.auth)).body.data;
    expect(asCustomer.driver.firstName).toBe('Ravi');
    expect(asCustomer.driver.vehicle).toMatchObject({ make: 'Maruti', color: 'White' });
    expect(JSON.stringify(asCustomer)).not.toMatch(/phone|\+91/i); // the driver's number is never shown

    const asDriver = (await api().get(`/api/v1/rides/${rideId}`).set(driver.auth)).body.data;
    expect(asDriver.customer).toEqual({ name: 'Asha', phone: '+919876543210' });
    expect(asDriver.driver).toBeUndefined();

    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    expect((await api().get(`/api/v1/rides/${rideId}`).set(ops.auth)).status).toBe(200);

    // Once the ride is over the driver no longer sees the rider's contact details; staff still do.
    await api()
      .post(`/api/v1/bookings/${asCustomer.bookingId}/cancel`)
      .set(customer.auth)
      .send({ reasonCode: 'CHANGED_MIND' });
    const afterwards = (await api().get(`/api/v1/rides/${rideId}`).set(driver.auth)).body.data;
    expect(afterwards.status).toBe('CANCELLED');
    expect(afterwards.customer).toBeNull();
    expect(JSON.stringify(afterwards)).not.toMatch(/9876543210|Asha/);
    const staffView = (await api().get(`/api/v1/rides/${rideId}`).set(ops.auth)).body.data;
    expect(staffView.customer).toEqual({ name: 'Asha', phone: '+919876543210' });

    const otherCustomer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const otherDriver = await createDriver(env, world, { at: NEARISH_CP });
    const finance = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    expect((await api().get(`/api/v1/rides/${rideId}`).set(otherCustomer.auth)).status).toBe(404);
    expect((await api().get(`/api/v1/rides/${rideId}`).set(otherDriver.auth)).status).toBe(404);
    expect((await api().get(`/api/v1/rides/${rideId}`).set(finance.auth)).status).toBe(403);
    expect((await api().get(`/api/v1/rides/${rideId}`)).status).toBe(401);
    expect((await api().get('/api/v1/rides/not-a-ride').set(customer.auth)).status).toBe(400);
  });

  it('the booking view gains the driver card once assigned', async () => {
    const driver = await createDriver(env, world);
    const booking = await requestRide(env, world, customer);
    const before = await api().get(`/api/v1/bookings/${booking.bookingId}`).set(customer.auth);
    expect(before.body.data).toMatchObject({ driver: null, rideId: null });
    const rideId = await assignTo(env, driver);
    const after = await api().get(`/api/v1/bookings/${booking.bookingId}`).set(customer.auth);
    expect(after.body.data.rideId).toBe(rideId);
    expect(after.body.data.driver.vehicle.registrationNumber).toMatch(/^DL01AB/);
  });
});

describe('tracking', () => {
  it('shows the rider their driver’s position and ETA while the ride is active', async () => {
    const { driver, rideId } = await assignedRide({ at: NEARISH_CP });
    const res = await api().get(`/api/v1/rides/${rideId}/track`).set(customer.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'DRIVER_ASSIGNED', etaTarget: 'PICKUP' });
    expect(res.body.data.driver).toMatchObject({
      lat: NEARISH_CP.lat,
      lng: NEARISH_CP.lng,
      stale: false,
    });
    expect(res.body.data.etaSeconds).toBeGreaterThan(0);

    env.setNow(new Date(Date.now() + 61_000));
    expect(
      (await api().get(`/api/v1/rides/${rideId}/track`).set(customer.auth)).body.data.driver.stale,
    ).toBe(true);
    env.setNow(null);
    void driver;
  });

  it('targets the drop-off during the trip, and stops once the ride ends', async () => {
    const { driver, rideId } = await inProgressRide();
    expect(
      (await api().get(`/api/v1/rides/${rideId}/track`).set(customer.auth)).body.data.etaTarget,
    ).toBe('DROP');
    await rideCall(env, driver, rideId, 'complete');
    expect((await api().get(`/api/v1/rides/${rideId}/track`).set(customer.auth)).status).toBe(409);
  });

  it('is not available to other riders, drivers, or without a token', async () => {
    const { driver, rideId } = await assignedRide();
    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await api().get(`/api/v1/rides/${rideId}/track`).set(other.auth)).status).toBe(404);
    expect((await api().get(`/api/v1/rides/${rideId}/track`).set(driver.auth)).status).toBe(403);
    expect((await api().get(`/api/v1/rides/${rideId}/track`)).status).toBe(401);
  });
});

describe('ride history', () => {
  it('lists the customer’s own bookings with status filter and pagination', async () => {
    const driver = await createDriver(env, world);
    const done = await requestRide(env, world, customer);
    const rideId = await assignTo(env, driver);
    await startRide(env, customer, driver, rideId);
    await rideCall(env, driver, rideId, 'complete');
    const cancelled = await requestRide(env, world, customer);
    await api()
      .post(`/api/v1/bookings/${cancelled.bookingId}/cancel`)
      .set(customer.auth)
      .send({ reasonCode: 'OTHER' });

    const all = await api().get('/api/v1/customers/me/rides').set(customer.auth);
    expect(all.body.data.map((r: { bookingId: string }) => r.bookingId)).toEqual([
      cancelled.bookingId,
      done.bookingId,
    ]);
    expect(all.body.meta).toMatchObject({ total: 2, page: 1 });

    const completed = await api()
      .get('/api/v1/customers/me/rides?status=COMPLETED')
      .set(customer.auth);
    expect(completed.body.data).toHaveLength(1);
    expect(completed.body.data[0]).toMatchObject({
      rideId,
      paymentStatus: 'DUE',
      finalFarePaise: expect.any(Number), // completed instantly, so billed on the clamped duration
    });
    expect(completed.body.data[0].finalFarePaise).toBeLessThanOrEqual(done.estimatedFarePaise);

    expect(
      (await api().get('/api/v1/customers/me/rides?limit=1&page=2').set(customer.auth)).body.data,
    ).toHaveLength(1);
    expect(
      (await api().get('/api/v1/customers/me/rides?status=BOGUS').set(customer.auth)).status,
    ).toBe(400);

    const stranger = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect(
      (await api().get('/api/v1/customers/me/rides').set(stranger.auth)).body.data,
    ).toHaveLength(0);
  });

  it('lists a driver’s rides, and only theirs', async () => {
    const a = await createDriver(env, world, { at: NEAR_CP });
    const b = await createDriver(env, world, { at: NEARISH_CP });
    await requestRide(env, world, customer);
    const rideId = await assignTo(env, a);
    const mine = (await api().get('/api/v1/drivers/me/rides').set(a.auth)).body.data;
    expect(mine).toHaveLength(1);
    expect(mine[0].rideId).toBe(rideId);
    expect((await api().get('/api/v1/drivers/me/rides').set(b.auth)).body.data).toHaveLength(0);
    expect((await api().get('/api/v1/drivers/me/rides').set(customer.auth)).status).toBe(403);
  });
});

describe('type safety of the roles', () => {
  it('drivers cannot create bookings and customers cannot take offers', async () => {
    const d: TestDriver = await createDriver(env, world);
    expect((await api().post('/api/v1/fare-quotes').set(d.auth).send({})).status).toBe(403);
    expect((await api().get('/api/v1/drivers/me/offers').set(customer.auth)).status).toBe(403);
  });
});
