import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Booking } from '../src/modules/bookings/booking.model';
import { LedgerTransaction } from '../src/modules/ledger/ledgerTransaction.model';
import type { LedgerService } from '../src/modules/ledger/ledger.service';
import { Payment } from '../src/modules/payments/payment.model';
import { Refund } from '../src/modules/payments/refund.model';
import { WebhookEvent } from '../src/modules/payments/webhookEvent.model';
import {
  FAR_FROM_CP,
  assignTo,
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
let customer: Session;
/** One driver does every ride in a test, so offers always go to the same person. */
let sharedDriver: TestDriver | null = null;
beforeAll(async () => {
  env = await startTestEnv({}, { devPayments: true });
});
afterAll(() => env.stop());
beforeEach(async () => {
  await env.reset();
  env.razorpay.orders.length = 0;
  env.razorpay.refundRequests.length = 0;
  env.razorpay.failOrders = false;
  env.razorpay.failRefunds = false;
  env.razorpay.refundStatus = 'pending';
  world = await seedWorld();
  sharedDriver = null;
  customer = await loginAs(env, nextPhone(), 'CUSTOMER');
});

const api = () => request(env.app);
const ledger = () => (env.app.locals['services'] as { ledger: LedgerService }).ledger;
const balanceOf = async (account: string) => (await ledger().balances([account]))[account]!;
let keyN = 0;
const idem = () => `k-${Date.now()}-${++keyN}`;

/** A finished ride, ready to be paid. */
async function completedRide(
  opts: { method?: 'CASH' | 'ONLINE'; driver?: TestDriver; who?: Session } = {},
) {
  const rider = opts.who ?? customer;
  const driver = opts.driver ?? (sharedDriver ??= await createDriver(env, world));
  const booking = await requestRide(env, world, rider, { paymentMethod: opts.method ?? 'CASH' });
  const rideId = await assignTo(env, driver);
  await startRide(env, rider, driver, rideId);
  const done = await rideCall(env, driver, rideId, 'complete');
  expect(done.status).toBe(200);
  return { driver, booking, rideId, fare: done.body.data.finalFarePaise as number, rider };
}
const startPay = (bookingId: string, who: Session = customer, key = idem()) =>
  api()
    .post(`/api/v1/bookings/${bookingId}/payments`)
    .set(who.auth)
    .set('Idempotency-Key', key)
    .send({});
const bookingDoc = (id: string) => Booking.findOne({ publicId: id }).lean();
const txns = (kind: string) => LedgerTransaction.find({ kind: kind as never }).lean();

describe('what a completed ride puts in the ledger', () => {
  it('records the fare owed, the driver’s share and the platform’s commission, and the books balance', async () => {
    const { booking, fare, driver } = await completedRide();
    const [t] = await txns('RIDE_ACCRUAL');
    expect(t).toBeTruthy();
    const commission = Math.round(fare * 0.2);
    expect(t!.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          account: `RIDER_RECEIVABLE:${customer.userId}`,
          amountPaise: fare,
        }),
        expect.objectContaining({
          account: `DRIVER_PAYABLE:${driver.driverId}`,
          amountPaise: -(fare - commission),
        }),
        expect.objectContaining({ account: 'COMMISSION', amountPaise: -commission }),
      ]),
    );
    expect(t!.entries.reduce((n, e) => n + e.amountPaise, 0)).toBe(0);
    const doc = await bookingDoc(booking.bookingId);
    expect(doc?.accrual).toMatchObject({
      kind: 'RIDE',
      amountPaise: fare,
      commissionPaise: commission,
    });
    expect(doc?.commission).toMatchObject({ rateBp: 2000 });

    // The rider sees what they owe; the driver sees what they earned.
    const bal = (await api().get('/api/v1/customers/me/balance').set(customer.auth)).body.data;
    expect(bal).toMatchObject({ unpaidPaise: fare, blocked: false });
    expect(bal.items[0]).toMatchObject({
      bookingId: booking.bookingId,
      amountPaise: fare,
      payable: true,
    });
    const view = (await api().get(`/api/v1/bookings/${booking.bookingId}`).set(customer.auth)).body
      .data;
    expect(view.amountDuePaise).toBe(fare);
    const earn = (await api().get('/api/v1/drivers/me/earnings').set(driver.auth)).body.data;
    expect(earn.totals).toEqual({
      chargedPaise: fare,
      commissionPaise: commission,
      earningsPaise: fare - commission,
      tipsPaise: 0,
      tipCount: 0,
    });
    expect(earn.items[0]).toMatchObject({
      bookingId: booking.bookingId,
      earningsPaise: fare - commission,
    });
  });

  it('uses the commission rate in force when the booking was made', async () => {
    const config = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    const first = await completedRide();
    const set = await api()
      .post('/api/v1/admin/pricing/commission')
      .set(config.auth)
      .send({ zoneId: world.zoneId, rateBp: 1000, changeReason: 'Promotion' });
    expect(set.status).toBe(201);
    expect(set.body.data).toMatchObject({ version: 1, ratePercent: 10 });
    const second = await completedRide({ driver: first.driver });
    expect((await bookingDoc(first.booking.bookingId))?.accrual?.commissionPaise).toBe(
      Math.round(first.fare * 0.2),
    );
    expect((await bookingDoc(second.booking.bookingId))?.accrual?.commissionPaise).toBe(
      Math.round(second.fare * 0.1),
    );
    expect(
      (
        await api()
          .post('/api/v1/admin/pricing/commission')
          .set(config.auth)
          .send({ zoneId: world.zoneId, rateBp: 9000, changeReason: 'Too high' })
      ).status,
    ).toBe(400);
  });
});

