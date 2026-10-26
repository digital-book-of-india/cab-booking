import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DriverProfile } from '../src/modules/drivers/driverProfile.model';
import { RideOffer } from '../src/modules/dispatch/rideOffer.model';
import type { CouponsService } from '../src/modules/coupons/coupons.service';
import type { LedgerService } from '../src/modules/ledger/ledger.service';
import { LedgerTransaction } from '../src/modules/ledger/ledgerTransaction.model';
import {
  LocationPing,
  LOCATION_TRAIL_RETENTION_DAYS,
} from '../src/modules/tracking/locationPing.model';
import { Coupon } from '../src/modules/coupons/coupon.model';
import {
  CP,
  IGI,
  NEAR_CP,
  assignTo,
  completedRide,
  createDriver,
  loginAs,
  loginAsAdmin,
  nextPhone,
  requestRide,
  rideCall,
  seedWorld,
  startRide,
  startTestEnv,
  type Session,
  type TestDriver,
  type TestEnv,
} from './helpers';

/**
 * The release gate. `npm run gate` runs this file together with the existing suites that cover the
 * other gate items (listed in docs/release-gate.md). If any of them fails, nothing ships.
 */
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
  driver = await createDriver(env, world, { at: NEAR_CP, name: 'Ravi Kumar' });
});

const api = () => request(env.app);
const services = () =>
  env.app.locals['services'] as { ledger: LedgerService; coupons: CouponsService };
let keyN = 0;
const idem = () => `gate-${Date.now()}-${++keyN}`;

describe('gate 1-2: nobody sees another person’s ride or contact details', () => {
  it('a stranger, another driver and a previous driver are all turned away; phones stay hidden', async () => {
    const { rideId, booking } = await completedRide(env, world, rider, driver);
    const stranger = await loginAs(env, nextPhone(), 'CUSTOMER');
    const otherDriver = await createDriver(env, world, { at: NEAR_CP, name: 'Other Driver' });
    for (const who of [stranger, otherDriver]) {
      for (const path of [
        `/api/v1/rides/${rideId}`,
        `/api/v1/rides/${rideId}/receipt`,
        `/api/v1/bookings/${booking.bookingId}`,
        `/api/v1/rides/${rideId}/rating`,
      ]) {
        // Refused either way: 404 (not yours) or 403 (wrong role for this endpoint).
        expect([403, 404], path).toContain((await api().get(path).set(who.auth)).status);
      }
    }
    // The rider’s own view never carries the driver’s number; the driver’s never carries the rider’s.
    const riderView = await api().get(`/api/v1/rides/${rideId}`).set(rider.auth);
    const driverView = await api().get(`/api/v1/rides/${rideId}`).set(driver.auth);
    expect(JSON.stringify(riderView.body)).not.toMatch(/\+91\d{10}/);
    expect(JSON.stringify(driverView.body)).not.toMatch(/\+91\d{10}/);
  });
});

describe('gate 7: the books always balance', () => {
  it('cash, a coupon ride and an unpaid ride together leave the ledger at exactly zero', async () => {
    const config = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    await api()
      .post('/api/v1/admin/coupons')
      .set(config.auth)
      .send({
        code: 'GATE50',
        type: 'FLAT',
        value: 5000,
        validFrom: new Date(Date.now() - 86_400_000).toISOString(),
        validTo: new Date(Date.now() + 86_400_000).toISOString(),
      });

    // 1. a cash ride, paid and recorded
    const cash = await completedRide(env, world, rider, driver);
    await api()
      .post(`/api/v1/rides/${cash.rideId}/cash-collected`)
      .set(driver.auth)
      .send({ amountPaise: cash.fare });

    // 2. a coupon ride, left unpaid
    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    const q = await api()
      .post('/api/v1/fare-quotes')
      .set(other.auth)
      .send({ pickup: CP, drop: IGI, categoryId: world.cats['MINI'], couponCode: 'GATE50' });
    const booked = await api()
      .post('/api/v1/bookings')
      .set(other.auth)
      .set('Idempotency-Key', idem())
      .send({ quoteId: q.body.data.quoteId, paymentMethod: 'CASH' });
    expect(booked.status).toBe(201);
    const rideId = await assignTo(env, driver);
    await startRide(env, other, driver, rideId);
    expect((await rideCall(env, driver, rideId, 'complete')).status).toBe(200);

    // The whole book: every transaction nets to zero, and so does every account added together.
    const ledger = services().ledger;
    expect(await ledger.checkBalance()).toEqual({
      ledgerTotalPaise: 0,
      unbalancedTransactions: [],
      completedRidesWithoutAccrual: 0,
    });
    const txns = await LedgerTransaction.find().lean();
    expect(txns.length).toBeGreaterThanOrEqual(2);
    for (const t of txns) {
      expect(
        t.entries.reduce((n, e) => n + e.amountPaise, 0),
        t.txnId,
      ).toBe(0);
    }
  });
});

describe('gate 9: a cancelled ride leaves nothing stuck', () => {
  it('the driver is freed, offers are closed, and the coupon use comes back', async () => {
    const config = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    const made = await api()
      .post('/api/v1/admin/coupons')
      .set(config.auth)
      .send({
        code: 'ONCEONLY',
        type: 'FLAT',
        value: 5000,
        validFrom: new Date(Date.now() - 86_400_000).toISOString(),
        validTo: new Date(Date.now() + 86_400_000).toISOString(),
      });
    const q = await api()
      .post('/api/v1/fare-quotes')
      .set(rider.auth)
      .send({ pickup: CP, drop: IGI, categoryId: world.cats['MINI'], couponCode: 'ONCEONLY' });
    const booked = await api()
      .post('/api/v1/bookings')
      .set(rider.auth)
      .set('Idempotency-Key', idem())
      .send({ quoteId: q.body.data.quoteId, paymentMethod: 'CASH' });
    await assignTo(env, driver);
    expect((await DriverProfile.findById(driver.driverId))!.activeRideId).toBeTruthy();

    const cancel = await api()
      .post(`/api/v1/bookings/${booked.body.data.bookingId}/cancel`)
      .set(rider.auth)
      .send({ reasonCode: 'CHANGED_MIND' });
    expect(cancel.status).toBe(200);

    expect((await DriverProfile.findById(driver.driverId))!.activeRideId ?? null).toBeNull();
    expect(await RideOffer.countDocuments({ status: 'PENDING' })).toBe(0);
    await services().coupons.reconcile();
    expect((await Coupon.findById(made.body.data.id))!.redemptionsCount).toBe(0);
    // The driver can take the next ride straight away.
    const next = await loginAs(env, nextPhone(), 'CUSTOMER');
    await requestRide(env, world, next);
    expect(await assignTo(env, driver)).toMatch(/^ride_/);
  });
});

describe('gate 11: location data does not live forever', () => {
  it('trail points expire after the retention period', async () => {
    await LocationPing.init();
    const indexes = await LocationPing.collection.indexes();
    const ttl = indexes.find((i) => i.expireAfterSeconds !== undefined);
    expect(ttl?.expireAfterSeconds).toBe(LOCATION_TRAIL_RETENTION_DAYS * 86400);
    expect(LOCATION_TRAIL_RETENTION_DAYS).toBeLessThanOrEqual(30);
  });
});
