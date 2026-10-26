import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Booking } from '../src/modules/bookings/booking.model';
import { Notification } from '../src/modules/notifications/notification.model';
import {
  CP,
  MUMBAI,
  assignTo,
  createDriver,
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
let T0 = new Date();
const at = (seconds: number) => env.setNow(new Date(T0.getTime() + seconds * 1000));

// Inside the seeded Delhi zone, a different way from the airport.
const NORTH = { lat: 28.7, lng: 77.2, label: 'North Delhi' };
const EAST = { lat: 28.64, lng: 77.3, label: 'East Delhi' };

async function assignedRide() {
  T0 = new Date();
  at(0);
  const driver = await createDriver(env, world);
  const booking = await requestRide(env, world, customer);
  const rideId = await assignTo(env, driver);
  return { driver, booking, rideId };
}
const change = (rideId: string, drop: object, who: Session = customer) =>
  api().post(`/api/v1/rides/${rideId}/destination`).set(who.auth).send({ drop });
const respond = (rideId: string, accept: boolean, who: Session) =>
  api().post(`/api/v1/rides/${rideId}/destination/respond`).set(who.auth).send({ accept });
const booking = async (id: string) =>
  (await api().get(`/api/v1/bookings/${id}`).set(customer.auth)).body.data;

describe('changing the destination', () => {
  it('prices the new route, changes nothing until the driver accepts, then bills the new route', async () => {
    const { driver, booking: b, rideId } = await assignedRide();
    const before = await booking(b.bookingId);

    const asked = await change(rideId, NORTH);
    expect(asked.status).toBe(201);
    expect(asked.body.data.currentEstimatedFarePaise).toBe(before.estimatedFarePaise);
    expect(asked.body.data.newEstimatedFarePaise).toBeGreaterThan(0);
    expect(asked.body.data.newEstimatedFarePaise).not.toBe(before.estimatedFarePaise);

    // Nothing has changed yet.
    const waiting = await booking(b.bookingId);
    expect(waiting.drop.label).toBe(before.drop.label);
    expect(waiting.estimatedFarePaise).toBe(before.estimatedFarePaise);

    const ok = await respond(rideId, true, driver);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({
      accepted: true,
      estimatedFarePaise: asked.body.data.newEstimatedFarePaise,
    });

    const after = await booking(b.bookingId);
    expect(after.drop.label).toBe('North Delhi');
    expect(after.estimatedFarePaise).toBe(asked.body.data.newEstimatedFarePaise);
    expect(after.fare.estimatedDistanceMeters).toBe(asked.body.data.newEstimatedDistanceMeters);

    // Support can see what the fare was before and after.
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const detail = (await api().get(`/api/v1/admin/bookings/${b.bookingId}`).set(ops.auth)).body
      .data;
    expect(detail.fareAmendments).toHaveLength(1);
    expect(detail.fareAmendments[0]).toMatchObject({
      reason: 'DESTINATION_CHANGE',
      previous: { estimatedFarePaise: before.estimatedFarePaise },
      next: { estimatedFarePaise: asked.body.data.newEstimatedFarePaise },
    });

    // The final fare is for the new route.
    at(5);
    await startRide(env, customer, driver, rideId);
    at(900);
    const done = await rideCall(env, driver, rideId, 'complete');
    expect(done.body.data.fare.billableDistanceMeters).toBe(
      asked.body.data.newEstimatedDistanceMeters,
    );
  });

  it('a declined request leaves everything as it was, and the rider can ask again', async () => {
    const { driver, booking: b, rideId } = await assignedRide();
    const before = await booking(b.bookingId);
    await change(rideId, NORTH);
    expect((await respond(rideId, false, driver)).body.data).toEqual({ accepted: false });
    const after = await booking(b.bookingId);
    expect(after.drop.label).toBe(before.drop.label);
    expect(after.estimatedFarePaise).toBe(before.estimatedFarePaise);
    expect((await change(rideId, EAST)).status).toBe(201);
  });

  it('only one request at a time; an unanswered one lapses after 30 seconds', async () => {
    const { driver, rideId } = await assignedRide();
    expect((await change(rideId, NORTH)).status).toBe(201);
    const second = await change(rideId, EAST);
    expect(second.status).toBe(409);

    at(31);
    // Too late to accept the old one...
    const late = await respond(rideId, true, driver);
    expect(late.status).toBe(409);
    // ...and the rider is free to ask again.
    expect((await change(rideId, EAST)).status).toBe(201);
  });

  it('two answers at the same moment cannot both apply', async () => {
    const { driver, booking: b, rideId } = await assignedRide();
    await change(rideId, NORTH);
    const [x, y] = await Promise.all([
      respond(rideId, true, driver),
      respond(rideId, true, driver),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const doc = await Booking.findOne({ publicId: b.bookingId }).lean();
    expect(doc?.fareAmendments).toHaveLength(1);
  });

  it('refuses places we do not serve, trips that are too short, and junk', async () => {
    const { rideId } = await assignedRide();
    const far = await change(rideId, MUMBAI);
    expect(far.status).toBe(422);
    expect(far.body.error.code).toBe('NOT_SERVICEABLE');
    expect((await change(rideId, CP)).status).toBe(422); // the pickup itself
    expect((await change(rideId, { lat: 999, lng: 1 })).status).toBe(400);
    expect((await change(rideId, { ...NORTH, surprise: 1 })).status).toBe(400);
  });

  it('is limited to three changes per booking', async () => {
    const { driver, rideId } = await assignedRide();
    const places = [NORTH, EAST, { lat: 28.5, lng: 77.2, label: 'South' }];
    for (const p of places) {
      expect((await change(rideId, p)).status).toBe(201);
      expect((await respond(rideId, true, driver)).status).toBe(200);
    }
    const fourth = await change(rideId, NORTH);
    expect(fourth.status).toBe(422);
  });

  it('belongs to this booking’s rider and driver only, and only while the ride is live', async () => {
    const { driver, rideId } = await assignedRide();
    const stranger = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await change(rideId, NORTH, stranger)).status).toBe(404);
    await change(rideId, NORTH);
    expect((await respond(rideId, true, customer)).status).toBe(403); // riders cannot answer
    const otherDriver = await createDriver(env, world);
    expect((await respond(rideId, true, otherDriver)).status).toBe(404);

    expect((await respond(rideId, true, driver)).status).toBe(200);
    at(5);
    await startRide(env, customer, driver, rideId);
    at(900);
    await rideCall(env, driver, rideId, 'complete');
    expect((await change(rideId, EAST)).status).toBe(409); // the ride is over
  });

  it('a request still waiting when the ride ends is void', async () => {
    const { driver, booking: b, rideId } = await assignedRide();
    at(5);
    await startRide(env, customer, driver, rideId);
    await change(rideId, NORTH);
    at(900);
    await rideCall(env, driver, rideId, 'complete');
    const doc = await Booking.findOne({ publicId: b.bookingId }).lean();
    expect(doc?.destinationChange).toBeUndefined();
  });

  it('asks the driver live and by high-priority push, and tells the rider the answer', async () => {
    const { driver, rideId } = await assignedRide();
    const driving = await env.connect(driver.accessToken);
    const rider = await env.connect(customer.accessToken);
    await change(rideId, NORTH);
    const ask = await driving.waitFor('ride:update');
    expect(ask.data).toMatchObject({ kind: 'DESTINATION_REQUESTED', rideId });
    const push = await Notification.findOne({ type: 'ride.destination_requested' }).lean();
    expect(push).toMatchObject({ priority: 'high', status: 'PENDING' });
    expect(push?.expiresAt).toBeTruthy();

    await respond(rideId, true, driver);
    const answer = await rider.waitFor('ride:update');
    expect(answer.data).toMatchObject({ kind: 'DESTINATION_ACCEPTED' });
    expect(await Notification.countDocuments({ type: 'ride.destination_accepted' })).toBe(1);
  });
});

describe('receipts', () => {
  async function finishedRide(waitSeconds = 0) {
    const { driver, booking: b, rideId } = await assignedRide();
    at(5);
    await rideCall(env, driver, rideId, 'en-route');
    at(10);
    await request(env.app)
      .post('/api/v1/drivers/me/location')
      .set(driver.auth)
      .send({ lat: CP.lat, lng: CP.lng });
    await rideCall(env, driver, rideId, 'arrived');
    at(10 + waitSeconds);
    const otp = await pickupOtpOf(env, customer, rideId);
    await rideCall(env, driver, rideId, 'start', { pickupOtp: otp });
    at(10 + waitSeconds + 900);
    const done = await rideCall(env, driver, rideId, 'complete');
    return { driver, booking: b, rideId, done: done.body.data };
  }
  const receipt = (rideId: string, who: Session) =>
    api().get(`/api/v1/rides/${rideId}/receipt`).set(who.auth);

  it('itemises the fare so the lines add up to the total the rider owes', async () => {
    const { rideId, done } = await finishedRide(480);
    const res = await receipt(rideId, customer);
    expect(res.status).toBe(200);
    const r = res.body.data;
    expect(r.kind).toBe('RIDE');
    expect(r.receiptNumber).toBe(done.receiptNumber);
    expect(r.totalPaise).toBe(done.finalFarePaise);
    expect(r.lines.reduce((n: number, l: { amountPaise: number }) => n + l.amountPaise, 0)).toBe(
      r.totalPaise,
    );
    expect(r.lines.map((l: { code: string }) => l.code)).toEqual(
      expect.arrayContaining(['BASE', 'DISTANCE', 'TIME', 'WAITING']),
    );
    expect(r.lines.find((l: { code: string }) => l.code === 'WAITING').detail).toBe('5 min billed');
    expect(r).toMatchObject({ payment: { method: 'CASH', status: 'DUE' }, currency: 'INR' });
    expect(r.driver.firstName).toBeTruthy();
    expect(JSON.stringify(r)).not.toMatch(/\+91\d{6,}/); // no phone numbers on a receipt
  });

  it('has one fixed number, the same for the rider, the driver and support, however often it is opened', async () => {
    const { driver, rideId, done } = await finishedRide();
    const support = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    const numbers = await Promise.all(
      [customer, driver, support, customer].map(
        async (who) => (await receipt(rideId, who)).body.data.receiptNumber,
      ),
    );
    expect(new Set(numbers)).toEqual(new Set([done.receiptNumber]));
    // The driver's copy has the money but not a driver card.
    expect((await receipt(rideId, driver)).body.data.driver).toBeUndefined();
  });

  it('is issued exactly once even for a ride that has none yet, however many open it at once', async () => {
    const { booking: b, rideId } = await finishedRide();
    await Booking.updateOne({ publicId: b.bookingId }, { $unset: { receipt: 1 } });
    const all = await Promise.all(Array.from({ length: 5 }, () => receipt(rideId, customer)));
    const numbers = new Set(all.map((r) => r.body.data.receiptNumber));
    expect(numbers.size).toBe(1);
    expect([...numbers][0]).toMatch(/^rcpt_[0-9a-f]{12}$/);
  });

  it('never changes after the fact, even when prices change later', async () => {
    const { rideId } = await finishedRide();
    const first = (await receipt(rideId, customer)).body.data;
    const config = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    const cat = world.cats['MINI'];
    const created = await api().post('/api/v1/admin/pricing/configs').set(config.auth).send({
      zoneId: world.zoneId,
      categoryId: cat,
      baseFarePaise: 99_000,
      perKmPaise: 9_900,
      perMinutePaise: 999,
      minimumFarePaise: 99_000,
      waitingPerMinutePaise: 999,
      changeReason: 'Surge pricing for the test',
    });
    expect(created.status).toBe(201);
    expect((await receipt(rideId, customer)).body.data).toEqual(first);
  });

  it('is for the people on the ride and support only', async () => {
    const { rideId } = await finishedRide();
    const stranger = await loginAs(env, nextPhone(), 'CUSTOMER');
    const otherDriver = await createDriver(env, world);
    expect((await receipt(rideId, stranger)).status).toBe(404);
    expect((await receipt(rideId, otherDriver)).status).toBe(404);
    const finance = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    expect((await receipt(rideId, finance)).status).toBe(403);
    expect((await api().get(`/api/v1/rides/${rideId}/receipt`)).status).toBe(401);
  });

  it('does not exist until the ride is finished, or when a cancelled ride cost nothing', async () => {
    const { driver, booking: b, rideId } = await assignedRide();
    expect((await receipt(rideId, customer)).status).toBe(409);
    expect((await receipt(rideId, driver)).status).toBe(409);
    await api()
      .post(`/api/v1/bookings/${b.bookingId}/cancel`)
      .set(customer.auth)
      .send({ reasonCode: 'CHANGED_MIND' });
    expect((await receipt(rideId, customer)).status).toBe(409); // free cancellation: nothing to bill
  });

  it('a late cancellation gets a fee receipt', async () => {
    const { driver, booking: b, rideId } = await assignedRide();
    at(10);
    await rideCall(env, driver, rideId, 'en-route');
    at(300);
    await api()
      .post(`/api/v1/bookings/${b.bookingId}/cancel`)
      .set(customer.auth)
      .send({ reasonCode: 'CHANGED_MIND' });
    const r = (await receipt(rideId, customer)).body.data;
    expect(r).toMatchObject({ kind: 'CANCELLATION_FEE', totalPaise: 3000 });
    expect(r.lines).toEqual([
      expect.objectContaining({ code: 'CANCELLATION_FEE', amountPaise: 3000 }),
    ]);
  });
});

export type { TestDriver };