describe('paying online', () => {
  it('the server sets the amount; only a valid signature marks the booking paid', async () => {
    const { booking, fare } = await completedRide({ method: 'ONLINE' });
    const started = await startPay(booking.bookingId);
    expect(started.status).toBe(201);
    const p = started.body.data;
    expect(p).toMatchObject({
      amountPaise: fare,
      status: 'CREATED',
      purpose: 'FARE',
      currency: 'INR',
    });
    expect(p.checkout).toMatchObject({
      key: env.razorpay.keyId,
      orderId: p.orderId,
      amountPaise: fare,
    });
    expect(env.razorpay.orders).toEqual([
      expect.objectContaining({ amount: fare, receipt: p.paymentId }),
    ]);
    expect((await bookingDoc(booking.bookingId))?.paymentStatus).toBe('PROCESSING');

    // A forged or wrong signature does nothing.
    const bad = await api()
      .post('/api/v1/payments/verify')
      .set(customer.auth)
      .send({ orderId: p.orderId, paymentId: 'pay_fake1', signature: 'a'.repeat(64) });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('PAYMENT_SIGNATURE_INVALID');
    expect((await bookingDoc(booking.bookingId))?.paymentStatus).toBe('PROCESSING');
    expect(await txns('ONLINE_PAYMENT')).toHaveLength(0);

    const ok = await api()
      .post('/api/v1/payments/verify')
      .set(customer.auth)
      .send({
        orderId: p.orderId,
        paymentId: 'pay_rzp_1',
        signature: env.razorpay.sign(p.orderId, 'pay_rzp_1'),
      });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ status: 'PAID' });
    const doc = await bookingDoc(booking.bookingId);
    expect(doc).toMatchObject({ paymentStatus: 'PAID', paidBy: p.paymentId });
    // Money: held at the gateway, and the rider owes nothing.
    expect(await balanceOf('GATEWAY')).toBe(fare);
    expect(await balanceOf(`RIDER_RECEIVABLE:${customer.userId}`)).toBe(0);
    expect(
      (await api().get('/api/v1/customers/me/balance').set(customer.auth)).body.data.unpaidPaise,
    ).toBe(0);

    // Confirming again, or the webhook arriving after, changes nothing.
    const again = await api()
      .post('/api/v1/payments/verify')
      .set(customer.auth)
      .send({
        orderId: p.orderId,
        paymentId: 'pay_rzp_1',
        signature: env.razorpay.sign(p.orderId, 'pay_rzp_1'),
      });
    expect(again.status).toBe(200);
    await env.razorpay.webhook(env.razorpay.captured(p.orderId, 'pay_rzp_1', fare));
    expect(await txns('ONLINE_PAYMENT')).toHaveLength(1);
    expect(await balanceOf('GATEWAY')).toBe(fare);
  });

  it('retrying with the same key, or while one is open, gives the same order; nothing else can be paid', async () => {
    const { booking } = await completedRide({ method: 'ONLINE' });
    const key = idem();
    const a = await startPay(booking.bookingId, customer, key);
    const b = await startPay(booking.bookingId, customer, key);
    const c = await startPay(booking.bookingId, customer, idem()); // a different key, still in progress
    expect(b.body.data.paymentId).toBe(a.body.data.paymentId);
    expect(c.body.data.paymentId).toBe(a.body.data.paymentId);
    expect(env.razorpay.orders).toHaveLength(1);
    // The same key cannot be used for another booking.
    const other = await completedRide({ method: 'ONLINE' });
    expect((await startPay(other.booking.bookingId, customer, key)).body.error.code).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
  });

  it('is the rider’s own business, and only for something that is owed', async () => {
    const { booking } = await completedRide({ method: 'ONLINE' });
    const stranger = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await startPay(booking.bookingId, stranger)).status).toBe(404);
    const driver = await createDriver(env, world, { at: FAR_FROM_CP });
    expect((await startPay(booking.bookingId, driver)).status).toBe(403);
    const searching = await requestRide(env, world, customer);
    expect((await startPay(searching.bookingId)).status).toBe(409); // not completed: nothing owed
    const p = (await startPay(booking.bookingId)).body.data;
    await api()
      .post('/api/v1/payments/verify')
      .set(customer.auth)
      .send({
        orderId: p.orderId,
        paymentId: 'pay_x1',
        signature: env.razorpay.sign(p.orderId, 'pay_x1'),
      });
    expect((await startPay(booking.bookingId)).status).toBe(409); // already paid
    // Someone else cannot read or confirm this payment.
    expect((await api().get(`/api/v1/payments/${p.paymentId}`).set(stranger.auth)).status).toBe(
      404,
    );
    expect(
      (
        await api()
          .post('/api/v1/payments/verify')
          .set(stranger.auth)
          .send({
            orderId: p.orderId,
            paymentId: 'pay_x1',
            signature: env.razorpay.sign(p.orderId, 'pay_x1'),
          })
      ).status,
    ).toBe(404);
  });

  it('a payment-provider outage leaves the booking payable', async () => {
    const { booking } = await completedRide({ method: 'ONLINE' });
    env.razorpay.failOrders = true;
    const res = await startPay(booking.bookingId);
    expect(res.status).toBe(502);
    expect((await bookingDoc(booking.bookingId))?.paymentStatus).toBe('DUE');
    env.razorpay.failOrders = false;
    expect((await startPay(booking.bookingId)).status).toBe(201);
  });

  it('an abandoned attempt is closed after half an hour and the booking is payable again', async () => {
    const { booking } = await completedRide({ method: 'ONLINE' });
    const p = (await startPay(booking.bookingId)).body.data;
    env.setNow(new Date(Date.now() + 31 * 60_000));
    await env.runFinance();
    expect((await Payment.findOne({ publicId: p.paymentId }).lean())?.status).toBe('EXPIRED');
    expect((await bookingDoc(booking.bookingId))?.paymentStatus).toBe('DUE');
    const fresh = await startPay(booking.bookingId);
    expect(fresh.body.data.paymentId).not.toBe(p.paymentId);
  });

  it('development: a mock payment can be completed only when that is switched on', async () => {
    const { booking, fare } = await completedRide({ method: 'ONLINE' });
    const p = (await startPay(booking.bookingId)).body.data;
    const done = await api()
      .post(`/api/v1/dev/payments/${p.paymentId}/complete`)
      .set(customer.auth)
      .send({});
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('PAID');
    expect(await balanceOf('GATEWAY')).toBe(fare);
  });
});

