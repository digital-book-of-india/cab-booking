import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/auditLog.model';
import { Booking } from '../src/modules/bookings/booking.model';
import { computeDiscount, MIN_PAYABLE_PAISE } from '../src/modules/coupons/coupons.service';
import type { CouponsService } from '../src/modules/coupons/coupons.service';
import { Coupon, CouponUsage } from '../src/modules/coupons/coupon.model';
import type { LedgerService } from '../src/modules/ledger/ledger.service';
import {
  CP,
  IGI,
  NEAR_CP,
  assignTo,
  createDriver,
  loginAs,
  loginAsAdmin,
  nextPhone,
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
let rider: Session;
let admin: Session;
let driver: TestDriver;
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(() => env.stop());
beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
  rider = await loginAs(env, nextPhone(), 'CUSTOMER');
  admin = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
  driver = await createDriver(env, world, { at: NEAR_CP });
});

const api = () => request(env.app);
const services = () =>
  env.app.locals['services'] as { ledger: LedgerService; coupons: CouponsService };
let keyN = 0;
const idem = () => `k-${Date.now()}-${++keyN}`;

const create = (body: Record<string, unknown> = {}) =>
  api()
    .post('/api/v1/admin/coupons')
    .set(admin.auth)
    .send({
      code: 'WELCOME',
      type: 'FLAT',
      value: 5000,
      validFrom: new Date(Date.now() - 86_400_000).toISOString(),
      validTo: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      ...body,
    });

const quote = (who: Session, couponCode?: string) =>
  api()
    .post('/api/v1/fare-quotes')
    .set(who.auth)
    .send({
      pickup: CP,
      drop: IGI,
      categoryId: world.cats['MINI'],
      ...(couponCode ? { couponCode } : {}),
    });

async function book(who: Session, couponCode?: string, paymentMethod: 'CASH' | 'ONLINE' = 'CASH') {
  const q = await quote(who, couponCode);
  expect(q.status).toBe(201);
  const b = await api()
    .post('/api/v1/bookings')
    .set(who.auth)
    .set('Idempotency-Key', idem())
    .send({ quoteId: q.body.data.quoteId, paymentMethod });
  return { quote: q.body.data, res: b, booking: b.body.data };
}

async function ride(who: Session, couponCode?: string) {
  const { booking } = await book(who, couponCode);
  const rideId = await assignTo(env, driver);
  await startRide(env, who, driver, rideId);
  const done = await rideCall(env, driver, rideId, 'complete');
  expect(done.status).toBe(200);
  return { booking, rideId, done: done.body.data };
}

describe('the discount rule', () => {
  it('percent and flat, capped, never below the minimum payable, zero under the minimum fare', () => {
    expect(computeDiscount({ type: 'PERCENT', value: 1000 }, 20_000)).toBe(2000);
    expect(computeDiscount({ type: 'PERCENT', value: 1000, maxDiscountPaise: 1500 }, 20_000)).toBe(
      1500,
    );
    expect(computeDiscount({ type: 'FLAT', value: 5000 }, 20_000)).toBe(5000);
    expect(computeDiscount({ type: 'FLAT', value: 50_000 }, 20_000)).toBe(
      20_000 - MIN_PAYABLE_PAISE,
    );
    expect(computeDiscount({ type: 'FLAT', value: 5000, minFarePaise: 30_000 }, 20_000)).toBe(0);
    expect(computeDiscount({ type: 'FLAT', value: 5000 }, 50)).toBe(0);
  });
});

describe('managing coupons', () => {
  it('creates (code upper-cased), lists, edits, and audits; bad input and duplicates refused', async () => {
    const made = await create({ code: 'welcome50' });
    expect(made.status).toBe(201);
    expect(made.body.data).toMatchObject({
      code: 'WELCOME50',
      redemptionsCount: 0,
      active: true,
      perUserLimit: 1,
    });
    expect((await create({ code: 'WELCOME50' })).status).toBe(409);
    expect((await create({ code: 'x' })).status).toBe(400);
    expect((await create({ code: 'P1', type: 'PERCENT', value: 20_000 })).status).toBe(400);
    expect((await create({ code: 'P2', validTo: '2000-01-01T00:00:00.000Z' })).status).toBe(400);
    expect((await create({ code: 'P3', extra: 1 })).status).toBe(400);

    const id = made.body.data.id as string;
    const patch = (body: object) =>
      api().patch(`/api/v1/admin/coupons/${id}`).set(admin.auth).send(body);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ active: false })).body.data.active).toBe(false);
    expect(
      (await api().get('/api/v1/admin/coupons?active=false').set(admin.auth)).body.data,
    ).toHaveLength(1);
    expect(
      await AuditLog.countDocuments({ action: { $in: ['coupon.create', 'coupon.update'] } }),
    ).toBe(2);

    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    expect((await api().get('/api/v1/admin/coupons').set(ops.auth)).status).toBe(403);
    expect((await api().post('/api/v1/admin/coupons').set(rider.auth).send({})).status).toBe(403);
  });
});

