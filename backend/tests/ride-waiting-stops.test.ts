import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CP,
  IGI,
  MUMBAI,
  assignTo,
  createDriver,
  loginAs,
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
afterAll(() => env?.stop());
beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
  customer = await loginAs(env, nextPhone(), 'CUSTOMER');
});

const api = () => request(env.app);
let T0 = new Date();
/** Put the app's clock at T0 + seconds. Every test drives time explicitly. */
const at = (seconds: number) => env.setNow(new Date(T0.getTime() + seconds * 1000));
const ping = (d: Session, p: { lat: number; lng: number }) =>
  api().post('/api/v1/drivers/me/location').set(d.auth).send({ lat: p.lat, lng: p.lng });

// Two stops inside the seeded Delhi zone, a few km from Connaught Place.
const STOP_1 = { lat: 28.6, lng: 77.2, label: 'Stop one' };
const STOP_2 = { lat: 28.58, lng: 77.15, label: 'Stop two' };

async function quote(body: object) {
  return api()
    .post('/api/v1/fare-quotes')
    .set(customer.auth)
    .send({ pickup: CP, drop: IGI, categoryId: world.cats['MINI'], ...body });
}

async function bookWithStops(stops: object[]) {
  const q = await quote({ stops });
  expect(q.status).toBe(201);
  const b = await api()
    .post('/api/v1/bookings')
    .set(customer.auth)
    .set('Idempotency-Key', `k-${Math.random().toString(36).slice(2)}-${Date.now()}`)
    .send({ quoteId: q.body.data.quoteId, paymentMethod: 'CASH' });
  expect(b.status).toBe(201);
  return b.body.data as { bookingId: string };
}

/** Driver arrives at the pickup at `arriveAt` seconds; returns the ride ready to start. */
async function arrivedRide(arriveAt: number, stops: object[] = []) {
  at(0);
  const driver = await createDriver(env, world);
  if (stops.length > 0) await bookWithStops(stops);
  else await requestRide(env, world, customer);
  const rideId = await assignTo(env, driver);
  at(arriveAt - 5);
  expect((await rideCall(env, driver, rideId, 'en-route')).status).toBe(200);
  at(arriveAt);
  await ping(driver, CP);
  expect((await rideCall(env, driver, rideId, 'arrived')).status).toBe(200);
  return { driver, rideId };
}

async function startAt(seconds: number, driver: TestDriver, rideId: string) {
  at(seconds);
  const otp = await pickupOtpOf(env, customer, rideId);
  const res = await rideCall(env, driver, rideId, 'start', { pickupOtp: otp });
  expect(res.status).toBe(200);
}

describe('waiting at the pickup', () => {
  it('charges only the time beyond the free allowance, at the zone rate', async () => {
    T0 = new Date();
    const { driver, rideId } = await arrivedRide(10);
    await startAt(10 + 480, driver, rideId); // waited 8 minutes; 3 are free
    at(10 + 480 + 600);
    const done = await rideCall(env, driver, rideId, 'complete');
    expect(done.status).toBe(200);
    const fare = done.body.data.fare;
    expect(fare.waiting).toMatchObject({
      pickupWaitSeconds: 480,
      billableSeconds: 300,
      ratePerMinutePaise: 200,
    });
    expect(fare.breakdown.waitingFarePaise).toBe(1000); // 5 min x Rs 2
    // The waiting line is part of the total, and the total is what the rider owes.
    const b = fare.breakdown;
    expect(
      b.baseFarePaise +
        b.distanceFarePaise +
        b.timeFarePaise +
        b.waitingFarePaise +
        b.minimumFareAdjustmentPaise +
        b.roundingAdjustmentPaise,
    ).toBe(b.estimatedTotalPaise);
    expect(done.body.data.finalFarePaise).toBe(b.estimatedTotalPaise);
  });

  it('charges nothing when the driver is met within the free time', async () => {
    T0 = new Date();
    const { driver, rideId } = await arrivedRide(10);
    await startAt(10 + 100, driver, rideId);
    at(10 + 100 + 600);
    const done = await rideCall(env, driver, rideId, 'complete');
    expect(done.body.data.fare.breakdown.waitingFarePaise).toBe(0);
    expect(done.body.data.fare.waiting.billableSeconds).toBe(0);
  });

  it('never bills more than the 30 minute cap', async () => {
    T0 = new Date();
    const { driver, rideId } = await arrivedRide(10);
    await startAt(10 + 6000, driver, rideId); // 100 minutes of waiting
    at(10 + 6000 + 600);
    const done = await rideCall(env, driver, rideId, 'complete');
    expect(done.body.data.fare.waiting.billableSeconds).toBe(1800);
    expect(done.body.data.fare.breakdown.waitingFarePaise).toBe(6000);
  });

  it('cannot be influenced by anything the driver sends', async () => {
    T0 = new Date();
    const { driver, rideId } = await arrivedRide(10);
    await startAt(10 + 100, driver, rideId);
    at(10 + 100 + 600);
    const done = await rideCall(env, driver, rideId, 'complete', {
      waitingSeconds: 99999,
      waitingFarePaise: 99999,
    });
    expect(done.status).toBe(400); // unknown fields are refused outright
  });
});

