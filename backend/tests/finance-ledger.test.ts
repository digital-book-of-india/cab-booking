import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/auditLog.model';
import { Booking } from '../src/modules/bookings/booking.model';
import type { LedgerService } from '../src/modules/ledger/ledger.service';
import { LedgerTransaction } from '../src/modules/ledger/ledgerTransaction.model';
import { Payment } from '../src/modules/payments/payment.model';
import { createRazorpayPayments } from '../src/providers/razorpay';
import {
  assignTo,
  completedRide,
  createDriver,
  loginAs,
  loginAsAdmin,
  nextPhone,
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
  env.razorpay.orders.length = 0;
  env.razorpay.refundRequests.length = 0;
  world = await seedWorld();
  customer = await loginAs(env, nextPhone(), 'CUSTOMER');
});

const api = () => request(env.app);
const ledger = () => (env.app.locals['services'] as { ledger: LedgerService }).ledger;
const balanceOf = async (account: string) => (await ledger().balances([account]))[account]!;
let keyN = 0;
const idem = () => `k-${Date.now()}-${++keyN}`;
const driverPosition = (d: TestDriver) => ledger().driverPosition(d.driverId);
const commissionOf = (fare: number) => Math.round(fare * 0.2);

async function payOnline(bookingId: string, fare: number, paymentId: string) {
  const started = await api()
    .post(`/api/v1/bookings/${bookingId}/payments`)
    .set(customer.auth)
    .set('Idempotency-Key', idem())
    .send({});
  expect(started.status).toBe(201);
  await env.razorpay.webhook(env.razorpay.captured(started.body.data.orderId, paymentId, fare));
  return started.body.data;
}

