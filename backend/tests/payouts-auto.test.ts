import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRazorpayXPayouts, normaliseStatus } from '../src/providers/razorpayx';
import { Payout } from '../src/modules/payouts/payout.model';
import {
  NEAR_CP,
  completedRide,
  createDriver,
  loginAs,
  loginAsAdmin,
  nextPhone,
  seedWorld,
  startTestEnv,
  type TestEnv,
} from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv({}, { financeConfig: { autoPayouts: true } });
});
afterAll(() => env.stop());

const api = () => request(env.app);

describe('automatic payouts', () => {
  it('pays an approved settlement by itself, only for a verified account, and only once', async () => {
    const world = await seedWorld();
    const rider = await loginAs(env, nextPhone(), 'CUSTOMER');
    const driver = await createDriver(env, world, { at: NEAR_CP });
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    const ride = await completedRide(env, world, rider, driver, 'ONLINE');
    const started = await api()
      .post(`/api/v1/bookings/${ride.booking.bookingId}/payments`)
      .set(rider.auth)
      .set('Idempotency-Key', `auto-${Date.now()}`)
      .send({});
    await env.razorpay.webhook(
      env.razorpay.captured(started.body.data.orderId, 'pay_auto', ride.fare),
    );
    const draft = await api()
      .post('/api/v1/admin/settlements')
      .set(fin.auth)
      .send({ driverId: driver.driverId });
    const id = draft.body.data.created[0].settlementId as string;
    await api().post(`/api/v1/admin/settlements/${id}/approve`).set(fin.auth).send({});

    // No verified account: the job leaves it alone.
    await env.runFinance();
    expect(await Payout.countDocuments({})).toBe(0);

    await api().put('/api/v1/drivers/me/payout-account').set(driver.auth).send({
      type: 'BANK',
      holderName: 'Ravi Kumar',
      accountNumber: '998877665544',
      ifsc: 'ICIC0000123',
    });
    await api()
      .post(`/api/v1/admin/drivers/${driver.driverId}/payout-account/review`)
      .set(fin.auth)
      .send({ decision: 'APPROVE' });

    await env.runFinance();
    expect(await Payout.countDocuments({})).toBe(1);
    expect(env.razorpayx.payouts).toHaveLength(1);
    await env.runFinance();
    await env.runFinance();
    expect(env.razorpayx.payouts).toHaveLength(1); // not sent again while it is on its way
  });
});

describe('the RazorpayX adapter', () => {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (String(url).endsWith('/contacts')) return new Response(JSON.stringify({ id: 'cont_1' }));
    if (String(url).endsWith('/fund_accounts')) return new Response(JSON.stringify({ id: 'fa_1' }));
    return new Response(JSON.stringify({ id: 'pout_1', status: 'queued', utr: null }));
  }) as unknown as typeof fetch;
  const provider = createRazorpayXPayouts({
    keyId: 'k',
    keySecret: 's',
    accountNumber: '2323230000000000',
    webhookSecret: 'whsec',
    fetchFn,
  });

  it('registers an account, sends with an idempotency header, and reads statuses', async () => {
    const fa = await provider.createFundAccount({
      referenceId: 'drv1',
      name: 'Ravi Kumar',
      destination: { type: 'BANK', accountNumber: '123456789012', ifsc: 'HDFC0001234' },
    });
    expect(fa).toEqual({ contactId: 'cont_1', fundAccountId: 'fa_1' });
    expect(calls[1]!.body).toMatchObject({ account_type: 'bank_account', contact_id: 'cont_1' });

    const p = await provider.createPayout({
      fundAccountId: 'fa_1',
      amountPaise: 123_400,
      referenceId: 'pyo_1',
      narration: 'Settlement',
      mode: 'IMPS',
      idempotencyKey: 'payout:stl_1:1',
    });
    expect(p).toEqual({ payoutId: 'pout_1', status: 'processing' });
    const sent = calls[2]!;
    expect(sent.headers['X-Payout-Idempotency']).toBe('payout:stl_1:1');
    expect(sent.body).toMatchObject({
      account_number: '2323230000000000',
      fund_account_id: 'fa_1',
      amount: 123_400,
      currency: 'INR',
      mode: 'IMPS',
    });
    expect(sent.headers['authorization']).toMatch(/^Basic /);
  });

  it('maps the many provider statuses to the few we act on, and checks webhook signatures', () => {
    expect(['queued', 'pending', 'processing', 'scheduled'].map(normaliseStatus)).toEqual(
      Array(4).fill('processing'),
    );
    expect(normaliseStatus('processed')).toBe('processed');
    expect(['failed', 'rejected', 'cancelled'].map(normaliseStatus)).toEqual(
      Array(3).fill('failed'),
    );
    expect(normaliseStatus('reversed')).toBe('reversed');
    expect(provider.verifyWebhookSignature(Buffer.from('{}'), '')).toBe(false);
    expect(provider.verifyWebhookSignature(Buffer.from('{}'), 'f'.repeat(64))).toBe(false);
  });
});