describe('Razorpay’s webhook', () => {
  it('settles a payment even if the app never confirmed it', async () => {
    const { booking, fare } = await completedRide({ method: 'ONLINE' });
    const p = (await startPay(booking.bookingId)).body.data;
    const res = await env.razorpay.webhook(env.razorpay.captured(p.orderId, 'pay_w1', fare));
    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('PAID');
    expect((await bookingDoc(booking.bookingId))?.paymentStatus).toBe('PAID');
    expect((await Payment.findOne({ publicId: p.paymentId }).lean())?.providerPaymentId).toBe(
      'pay_w1',
    );
  });

  it('ignores a replay of the same event and refuses a bad signature', async () => {
    const { booking, fare } = await completedRide({ method: 'ONLINE' });
    const p = (await startPay(booking.bookingId)).body.data;
    const body = env.razorpay.captured(p.orderId, 'pay_w2', fare);
    expect((await env.razorpay.webhook(body, { eventId: 'evt_same' })).body.data.outcome).toBe(
      'PAID',
    );
    const replay = await env.razorpay.webhook(body, { eventId: 'evt_same' });
    expect(replay.status).toBe(200);
    expect(replay.body.data.outcome).toBe('DUPLICATE');
    expect(await txns('ONLINE_PAYMENT')).toHaveLength(1);
    expect(await WebhookEvent.countDocuments({ eventId: 'evt_same' })).toBe(1);

    const forged = await env.razorpay.webhook(env.razorpay.captured(p.orderId, 'pay_w3', fare), {
      badSignature: true,
    });
    expect(forged.status).toBe(400);
    expect(forged.body.error.code).toBe('PAYMENT_SIGNATURE_INVALID');
  });

  it('does not accept a payment for the wrong amount, or for an order we never made', async () => {
    const { booking, fare } = await completedRide({ method: 'ONLINE' });
    const p = (await startPay(booking.bookingId)).body.data;
    const short = await env.razorpay.webhook(
      env.razorpay.captured(p.orderId, 'pay_w4', fare - 100),
    );
    expect(short.body.data.outcome).toBe('AMOUNT_MISMATCH');
    expect((await bookingDoc(booking.bookingId))?.paymentStatus).toBe('PROCESSING');
    expect(
      (await env.razorpay.webhook(env.razorpay.captured('order_nobody', 'pay_w5', 100))).body.data
        .outcome,
    ).toBe('UNKNOWN_ORDER');
    expect(await txns('ONLINE_PAYMENT')).toHaveLength(0);
  });

  it('a failed payment makes the booking payable again', async () => {
    const { booking } = await completedRide({ method: 'ONLINE' });
    const p = (await startPay(booking.bookingId)).body.data;
    const failed = await env.razorpay.webhook({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: { id: 'pay_f1', order_id: p.orderId, error_description: 'Card declined' },
        },
      },
    });
    expect(failed.body.data.outcome).toBe('FAILED');
    expect((await Payment.findOne({ publicId: p.paymentId }).lean())?.status).toBe('FAILED');
    expect((await bookingDoc(booking.bookingId))?.paymentStatus).toBe('DUE');
    expect((await startPay(booking.bookingId)).body.data.paymentId).not.toBe(p.paymentId);
  });

  it('a delivery that crashed half-way is processed on Razorpay’s retry, not skipped', async () => {
    const { booking, fare } = await completedRide({ method: 'ONLINE' });
    const p = (await startPay(booking.bookingId)).body.data;
    // First delivery fails inside our code (simulated), so the event must not stay "seen".
    const original = LedgerTransaction.create.bind(LedgerTransaction);
    let blown = false;
    (LedgerTransaction as unknown as { create: unknown }).create = async (...args: unknown[]) => {
      if (!blown) {
        blown = true;
        throw new Error('database blip');
      }
      return (original as (...a: unknown[]) => unknown)(...args);
    };
    try {
      const first = await env.razorpay.webhook(env.razorpay.captured(p.orderId, 'pay_w6', fare), {
        eventId: 'evt_retry',
      });
      expect(first.status).toBe(500);
    } finally {
      (LedgerTransaction as unknown as { create: unknown }).create = original;
    }
    expect(await WebhookEvent.countDocuments({ eventId: 'evt_retry' })).toBe(0);
    const retry = await env.razorpay.webhook(env.razorpay.captured(p.orderId, 'pay_w6', fare), {
      eventId: 'evt_retry',
    });
    expect(retry.status).toBe(200);
    expect(await txns('ONLINE_PAYMENT')).toHaveLength(1);
    expect(await balanceOf('GATEWAY')).toBe(fare);
  });
});