describe('settling a driver', () => {
  it('nets cash against earnings, pays the rest out, and leaves the books balanced', async () => {
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    const driver = await createDriver(env, world);
    const online = await completedRide(env, world, customer, driver, 'ONLINE');
    await payOnline(online.booking.bookingId, online.fare, 'pay_s1');
    const cash = await completedRide(env, world, customer, driver, 'CASH');
    await api()
      .post(`/api/v1/rides/${cash.rideId}/cash-collected`)
      .set(driver.auth)
      .send({ amountPaise: cash.fare });

    const payable = online.fare - commissionOf(online.fare) + cash.fare - commissionOf(cash.fare);
    expect(await driverPosition(driver)).toMatchObject({
      cashHeldPaise: cash.fare,
      payablePaise: payable,
    });

    const draft = await api()
      .post('/api/v1/admin/settlements')
      .set(fin.auth)
      .send({ driverId: driver.driverId });
    expect(draft.status).toBe(201);
    const s = draft.body.data.created[0];
    expect(s).toMatchObject({
      status: 'DRAFT',
      payablePaise: payable,
      cashHeldPaise: cash.fare,
      nettedPaise: cash.fare,
      payoutPaise: payable - cash.fare,
      depositDuePaise: 0,
    });
    // Only one open settlement per driver.
    expect(
      (
        await api()
          .post('/api/v1/admin/settlements')
          .set(fin.auth)
          .send({ driverId: driver.driverId })
      ).status,
    ).toBe(409);

    const approved = await api()
      .post(`/api/v1/admin/settlements/${s.settlementId}/approve`)
      .set(fin.auth)
      .send({});
    expect(approved.body.data.status).toBe('APPROVED');
    expect(await driverPosition(driver)).toMatchObject({
      cashHeldPaise: 0,
      payablePaise: s.payoutPaise,
    });

    const paid = await api()
      .post(`/api/v1/admin/settlements/${s.settlementId}/mark-paid`)
      .set(fin.auth)
      .send({ payoutReference: 'NEFT 998877' });
    expect(paid.body.data).toMatchObject({ status: 'PAID', payoutReference: 'NEFT 998877' });
    expect(await driverPosition(driver)).toMatchObject({ cashHeldPaise: 0, payablePaise: 0 });
    expect(await balanceOf('PLATFORM_BANK')).toBe(-s.payoutPaise);

    // Done twice does nothing more; nothing left to settle; a new open settlement is not blocked by the paid one.
    expect(
      (
        await api()
          .post(`/api/v1/admin/settlements/${s.settlementId}/mark-paid`)
          .set(fin.auth)
          .send({ payoutReference: 'again' })
      ).status,
    ).toBe(409);
    expect(
      (
        await api()
          .post('/api/v1/admin/settlements')
          .set(fin.auth)
          .send({ driverId: driver.driverId })
      ).status,
    ).toBe(422);
    expect((await api().get('/api/v1/admin/finance/consistency').set(fin.auth)).body.data.ok).toBe(
      true,
    );
    expect(await AuditLog.countDocuments({ action: { $regex: '^finance.settlement' } })).toBe(3);
    const own = await api().get('/api/v1/drivers/me/settlements').set(driver.auth);
    expect(own.body.data.map((x: { status: string }) => x.status)).toEqual(['PAID']);
  });

  it('a driver who holds more cash than they are owed still owes a deposit afterwards', async () => {
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    const driver = await createDriver(env, world);
    const ride = await completedRide(env, world, customer, driver, 'CASH');
    await api()
      .post(`/api/v1/rides/${ride.rideId}/cash-collected`)
      .set(driver.auth)
      .send({ amountPaise: ride.fare });
    const c = commissionOf(ride.fare);

    const s = (
      await api()
        .post('/api/v1/admin/settlements')
        .set(fin.auth)
        .send({ driverId: driver.driverId })
    ).body.data.created[0];
    expect(s).toMatchObject({ nettedPaise: ride.fare - c, payoutPaise: 0, depositDuePaise: c });
    await api().post(`/api/v1/admin/settlements/${s.settlementId}/approve`).set(fin.auth).send({});
    expect(await driverPosition(driver)).toMatchObject({ cashHeldPaise: c, payablePaise: 0 });

    const deposit = await api()
      .post(`/api/v1/admin/drivers/${driver.driverId}/cash-deposits`)
      .set(fin.auth)
      .set('Idempotency-Key', 'deposit-key-1')
      .send({ amountPaise: c, reference: 'slip 4411' });
    expect(deposit.status).toBe(201);
    expect(deposit.body.data).toMatchObject({ cashHeldPaise: 0, recorded: true });
    expect(await balanceOf('PLATFORM_BANK')).toBe(c);
    // Replaying the same deposit records nothing new; depositing more than is held is refused.
    const replay = await api()
      .post(`/api/v1/admin/drivers/${driver.driverId}/cash-deposits`)
      .set(fin.auth)
      .set('Idempotency-Key', 'deposit-key-1')
      .send({ amountPaise: c });
    expect(replay.body.data.recorded).toBe(false);
    expect(
      (
        await api()
          .post(`/api/v1/admin/drivers/${driver.driverId}/cash-deposits`)
          .set(fin.auth)
          .set('Idempotency-Key', 'deposit-key-2')
          .send({ amountPaise: 1 })
      ).status,
    ).toBe(422);
  });

  it('refuses to approve a draft whose balances moved, and only drafts can be cancelled', async () => {
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    const driver = await createDriver(env, world);
    const ride = await completedRide(env, world, customer, driver, 'CASH');
    await api()
      .post(`/api/v1/rides/${ride.rideId}/cash-collected`)
      .set(driver.auth)
      .send({ amountPaise: ride.fare });
    const s = (
      await api()
        .post('/api/v1/admin/settlements')
        .set(fin.auth)
        .send({ driverId: driver.driverId })
    ).body.data.created[0];
    // The driver hands the cash in before finance approves.
    await api()
      .post(`/api/v1/admin/drivers/${driver.driverId}/cash-deposits`)
      .set(fin.auth)
      .set('Idempotency-Key', 'dep-stale-1')
      .send({ amountPaise: ride.fare });
    const stale = await api()
      .post(`/api/v1/admin/settlements/${s.settlementId}/approve`)
      .set(fin.auth)
      .send({});
    expect(stale.status).toBe(409);
    expect(
      (
        await api()
          .post(`/api/v1/admin/settlements/${s.settlementId}/cancel`)
          .set(fin.auth)
          .send({})
      ).body.data.status,
    ).toBe('CANCELLED');
    expect(
      (
        await api()
          .post(`/api/v1/admin/settlements/${s.settlementId}/approve`)
          .set(fin.auth)
          .send({})
      ).status,
    ).toBe(409);
    expect(
      (
        await api()
          .post(`/api/v1/admin/settlements/${s.settlementId}/mark-paid`)
          .set(fin.auth)
          .send({ payoutReference: 'ref-1' })
      ).status,
    ).toBe(409);
  });

  it('can draft everyone at once, skipping those with nothing to settle, and is for finance only', async () => {
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    const driver = await createDriver(env, world);
    const ride = await completedRide(env, world, customer, driver, 'CASH');
    await api()
      .post(`/api/v1/rides/${ride.rideId}/cash-collected`)
      .set(driver.auth)
      .send({ amountPaise: ride.fare });
    const all = await api().post('/api/v1/admin/settlements').set(fin.auth).send({ all: true });
    expect(all.body.data.created).toHaveLength(1);
    expect(
      (
        await api()
          .post('/api/v1/admin/settlements')
          .set(fin.auth)
          .send({ all: true, driverId: driver.driverId })
      ).status,
    ).toBe(400);
    const support = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    for (const who of [support, customer, driver]) {
      expect((await api().get('/api/v1/admin/settlements').set(who.auth)).status).toBe(403);
      expect(
        (await api().post('/api/v1/admin/settlements').set(who.auth).send({ all: true })).status,
      ).toBe(403);
    }
    const list = (await api().get('/api/v1/admin/balances/drivers').set(fin.auth)).body.data;
    expect(list[0]).toMatchObject({ driverId: driver.driverId, cashHeldPaise: ride.fare });
  });
});

