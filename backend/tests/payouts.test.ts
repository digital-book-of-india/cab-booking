import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import type { LedgerService } from '../src/modules/ledger/ledger.service';
import { LedgerTransaction } from '../src/modules/ledger/ledgerTransaction.model';
import type { MonitorService } from '../src/modules/monitoring/monitor.service';
import { Notification } from '../src/modules/notifications/notification.model';
import { Payout, PayoutAccount } from '../src/modules/payouts/payout.model';
import { Settlement } from '../src/modules/settlements/settlement.model';
import {
  NEAR_CP,
  completedRide,
  createDriver,
  loginAs,
  loginAsAdmin,
  nextPhone,
  seedWorld,
  startTestEnv,
  type Session,
  type TestDriver,
  type TestEnv,
} from './helpers';

let env: TestEnv;
let world: Awaited<ReturnType<typeof seedWorld>>;
let rider: Session;
let driver: TestDriver;
let fin: Session;
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(() => env.stop());
beforeEach(async () => {
  await env.reset();
  env.razorpay.orders.length = 0;
  env.razorpayx.fundAccounts.length = 0;
  env.razorpayx.payouts.length = 0;
  env.razorpayx.failPayouts = false;
  env.razorpayx.payoutStatus = 'processing';
  world = await seedWorld();
  rider = await loginAs(env, nextPhone(), 'CUSTOMER');
  driver = await createDriver(env, world, { at: NEAR_CP });
  fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
});

const api = () => request(env.app);
const ledger = () => (env.app.locals['services'] as { ledger: LedgerService }).ledger;
const ACCOUNT_NUMBER = '123456789012';
const bank = {
  type: 'BANK',
  holderName: 'Ravi Kumar',
  accountNumber: ACCOUNT_NUMBER,
  ifsc: 'HDFC0001234',
};
let keyN = 0;
const idem = () => `k-${Date.now()}-${++keyN}`;

const setAccount = (body: object = bank, who: Session = driver) =>
  api().put('/api/v1/drivers/me/payout-account').set(who.auth).send(body);
const review = (decision: string, reason?: string, who = fin) =>
  api()
    .post(`/api/v1/admin/drivers/${driver.driverId}/payout-account/review`)
    .set(who.auth)
    .send({ decision, ...(reason ? { reason } : {}) });
const sendPayout = (settlementId: string, who = fin) =>
  api().post(`/api/v1/admin/settlements/${settlementId}/payout`).set(who.auth).send({});

/** A driver who is owed money: an online-paid ride, settled and approved. */
async function approvedSettlement(): Promise<{ settlementId: string; payoutPaise: number }> {
  const ride = await completedRide(env, world, rider, driver, 'ONLINE');
  const started = await api()
    .post(`/api/v1/bookings/${ride.booking.bookingId}/payments`)
    .set(rider.auth)
    .set('Idempotency-Key', idem())
    .send({});
  await env.razorpay.webhook(
    env.razorpay.captured(started.body.data.orderId, 'pay_for_payout', ride.fare),
  );
  const draft = await api()
    .post('/api/v1/admin/settlements')
    .set(fin.auth)
    .send({ driverId: driver.driverId });
  const s = draft.body.data.created[0];
  const approved = await api()
    .post(`/api/v1/admin/settlements/${s.settlementId}/approve`)
    .set(fin.auth)
    .send({});
  expect(approved.status).toBe(200);
  return { settlementId: s.settlementId, payoutPaise: s.payoutPaise };
}
async function verifiedAccount() {
  await setAccount();
  expect((await review('APPROVE')).status).toBe(200);
}
const books = async () => {
  expect(await ledger().checkBalance()).toEqual({
    ledgerTotalPaise: 0,
    unbalancedTransactions: [],
    completedRidesWithoutAccrual: 0,
  });
};
const payable = async () => (await ledger().driverPosition(driver.driverId)).payablePaise;

describe('the driver’s payout account', () => {
  it('is registered with the payout service; we keep only the last digits; finance must verify it', async () => {
    const res = await setAccount();
    expect(res.status).toBe(200);
    expect(res.body.data.account).toMatchObject({
      type: 'BANK',
      status: 'PENDING',
      maskedNumber: '••••9012',
      ifsc: 'HDFC0001234',
    });
    expect(env.razorpayx.fundAccounts).toHaveLength(1);
    // The full number is nowhere on our side: not in the answer, not in the database.
    expect(JSON.stringify(res.body)).not.toContain(ACCOUNT_NUMBER);
    expect(JSON.stringify(await PayoutAccount.find().lean())).not.toContain(ACCOUNT_NUMBER);

    expect(
      (await api().get('/api/v1/drivers/me/payout-account').set(driver.auth)).body.data.account
        .status,
    ).toBe('PENDING');
    expect((await review('REJECT')).status).toBe(400); // a reason is needed
    expect((await review('APPROVE')).body.data.account.status).toBe('ACTIVE');
    expect((await review('APPROVE')).status).toBe(409); // already decided

    // Changing the account puts it back under review.
    const upi = await setAccount({
      type: 'UPI',
      holderName: 'Ravi Kumar',
      vpa: 'ravi.kumar@okhdfc',
    });
    expect(upi.body.data.account).toMatchObject({ type: 'UPI', status: 'PENDING', ifsc: null });
    expect(upi.body.data.account.maskedNumber).toMatch(/^ra\*+@okhdfc$/);
  });

  it('refuses bad details and anyone who is not finance or the driver', async () => {
    expect((await setAccount({ ...bank, ifsc: 'bad' })).status).toBe(400);
    expect((await setAccount({ ...bank, accountNumber: '12ab' })).status).toBe(400);
    expect((await setAccount({ type: 'UPI', holderName: 'Ravi', vpa: 'nope' })).status).toBe(400);
    expect((await setAccount({ ...bank, extra: 1 })).status).toBe(400);
    await setAccount();
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    expect((await review('APPROVE', undefined, ops)).status).toBe(403);
    expect((await setAccount(bank, rider as unknown as TestDriver)).status).toBe(403);
    expect(
      (await api().get(`/api/v1/admin/drivers/${driver.driverId}/payout-account`).set(ops.auth))
        .status,
    ).toBe(403);
  });
});

