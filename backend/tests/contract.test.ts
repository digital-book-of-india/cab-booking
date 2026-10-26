import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openApiSpec } from '../src/docs/openapi';
import { routes } from '../src/docs/routes';
import { startTestEnv, type TestEnv } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  // The development-only payment route is documented, so it must be switched on to be found.
  env = await startTestEnv({}, { devPayments: true });
});
afterAll(() => env.stop());

type Layer = {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
};

/** Walk Express's router tree and list every registered "METHOD /path". */
function registeredRoutes(app: Express): Set<string> {
  const found = new Set<string>();
  const walk = (stack: Layer[]) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const m of Object.keys(layer.route.methods)) {
          // The Razorpay webhook is mounted on the app itself (it needs the raw body), so its
          // path carries the /api/v1 prefix that the versioned router adds for everything else.
          found.add(`${m.toUpperCase()} ${layer.route.path.replace(/^\/api\/v1/, '')}`);
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk((app as unknown as { router: { stack: Layer[] } }).router.stack);
  return found;
}

describe('API documentation matches the implementation', () => {
  const documented = new Set(
    routes.map((r) => `${r.method.toUpperCase()} ${r.path.replace(/\{(\w+)\}/g, ':$1')}`),
  );

  it('every implemented route is documented (except the spec endpoint itself)', () => {
    const implemented = registeredRoutes(env.app);
    implemented.delete('GET /openapi.json');
    const undocumented = [...implemented].filter((r) => !documented.has(r));
    expect(undocumented).toEqual([]);
  });

  it('every documented route is implemented', () => {
    const implemented = registeredRoutes(env.app);
    const missing = [...documented].filter((r) => !implemented.has(r));
    expect(missing).toEqual([]);
  });

  it('serves the generated OpenAPI document', async () => {
    const res = await request(env.app).get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.paths).length).toBe(Object.keys(openApiSpec.paths).length);
    expect(res.body.paths['/auth/otp/verify'].post.requestBody).toBeDefined();
  });

  it('every protected route rejects a missing token with 401', async () => {
    for (const r of routes.filter((x) => x.auth !== 'public')) {
      const path = `/api/v1${r.path.replace(/\{(\w+)\}/g, '507f1f77bcf86cd799439011')}`;
      const res = await (
        request(env.app) as unknown as Record<string, (p: string) => request.Test>
      )[r.method]!(path);
      expect(res.status, `${r.method} ${r.path}`).toBe(401);
    }
  });
});