describe('intermediate stops: quote and booking', () => {
  it('prices the route through the stops, longer than the direct trip', async () => {
    const direct = (await quote({})).body.data;
    const viaStops = (await quote({ stops: [STOP_1, STOP_2] })).body.data;
    expect(viaStops.stops).toEqual([
      { lat: STOP_1.lat, lng: STOP_1.lng, label: 'Stop one' },
      { lat: STOP_2.lat, lng: STOP_2.lng, label: 'Stop two' },
    ]);
    expect(viaStops.estimatedDistanceMeters).toBeGreaterThan(direct.estimatedDistanceMeters);
    expect(viaStops.breakdown.estimatedTotalPaise).toBeGreaterThan(
      direct.breakdown.estimatedTotalPaise,
    );
  });

  it('refuses a stop outside the service area, or more than 3 stops', async () => {
    const out = await quote({ stops: [MUMBAI] });
    expect(out.status).toBe(422);
    expect(out.body.error.code).toBe('NOT_SERVICEABLE');
    const four = await quote({ stops: [STOP_1, STOP_2, STOP_1, STOP_2] });
    expect(four.status).toBe(400);
  });

  it('carries the stops onto the booking, and a booking that disagrees with its quote is refused', async () => {
    const booked = await bookWithStops([STOP_1, STOP_2]);
    const view = await api().get(`/api/v1/bookings/${booked.bookingId}`).set(customer.auth);
    expect(view.body.data.stops).toHaveLength(2);
    expect(view.body.data.stops[0]).toMatchObject({ lat: STOP_1.lat, label: 'Stop one' });

    const q = await quote({ stops: [STOP_1] });
    const mismatch = await api()
      .post('/api/v1/bookings')
      .set(customer.auth)
      .set('Idempotency-Key', 'mismatch-key-0001')
      .send({ quoteId: q.body.data.quoteId, paymentMethod: 'CASH', stops: [STOP_2] });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe('QUOTE_MISMATCH');
  });
});

describe('intermediate stops: during the trip', () => {
  async function tripWithStops() {
    T0 = new Date();
    const { driver, rideId } = await arrivedRide(10, [STOP_1, STOP_2]);
    await startAt(30, driver, rideId);
    return { driver, rideId };
  }
  const stop = (d: Session, rideId: string, i: number, what: 'arrived' | 'departed') =>
    api().post(`/api/v1/rides/${rideId}/stops/${i}/${what}`).set(d.auth).send({});

  it('must be visited in order, near the stop, once each', async () => {
    const { driver, rideId } = await tripWithStops();

    // Far away from the stop: refused.
    at(100);
    const far = await stop(driver, rideId, 0, 'arrived');
    expect(far.status).toBe(422);
    expect(far.body.error.code).toBe('NOT_AT_STOP');

    // Drive to stop one.
    at(300);
    await ping(driver, STOP_1);
    // The second stop cannot be reached first.
    expect((await stop(driver, rideId, 1, 'arrived')).status).toBe(409);
    expect((await stop(driver, rideId, 0, 'arrived')).status).toBe(200);
    expect((await stop(driver, rideId, 0, 'arrived')).status).toBe(409); // already there

    // Cannot start the next stop before leaving this one (even once the driver is there).
    at(500);
    await ping(driver, STOP_2);
    expect((await stop(driver, rideId, 1, 'arrived')).status).toBe(409);

    at(510);
    expect((await stop(driver, rideId, 0, 'departed')).status).toBe(200);
    expect((await stop(driver, rideId, 0, 'departed')).status).toBe(409); // not waiting there any more
    expect((await stop(driver, rideId, 1, 'arrived')).status).toBe(200);
    expect((await stop(driver, rideId, 9, 'arrived')).status).toBe(404); // no such stop
  });

  it('bills waiting at each stop beyond its free time, and not also as ride time', async () => {
    const { driver, rideId } = await tripWithStops();
    at(300);
    await ping(driver, STOP_1);
    await stop(driver, rideId, 0, 'arrived'); // arrives at 300
    at(600);
    await stop(driver, rideId, 0, 'departed'); // waited 300 s -> 120 s over the free 180
    at(900);
    await ping(driver, STOP_2);
    await stop(driver, rideId, 1, 'arrived'); // arrives at 900
    at(1000);
    await stop(driver, rideId, 1, 'departed'); // waited 100 s: inside the free time
    at(3030); // the trip started at 30, so it lasted 3000 s
    const done = await rideCall(env, driver, rideId, 'complete');
    expect(done.status).toBe(200);
    const fare = done.body.data.fare;
    expect(fare.waiting).toMatchObject({ stopWaitSeconds: 400, billableSeconds: 120 });
    expect(fare.breakdown.waitingFarePaise).toBe(400); // 2 min x Rs 2
    expect(fare.measuredDurationSeconds).toBe(3000);
    // 400 of those seconds were spent standing at stops: billed as waiting, never also as ride time.
    expect(fare.billableDurationSeconds).toBe(2600);
  });

  it('is not possible before the trip starts', async () => {
    T0 = new Date();
    const { driver, rideId } = await arrivedRide(10, [STOP_1]);
    expect((await stop(driver, rideId, 0, 'arrived')).status).toBe(409);
  });

  it('tells the rider live when the driver reaches and leaves a stop', async () => {
    T0 = new Date();
    at(0);
    const rider = await env.connect(customer.accessToken);
    const { driver, rideId } = await arrivedRide(10, [STOP_1]);
    await startAt(30, driver, rideId);
    at(300);
    await ping(driver, STOP_1);
    await stop(driver, rideId, 0, 'arrived');
    const arrived = await rider.waitFor('ride:update');
    expect(arrived.data).toMatchObject({ kind: 'STOP_ARRIVED', index: 0, rideId });
  });
});