describe('using a coupon on a quote', () => {
  it('shows the rider what they would pay, and says clearly why a code is refused', async () => {
    await create({ code: 'SAVE50', minFarePaise: 1_000 });
    const good = await quote(rider, 'save50'); // case-insensitive
    expect(good.body.data.coupon).toEqual({ code: 'SAVE50', discountPaise: 5000 });
    expect(good.body.data.estimatedPayablePaise).toBe(
      good.body.data.breakdown.estimatedTotalPaise - 5000,
    );

    const refused = async (code: string, who = rider) => {
      const res = await quote(who, code);
      expect(res.status).toBe(422);
      return res.body.error.fieldErrors?.[0]?.message as string;
    };
    expect(await refused('NOSUCH')).toMatch(/does not exist/);

    await create({ code: 'FUTURE', validFrom: new Date(Date.now() + 86_400_000).toISOString() });
    expect(await refused('FUTURE')).toMatch(/not valid yet/);
    await create({
      code: 'OLD',
      validFrom: '2020-01-01T00:00:00.000Z',
      validTo: '2020-02-01T00:00:00.000Z',
    });
    expect(await refused('OLD')).toMatch(/expired/);
    await create({ code: 'BIGFARE', minFarePaise: 9_000_000 });
    expect(await refused('BIGFARE')).toMatch(/at least/);
    await create({ code: 'OTHERZONE', zoneIds: ['64b000000000000000000001'] });
    expect(await refused('OTHERZONE')).toMatch(/area/);
    await create({ code: 'OTHERCAB', categoryIds: ['64b000000000000000000001'] });
    expect(await refused('OTHERCAB')).toMatch(/cab type/);
    const off = await create({ code: 'SWITCHED' });
    await api()
      .patch(`/api/v1/admin/coupons/${off.body.data.id}`)
      .set(admin.auth)
      .send({ active: false });
    expect(await refused('SWITCHED')).toMatch(/no longer active/);
  });

  it('can be switched off for everyone with the COUPONS flag', async () => {
    await create({ code: 'SAVE50' });
    await api().put('/api/v1/admin/feature-flags/COUPONS').set(admin.auth).send({ enabled: false });
    expect((await quote(rider, 'SAVE50')).body.error.code).toBe('FEATURE_DISABLED');
    expect((await quote(rider)).status).toBe(201); // no code: unaffected
  });
});

describe('a ride with a coupon: what each side gets', () => {
  it('rider pays the discounted fare; driver and commission are on the full fare; the platform funds it; books balance', async () => {
    await create({ code: 'SAVE50' });
    const plain = await ride(await loginAs(env, nextPhone(), 'CUSTOMER'));
    const { rideId, done } = await ride(rider, 'SAVE50');

    // The same trip costs the same gross; the coupon takes ₹50 off what the rider pays.
    expect(done.grossFarePaise).toBe(plain.done.finalFarePaise);
    expect(done.discountPaise).toBe(5000);
    expect(done.finalFarePaise).toBe(done.grossFarePaise - 5000);

    const receipt = (await api().get(`/api/v1/rides/${rideId}/receipt`).set(rider.auth)).body.data;
    const line = receipt.lines.find((l: { code: string }) => l.code === 'DISCOUNT');
    expect(line).toMatchObject({ amountPaise: -5000, detail: 'SAVE50' });

    const gross = done.grossFarePaise as number;
    const commission = Math.round(gross * 0.2);
    const ledger = services().ledger;
    const bal = async (a: string) => (await ledger.balances([a]))[a]!;
    expect(await bal('PROMOTIONS')).toBe(5000);
    expect(await bal('COMMISSION')).toBe(-2 * commission); // this ride and the plain one
    expect(await bal(`RIDER_RECEIVABLE:${rider.userId}`)).toBe(done.finalFarePaise);
    expect((await ledger.driverPosition(driver.driverId)).payablePaise).toBeGreaterThanOrEqual(
      gross - commission,
    );
    expect(await ledger.checkBalance()).toMatchObject({
      ledgerTotalPaise: 0,
      unbalancedTransactions: [],
      completedRidesWithoutAccrual: 0,
    });

    // The rider owes the discounted amount, no more.
    const owed = await api().get('/api/v1/customers/me/balance').set(rider.auth);
    expect(owed.body.data.unpaidPaise).toBe(done.finalFarePaise);
  });

  it('the driver cash they may collect is the discounted fare', async () => {
    await create({ code: 'SAVE50' });
    const { rideId, done } = await ride(rider, 'SAVE50');
    const over = await api()
      .post(`/api/v1/rides/${rideId}/cash-collected`)
      .set(driver.auth)
      .send({ amountPaise: done.grossFarePaise });
    expect(over.status).toBeGreaterThanOrEqual(400);
    const exact = await api()
      .post(`/api/v1/rides/${rideId}/cash-collected`)
      .set(driver.auth)
      .send({ amountPaise: done.finalFarePaise });
    expect(exact.status).toBe(200);
  });
});

