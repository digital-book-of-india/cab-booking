import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CP,
  assignTo,
  createDriver,
  currentOffer,
  loginAs,
  loginAsAdmin,
  nextPhone,
  pickupOtpOf,
  rideCall,
  seedWorld,
  startTestEnv,
  type Session,
  type TestEnv,
} from './helpers';

let env: TestEnv;
let world: Awaited<ReturnType<typeof seedWorld>>;
let customer: Session;
let config: Session;
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(() => env.stop());

const api = () => request(env.app);
let T0 = new Date();
const at = (seconds: number) => env.setNow(new Date(T0.getTime() + seconds * 1000));
const ping = async (d: Session, p: { lat: number; lng: number }) => {
  const res = await api()
    .post('/api/v1/drivers/me/location')
    .set(d.auth)
    .send({ lat: p.lat, lng: p.lng });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};
const JAIPUR = { lat: 26.9124, lng: 75.7873, label: 'Jaipur' };
let packageId: string;

beforeEach(async () => {
  await env.reset();
  T0 = new Date();
  at(0);
  world = await seedWorld();
  customer = await loginAs(env, nextPhone(), 'CUSTOMER');
  config = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
  const p = await api().post('/api/v1/admin/rental-packages').set(config.auth).send({
    zoneId: world.zoneId,
    categoryId: world.cats['MINI'],
    name: '4 hours / 40 km',
    hours: 4,
    includedKm: 40,
    pricePaise: 120000,
    extraKmPaise: 1800,
    extraHourPaise: 24000,
  });
  expect(p.status).toBe(201);
  packageId = p.body.data.packageId ?? p.body.data.id;
  const r = await api().post('/api/v1/admin/outstation-rates').set(config.auth).send({
    zoneId: world.zoneId,
    categoryId: world.cats['MINI'],
    oneWayPerKmPaise: 1800,
    roundTripPerKmPaise: 1400,
    minKmPerDay: 250,
    driverAllowancePerNightPaise: 30000,
  });
  expect(r.status).toBe(201);
});

const quote = (body: object) =>
  api()
    .post('/api/v1/fare-quotes')
    .set(customer.auth)
    .send({ pickup: CP, categoryId: world.cats['MINI'], ...body });

async function book(q: { body: { data: { quoteId: string } } }) {
  const b = await api()
    .post('/api/v1/bookings')
    .set(customer.auth)
    .set('Idempotency-Key', `k-${Math.random().toString(36).slice(2)}-${Date.now()}`)
    .send({ quoteId: q.body.data.quoteId, paymentMethod: 'CASH' });
  expect(b.status).toBe(201);
  return b;
}

async function startedRide(opts: { outstation?: boolean } = {}) {
  const driver = await createDriver(env, world);
  if (opts.outstation) {
    const pref = await api()
      .patch('/api/v1/drivers/me/preferences')
      .set(driver.auth)
      .send({ acceptsOutstation: true });
    expect(pref.status).toBe(200);
  }
  return driver;
}

async function runRide(driver: Session, rideId: string) {
  at(10);
  await rideCall(env, driver, rideId, 'en-route');
  await ping(driver, CP);
  expect((await rideCall(env, driver, rideId, 'arrived')).status).toBe(200);
  const otp = await pickupOtpOf(env, customer, rideId);
  expect((await rideCall(env, driver, rideId, 'start', { pickupOtp: otp })).status).toBe(200);
}

