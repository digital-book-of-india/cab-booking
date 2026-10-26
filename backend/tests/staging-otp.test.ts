import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from '../src/config/env';
import { nextPhone, startTestEnv, type TestEnv } from './helpers';

const baseEnv = {
  NODE_ENV: 'staging',
  MONGODB_URI: 'mongodb://localhost/x',
  REDIS_URL: 'redis://localhost',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  PROVIDER_MODE: 'mock',
};

describe('STAGING_FIXED_OTP configuration', () => {
  it('is accepted outside production and must be 6 digits', () => {
    expect(loadEnv({ ...baseEnv, STAGING_FIXED_OTP: '123456' }).STAGING_FIXED_OTP).toBe('123456');
    expect(() => loadEnv({ ...baseEnv, STAGING_FIXED_OTP: '12345' })).toThrow(EnvValidationError);
    expect(() => loadEnv({ ...baseEnv, STAGING_FIXED_OTP: 'abcdef' })).toThrow(EnvValidationError);
  });

  it('is refused in production', () => {
    expect(() =>
      loadEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        PROVIDER_MODE: 'live',
        STAGING_FIXED_OTP: '123456',
      }),
    ).toThrow(/STAGING_FIXED_OTP: not allowed in production/);
  });

  it('Redis is optional outside production but required in production', () => {
    const noRedis: Record<string, string> = { ...baseEnv };
    delete noRedis['REDIS_URL'];
    expect(loadEnv(noRedis).REDIS_URL).toBeUndefined();
    expect(() => loadEnv({ ...noRedis, NODE_ENV: 'production', PROVIDER_MODE: 'live' })).toThrow(
      /REDIS_URL: required in production/,
    );
  });
});

describe('login with a fixed staging OTP', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startTestEnv({ fixedOtp: '246810' });
  });
  afterAll(() => env.stop());
  beforeEach(() => env.reset());

  const api = () => request(env.app);

  it('the fixed code logs in; a wrong code still fails and counts as an attempt', async () => {
    const phone = nextPhone();
    const req = await api().post('/api/v1/auth/otp/request').send({ phone });
    const challengeId = req.body.data.challengeId;

    const wrong = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ challengeId, phone, otp: '000000', role: 'CUSTOMER' });
    expect(wrong.status).toBe(401);

    const right = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ challengeId, phone, otp: '246810', role: 'CUSTOMER' });
    expect(right.status).toBe(200);
    expect(right.body.data.accessToken).toBeTruthy();

    // Still single-use: the same fixed code cannot be replayed on the same challenge.
    const replay = await api()
      .post('/api/v1/auth/otp/verify')
      .send({ challengeId, phone, otp: '246810', role: 'CUSTOMER' });
    expect(replay.status).toBe(401);
  });
});
