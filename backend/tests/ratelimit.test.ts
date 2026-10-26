import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CP, IGI, loginAs, nextPhone, seedWorld, startTestEnv, type TestEnv } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv({}, { bookingRateLimitMax: 3, authRateLimitMax: 4 });
});
afterAll(() => env.stop());

describe('rate limits', () => {
  it('caps quote creation per user, independently for each user', async () => {
    const world = await seedWorld();
    const a = await loginAs(env, nextPhone(), 'CUSTOMER');
    const b = await loginAs(env, nextPhone(), 'CUSTOMER');
    const quote = (s: typeof a) =>
      request(env.app)
        .post('/api/v1/fare-quotes')
        .set(s.auth)
        .send({ pickup: CP, drop: IGI, categoryId: world.cats['MINI'] });

    // loginAs consumed the auth limiter budget on a different route, so this isolates the booking limiter.
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await quote(a)).status);
    expect(statuses).toEqual([201, 201, 201, 429, 429]);
    expect((await quote(b)).status).toBe(201);
  });

  it('caps OTP endpoints per IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (await request(env.app).post('/api/v1/auth/otp/request').send({ phone: '12' })).status,
      );
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(2);
  });
});