describe('rentals', () => {
  it('lists packages and quotes the package price with no drop', async () => {
    const list = await api()
      .get('/api/v1/rental-packages')
      .set(customer.auth)
      .query({ lat: CP.lat, lng: CP.lng });
    expect(list.status).toBe(200);
    expect(list.body.data.packages).toHaveLength(1);
    const q = await quote({ rentalPackageId: packageId });
    expect(q.status).toBe(201);
    expect(q.body.data.tripKind).toBe('RENTAL');
    expect(q.body.data.breakdown.estimatedTotalPaise).toBe(120000);
  });

  it('refuses a rental with stops, a missing package, or no drop and no package', async () => {
    expect((await quote({ rentalPackageId: packageId, stops: [CP] })).status).toBe(400);
    expect((await quote({})).status).toBe(400);
    expect((await quote({ rentalPackageId: '64b000000000000000000000' })).status).toBe(422);
  });

  it('charges the package when nothing goes over', async () => {
    const q = await quote({ rentalPackageId: packageId });
    await book(q);
    const driver = await startedRide();
    const rideId = await assignTo(env, driver);
    await runRide(driver, rideId);
    at(10 + 2 * 3600);
    await ping(driver, { lat: CP.lat + 0.05, lng: CP.lng });
    at(10 + 2 * 3600 + 60);
    const done = await rideCall(env, driver, rideId, 'complete');
    expect(done.status).toBe(200);
    expect(done.body.data.finalFarePaise).toBe(120000);
    expect(done.body.data.fare.basis).toBe('RENTAL_PACKAGE_AND_USAGE');
  });

  it('charges extra time and distance from the server clock and trail, not the odometer', async () => {
    const q = await quote({ rentalPackageId: packageId });
    await book(q);
    const driver = await startedRide();
    const rideId = await assignTo(env, driver);
    await runRide(driver, rideId);
    // About 30 km out and 30 km back: 60 km, 20 over the package (less the 2 km grace).
    at(10 + 3600);
    await ping(driver, { lat: CP.lat + 0.27, lng: CP.lng });
    at(10 + 2 * 3600);
    await ping(driver, CP);
    // 5.5 hours in total: 90 min over, 10 free => 80 min extra.
    at(10 + 5.5 * 3600);
    const done = await rideCall(env, driver, rideId, 'complete', {
      odometerEndMeters: 1,
    });
    expect(done.status).toBe(200);
    const b = done.body.data.fare.breakdown;
    expect(b.timeFarePaise).toBe(Math.round((80 * 24000) / 60));
    expect(b.distanceFarePaise).toBeGreaterThan(30000);
    expect(b.distanceFarePaise).toBeLessThan(40000);
    expect(b.baseFarePaise).toBe(120000);
    expect(done.body.data.finalFarePaise).toBe(b.estimatedTotalPaise);
    const receipt = await api().get(`/api/v1/rides/${rideId}/receipt`).set(customer.auth);
    expect(receipt.status).toBe(200);
    expect(JSON.stringify(receipt.body.data)).toContain('Package: 4 hours / 40 km');
  });
});

describe('outstation', () => {
  it('is quoted per route kilometre, and a round trip needs a return time', async () => {
    const one = await quote({ drop: JAIPUR, outstation: { tripType: 'ONE_WAY' } });
    expect(one.status).toBe(201);
    expect(one.body.data.tripKind).toBe('OUTSTATION');
    const bad = await quote({ drop: JAIPUR, outstation: { tripType: 'ROUND_TRIP' } });
    expect(bad.status).toBe(400);
    const returnAt = new Date(T0.getTime() + 3 * 86_400_000).toISOString();
    const round = await quote({ drop: JAIPUR, outstation: { tripType: 'ROUND_TRIP', returnAt } });
    expect(round.status).toBe(201);
    const tooShort = await quote({
      drop: { lat: 28.64, lng: 77.22, label: 'Nearby' },
      outstation: { tripType: 'ONE_WAY' },
    });
    expect(tooShort.status).toBe(422);
  });

  it('is offered only to drivers who opted in', async () => {
    const q = await quote({ drop: JAIPUR, outstation: { tripType: 'ONE_WAY' } });
    await book(q);
    const driver = await startedRide();
    await env.sweep();
    expect(await currentOffer(env, driver)).toBeNull();
    const pref = await api()
      .patch('/api/v1/drivers/me/preferences')
      .set(driver.auth)
      .send({ acceptsOutstation: true });
    expect(pref.status).toBe(200);
    await env.sweep();
    expect(await currentOffer(env, driver)).not.toBeNull();
  });

  it('keeps the quoted fare for a one-way trip that followed the route', async () => {
    const q = await quote({ drop: JAIPUR, outstation: { tripType: 'ONE_WAY' } });
    const quoted = q.body.data.breakdown.estimatedTotalPaise;
    await book(q);
    const driver = await startedRide({ outstation: true });
    const rideId = await assignTo(env, driver);
    await runRide(driver, rideId);
    at(10 + 3600);
    await ping(driver, { lat: CP.lat + 0.9, lng: CP.lng });
    at(10 + 7 * 3600);
    const done = await rideCall(env, driver, rideId, 'complete');
    expect(done.status).toBe(200);
    expect(done.body.data.finalFarePaise).toBe(quoted);
  });
});
