import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Booking } from '../src/modules/bookings/booking.model';
import type { LedgerService } from '../src/modules/ledger/ledger.service';
import { Notification } from '../src/modules/notifications/notification.model';
import { Payment } from '../src/modules/payments/payment.model';
import {
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
  env.razorpay.orders.length = 0;
  env.razorpay.refundRequests.length = 0;
  world = await seedWorld();
  rider = await loginAs(env, nextPhone(), 'CUSTOMER');
  driver = await createDriver(env, world, { at: NEAR_CP });
});

const api = () => request(env.app);
const ledger = () => (env.app.locals['services'] as { ledger: LedgerService }).ledger;
let keyN = 0;
const idem = () => `k-${Date.now()}-${++keyN}`;
let payN = 0;

const walletBalance = async (who = rider) =>
  (await api().get('/api/v1/wallet').set(who.auth)).body.data.balancePaise as number;
const payable = async () => (await ledger().driverPosition(driver.driverId)).payablePaise;

/** Start a payment through the API and "capture" it at Razorpay (a signed webhook). */
async function capture(started: { orderId: string; amountPaise: number }) {
  payN += 1;
  await env.razorpay.webhook(
    env.razorpay.captured(started.orderId, `pay_cap_${payN}`, started.amountPaise),
  );
}
async function topUp(amountPaise: number, who = rider) {
  const res = await api()
    .post('/api/v1/wallet/topups')
    .set(who.auth)
    .set('Idempotency-Key', idem())
    .send({ amountPaise });
  expect(res.status).toBe(201);
  await capture(res.body.data);
  return res.body.data;
}
const tip = (who: Session, rideId: string, body: object, key = idem()) =>
  api().post(`/api/v1/rides/${rideId}/tip`).set(who.auth).set('Idempotency-Key', key).send(body);
const books = async () => {
  const check = await ledger().checkBalance();
  expect(check).toEqual({
    ledgerTotalPaise: 0,
    unbalancedTransactions: [],
    completedRidesWithoutAccrual: 0,
  });
  const finance = await loginAsAdmin(env, nextPhone(), 'FINANCE');
  const consistency = (await api().get('/api/v1/admin/finance/consistency').set(finance.auth)).body
    .data;
  expect(consistency.ok, JSON.stringify(consistency)).toBe(true);
};

describe('tipping a driver', () => {
  it('an online tip goes to the driver in full, through the ledger, and the driver is told', async () => {
    const ride = await completedRide(env, world, rider, driver);
    const before = await payable();

    const res = await tip(rider, ride.rideId, { amountPaise: 5000, source: 'ONLINE' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'PENDING', amountPaise: 5000, source: 'ONLINE' });
    expect(res.body.data.payment.checkout.orderId).toBeTruthy();
    expect(await payable()).toBe(before); // nothing moves until the payment is confirmed

    await capture(res.body.data.payment);
    const seen = await api().get(`/api/v1/rides/${ride.rideId}/tip`).set(rider.auth);
    expect(seen.body.data.tip).toMatchObject({ status: 'PAID', amountPaise: 5000 });
    expect(await payable()).toBe(before + 5000); // all of it, no commission

    expect(await Notification.countDocuments({ type: 'tip.received' })).toBe(1);
    const earn = (await api().get('/api/v1/drivers/me/earnings').set(driver.auth)).body.data;
    expect(earn.totals).toMatchObject({ tipsPaise: 5000, tipCount: 1 });
    const driverSees = await api().get(`/api/v1/rides/${ride.rideId}/tip`).set(driver.auth);
    expect(driverSees.body.data.tip).toMatchObject({ status: 'PAID', amountPaise: 5000 });
    expect(driverSees.body.data.tip.payment).toBeUndefined();
    await books();
  });

  it('one tip per ride; repeating a request is harmless; a second tip is refused', async () => {
    const ride = await completedRide(env, world, rider, driver);
    const key = idem();
    const first = await tip(rider, ride.rideId, { amountPaise: 3000 }, key);
    const again = await tip(rider, ride.rideId, { amountPaise: 3000 }, key);
    expect(again.body.data.tipId).toBe(first.body.data.tipId);
    expect(await Payment.countDocuments({ purpose: 'TIP' })).toBe(1);

    const during = await tip(rider, ride.rideId, { amountPaise: 3000 });
    expect(during.status).toBe(409); // still waiting for the first payment
    await capture(first.body.data.payment);
    expect((await tip(rider, ride.rideId, { amountPaise: 3000 })).status).toBe(409); // already tipped
    expect((await payable()) - (await payable())).toBe(0);
  });

  it('refuses silly tips, tips on rides that are not finished, other people’s rides, and late tips', async () => {
    const ride = await completedRide(env, world, rider, driver);
    expect((await tip(rider, ride.rideId, { amountPaise: 500 })).status).toBe(422);
    expect((await tip(rider, ride.rideId, { amountPaise: 300_000 })).status).toBe(422);
    expect((await tip(rider, ride.rideId, { amountPaise: 5000, extra: 1 })).status).toBe(400);
    expect((await tip(rider, ride.rideId, { amountPaise: 5000, source: 'BARTER' })).status).toBe(
      400,
    );
    const stranger = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await tip(stranger, ride.rideId, { amountPaise: 5000 })).status).toBe(404);
    expect((await tip(driver, ride.rideId, { amountPaise: 5000 })).status).toBe(403);

    // A ride still in progress cannot be tipped.
    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    await requestRide(env, world, other);
    const liveRide = await assignTo(env, driver);
    await startRide(env, other, driver, liveRide);
    expect((await tip(other, liveRide, { amountPaise: 5000 })).status).toBe(409);
    await rideCall(env, driver, liveRide, 'complete');

    env.setNow(new Date(Date.now() + 25 * 3_600_000));
    expect((await tip(rider, ride.rideId, { amountPaise: 5000 })).status).toBe(422);
    env.setNow(null);

    const config = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    await api().put('/api/v1/admin/feature-flags/TIPS').set(config.auth).send({ enabled: false });
    expect((await tip(rider, ride.rideId, { amountPaise: 5000 })).body.error.code).toBe(
      'FEATURE_DISABLED',
    );
  });

  it('an abandoned tip payment does not block trying again', async () => {
    const ride = await completedRide(env, world, rider, driver);
    const first = await tip(rider, ride.rideId, { amountPaise: 5000 });
    expect(first.status).toBe(201);
    env.setNow(new Date(Date.now() + 31 * 60_000)); // the payment window passes
    await env.runFinance();
    const second = await tip(rider, ride.rideId, { amountPaise: 2000 });
    expect(second.status).toBe(201);
    expect(second.body.data.tipId).not.toBe(first.body.data.tipId);
    env.setNow(null);
  });
});