describe('paying in cash', () => {
  const collect = (d: Session, rideId: string, amountPaise: number) =>
    api().post(`/api/v1/rides/${rideId}/cash-collected`).set(d.auth).send({ amountPaise });

  it('the driver confirms the exact fare; the cash is theirs to hand over and the commission is theirs to owe', async () => {
    const { driver, rideId, fare, booking } = await completedRide();
    const res = await collect(driver, rideId, fare);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ paymentStatus: 'PAID', cashHeldPaise: fare });
    expect((await bookingDoc(booking.bookingId))?.paymentStatus).toBe('PAID');
    const commission = Math.round(fare * 0.2);
    expect(await balanceOf(`DRIVER_CASH:${driver.driverId}`)).toBe(fare);
    expect(await balanceOf(`RIDER_RECEIVABLE:${customer.userId}`)).toBe(0);
    // Net: the driver holds the fare, we owe them their share, so they owe us the commission.
    const bal = (await api().get('/api/v1/drivers/me/balance').set(driver.auth)).body.data;
    expect(bal).toMatchObject({
      cashHeldPaise: fare,
      payablePaise: fare - commission,
      netOwedToPlatformPaise: commission,
    });
    // A repeat of the same confirmation is harmless.
    expect((await collect(driver, rideId, fare)).status).toBe(200);
    expect(await txns('CASH_COLLECTED')).toHaveLength(1);
  });

  it('refuses a different amount, an online ride, a ride that is not finished, and another driver’s ride', async () => {
    const { driver, rideId, fare } = await completedRide();
    expect((await collect(driver, rideId, fare - 100)).status).toBe(422);
    expect((await collect(driver, rideId, fare + 100)).status).toBe(422);
    const other = await createDriver(env, world, { at: FAR_FROM_CP });
    expect((await collect(other, rideId, fare)).status).toBe(404);
    expect(
      (
        await api()
          .post(`/api/v1/rides/${rideId}/cash-collected`)
          .set(customer.auth)
          .send({ amountPaise: fare })
      ).status,
    ).toBe(403);

    const online = await completedRide({ method: 'ONLINE', driver });
    expect((await collect(driver, online.rideId, online.fare)).status).toBe(409);

    const running = await requestRide(env, world, customer);
    const runningRide = await assignTo(env, driver);
    expect(running.bookingId).toBeTruthy();
    expect((await collect(driver, runningRide, 10000)).status).toBe(409);
  });

  it('cannot be taken while an online payment is in progress, nor after the rider paid online', async () => {
    const { driver, rideId, fare, booking } = await completedRide({ method: 'CASH' });
    const p = (await startPay(booking.bookingId)).body.data; // the rider chose to pay online after all
    expect((await collect(driver, rideId, fare)).status).toBe(409);
    await env.razorpay.webhook(env.razorpay.captured(p.orderId, 'pay_c1', fare));
    expect((await collect(driver, rideId, fare)).status).toBe(409);
    expect(await txns('CASH_COLLECTED')).toHaveLength(0);
  });

  it('if the rider’s online payment lands after cash was taken, it goes straight back', async () => {
    const { driver, rideId, fare, booking } = await completedRide({ method: 'CASH' });
    const p = (await startPay(booking.bookingId)).body.data;
    env.setNow(new Date(Date.now() + 31 * 60_000)); // the attempt is abandoned...
    await env.runFinance();
    expect((await collect(driver, rideId, fare)).status).toBe(200); // ...so the driver takes cash
    // ...but the rider had in fact paid, and Razorpay tells us late.
    const late = await env.razorpay.webhook(env.razorpay.captured(p.orderId, 'pay_late', fare));
    expect(late.body.data.outcome).toBe('PAID');
    const refund = await Refund.findOne({
      paymentId: (await Payment.findOne({ publicId: p.paymentId }))!._id,
    }).lean();
    expect(refund).toMatchObject({ amountPaise: fare, status: 'REQUESTED' });
    expect(env.razorpay.refundRequests).toEqual([{ paymentId: 'pay_late', amount: fare }]);
    // The cash payment still stands as the one that settled the booking.
    expect(await bookingDoc(booking.bookingId)).toMatchObject({
      paymentStatus: 'PAID',
      paidBy: expect.stringMatching(/^CASH:/),
    });
  });
});