describe('limits and giving uses back', () => {
  it('one use per rider by default; the next rider can still use it', async () => {
    await create({ code: 'ONCE' });
    expect((await book(rider, 'ONCE')).res.status).toBe(201);
    const again = await quote(rider, 'ONCE');
    expect(again.status).toBe(422);
    expect(again.body.error.fieldErrors[0].message).toMatch(/already used/);
    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await book(other, 'ONCE')).res.status).toBe(201);
  });

  it('the total limit is enforced atomically: two riders racing for the last use', async () => {
    const made = await create({ code: 'LAST', maxRedemptions: 1 });
    const a = await loginAs(env, nextPhone(), 'CUSTOMER');
    const b = await loginAs(env, nextPhone(), 'CUSTOMER');
    const qa = (await quote(a, 'LAST')).body.data.quoteId;
    const qb = (await quote(b, 'LAST')).body.data.quoteId;
    const go = (who: Session, quoteId: string) =>
      api()
        .post('/api/v1/bookings')
        .set(who.auth)
        .set('Idempotency-Key', idem())
        .send({ quoteId, paymentMethod: 'CASH' });
    const [ra, rb] = await Promise.all([go(a, qa), go(b, qb)]);
    expect([ra.status, rb.status].sort()).toEqual([201, 422]);
    expect((await Coupon.findById(made.body.data.id))!.redemptionsCount).toBe(1);
  });

  it('a limit can be raised but not cut below what was used', async () => {
    const made = await create({ code: 'CAP', maxRedemptions: 2 });
    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await book(rider, 'CAP')).res.status).toBe(201);
    expect((await book(other, 'CAP')).res.status).toBe(201);
    const id = made.body.data.id as string;
    const patch = (body: object) =>
      api().patch(`/api/v1/admin/coupons/${id}`).set(admin.auth).send(body);
    expect((await patch({ maxRedemptions: 1 })).status).toBe(422);
    expect((await patch({ maxRedemptions: 50 })).status).toBe(200);
    const third = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await book(third, 'CAP')).res.status).toBe(201);
  });

  it('a cancelled booking gives the use back, once; the rider can use the code again', async () => {
    const made = await create({ code: 'ONCE' });
    const { booking } = await book(rider, 'ONCE');
    expect((await Coupon.findById(made.body.data.id))!.redemptionsCount).toBe(1);

    const cancel = await api()
      .post(`/api/v1/bookings/${booking.bookingId}/cancel`)
      .set(rider.auth)
      .send({ reasonCode: 'CHANGED_MIND' });
    expect(cancel.status).toBe(200);
    // The repair job returns it; running it twice never gives back more than was taken.
    const coupons = services().coupons;
    expect(await coupons.reconcile()).toEqual({ released: 1 });
    expect(await coupons.reconcile()).toEqual({ released: 0 });
    expect((await Coupon.findById(made.body.data.id))!.redemptionsCount).toBe(0);
    expect((await CouponUsage.findOne({ userId: rider.userId }))!.count).toBe(0);
    expect((await quote(rider, 'ONCE')).status).toBe(201);
    expect(
      (await Booking.findOne({ publicId: booking.bookingId }))!.coupon?.releasedAt,
    ).toBeTruthy();
  });

  it('a booking that fails to be created gives the use back straight away', async () => {
    const made = await create({ code: 'ONCE' });
    const q = await quote(rider, 'ONCE');
    // An unknown payment method fails after the quote is accepted; nothing may stay reserved.
    const bad = await api()
      .post('/api/v1/bookings')
      .set(rider.auth)
      .set('Idempotency-Key', idem())
      .send({ quoteId: q.body.data.quoteId, paymentMethod: 'BARTER' });
    expect(bad.status).toBe(400);
    expect((await Coupon.findById(made.body.data.id))!.redemptionsCount).toBe(0);
  });
});