describe('writing off and disputing', () => {
  it('only a super admin can write off; the driver is still paid and the rider is released', async () => {
    const driver = await createDriver(env, world);
    const ride = await completedRide(env, world, customer, driver, 'ONLINE');
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    const root = await loginAsAdmin(env, nextPhone(), 'SUPER_ADMIN');
    const writeOff = (who: Session, reason = 'Rider unreachable after reminders') =>
      api()
        .post(`/api/v1/admin/bookings/${ride.booking.bookingId}/write-off`)
        .set(who.auth)
        .send({ reason });
    expect((await writeOff(fin)).status).toBe(403);
    expect((await writeOff(root, 'x')).status).toBe(400);
    const done = await writeOff(root);
    expect(done.body.data).toMatchObject({ paymentStatus: 'WRITTEN_OFF', amountPaise: ride.fare });
    expect(await balanceOf(`RIDER_RECEIVABLE:${customer.userId}`)).toBe(0);
    expect(await balanceOf('WRITE_OFFS')).toBe(ride.fare);
    expect(await balanceOf(`DRIVER_PAYABLE:${driver.driverId}`)).toBe(
      -(ride.fare - commissionOf(ride.fare)),
    );
    expect((await writeOff(root)).status).toBe(409); // once only
    expect(await AuditLog.countDocuments({ action: 'finance.write_off' })).toBe(1);
    // It can no longer be paid, and it no longer blocks the rider.
    const pay = await api()
      .post(`/api/v1/bookings/${ride.booking.bookingId}/payments`)
      .set(customer.auth)
      .set('Idempotency-Key', idem())
      .send({});
    expect(pay.status).toBe(409);
  });

  it('a paid booking cannot be written off', async () => {
    const driver = await createDriver(env, world);
    const ride = await completedRide(env, world, customer, driver, 'CASH');
    await api()
      .post(`/api/v1/rides/${ride.rideId}/cash-collected`)
      .set(driver.auth)
      .send({ amountPaise: ride.fare });
    const root = await loginAsAdmin(env, nextPhone(), 'SUPER_ADMIN');
    expect(
      (
        await api()
          .post(`/api/v1/admin/bookings/${ride.booking.bookingId}/write-off`)
          .set(root.auth)
          .send({ reason: 'Mistake' })
      ).status,
    ).toBe(409);
  });
});

