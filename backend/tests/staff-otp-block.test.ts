import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { User } from '../src/modules/users/user.model';
import { loginAs, nextPhone, startTestEnv, type TestEnv } from './helpers';
import { normalizePhone } from '../src/common/phone';
import { allRealDrivers } from './liveEnv';

/** The production setting: staff may not sign in with a phone code. */
let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv({ staffOtpLogin: false });
});
afterAll(() => env.stop());

describe('staff and phone codes', () => {
  it('a staff member cannot sign in with a phone code, but riders and drivers still can', async () => {
    const phone = nextPhone();
    await User.create({ phone, role: 'SUPER_ADMIN', name: 'Root', phoneVerifiedAt: new Date() });
    const req = await request(env.app).post('/api/v1/auth/otp/request').send({ phone });
    const verify = await request(env.app)
      .post('/api/v1/auth/otp/verify')
      .send({
        challengeId: req.body.data.challengeId,
        phone,
        otp: env.otps.get(normalizePhone(phone)!),
      });
    expect(verify.status).toBe(403);
    expect(verify.body.error.message).toMatch(/email, password and an authenticator/);
    expect((await loginAs(env, nextPhone(), 'CUSTOMER')).accessToken).toBeTruthy();
    expect((await loginAs(env, nextPhone(), 'DRIVER')).accessToken).toBeTruthy();
  });
});

describe('start-up', () => {
  const base = {
    MONGODB_URI: 'mongodb://x/y',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
  };
  const production = {
    ...allRealDrivers,
    ...base,
    NODE_ENV: 'production',
    REDIS_URL: 'redis://x:6379',
  };

  it('production refuses to allow staff phone codes, and defaults to not allowing them', () => {
    expect(() => loadEnv({ ...production, STAFF_OTP_LOGIN: 'true' })).toThrow(/STAFF_OTP_LOGIN/);
    expect(loadEnv(production).STAFF_OTP_LOGIN).toBe(false);
  });

  it('outside production staff phone codes are allowed by default (for development)', () => {
    expect(loadEnv({ ...base, NODE_ENV: 'development' }).STAFF_OTP_LOGIN).toBe(true);
    expect(
      loadEnv({ ...base, NODE_ENV: 'staging', STAFF_OTP_LOGIN: 'false' }).STAFF_OTP_LOGIN,
    ).toBe(false);
  });

  it('real email needs all its settings', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'development', EMAIL_DRIVER: 'smtp' })).toThrow(
      /SMTP_HOST/,
    );
  });
});
