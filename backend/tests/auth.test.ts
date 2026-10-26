import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OtpChallenge } from '../src/modules/auth/otp.model';
import { Session as SessionModel } from '../src/modules/auth/session.model';
import { User } from '../src/modules/users/user.model';
import { DriverProfile } from '../src/modules/drivers/driverProfile.model';
import { CustomerProfile } from '../src/modules/customers/customerProfile.model';
import { ACCESS_SECRET, loginAs, nextPhone, startTestEnv, type TestEnv } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(() => env.stop());
beforeEach(() => env.reset());

const api = () => request(env.app);

async function requestOtp(phone: string) {
  const res = await api().post('/api/v1/auth/otp/request').send({ phone });
  return res;
}

describe('OTP request', () => {
  it('returns a challenge, sends the SMS, and never stores the plaintext OTP', async () => {
    const phone = nextPhone();
    const res = await requestOtp(phone);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ expiresInSeconds: 300 });

    const otp = env.otps.get(phone)!;
    expect(otp).toMatch(/^\d{6}$/);
    const row = await OtpChallenge.findById(res.body.data.challengeId).lean();
    expect(row?.otpHash).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain(otp);
  });

  it('rejects an invalid phone number', async () => {
    const res = await requestOtp('12345');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unknown body fields', async () => {
    const res = await api()
      .post('/api/v1/auth/otp/request')
      .send({ phone: nextPhone(), role: 'SUPER_ADMIN' });
    expect(res.status).toBe(400);
  });
});

describe('OTP verify', () => {
  it('creates a customer on first login and issues tokens', async () => {
    const phone = nextPhone();
    const s = await loginAs(env, phone);
    const me = await api().get('/api/v1/auth/me').set(s.auth);
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({
      role: 'CUSTOMER',
      status: 'ACTIVE',
      profileComplete: false,
    });
    expect(await CustomerProfile.countDocuments({ userId: s.userId })).toBe(1);
  });

  it('creates a driver profile in PENDING state for DRIVER signups', async () => {
    const s = await loginAs(env, nextPhone(), 'DRIVER');
    const profile = await DriverProfile.findOne({ userId: s.userId }).lean();
    expect(profile?.approvalStatus).toBe('PENDING');
    expect(profile?.onlineStatus).toBe('OFFLINE');
  });

  it('refuses to self-register as an admin role', async () => {
    const phone = nextPhone();
    const r = await requestOtp(phone);
    const res = await api()
      .post('/api/v1/auth/otp/verify')
      .send({
        challengeId: r.body.data.challengeId,
        phone,
        otp: env.otps.get(phone),
        role: 'SUPER_ADMIN',
      });
    expect(res.status).toBe(400);
    expect(await User.countDocuments({ phone })).toBe(0);
  });

  it('rejects a wrong OTP, then locks the challenge after the attempt cap', async () => {
    const phone = nextPhone();
    const r = await requestOtp(phone);
    const good = env.otps.get(phone)!;
    const bad = good === '000000' ? '111111' : '000000';
    const attempt = (otp: string) =>
      api()
        .post('/api/v1/auth/otp/verify')
        .send({ challengeId: r.body.data.challengeId, phone, otp });

    for (let i = 0; i < 5; i++) {
      const res = await attempt(bad);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('OTP_INVALID');
    }
    const locked = await attempt(good);
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('OTP_ATTEMPTS_EXCEEDED');
    expect(await User.countDocuments({ phone })).toBe(0);
  });

  it('rejects an expired OTP', async () => {
    const phone = nextPhone();
    const r = await requestOtp(phone);
    await OtpChallenge.updateOne(
      { _id: r.body.data.challengeId },
      { expiresAt: new Date(Date.now() - 1000) },
    );
    const res = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ challengeId: r.body.data.challengeId, phone, otp: env.otps.get(phone) });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
  });

  it('allows an OTP to be used only once', async () => {
    const phone = nextPhone();
    const r = await requestOtp(phone);
    const body = { challengeId: r.body.data.challengeId, phone, otp: env.otps.get(phone) };
    expect((await api().post('/api/v1/auth/otp/verify').send(body)).status).toBe(200);
    const again = await api().post('/api/v1/auth/otp/verify').send(body);
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe('OTP_INVALID');
  });

  it('only one of two concurrent verifications succeeds', async () => {
    const phone = nextPhone();
    const r = await requestOtp(phone);
    const body = { challengeId: r.body.data.challengeId, phone, otp: env.otps.get(phone) };
    const results = await Promise.all([
      api().post('/api/v1/auth/otp/verify').send(body),
      api().post('/api/v1/auth/otp/verify').send(body),
    ]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 401]);
    expect(await User.countDocuments({ phone })).toBe(1);
  });

  it('does not accept an OTP with a different phone', async () => {
    const phone = nextPhone();
    const r = await requestOtp(phone);
    const res = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ challengeId: r.body.data.challengeId, phone: nextPhone(), otp: env.otps.get(phone) });
    expect(res.status).toBe(401);
  });

  it('rejects a role mismatch for an existing account', async () => {
    const phone = nextPhone();
    await loginAs(env, phone, 'CUSTOMER');
    const r = await requestOtp(phone);
    const res = await api()
      .post('/api/v1/auth/otp/verify')
      .send({
        challengeId: r.body.data.challengeId,
        phone,
        otp: env.otps.get(phone),
        role: 'DRIVER',
      });
    expect(res.status).toBe(403);
  });

  it('refuses login for a suspended account', async () => {
    const phone = nextPhone();
    await loginAs(env, phone);
    await User.updateOne({ phone }, { accountStatus: 'SUSPENDED' });
    const r = await requestOtp(phone);
    const res = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ challengeId: r.body.data.challengeId, phone, otp: env.otps.get(phone) });
    expect(res.status).toBe(403);
  });
});