describe('paying a settlement out', () => {
  it('sends the money once, completes on the bank’s confirmation, and the books balance', async () => {
    const { settlementId, payoutPaise } = await approvedSettlement();
    expect((await sendPayout(settlementId)).status).toBe(422); // no verified account yet
    await verifiedAccount();

    const sent = await sendPayout(settlementId);
    expect(sent.status).toBe(201);
    expect(sent.body.data).toMatchObject({
      status: 'PROCESSING',
      amountPaise: payoutPaise,
      attempt: 1,
    });
    expect(env.razorpayx.payouts).toHaveLength(1);
    expect(env.razorpayx.payouts[0]).toMatchObject({ amount: payoutPaise, mode: 'IMPS' });
    expect(await payable()).toBe(payoutPaise); // not recorded as paid until the bank confirms

    // Asking again returns the same payout; paying by hand now would pay twice, so it is refused.
    expect((await sendPayout(settlementId)).body.data.payoutId).toBe(sent.body.data.payoutId);
    expect(env.razorpayx.payouts).toHaveLength(1);
    const byHand = await api()
      .post(`/api/v1/admin/settlements/${settlementId}/mark-paid`)
      .set(fin.auth)
      .send({ payoutReference: 'MANUAL-1' });
    expect(byHand.status).toBe(409);

    // The bank confirms (twice: a replayed webhook changes nothing).
    const providerId = env.razorpayx.payouts[0]!.id;
    const done = env.razorpayx.event(providerId, 'payout.processed', { utr: 'UTR123456789' });
    const w1 = await env.razorpayx.webhook(done, { eventId: 'evx_1' });
    expect(w1.body.data.outcome).toBe('PROCESSED');
    expect((await env.razorpayx.webhook(done, { eventId: 'evx_1' })).body.data.outcome).toBe(
      'DUPLICATE',
    );

    const s = await Settlement.findOne({ publicId: settlementId });
    expect(s).toMatchObject({ status: 'PAID', payoutReference: 'UTR123456789' });
    expect(await payable()).toBe(0);
    expect(await LedgerTransaction.countDocuments({ kind: 'SETTLEMENT_PAYOUT' })).toBe(1);
    expect(await Notification.countDocuments({ type: 'payout.sent' })).toBe(1);
    const payouts = (
      await api().get(`/api/v1/admin/settlements/${settlementId}/payouts`).set(fin.auth)
    ).body.data;
    expect(payouts).toHaveLength(1);
    expect(payouts[0]).toMatchObject({ status: 'PAID', utr: 'UTR123456789' });
    expect((await sendPayout(settlementId)).status).toBe(409); // approved no longer
    await books();
  });

  it('a UPI account is paid by UPI', async () => {
    const { settlementId } = await approvedSettlement();
    await setAccount({ type: 'UPI', holderName: 'Ravi Kumar', vpa: 'ravi.kumar@okhdfc' });
    await review('APPROVE');
    await sendPayout(settlementId);
    expect(env.razorpayx.payouts[0]!.mode).toBe('UPI');
  });

  it('a failed payout leaves the settlement payable; a second attempt can succeed; finance is warned in between', async () => {
    const { settlementId, payoutPaise } = await approvedSettlement();
    await verifiedAccount();
    await sendPayout(settlementId);
    const monitor = (env.app.locals['services'] as { monitor: MonitorService }).monitor;
    const attention = async () =>
      (await monitor.checks()).find((c) => c.name === 'payouts_need_attention')!;
    expect((await attention()).ok).toBe(true);

    const failed = env.razorpayx.event(env.razorpayx.payouts[0]!.id, 'payout.failed', {
      failure_reason: 'Account closed',
    });
    expect((await env.razorpayx.webhook(failed)).body.data.outcome).toBe('FAILED');
    expect(await Payout.findOne({ attempt: 1 })).toMatchObject({
      status: 'FAILED',
      failureReason: 'Account closed',
    });
    expect(await Settlement.findOne({ publicId: settlementId })).toMatchObject({
      status: 'APPROVED',
    });
    expect(await payable()).toBe(payoutPaise); // still owed
    expect((await attention()).ok).toBe(false); // nobody has retried yet

    const retry = await sendPayout(settlementId);
    expect(retry.body.data).toMatchObject({ attempt: 2, status: 'PROCESSING' });
    expect(env.razorpayx.payouts).toHaveLength(2);
    expect(env.razorpayx.payouts[1]!.key).not.toBe(env.razorpayx.payouts[0]!.key); // a new request, not a repeat
    expect((await attention()).ok).toBe(true);
    await env.razorpayx.webhook(
      env.razorpayx.event(env.razorpayx.payouts[1]!.id, 'payout.processed', { utr: 'UTR999' }),
    );
    expect(await Settlement.findOne({ publicId: settlementId })).toMatchObject({ status: 'PAID' });
    expect(await payable()).toBe(0);
    await books();
  });

  it('an outage leaves the payout waiting, and the repair job sends it exactly once', async () => {
    const { settlementId } = await approvedSettlement();
    await verifiedAccount();
    env.razorpayx.failPayouts = true;
    expect((await sendPayout(settlementId)).status).toBe(502);
    expect(await Payout.findOne({})).toMatchObject({ status: 'CREATED' });
    expect(env.razorpayx.payouts).toHaveLength(0);

    env.razorpayx.failPayouts = false;
    env.setNow(new Date(Date.now() + 60_000));
    await env.runFinance();
    expect(await Payout.findOne({})).toMatchObject({ status: 'PROCESSING' });
    expect(env.razorpayx.payouts).toHaveLength(1);
    env.setNow(new Date(Date.now() + 120_000));
    await env.runFinance(); // nothing more to send
    expect(env.razorpayx.payouts).toHaveLength(1);
    expect(await Payout.countDocuments({})).toBe(1);
    env.setNow(null);
  });

  it('notices a payout the bank finished even if its webhook never arrived', async () => {
    const { settlementId } = await approvedSettlement();
    await verifiedAccount();
    await sendPayout(settlementId);
    env.razorpayx.payouts[0]!.status = 'processed'; // the bank did it; we were never told
    env.setNow(new Date(Date.now() + 11 * 60_000));
    await env.runFinance();
    expect(await Settlement.findOne({ publicId: settlementId })).toMatchObject({ status: 'PAID' });
    expect(await payable()).toBe(0);
    env.setNow(null);
    await books();
  });

  it('a payout the bank sends back after it was paid puts the money back on the driver’s balance', async () => {
    const { settlementId, payoutPaise } = await approvedSettlement();
    await verifiedAccount();
    await sendPayout(settlementId);
    const id = env.razorpayx.payouts[0]!.id;
    await env.razorpayx.webhook(env.razorpayx.event(id, 'payout.processed', { utr: 'UTR1' }));
    expect(await payable()).toBe(0);

    const back = await env.razorpayx.webhook(
      env.razorpayx.event(id, 'payout.reversed', {
        failure_reason: 'Beneficiary bank returned it',
      }),
    );
    expect(back.body.data.outcome).toBe('REVERSED');
    expect(await Payout.findOne({})).toMatchObject({ status: 'REVERSED' });
    expect(await payable()).toBe(payoutPaise); // owed again
    expect((await Settlement.findOne({ publicId: settlementId }))!.payoutReversedAt).toBeTruthy();
    expect(await LedgerTransaction.countDocuments({ kind: 'PAYOUT_REVERSAL' })).toBe(1);
    await env.razorpayx.webhook(env.razorpayx.event(id, 'payout.reversed'), { eventId: 'again' }); // repeat is harmless
    expect(await LedgerTransaction.countDocuments({ kind: 'PAYOUT_REVERSAL' })).toBe(1);
    await books();
  });

  it('refuses forged webhooks and ignores payouts it does not know', async () => {
    expect(
      (
        await env.razorpayx.webhook(env.razorpayx.event('pout_x', 'payout.processed'), {
          badSignature: true,
        })
      ).status,
    ).toBe(400);
    const unknown = await env.razorpayx.webhook(
      env.razorpayx.event('pout_unknown', 'payout.processed'),
    );
    expect(unknown.body.data.outcome).toBe('UNKNOWN_PAYOUT');
  });

  it('only finance can send money; a settlement with nothing to pay out is refused', async () => {
    const { settlementId } = await approvedSettlement();
    await verifiedAccount();
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    expect((await sendPayout(settlementId, ops)).status).toBe(403);
    expect((await sendPayout('stl_000000000000')).status).toBe(404);
  });
});

describe('start-up checks', () => {
  it('real payouts need all their settings', () => {
    const base = {
      NODE_ENV: 'development',
      MONGODB_URI: 'mongodb://x/y',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
    };
    expect(() => loadEnv({ ...base, PAYOUTS_DRIVER: 'razorpayx' })).toThrow(/RAZORPAYX_KEY_ID/);
    expect(loadEnv({ ...base, AUTO_PAYOUTS: 'true' }).AUTO_PAYOUTS).toBe(true);
    expect(loadEnv(base).AUTO_PAYOUTS).toBe(false);
  });
});
