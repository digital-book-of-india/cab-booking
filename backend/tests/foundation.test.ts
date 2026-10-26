import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createLogger } from '../src/common/logger';
import { AppError } from '../src/common/errors';
import { EnvValidationError, loadEnv } from '../src/config/env';
import { createProviders } from '../src/providers';
import { authConfigFromEnv } from '../src/modules/auth/auth.config';

const logger = createLogger('silent');
const baseEnv = {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://localhost/test',
  REDIS_URL: 'redis://localhost',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

function makeApp(opts: { mongoUp?: boolean; shuttingDown?: boolean } = {}) {
  const { mongoUp = true, shuttingDown = false } = opts;
  return createApp({
    logger,
    providers: createProviders({ NODE_ENV: 'test', PROVIDER_MODE: 'mock' }),
    authConfig: authConfigFromEnv(loadEnv(baseEnv)),
    corsOrigins: ['http://localhost:3000'],
    isShuttingDown: () => shuttingDown,
    readinessChecks: [
      {
        name: 'mongo',
        check: async () => {
          if (!mongoUp) throw new Error('down');
        },
      },
      { name: 'redis', check: async () => {} },
    ],
  });
}

describe('health', () => {
  it('live returns 200 with envelope and request id', async () => {
    const res = await request(makeApp()).get('/api/v1/health/live');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.meta.requestId).toBe(res.headers['x-request-id']);
  });

  it('ready returns 200 when dependencies are up', async () => {
    const res = await request(makeApp()).get('/api/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.data.dependencies).toEqual({ mongo: 'up', redis: 'up' });
  });

  it('ready returns 503 when a dependency is down', async () => {
    const res = await request(makeApp({ mongoUp: false })).get('/api/v1/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.body.data.dependencies.mongo).toBe('down');
  });

  it('ready returns 503 while shutting down', async () => {
    const res = await request(makeApp({ shuttingDown: true })).get('/api/v1/health/ready');
    expect(res.status).toBe(503);
  });
});

describe('error handling', () => {
  it('unknown route returns the standard error envelope', async () => {
    const res = await request(makeApp()).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('malformed JSON returns 400 VALIDATION_ERROR', async () => {
    const res = await request(makeApp())
      .post('/api/v1/health/live')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('AppError carries its status and code', () => {
    const e = new AppError('RIDE_ALREADY_ASSIGNED');
    expect(e.status).toBe(409);
    expect(e.code).toBe('RIDE_ALREADY_ASSIGNED');
  });
});

describe('request id', () => {
  it('reuses a well-formed inbound id', async () => {
    const res = await request(makeApp())
      .get('/api/v1/health/live')
      .set('X-Request-Id', 'client-id-12345');
    expect(res.headers['x-request-id']).toBe('client-id-12345');
  });

  it('replaces a malformed inbound id', async () => {
    const res = await request(makeApp()).get('/api/v1/health/live').set('X-Request-Id', 'bad id!');
    expect(res.headers['x-request-id']).toMatch(/^req_/);
  });
});

describe('openapi', () => {
  it('serves the spec', async () => {
    const res = await request(makeApp()).get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.paths['/health/live']).toBeDefined();
  });
});

describe('env validation', () => {
  it('accepts a valid env', () => {
    expect(loadEnv(baseEnv).PORT).toBe(4000);
  });

  it('rejects missing and short secrets', () => {
    expect(() => loadEnv({ ...baseEnv, JWT_ACCESS_SECRET: 'short' })).toThrow(EnvValidationError);
    expect(() => loadEnv({ NODE_ENV: 'test' })).toThrow(EnvValidationError);
  });

  it('rejects mock providers in production', () => {
    expect(() => loadEnv({ ...baseEnv, NODE_ENV: 'production', PROVIDER_MODE: 'mock' })).toThrow(
      /not allowed in production/,
    );
  });

  it('parses CORS origins', () => {
    expect(
      loadEnv({ ...baseEnv, CORS_ORIGINS: 'http://a.com, http://b.com' }).CORS_ORIGINS,
    ).toEqual(['http://a.com', 'http://b.com']);
  });
});

describe('providers', () => {
  it('refuses mock providers in production', () => {
    expect(() => createProviders({ NODE_ENV: 'production', PROVIDER_MODE: 'mock' })).toThrow();
  });

  it('mock payments never report a signature as valid', () => {
    const p = createProviders({ NODE_ENV: 'test', PROVIDER_MODE: 'mock' });
    expect(
      p.payments.verifyPaymentSignature({ orderId: 'o', paymentId: 'p', signature: 's' }),
    ).toBe(false);
    expect(p.payments.verifyWebhookSignature(Buffer.from('x'), 's')).toBe(false);
  });
});