describe('refunds', () => {
  async function paidOnline() {
    const ride = await completedRide({ method: 'ONLINE' });
    const p = (await startPay(ride.booking.bookingId)).body.data;
    await env.razorpay.webhook(env.razorpay.captured(p.orderId, 'pay_r1', ride.fare));
    return { ...ride, payment: p };
  }
  const refund = (who: Session, bookingId: string, amountPaise: number, key = idem()) =>
    api()
      .post(`/api/v1/admin/bookings/${bookingId}/refund`)
      .set(who.auth)
      .set('Idempotency-Key', key)
      .send({ amountPaise, reason: 'Wrong route taken' });
  const refundEvent = (event: string, id: string) => ({
    event,
    payload: { refund: { entity: { id } } },
  });

  it('goes through Razorpay, never exceeds what was paid, and is recorded when Razorpay confirms', async () => {
    const { booking, fare } = await paidOnline();
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    const part = Math.floor(fare / 3);
    const first = await refund(fin, booking.bookingId, part);
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ amountPaise: part, status: 'REQUESTED' });
    expect(env.razorpay.refundRequests).toEqual([{ paymentId: 'pay_r1', amount: part }]);
    expect((await bookingDoc(booking.bookingId))?.paymentStatus).toBe('REFUND_PENDING');
    expect(await txns('REFUND')).toHaveLength(0); // not recorded until Razorpay confirms

    await env.razorpay.webhook(refundEvent('refund.processed', 'rfnd_test_1'));
    expect(await balanceOf('GATEWAY')).toBe(fare - part);
    expect(await balanceOf('REFUNDS')).toBe(part);
    expect((await bookingDoc(booking.bookingId))?.paymentStatus).toBe('PAID'); // partial: still paid

    // More than is left is refused; exactly the rest is allowed and finishes the booking.
    expect((await refund(fin, booking.bookingId, fare - part + 1)).status).toBe(422);
    expect((await refund(fin, booking.bookingId, fare - part)).status).toBe(201);
    await env.razorpay.webhook(refundEvent('refund.processed', 'rfnd_test_2'));
    expect((await bookingDoc(booking.bookingId))?.paymentStatus).toBe('REFUNDED');
    expect(await balanceOf('GATEWAY')).toBe(0);
    expect(await balanceOf('REFUNDS')).toBe(fare);
  });

  it('the same key returns the same refund; two at once cannot add up to more than was paid', async () => {
    const { booking, fare } = await paidOnline();
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    const key = idem();
    const a = await refund(fin, booking.bookingId, fare, key);
    const b = await refund(fin, booking.bookingId, fare, key);
    expect(b.body.data.refundId).toBe(a.body.data.refundId);
    expect(env.razorpay.refundRequests).toHaveLength(1);

    const second = await paidOnline();
    const [x, y] = await Promise.all([
      refund(fin, second.booking.bookingId, second.fare),
      refund(fin, second.booking.bookingId, second.fare),
    ]);
    expect([x.status, y.status].sort()).toEqual([201, 422]);
    expect(
      (await Payment.findOne({ publicId: second.payment.paymentId }).lean())?.refundedPaise,
    ).toBe(second.fare);
  });

  it('a refused or failed refund releases the amount so it can be tried again', async () => {
    const { booking, fare, payment } = await paidOnline();
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    env.razorpay.failRefunds = true;
    const down = await refund(fin, booking.bookingId, fare);
    expect(down.status).toBe(502);
    expect((await Payment.findOne({ publicId: payment.paymentId }).lean())?.refundedPaise).toBe(0);
    env.razorpay.failRefunds = false;
    const ok = await refund(fin, booking.bookingId, fare);
    expect(ok.status).toBe(201);
    await env.razorpay.webhook(refundEvent('refund.failed', 'rfnd_test_1'));
    expect((await Payment.findOne({ publicId: payment.paymentId }).lean())?.refundedPaise).toBe(0);
    expect((await bookingDoc(booking.bookingId))?.paymentStatus).toBe('PAID');
  });

  it('is for finance only, and only for something paid online', async () => {
    const { booking, fare } = await paidOnline();
    const support = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    expect((await refund(support, booking.bookingId, 100)).status).toBe(403);
    expect((await refund(customer, booking.bookingId, 100)).status).toBe(403);
    const cash = await completedRide({ method: 'CASH' });
    expect((await refund(fin, cash.booking.bookingId, 100)).status).toBe(422);
    expect((await refund(fin, 'bk_000000000000', 100)).status).toBe(404);
    expect(
      (
        await api()
          .post(`/api/v1/admin/bookings/${booking.bookingId}/refund`)
          .set(fin.auth)
          .send({ amountPaise: fare, reason: 'x' })
      ).status,
    ).toBe(400); // no key
  });
});

