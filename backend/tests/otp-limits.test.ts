import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OtpChallenge } from '../src/modules/auth/otp.model';
import { nextPhone, startTestEnv, type TestEnv } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv({ otpResendSeconds: 30, otpMaxPerHour: 2 });
});
afterAll(() => env.stop());

const requestOtp = (phone: string) =>
  request(env.app).post('/api/v1/auth/otp/request').send({ phone });

describe('OTP request limits', () => {
  it('enforces the resend cooldown per phone', async () => {
    const phone = nextPhone();
    expect((await requestOtp(phone)).status).toBe(201);
    const second = await requestOtp(phone);
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('RATE_LIMITED');
    // A different phone is unaffected.
    expect((await requestOtp(nextPhone())).status).toBe(201);
  });
});

describe('hourly cap', () => {
  it('blocks requests beyond the hourly limit', async () => {
    const phone = nextPhone();
    const old = new Date(Date.now() - 60_000);
    const normalized = `+91${phone.slice(3)}`;
    await OtpChallenge.create([
      { phone: normalized, otpHash: 'x', expiresAt: new Date(Date.now() + 1000), createdAt: old },
      { phone: normalized, otpHash: 'y', expiresAt: new Date(Date.now() + 1000), createdAt: old },
    ]);
    const res = await requestOtp(phone);
    expect(res.status).toBe(429);
  });
});