describe('fees in the ledger', () => {
  it('a late-cancel fee is owed like a fare, shared with the driver, payable online, and waivable', async () => {
    const T0 = Date.now();
    const at = (s: number) => env.setNow(new Date(T0 + s * 1000));
    const ping = (d: Session) =>
      api().post('/api/v1/drivers/me/location').set(d.auth).send({ lat: 28.6335, lng: 77.2167 });
    at(0);
    const driver = await createDriver(env, world);
    const cancelLate = async (base: number) => {
      const booking = await requestRide(env, world, customer);
      const rideId = await assignTo(env, driver);
      at(base + 10);
      await rideCall(env, driver, rideId, 'en-route');
      at(base + 200);
      const res = await api()
        .post(`/api/v1/bookings/${booking.bookingId}/cancel`)
        .set(customer.auth)
        .send({ reasonCode: 'CHANGED_MIND' });
      expect(res.body.data.fee.amountPaise).toBe(3000);
      return booking;
    };
    const first = await cancelLate(0);
    const [t] = await LedgerTransaction.find({ kind: 'FEE_ACCRUAL' }).lean();
    expect(t!.entries.map((e) => e.amountPaise).sort((a, b) => a - b)).toEqual([-2400, -600, 3000]);
    expect(await balanceOf(`RIDER_RECEIVABLE:${customer.userId}`)).toBe(3000);

    // Pay it online like any other amount due.
    const p = await payOnline(first.bookingId, 3000, 'pay_fee1');
    expect(p).toMatchObject({ amountPaise: 3000, purpose: 'FEE' });
    expect(await balanceOf('GATEWAY')).toBe(3000);
    expect(await balanceOf(`RIDER_RECEIVABLE:${customer.userId}`)).toBe(0);

    // A second late cancel, waived by support: the rider is released, the driver is still paid.
    at(300);
    await ping(driver);
    const second = await cancelLate(300);
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    expect(
      (
        await api()
          .post(`/api/v1/admin/bookings/${second.bookingId}/fee/waive`)
          .set(ops.auth)
          .send({ reason: 'Driver arrived at the wrong gate' })
      ).status,
    ).toBe(200);
    expect(await balanceOf(`RIDER_RECEIVABLE:${customer.userId}`)).toBe(0);
    expect(await balanceOf('WAIVED_FEES')).toBe(3000);
    expect(await balanceOf(`DRIVER_PAYABLE:${driver.driverId}`)).toBe(-4800);
    expect((await Booking.findOne({ publicId: second.bookingId }).lean())?.paymentStatus).toBe(
      'NOT_DUE',
    );
  });
});

describe('the ledger can never be altered', () => {
  it('refuses edits, deletes, unbalanced and malformed transactions', async () => {
    const driver = await createDriver(env, world);
    await completedRide(env, world, customer, driver, 'CASH');
    const one = await LedgerTransaction.findOne().lean();
    expect(one).toBeTruthy();
    await expect(
      LedgerTransaction.updateOne({ _id: one!._id }, { description: 'edited' }),
    ).rejects.toThrow(/append-only/);
    await expect(
      LedgerTransaction.findOneAndUpdate({ _id: one!._id }, { description: 'x' }),
    ).rejects.toThrow(/append-only/);
    await expect(LedgerTransaction.deleteOne({ _id: one!._id })).rejects.toThrow(/append-only/);
    await expect(LedgerTransaction.deleteMany({})).rejects.toThrow(/append-only/);
    const base = { kind: 'CASH_DEPOSIT' as const, at: new Date() };
    const post = (idempotencyKey: string, entries: { account: string; amountPaise: number }[]) =>
      ledger().post({ ...base, idempotencyKey, entries });
    await expect(
      post('bad-1', [
        { account: 'A', amountPaise: 100 },
        { account: 'B', amountPaise: -99 },
      ]),
    ).rejects.toThrow(/does not balance/);
    await expect(post('bad-2', [{ account: 'A', amountPaise: 100 }])).rejects.toThrow(
      /at least two/,
    );
    await expect(
      post('bad-3', [
        { account: 'A', amountPaise: 10.5 },
        { account: 'B', amountPaise: -10.5 },
      ]),
    ).rejects.toThrow(/whole paise/);
    await expect(
      post('bad-4', [
        { account: 'A', amountPaise: 0 },
        { account: 'B', amountPaise: 0 },
      ]),
    ).rejects.toThrow(/non-zero/);
  });

  it('posting the same event twice records it once; the same key with other numbers is an error', async () => {
    const entries = [
      { account: 'X', amountPaise: 500 },
      { account: 'Y', amountPaise: -500 },
    ];
    const a = await ledger().post({
      kind: 'CASH_DEPOSIT',
      idempotencyKey: 'ev-1',
      entries,
      at: new Date(),
    });
    const b = await ledger().post({
      kind: 'CASH_DEPOSIT',
      idempotencyKey: 'ev-1',
      entries,
      at: new Date(),
    });
    expect(a.created).toBe(true);
    expect(b).toEqual({ txnId: a.txnId, created: false });
    await expect(
      ledger().post({
        kind: 'CASH_DEPOSIT',
        idempotencyKey: 'ev-1',
        entries: [
          { account: 'X', amountPaise: 600 },
          { account: 'Y', amountPaise: -600 },
        ],
        at: new Date(),
      }),
    ).rejects.toThrow(/reused with different entries/);
    expect(await LedgerTransaction.countDocuments({ idempotencyKey: 'ev-1' })).toBe(1);
  });

  it('only finance can read the ledger and the consistency report', async () => {
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    const support = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    const driver = await createDriver(env, world);
    const ride = await completedRide(env, world, customer, driver, 'CASH');
    const list = await api()
      .get(`/api/v1/admin/ledger?bookingId=${ride.booking.bookingId}`)
      .set(fin.auth);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].kind).toBe('RIDE_ACCRUAL');
    for (const path of ['/admin/ledger', '/admin/finance/consistency', '/admin/balances/drivers']) {
      expect((await api().get(`/api/v1${path}`).set(support.auth)).status, path).toBe(403);
      expect((await api().get(`/api/v1${path}`).set(customer.auth)).status, path).toBe(403);
    }
  });
});