describe('an unpaid ride stops the next booking', () => {
  it('only once it is a day old, and paying (or a dispute or write-off) lifts it', async () => {
    const ride = await completedRide({ method: 'ONLINE' });
    // Fresh: the rider can still book.
    const soon = await requestRide(env, world, customer);
    await api()
      .post(`/api/v1/bookings/${soon.bookingId}/cancel`)
      .set(customer.auth)
      .send({ reasonCode: 'CHANGED_MIND' });

    env.setNow(new Date(Date.now() + 25 * 3_600_000));
    const quote = await api()
      .post('/api/v1/fare-quotes')
      .set(customer.auth)
      .send({
        pickup: { lat: 28.6315, lng: 77.2167 },
        drop: { lat: 28.5562, lng: 77.1 },
        categoryId: world.cats['MINI'],
      });
    const attempt = () =>
      api()
        .post('/api/v1/bookings')
        .set(customer.auth)
        .set('Idempotency-Key', idem())
        .send({ quoteId: quote.body.data.quoteId, paymentMethod: 'CASH' });
    const blocked = await attempt();
    expect(blocked.status).toBe(402);
    expect(blocked.body.error.code).toBe('UNPAID_BALANCE');
    expect(
      (await api().get('/api/v1/customers/me/balance').set(customer.auth)).body.data.blocked,
    ).toBe(true);

    // A dispute lifts the block (support is looking into it)...
    const support = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    expect(
      (
        await api()
          .patch(`/api/v1/admin/bookings/${ride.booking.bookingId}/payment-dispute`)
          .set(support.auth)
          .send({ disputed: true, reason: 'Rider disputes the route' })
      ).status,
    ).toBe(200);
    // ...and closing it puts it back.
    await api()
      .patch(`/api/v1/admin/bookings/${ride.booking.bookingId}/payment-dispute`)
      .set(support.auth)
      .send({ disputed: false, reason: 'Checked, fare stands' });
    expect((await attempt()).status).toBe(402);

    // Paying clears it.
    const p = (await startPay(ride.booking.bookingId)).body.data;
    await env.razorpay.webhook(env.razorpay.captured(p.orderId, 'pay_u1', ride.fare));
    expect((await attempt()).status).toBe(201);
  });
});
