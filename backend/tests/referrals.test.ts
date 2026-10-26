import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FeatureFlag } from '../src/modules/flags/featureFlag.model';
import { Coupon } from '../src/modules/coupons/coupon.model';
import { loginAs, nextPhone, startTestEnv, type Session, type TestEnv } from './helpers';

let env: TestEnv;
let rider1: Session;
let rider2: Session;
let rider3: Session;

beforeAll(async () => {
  env = await startTestEnv();
});

afterAll(() => env.stop());

beforeEach(async () => {
  await env.reset();
  rider1 = await loginAs(env, nextPhone(), 'CUSTOMER');
  rider2 = await loginAs(env, nextPhone(), 'CUSTOMER');
  rider3 = await loginAs(env, nextPhone(), 'CUSTOMER');
});

const api = () => request(env.app);

describe('Customer Referrals Feature', () => {
  it('rejects unauthenticated access to referrals', async () => {
    const res = await api().get('/api/v1/customers/me/referrals');
    expect(res.status).toBe(401);
  });

  it('generates a unique referral code and shareable link on first access', async () => {
    const res = await api()
      .get('/api/v1/customers/me/referrals')
      .set(rider1.auth);

    expect(res.status).toBe(200);
    expect(res.body.data.code).toBeDefined();
    expect(res.body.data.code).toMatch(/^REF-[A-Z0-9]{6}$/);
    expect(res.body.data.shareUrl).toContain(res.body.data.code);
    expect(res.body.data.totalReferred).toBe(0);
    expect(res.body.data.rewardHistory).toEqual([]);

    // Second call returns the identical referral code
    const res2 = await api()
      .get('/api/v1/customers/me/referrals')
      .set(rider1.auth);
    expect(res2.status).toBe(200);
    expect(res2.body.data.code).toBe(res.body.data.code);
  });

  it('prevents self-referral', async () => {
    const getRes = await api()
      .get('/api/v1/customers/me/referrals')
      .set(rider1.auth);
    const code = getRes.body.data.code;

    const claimRes = await api()
      .post('/api/v1/customers/me/referrals/claim')
      .set(rider1.auth)
      .send({ code });

    expect(claimRes.status).toBe(422);
    expect(claimRes.body.error.message).toMatch(/cannot (use your own|refer yourself)/i);
  });

  it('allows a referee to claim a valid referral code and issues rewards', async () => {
    const getRes = await api()
      .get('/api/v1/customers/me/referrals')
      .set(rider1.auth);
    const code = getRes.body.data.code;

    const claimRes = await api()
      .post('/api/v1/customers/me/referrals/claim')
      .set(rider2.auth)
      .send({ code });

    expect(claimRes.status).toBe(200);
    expect(claimRes.body.data.status).toBe('CLAIMED');
    expect(claimRes.body.data.rewardPaise).toBeGreaterThan(0);
    expect(claimRes.body.data.couponCode).toBeDefined();

    // Verify referrer stats updated
    const referrerStats = await api()
      .get('/api/v1/customers/me/referrals')
      .set(rider1.auth);
    expect(referrerStats.body.data.totalReferred).toBe(1);
    expect(referrerStats.body.data.totalEarnedPaise).toBe(claimRes.body.data.rewardPaise);
    expect(referrerStats.body.data.rewardHistory.length).toBe(1);

    // Verify referee's coupon was created in database
    const coupon = await Coupon.findOne({ code: claimRes.body.data.couponCode });
    expect(coupon).toBeDefined();
    expect(coupon?.active).toBe(true);
  });

  it('prevents duplicate claims by the same referee (one-time eligibility)', async () => {
    const getRes1 = await api().get('/api/v1/customers/me/referrals').set(rider1.auth);
    const code1 = getRes1.body.data.code;

    const getRes3 = await api().get('/api/v1/customers/me/referrals').set(rider3.auth);
    const code3 = getRes3.body.data.code;

    // First claim succeeds
    const claim1 = await api()
      .post('/api/v1/customers/me/referrals/claim')
      .set(rider2.auth)
      .send({ code: code1 });
    expect(claim1.status).toBe(200);

    // Claiming same code again fails with 409
    const claimDuplicate = await api()
      .post('/api/v1/customers/me/referrals/claim')
      .set(rider2.auth)
      .send({ code: code1 });
    expect(claimDuplicate.status).toBe(409);

    // Claiming another code also fails with 409
    const claimAnother = await api()
      .post('/api/v1/customers/me/referrals/claim')
      .set(rider2.auth)
      .send({ code: code3 });
    expect(claimAnother.status).toBe(409);
  });

  it('rejects invalid or non-existent referral codes', async () => {
    const res = await api()
      .post('/api/v1/customers/me/referrals/claim')
      .set(rider2.auth)
      .send({ code: 'REF-NONEXIST' });

    expect(res.status).toBe(404);
  });

  it('enforces feature flag: returns 403 when REFERRALS feature is disabled', async () => {
    // Disable REFERRALS flag
    await FeatureFlag.updateOne({ key: 'REFERRALS' }, { enabled: false }, { upsert: true });

    const getRes = await api()
      .get('/api/v1/customers/me/referrals')
      .set(rider1.auth);
    expect(getRes.status).toBe(403);
    expect(getRes.body.error.code).toBe('FEATURE_DISABLED');

    const claimRes = await api()
      .post('/api/v1/customers/me/referrals/claim')
      .set(rider2.auth)
      .send({ code: 'REF-123456' });
    expect(claimRes.status).toBe(403);
    expect(claimRes.body.error.code).toBe('FEATURE_DISABLED');
  });

  it('enforces referral cap (maximum referrals per customer)', async () => {
    const getRes = await api().get('/api/v1/customers/me/referrals').set(rider1.auth);
    const code = getRes.body.data.code;

    // Simulate 10 referees claiming
    for (let i = 0; i < 10; i++) {
      const refUser = await loginAs(env, nextPhone(), 'CUSTOMER');
      const claim = await api()
        .post('/api/v1/customers/me/referrals/claim')
        .set(refUser.auth)
        .send({ code });
      expect(claim.status).toBe(200);
    }

    // 11th claim reaches cap
    const refUser11 = await loginAs(env, nextPhone(), 'CUSTOMER');
    const claim11 = await api()
      .post('/api/v1/customers/me/referrals/claim')
      .set(refUser11.auth)
      .send({ code });
    expect(claim11.status).toBe(422);
    expect(claim11.body.error.message).toMatch(/limit reached/i);
  });
});
