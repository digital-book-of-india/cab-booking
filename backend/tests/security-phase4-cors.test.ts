import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { preflight } from '../src/tools/preflight';
import { allRealDrivers } from './liveEnv';
import { loginAs, nextPhone, startTestEnv, type TestEnv } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv(
    {},
    {
      corsOrigins: ['http://localhost:3000', 'https://admin.cabbooking.com'],
    },
  );
});
afterAll(async () => {
  if (env) {
    await env.stop();
  }
});

const api = () => request(env.app);

describe('Phase 4: CORS & API Security Hardening', () => {
  describe('Preflight OPTIONS Handling for Approved Origins', () => {
    it('returns 204 with strict CORS headers for approved localhost origin', async () => {
      const res = await api()
        .options('/api/v1/auth/me')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET')
        .set(
          'Access-Control-Request-Headers',
          'Content-Type, Authorization, Idempotency-Key, X-Request-Id',
        );

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(res.headers['vary']).toMatch(/Origin/i);
      expect(res.headers['access-control-allow-methods']).toMatch(/GET, ?POST, ?PUT, ?PATCH, ?DELETE, ?OPTIONS, ?HEAD/);
      expect(res.headers['access-control-allow-headers']).toMatch(/Content-Type/i);
      expect(res.headers['access-control-allow-headers']).toMatch(/Authorization/i);
      expect(res.headers['access-control-allow-headers']).toMatch(/Idempotency-Key/i);
      expect(res.headers['access-control-allow-headers']).toMatch(/X-Request-Id/i);
      expect(res.headers['access-control-max-age']).toBe('86400');
      // Must NOT allow credentials when using Bearer token architecture
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('returns 204 with strict CORS headers for approved production HTTPS origin', async () => {
      const res = await api()
        .options('/api/v1/admin/dashboard')
        .set('Origin', 'https://admin.cabbooking.com')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type, Authorization');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://admin.cabbooking.com');
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });
  });

  describe('Strict Origin Restriction (No Indiscriminate Reflection)', () => {
    it('does not reflect unapproved origins', async () => {
      const res = await api()
        .options('/api/v1/auth/me')
        .set('Origin', 'https://malicious-attacker.com')
        .set('Access-Control-Request-Method', 'GET');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('does not reflect subdomains or port variations that are not in the approved list', async () => {
      const wrongPort = await api()
        .options('/api/v1/auth/me')
        .set('Origin', 'http://localhost:4000')
        .set('Access-Control-Request-Method', 'GET');

      expect(wrongPort.headers['access-control-allow-origin']).toBeUndefined();

      const subDomain = await api()
        .options('/api/v1/auth/me')
        .set('Origin', 'https://sub.admin.cabbooking.com')
        .set('Access-Control-Request-Method', 'GET');

      expect(subDomain.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('does not allow null origin', async () => {
      const nullOrigin = await api()
        .options('/api/v1/auth/me')
        .set('Origin', 'null')
        .set('Access-Control-Request-Method', 'GET');

      expect(nullOrigin.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('Strict Header and Method Whitelisting', () => {
    it('whitelists only approved headers', async () => {
      const res = await api()
        .options('/api/v1/auth/me')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'X-Injected-Header, Authorization');

      // The configured allowedHeaders are explicitly returned
      expect(res.headers['access-control-allow-headers']).not.toContain('X-Injected-Header');
      expect(res.headers['access-control-allow-headers']).toMatch(/Authorization/i);
    });

    it('exposes X-Request-Id header to browser frontend', async () => {
      const res = await api()
        .get('/api/v1/health/live')
        .set('Origin', 'http://localhost:3000');

      expect(res.headers['access-control-expose-headers']).toContain('X-Request-Id');
    });
  });

  describe('Preflight Does Not Bypass Route Authentication', () => {
    it('OPTIONS succeeds with 204 but subsequent GET without token fails with 401', async () => {
      // 1. Preflight succeeds
      const preflightRes = await api()
        .options('/api/v1/admin/dashboard')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET');
      expect(preflightRes.status).toBe(204);

      // 2. Direct GET without authorization returns 401
      const getRes = await api()
        .get('/api/v1/admin/dashboard')
        .set('Origin', 'http://localhost:3000');
      expect(getRes.status).toBe(401);
      expect(getRes.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('preserves Bearer token authorization on actual authenticated cross-origin requests', async () => {
      const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
      const res = await api()
        .get('/api/v1/auth/me')
        .set('Origin', 'http://localhost:3000')
        .set(customer.auth);

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(res.body.data.id).toBe(customer.userId);
    });
  });

  describe('Environment Validation for CORS_ORIGINS', () => {
    const base = {
      ...allRealDrivers,
      NODE_ENV: 'production',
      REDIS_URL: 'redis://r:6379',
    };

    it('normalizes trailing slashes and trims whitespace in CORS_ORIGINS', () => {
      const parsed = loadEnv({
        ...base,
        CORS_ORIGINS: '  https://admin.example.com/ , https://rider.example.com///  ',
      });
      expect(parsed.CORS_ORIGINS).toEqual([
        'https://admin.example.com',
        'https://rider.example.com',
      ]);
    });

    it('fails safely if wildcard origin is provided in production or staging', () => {
      expect(() =>
        loadEnv({
          ...base,
          CORS_ORIGINS: '*',
        }),
      ).toThrow(/wildcard is not allowed/);
    });

    it('preflight blocks non-https and local origin in production', () => {
      const findings = preflight(loadEnv({ ...base, CORS_ORIGINS: 'http://insecure-admin.com' }));
      expect(findings.some((f: { setting: string; level: string }) => f.setting === 'CORS_ORIGINS' && f.level === 'BLOCK')).toBe(true);
    });

    it('fails safely if invalid origin URL is provided', () => {
      expect(() =>
        loadEnv({
          ...base,
          CORS_ORIGINS: 'not a valid url',
        }),
      ).toThrow(/invalid origin URL/);
    });

    it('parses empty CORS_ORIGINS into an empty array, failing closed for cross-origin callers', () => {
      const parsed = loadEnv({
        ...base,
        CORS_ORIGINS: '',
      });
      expect(parsed.CORS_ORIGINS).toEqual([]);
    });
  });
});