describe('repairing what a crash leaves behind', () => {
  async function failNextLedgerWrite<T>(run: () => Promise<T>): Promise<T> {
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
      return await run();
    } finally {
      (LedgerTransaction as unknown as { create: unknown }).create = original;
    }
  }

  it('a ride whose accrual failed is recorded by the repair job, and the report notices until then', async () => {
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    const driver = await createDriver(env, world);
    const ride = await failNextLedgerWrite(() =>
      completedRide(env, world, customer, driver, 'CASH'),
    );
    expect(
      (await Booking.findOne({ publicId: ride.booking.bookingId }).lean())?.accrual,
    ).toBeUndefined();

    env.setNow(new Date(Date.now() + 60_000));
    const before = (await api().get('/api/v1/admin/finance/consistency').set(fin.auth)).body.data;
    expect(before).toMatchObject({ ok: false, completedRidesWithoutAccrual: 1 });
    await env.runFinance();
    expect(
      (await Booking.findOne({ publicId: ride.booking.bookingId }).lean())?.accrual?.amountPaise,
    ).toBe(ride.fare);
    expect(await balanceOf(`RIDER_RECEIVABLE:${customer.userId}`)).toBe(ride.fare);
    expect((await api().get('/api/v1/admin/finance/consistency').set(fin.auth)).body.data.ok).toBe(
      true,
    );
    await env.runFinance(); // running it again changes nothing
    expect(await LedgerTransaction.countDocuments({ kind: 'RIDE_ACCRUAL' })).toBe(1);
  });

  it('a payment confirmed but not recorded is completed by the repair job', async () => {
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    const driver = await createDriver(env, world);
    const ride = await completedRide(env, world, customer, driver, 'ONLINE');
    const started = (
      await api()
        .post(`/api/v1/bookings/${ride.booking.bookingId}/payments`)
        .set(customer.auth)
        .set('Idempotency-Key', idem())
        .send({})
    ).body.data;
    // Razorpay's confirmation reaches us, but the ledger write fails.
    const res = await failNextLedgerWrite(() =>
      api()
        .post('/api/v1/payments/verify')
        .set(customer.auth)
        .send({
          orderId: started.orderId,
          paymentId: 'pay_crash',
          signature: env.razorpay.sign(started.orderId, 'pay_crash'),
        }),
    );
    expect(res.status).toBe(500);
    const stuck = await Payment.findOne({ publicId: started.paymentId }).lean();
    expect(stuck).toMatchObject({ status: 'PAID' });
    expect(stuck?.ledgerRecordedAt).toBeUndefined();
    expect(await balanceOf('GATEWAY')).toBe(0);

    env.setNow(new Date(Date.now() + 60_000));
    expect((await api().get('/api/v1/admin/finance/consistency').set(fin.auth)).body.data.ok).toBe(
      false,
    );
    await env.runFinance();
    expect(await balanceOf('GATEWAY')).toBe(ride.fare);
    expect(await balanceOf(`RIDER_RECEIVABLE:${customer.userId}`)).toBe(0);
    expect((await api().get('/api/v1/admin/finance/consistency').set(fin.auth)).body.data.ok).toBe(
      true,
    );
    // The app can also simply retry: it gets the paid payment, not an error.
    const retry = await api()
      .post('/api/v1/payments/verify')
      .set(customer.auth)
      .send({
        orderId: started.orderId,
        paymentId: 'pay_crash',
        signature: env.razorpay.sign(started.orderId, 'pay_crash'),
      });
    expect(retry.status).toBe(200);
    expect(await LedgerTransaction.countDocuments({ kind: 'ONLINE_PAYMENT' })).toBe(1);
  });
});