describe('the wallet', () => {
  it('starts empty, tops up through a normal payment, and shows the entry', async () => {
    expect(await walletBalance()).toBe(0);
    const started = await api()
      .post('/api/v1/wallet/topups')
      .set(rider.auth)
      .set('Idempotency-Key', idem())
      .send({ amountPaise: 50_000 });
    expect(started.body.data).toMatchObject({
      purpose: 'TOPUP',
      amountPaise: 50_000,
      status: 'CREATED',
    });
    expect(await walletBalance()).toBe(0); // not until the payment is confirmed
    await capture(started.body.data);
    const view = (await api().get('/api/v1/wallet').set(rider.auth)).body.data;
    expect(view.balancePaise).toBe(50_000);
    expect(view.entries[0]).toMatchObject({ kind: 'WALLET_TOPUP', amountPaise: 50_000 });
    expect(view.limits).toEqual({
      minTopupPaise: 5000,
      maxTopupPaise: 500_000,
      maxBalancePaise: 1_000_000,
    });
    await books();
  });

  it('keeps top-ups and the balance within the limits', async () => {
    const topup = (amountPaise: number) =>
      api()
        .post('/api/v1/wallet/topups')
        .set(rider.auth)
        .set('Idempotency-Key', idem())
        .send({ amountPaise });
    expect((await topup(4000)).status).toBe(422);
    expect((await topup(600_000)).status).toBe(422);
    await topUp(500_000);
    await topUp(500_000);
    expect(await walletBalance()).toBe(1_000_000);
    expect((await topup(5000)).status).toBe(422); // the wallet would hold more than Rs 10,000

    const config = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    await api().put('/api/v1/admin/feature-flags/WALLET').set(config.auth).send({ enabled: false });
    expect((await topup(5000)).body.error.code).toBe('FEATURE_DISABLED');
    expect((await api().get('/api/v1/wallet').set(rider.auth)).status).toBe(200); // looking still works
  });

  it('pays a ride from the balance at once, and the books and the gateway still agree', async () => {
    const ride = await completedRide(env, world, rider, driver, 'ONLINE');
    const empty = await api()
      .post(`/api/v1/bookings/${ride.booking.bookingId}/pay-from-wallet`)
      .set(rider.auth)
      .set('Idempotency-Key', idem())
      .send({});
    expect(empty.status).toBe(402);
    expect(empty.body.error.code).toBe('INSUFFICIENT_WALLET_BALANCE');
    expect((await Booking.findOne({ publicId: ride.booking.bookingId }))!.paymentStatus).toBe(
      'DUE',
    ); // still payable

    await topUp(100_000);
    const key = idem();
    const pay = () =>
      api()
        .post(`/api/v1/bookings/${ride.booking.bookingId}/pay-from-wallet`)
        .set(rider.auth)
        .set('Idempotency-Key', key)
        .send({});
    const paid = await pay();
    expect(paid.status).toBe(201);
    expect(paid.body.data).toMatchObject({
      method: 'WALLET',
      status: 'PAID',
      amountPaise: ride.fare,
      checkout: null,
    });
    expect((await pay()).body.data.paymentId).toBe(paid.body.data.paymentId); // same request again
    expect(
      (
        await api()
          .post(`/api/v1/bookings/${ride.booking.bookingId}/pay-from-wallet`)
          .set(rider.auth)
          .set('Idempotency-Key', idem())
          .send({})
      ).status,
    ).toBe(409); // already paid

    expect(await walletBalance()).toBe(100_000 - ride.fare);
    const bal = (await api().get('/api/v1/customers/me/balance').set(rider.auth)).body.data;
    expect(bal.unpaidPaise).toBe(0);
    expect((await Booking.findOne({ publicId: ride.booking.bookingId }))!.paymentStatus).toBe(
      'PAID',
    );
    await books();
  });

  it('a refund can go back to the wallet, whether the ride was paid by card or from the wallet', async () => {
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    const refund = (bookingId: string, body: object) =>
      api()
        .post(`/api/v1/admin/bookings/${bookingId}/refund`)
        .set(fin.auth)
        .set('Idempotency-Key', idem())
        .send(body);

    // 1. paid by card, refunded to the wallet: the gateway keeps the money, the wallet gets it
    const card = await completedRide(env, world, rider, driver, 'ONLINE');
    const started = await api()
      .post(`/api/v1/bookings/${card.booking.bookingId}/payments`)
      .set(rider.auth)
      .set('Idempotency-Key', idem())
      .send({});
    await capture(started.body.data);
    const toWallet = await refund(card.booking.bookingId, {
      amountPaise: 4000,
      reason: 'Long route',
      destination: 'WALLET',
    });
    expect(toWallet.status).toBe(201);
    expect(toWallet.body.data).toMatchObject({ destination: 'WALLET', status: 'PROCESSED' });
    expect(env.razorpay.refundRequests).toHaveLength(0); // nothing asked of Razorpay
    expect(await walletBalance()).toBe(4000);

    // 2. paid from the wallet, refunded: goes to the wallet whatever is asked
    const second = await completedRide(env, world, rider, driver, 'ONLINE');
    await topUp(100_000);
    await api()
      .post(`/api/v1/bookings/${second.booking.bookingId}/pay-from-wallet`)
      .set(rider.auth)
      .set('Idempotency-Key', idem())
      .send({});
    const before = await walletBalance();
    const back = await refund(second.booking.bookingId, {
      amountPaise: second.fare,
      reason: 'Ride cancelled by us',
      destination: 'ORIGINAL',
    });
    expect(back.body.data).toMatchObject({ destination: 'WALLET', status: 'PROCESSED' });
    expect(await walletBalance()).toBe(before + second.fare);
    expect((await Booking.findOne({ publicId: second.booking.bookingId }))!.paymentStatus).toBe(
      'REFUNDED',
    );
    expect(
      (await refund(second.booking.bookingId, { amountPaise: 1000, reason: 'again' })).status,
    ).toBe(422); // never more than was paid
    expect(env.razorpay.refundRequests).toHaveLength(0);
    await books();
  });

  it('two payments racing for the same balance: only one can spend it', async () => {
    const ride = await completedRide(env, world, rider, driver, 'ONLINE');
    await topUp(ride.fare > 5000 ? ride.fare : 5000); // exactly enough for the ride, not also for a tip
    const [a, b] = await Promise.all([
      api()
        .post(`/api/v1/bookings/${ride.booking.bookingId}/pay-from-wallet`)
        .set(rider.auth)
        .set('Idempotency-Key', idem())
        .send({}),
      tip(rider, ride.rideId, { amountPaise: 5000, source: 'WALLET' }),
    ]);
    const statuses = [a.status, b.status];
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.find((s) => s !== 201)).toBeGreaterThanOrEqual(402); // 402 not enough, or 409 busy
    expect(await walletBalance()).toBeGreaterThanOrEqual(0);
    await books();
  });

  it('a tip can be paid from the wallet', async () => {
    const ride = await completedRide(env, world, rider, driver);
    expect(
      (await tip(rider, ride.rideId, { amountPaise: 5000, source: 'WALLET' })).body.error.code,
    ).toBe('INSUFFICIENT_WALLET_BALANCE');
    await topUp(20_000);
    const before = await payable();
    const res = await tip(rider, ride.rideId, { amountPaise: 5000, source: 'WALLET' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'PAID', source: 'WALLET' });
    expect(await walletBalance()).toBe(15_000);
    expect(await payable()).toBe(before + 5000);
    await books();
  });

  it('staff can look at a rider’s wallet; nobody else can', async () => {
    await topUp(10_000);
    const support = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    const res = await api().get(`/api/v1/admin/wallets/${rider.userId}`).set(support.auth);
    expect(res.body.data.balancePaise).toBe(10_000);
    const stranger = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect(
      (await api().get(`/api/v1/admin/wallets/${rider.userId}`).set(stranger.auth)).status,
    ).toBe(403);
    expect(await walletBalance(stranger)).toBe(0); // and a rider only ever sees their own
  });
});