describe('access control basics', () => {
  it('denies unauthenticated access', async () => {
    for (const path of [
      '/auth/me',
      '/auth/sessions',
      '/customers/me',
      '/drivers/me/application',
      '/admin/drivers',
    ]) {
      const res = await api().get(`/api/v1${path}`);
      expect(res.status, path).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('rejects garbage, foreign-secret, and expired tokens', async () => {
    const s = await loginAs(env, nextPhone());
    const sid = (jwt.decode(s.accessToken) as { sid: string }).sid;
    const forged = jwt.sign({ sid }, 'z'.repeat(32), { subject: s.userId, expiresIn: 60 });
    const expired = jwt.sign({ sid }, ACCESS_SECRET, { subject: s.userId, expiresIn: -10 });
    const noneAlg = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(
      JSON.stringify({ sub: s.userId, sid }),
    ).toString('base64url')}.`;
    for (const token of ['garbage', forged, expired, noneAlg]) {
      const res = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    }
  });

  it('applies account suspension to already-issued tokens immediately', async () => {
    const s = await loginAs(env, nextPhone());
    await User.updateOne({ _id: s.userId }, { accountStatus: 'SUSPENDED' });
    const res = await api().get('/api/v1/auth/me').set(s.auth);
    expect(res.status).toBe(403);
  });
});

describe('refresh and logout', () => {
  it('rotates the refresh token', async () => {
    const s = await loginAs(env, nextPhone());
    const res = await api().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).not.toBe(s.refreshToken);
    const me = await api()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${res.body.data.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('treats reuse of a rotated token as theft and revokes the session', async () => {
    const s = await loginAs(env, nextPhone());
    const first = await api().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    const replay = await api().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(replay.status).toBe(401);
    // The legitimate newest token is now dead too.
    const next = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.body.data.refreshToken });
    expect(next.status).toBe(401);
    const me = await api()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${first.body.data.accessToken}`);
    expect(me.status).toBe(401);
  });

  it('rejects a tampered refresh token', async () => {
    const s = await loginAs(env, nextPhone());
    const res = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: `${s.refreshToken}x` });
    expect(res.status).toBe(401);
  });

  it('logout revokes the session and its access token', async () => {
    const s = await loginAs(env, nextPhone());
    expect((await api().post('/api/v1/auth/logout').set(s.auth)).status).toBe(200);
    expect((await api().get('/api/v1/auth/me').set(s.auth)).status).toBe(401);
    expect(
      (await api().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken })).status,
    ).toBe(401);
  });

  it('stores only a hash of the refresh token', async () => {
    const s = await loginAs(env, nextPhone());
    const row = await SessionModel.findOne({ userId: s.userId }).lean();
    expect(JSON.stringify(row)).not.toContain(s.refreshToken.split('.')[1]);
  });
});

describe('sessions', () => {
  it('lists own sessions and revokes one', async () => {
    const phone = nextPhone();
    const a = await loginAs(env, phone);
    const b = await loginAs(env, phone);
    const list = await api().get('/api/v1/auth/sessions').set(a.auth);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.filter((x: { current: boolean }) => x.current)).toHaveLength(1);

    const other = list.body.data.find((x: { current: boolean }) => !x.current);
    expect((await api().delete(`/api/v1/auth/sessions/${other.id}`).set(a.auth)).status).toBe(200);
    expect((await api().get('/api/v1/auth/me').set(b.auth)).status).toBe(401);
  });

  it("cannot revoke another user's session", async () => {
    const a = await loginAs(env, nextPhone());
    const b = await loginAs(env, nextPhone());
    const bSession = (await api().get('/api/v1/auth/sessions').set(b.auth)).body.data[0];
    const res = await api().delete(`/api/v1/auth/sessions/${bSession.id}`).set(a.auth);
    expect(res.status).toBe(404);
    expect((await api().get('/api/v1/auth/me').set(b.auth)).status).toBe(200);
  });
});

describe('sanity', () => {
  it('runs against an isolated in-memory database', () => {
    expect(mongoose.connection.name).toMatch(/^test_[0-9a-f]{12}$/);
  });
});