describe('the Razorpay adapter', () => {
  const secret = 'key_secret_value';
  const webhookSecret = 'webhook_secret_value';
  const calls: { url: string; init: RequestInit }[] = [];
  const provider = createRazorpayPayments({
    keyId: 'rzp_test_abc',
    keySecret: secret,
    webhookSecret,
    fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith('/orders'))
        return new Response(JSON.stringify({ id: 'order_9' }), { status: 200 });
      if (String(url).includes('/refund'))
        return new Response(JSON.stringify({ id: 'rfnd_9', status: 'processed' }), { status: 200 });
      return new Response('{}', { status: 400 });
    }) as typeof fetch,
  });

  it('checks checkout signatures the way Razorpay defines them', () => {
    const sig = createHmac('sha256', secret).update('order_1|pay_1').digest('hex');
    expect(
      provider.verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: sig }),
    ).toBe(true);
    expect(
      provider.verifyPaymentSignature({ orderId: 'order_2', paymentId: 'pay_1', signature: sig }),
    ).toBe(false);
    expect(
      provider.verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_2', signature: sig }),
    ).toBe(false);
    expect(
      provider.verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: '' }),
    ).toBe(false);
    expect(
      provider.verifyPaymentSignature({
        orderId: 'order_1',
        paymentId: 'pay_1',
        signature: sig.slice(1),
      }),
    ).toBe(false);
  });

  it('checks webhooks over the exact bytes received', () => {
    const body = '{"event":"payment.captured","payload":{}}';
    const sig = createHmac('sha256', webhookSecret).update(body).digest('hex');
    expect(provider.verifyWebhookSignature(Buffer.from(body), sig)).toBe(true);
    expect(provider.verifyWebhookSignature(Buffer.from(body + ' '), sig)).toBe(false); // one byte changed
    expect(
      provider.verifyWebhookSignature(Buffer.from(JSON.stringify(JSON.parse(body))), sig),
    ).toBe(true);
    expect(
      provider.verifyWebhookSignature(
        Buffer.from('{"event": "payment.captured","payload":{}}'),
        sig,
      ),
    ).toBe(false); // re-formatted
    expect(provider.verifyWebhookSignature(Buffer.from(body), '')).toBe(false);
  });

  it('creates orders in paise with the account credentials, and maps refund results', async () => {
    expect(await provider.createOrder({ amountPaise: 25_000, receipt: 'pay_abc' })).toEqual({
      orderId: 'order_9',
    });
    const sent = calls.find((c) => c.url.endsWith('/orders'))!;
    expect(JSON.parse(String(sent.init.body))).toMatchObject({
      amount: 25_000,
      currency: 'INR',
      receipt: 'pay_abc',
    });
    expect((sent.init.headers as Record<string, string>)['authorization']).toBe(
      `Basic ${Buffer.from(`rzp_test_abc:${secret}`).toString('base64')}`,
    );
    expect(
      await provider.createRefund({ paymentId: 'pay_1', amountPaise: 500, receipt: 'rfd_1' }),
    ).toEqual({ refundId: 'rfnd_9', status: 'processed' });
    const broken = createRazorpayPayments({
      keyId: 'k',
      keySecret: 's',
      webhookSecret: 'w',
      fetchFn: (async () => new Response('{}', { status: 500 })) as typeof fetch,
    });
    await expect(broken.createOrder({ amountPaise: 100, receipt: 'r' })).rejects.toThrow(
      /order failed \(500\)/,
    );
  });
});
