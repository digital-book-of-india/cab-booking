import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { ACCESS_SECRET, loginAs, nextPhone, startTestEnv, type TestEnv } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv({}, { corsOrigins: ['https://admin.example.com'] });
});
afterAll(async () => {
  await env.stop();
});

const api = () => request(env.app);

describe('headers and cross-site rules', () => {
  it('hides the framework, sets safe headers, and tells proxies never to keep answers', async () => {
    const res = await api().get('/api/v1/health/live');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('allows only the listed web origin', async () => {
    const ok = await api()
      .options('/api/v1/auth/me')
      .set('Origin', 'https://admin.example.com')
      .set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe('https://admin.example.com');
    const evil = await api()
      .options('/api/v1/auth/me')
      .set('Origin', 'https://evil.example.com')
      .set('Access-Control-Request-Method', 'GET');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('hostile input', () => {
  it('refuses oversized and malformed bodies with a plain error, never a stack trace', async () => {
    const big = await api()
      .post('/api/v1/auth/otp/request')
      .send({ phone: '+919876543210', pad: 'x'.repeat(200_000) });
    expect(big.status).toBe(400);
    expect(big.body.error.message).toMatch(/too large/);
    const bad = await api()
      .post('/api/v1/auth/otp/request')
      .set('content-type', 'application/json')
      .send('{"phone": ');
    expect(bad.status).toBe(400);
    for (const res of [big, bad, await api().get('/api/v1/no/such/route')]) {
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).not.toMatch(
        /node_modules|at .*\.(ts|js):\d+|MongoServerError/,
      );
    }
  });

  it('does not let query or body objects act as database operators', async () => {
    const staff = await loginAs(env, nextPhone(), 'CUSTOMER');
    // An operator written into the query is just an unknown parameter: it is ignored, never run.
    const odd = await api().get('/api/v1/support/tickets?status[$ne]=OPEN').set(staff.auth);
    expect([200, 400]).toContain(odd.status);
    expect(odd.body.data ?? []).toEqual([]);
    const injected = await api()
      .post('/api/v1/auth/otp/request')
      .send({ phone: { $ne: null } });
    expect(injected.status).toBe(400);
    const proto = await api()
      .post('/api/v1/me/emergency-contacts')
      .set(staff.auth)
      .set('content-type', 'application/json')
      .send('{"name":"A B","phone":"+919812300001","__proto__":{"admin":true}}');
    expect(proto.status).toBe(400);
  });
});

describe('login tokens', () => {
  const call = (token: string) =>
    api().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);

  it('rejects unsigned, wrongly signed, expired and logged-out tokens', async () => {
    const s = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await call(s.accessToken)).status).toBe(200);

    const payload = jwt.decode(s.accessToken) as { sid: string };
    const unsigned = jwt.sign({ sid: payload.sid }, '', { algorithm: 'none' as never });
    const wrongKey = jwt.sign({ sid: payload.sid }, 'z'.repeat(32), { expiresIn: 600 });
    const expired = jwt.sign({ sid: payload.sid }, ACCESS_SECRET, { expiresIn: -10 });
    const otherAlg = jwt.sign({ sid: payload.sid }, ACCESS_SECRET, { algorithm: 'HS512' });
    for (const token of [unsigned, wrongKey, expired, otherAlg, 'garbage', '']) {
      expect((await call(token)).status, token.slice(0, 12)).toBe(401);
    }

    await api().post('/api/v1/auth/logout').set(s.auth).send({});
    expect((await call(s.accessToken)).status).toBe(401); // a copied token dies with the session
  });
});

describe('metrics endpoint', () => {
  it('does not exist unless a token is configured', async () => {
    expect((await api().get('/api/v1/metrics')).status).toBe(404);
    expect(
      (await api().get('/api/v1/metrics').set('Authorization', 'Bearer anything-at-all-1234'))
        .status,
    ).toBe(404);
  });
});

describe('unsafe settings are refused at start-up', () => {
  const base = {
    NODE_ENV: 'staging',
    MONGODB_URI: 'mongodb://x/y',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
  };
  it('no wildcard web origin outside development; the two token secrets must differ', () => {
    expect(() => loadEnv({ ...base, CORS_ORIGINS: '*' })).toThrow(/wildcard/);
    expect(() => loadEnv({ ...base, CORS_ORIGINS: 'https://a.example.com' })).not.toThrow();
    expect(() => loadEnv({ ...base, JWT_REFRESH_SECRET: 'a'.repeat(32) })).toThrow(/differ/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'development', CORS_ORIGINS: '*' })).not.toThrow();
  });
});
