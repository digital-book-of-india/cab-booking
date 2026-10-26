import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LedgerService } from '../src/modules/ledger/ledger.service';
import { LedgerTransaction } from '../src/modules/ledger/ledgerTransaction.model';
import { Notification } from '../src/modules/notifications/notification.model';
import { Payment } from '../src/modules/payments/payment.model';
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
beforeAll(async () => {
  env = await startTestEnv({}, { financeConfig: { walletBonusBp: 500 } }); // 5% bonus, min Rs 500, max Rs 100
});
afterAll(() => env.stop());
beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
  rider = await loginAs(env, nextPhone(), 'CUSTOMER');
  driver = await createDriver(env, world, { at: NEAR_CP });
});

const api = () => request(env.app);
const ledger = () => (env.app.locals['services'] as { ledger: LedgerService }).ledger;
let keyN = 0;
const idem = () => `k-${Date.now()}-${++keyN}`;
let payN = 0;

describe('a tip handed over in cash', () => {
  it('is recorded and the driver is told, but no money moves through the platform', async () => {
    const ride = await completedRide(env, world, rider, driver);
    const before = (await ledger().driverPosition(driver.driverId)).payablePaise;
    const res = await api()
      .post(`/api/v1/rides/${ride.rideId}/tip`)
      .set(rider.auth)
      .set('Idempotency-Key', idem())
      .send({ amountPaise: 3000, source: 'CASH' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'PAID', source: 'CASH', amountPaise: 3000 });

    expect(await Payment.countDocuments({ purpose: 'TIP' })).toBe(0);
    expect((await ledger().driverPosition(driver.driverId)).payablePaise).toBe(before);
    expect(await LedgerTransaction.countDocuments({ kind: 'TIP_PAYMENT' })).toBe(0);
    const note = await Notification.findOne({ type: 'tip.received' });
    expect(note!.body).toMatch(/in cash/);
    // It is not counted as money the platform paid out, nor as platform revenue.
    const earn = (await api().get('/api/v1/drivers/me/earnings').set(driver.auth)).body.data;
    expect(earn.totals.tipsPaise).toBe(0);
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    expect(
      (await api().get('/api/v1/admin/analytics/revenue').set(fin.auth)).body.data.totals.tipsPaise,
    ).toBe(0);
    // One tip per ride, whatever way it was given.
    const again = await api()
      .post(`/api/v1/rides/${ride.rideId}/tip`)
      .set(rider.auth)
      .set('Idempotency-Key', idem())
      .send({ amountPaise: 2000, source: 'ONLINE' });
    expect(again.status).toBe(409);
    expect(
      (await api().get(`/api/v1/rides/${ride.rideId}/tip`).set(driver.auth)).body.data.tip,
    ).toMatchObject({ source: 'CASH', amountPaise: 3000 });
  });
});

describe('wallet top-up bonus', () => {
  const topup = async (amountPaise: number, eventId?: string) => {
    const started = await api()
      .post('/api/v1/wallet/topups')
      .set(rider.auth)
      .set('Idempotency-Key', idem())
      .send({ amountPaise });
    payN += 1;
    const body = env.razorpay.captured(started.body.data.orderId, `pay_bonus_${payN}`, amountPaise);
    await env.razorpay.webhook(body, eventId ? { eventId } : {});
    return env.razorpay.webhook(body, { eventId: eventId ?? `again-${payN}` }); // delivered twice
  };
  const balance = async () => (await api().get('/api/v1/wallet').set(rider.auth)).body.data;

  it('adds 5% to a big enough top-up, never more than the cap, and only once', async () => {
    await topup(100_000); // Rs 1,000 -> 5% = Rs 50
    expect((await balance()).balancePaise).toBe(105_000);
    await topup(20_000); // under the Rs 500 minimum: no bonus
    expect((await balance()).balancePaise).toBe(125_000);
    await topup(400_000); // 5% would be Rs 200: capped at Rs 100
    const wallet = await balance();
    expect(wallet.balancePaise).toBe(125_000 + 400_000 + 10_000);
    expect(
      wallet.entries
        .filter((e: { kind: string }) => e.kind === 'WALLET_BONUS')
        .map((e: { amountPaise: number }) => e.amountPaise)
        .sort((a: number, b: number) => a - b),
    ).toEqual([5000, 10_000]);
    expect(await LedgerTransaction.countDocuments({ kind: 'WALLET_BONUS' })).toBe(2);
    // The platform paid for it, and the books balance.
    expect((await ledger().balances(['PROMOTIONS']))['PROMOTIONS']).toBe(15_000);
    expect(await ledger().checkBalance()).toEqual({
      ledgerTotalPaise: 0,
      unbalancedTransactions: [],
      completedRidesWithoutAccrual: 0,
    });
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    expect((await api().get('/api/v1/admin/finance/consistency').set(fin.auth)).body.data.ok).toBe(
      true,
    );
  });
});
