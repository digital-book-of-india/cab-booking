import { describe, expect, it, vi } from 'vitest';
import { createMockProviders } from '../src/providers/mock';
import { InvalidPushTokenError, type Providers } from '../src/providers';
import {
  formatResults,
  runChecks,
  TINY_PNG,
  type VerifyDeps,
  type VerifyTargets,
} from '../src/tools/verifyLive';

type DriverEnv = VerifyDeps['env'];
const mockEnv: DriverEnv = {
  MAPS_DRIVER: 'mock',
  PAYMENTS_DRIVER: 'mock',
  PAYOUTS_DRIVER: 'mock',
  SMS_DRIVER: 'mock',
  EMAIL_DRIVER: 'mock',
  PUSH_DRIVER: 'mock',
  STORAGE_DRIVER: 'mock',
  RAZORPAY_KEY_ID: undefined,
  REDIS_URL: undefined,
};
const byName = (rs: Awaited<ReturnType<typeof runChecks>>, name: string) =>
  rs.find((r) => r.name === name)!;

describe('verify:live', () => {
  it('skips everything that is a mock, and never calls it a pass', async () => {
    const results = await runChecks({ env: mockEnv, providers: createMockProviders() });
    expect(results.filter((r) => r.status === 'PASS')).toEqual([]);
    expect(results.filter((r) => r.status === 'FAIL')).toEqual([]);
    expect(byName(results, 'storage: upload, read back, delete').detail).toMatch(/mock/);
  });

  it('checks the maps adapter end to end and fails a wrong answer', async () => {
    const good = createMockProviders();
    good.maps.geocode = async () => ({ lat: 28.6129, lng: 77.2295 });
    const results = await runChecks({
      env: { ...mockEnv, MAPS_DRIVER: 'google' },
      providers: good,
    });
    expect(byName(results, 'maps: road route').status).toBe('PASS');
    expect(byName(results, 'maps: address to coordinates').status).toBe('PASS');
    expect(byName(results, 'maps: coordinates to address').status).toBe('PASS');
    expect(byName(results, 'maps: place search and details').status).toBe('PASS');

    const bad = createMockProviders();
    bad.maps.route = async () => ({ distanceMeters: 50, durationSeconds: 1 });
    bad.maps.geocode = async () => ({ lat: 12.97, lng: 77.59 }); // Bengaluru, not Delhi
    const failed = await runChecks({ env: { ...mockEnv, MAPS_DRIVER: 'google' }, providers: bad });
    expect(byName(failed, 'maps: road route')).toMatchObject({ status: 'FAIL' });
    expect(byName(failed, 'maps: address to coordinates')).toMatchObject({
      status: 'FAIL',
      detail: expect.stringContaining('not in Delhi'),
    });
  });

  it('a provider that throws is a FAIL with its message, not a crash', async () => {
    const p = createMockProviders();
    p.payments.createOrder = async () => {
      throw Object.assign(new Error('Authentication failed'), { code: 'PROVIDER_ERROR' });
    };
    const results = await runChecks({
      env: { ...mockEnv, PAYMENTS_DRIVER: 'razorpay', RAZORPAY_KEY_ID: 'rzp_test_abc' },
      providers: p,
    });
    expect(byName(results, 'payments: create a test order')).toMatchObject({
      status: 'FAIL',
      detail: 'PROVIDER_ERROR: Authentication failed',
    });
  });

  it('creates a test order, but will not use a LIVE key unless told to', async () => {
    const createOrder = vi.fn(async () => ({ orderId: 'order_TEST123' }));
    const p = createMockProviders();
    p.payments.createOrder = createOrder;
    const env = { ...mockEnv, PAYMENTS_DRIVER: 'razorpay' as const };
    const test = await runChecks({
      env: { ...env, RAZORPAY_KEY_ID: 'rzp_test_abc' },
      providers: p,
    });
    expect(byName(test, 'payments: create a test order').status).toBe('PASS');
    expect(createOrder).toHaveBeenCalledTimes(1);

    const live = await runChecks({
      env: { ...env, RAZORPAY_KEY_ID: 'rzp_live_abc' },
      providers: p,
    });
    expect(byName(live, 'payments: create a test order').status).toBe('SKIP');
    expect(createOrder).toHaveBeenCalledTimes(1); // not called again

    const allowed = await runChecks({
      env: { ...env, RAZORPAY_KEY_ID: 'rzp_live_abc' },
      providers: p,
      targets: { allowLiveKeys: true },
    });
    expect(byName(allowed, 'payments: create a test order').status).toBe('PASS');
    expect(createOrder).toHaveBeenCalledTimes(2);
  });

  it('sends a message only when a recipient is named', async () => {
    const sendOtp = vi.fn(async () => ({ providerMessageId: 'sms-1' }));
    const send = vi.fn(async () => ({ providerMessageId: 'mail-1' }));
    const push = vi.fn(async () => ({ providerMessageId: 'push-1' }));
    const p: Providers = createMockProviders();
    p.sms.sendOtp = sendOtp;
    p.email.send = send;
    p.push.send = push;
    const env = {
      ...mockEnv,
      SMS_DRIVER: 'nimbus',
      EMAIL_DRIVER: 'smtp',
      PUSH_DRIVER: 'fcm',
    } as const;

    const none = await runChecks({ env, providers: p });
    expect(none.filter((r) => r.status === 'SKIP').map((r) => r.name)).toEqual(
      expect.arrayContaining([
        'sms: send one text',
        'email: send one email',
        'push: send one notification',
      ]),
    );
    expect(sendOtp).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();

    const targets: VerifyTargets = {
      phone: '+919876543210',
      email: 'me@example.com',
      fcmToken: 'tok',
    };
    const sent = await runChecks({ env, providers: p, targets });
    expect(byName(sent, 'sms: send one text').status).toBe('PASS');
    expect(byName(sent, 'email: send one email').status).toBe('PASS');
    expect(byName(sent, 'push: send one notification').status).toBe('PASS');
    expect(sendOtp).toHaveBeenCalledWith('+919876543210', expect.stringMatching(/^\d{6}$/));
  });

  it('reports a dead push token clearly', async () => {
    const p = createMockProviders();
    p.push.send = async () => {
      throw new InvalidPushTokenError();
    };
    const r = await runChecks({
      env: { ...mockEnv, PUSH_DRIVER: 'fcm' },
      providers: p,
      targets: { fcmToken: 'old' },
    });
    expect(byName(r, 'push: send one notification')).toMatchObject({
      status: 'FAIL',
      detail: expect.stringContaining('dead'),
    });
  });

  it('round-trips a file through storage and fails when the bytes differ', async () => {
    const files = new Map<string, Buffer>();
    const mk = (): Providers => {
      const p = createMockProviders();
      p.storage = {
        async createUploadUrl(key) {
          return { url: `https://files.test/up/${key}`, expiresInSeconds: 60 };
        },
        async createDownloadUrl(key) {
          return { url: `https://files.test/down/${key}`, expiresInSeconds: 60 };
        },
        async statObject(key) {
          const f = files.get(key);
          return f
            ? { exists: true as const, sizeBytes: f.length, contentType: 'image/png' }
            : { exists: false as const };
        },
        async deleteObject(key) {
          files.delete(key);
        },
      };
      return p;
    };
    const fetchFn = (corrupt: boolean) =>
      (async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        const key = u.replace(/^https:\/\/files\.test\/(up|down)\//, '');
        if (init?.method === 'PUT') {
          files.set(key, Buffer.from(init.body as Uint8Array));
          return new Response(null, { status: 200 });
        }
        const bytes = files.get(key);
        return bytes
          ? new Response(new Uint8Array(corrupt ? Buffer.from('tampered') : bytes), { status: 200 })
          : new Response(null, { status: 404 });
      }) as unknown as typeof fetch;

    const ok = await runChecks({
      env: { ...mockEnv, STORAGE_DRIVER: 'local' },
      providers: mk(),
      fetchFn: fetchFn(false),
    });
    expect(byName(ok, 'storage: upload, read back, delete')).toMatchObject({ status: 'PASS' });
    expect(files.size).toBe(0); // cleaned up

    const bad = await runChecks({
      env: { ...mockEnv, STORAGE_DRIVER: 'local' },
      providers: mk(),
      fetchFn: fetchFn(true),
    });
    expect(byName(bad, 'storage: upload, read back, delete')).toMatchObject({
      status: 'FAIL',
      detail: 'downloaded bytes differ',
    });
    expect(TINY_PNG[0]).toBe(0x89);
  });

  it('says what to check when the upload link cannot be reached', async () => {
    const p = createMockProviders();
    const r = await runChecks({
      env: { ...mockEnv, STORAGE_DRIVER: 'local' },
      providers: p,
      fetchFn: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    expect(byName(r, 'storage: upload, read back, delete').detail).toMatch(
      /server must be running/,
    );
  });

  it('checks the database and the cache', async () => {
    const store = new Map<string, string>();
    const redis = {
      ping: async () => 'PONG',
      set: async (k: string, v: string) => void store.set(k, v),
      get: async (k: string) => store.get(k) ?? null,
      del: async (k: string) => void store.delete(k),
    };
    const up = await runChecks({
      env: { ...mockEnv, REDIS_URL: 'redis://x' },
      providers: createMockProviders(),
      pingMongo: async () => undefined,
      redis,
    });
    expect(byName(up, 'database: reachable').status).toBe('PASS');
    expect(byName(up, 'redis: reachable and readable').status).toBe('PASS');
    expect(store.size).toBe(0);

    const down = await runChecks({
      env: mockEnv,
      providers: createMockProviders(),
      pingMongo: async () => {
        throw new Error('no connection');
      },
    });
    expect(byName(down, 'database: reachable')).toMatchObject({
      status: 'FAIL',
      detail: 'no connection',
    });
  });

  describe('the deployed server', () => {
    const good = (path: string, init?: RequestInit): Response => {
      const headers = {
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
        'content-type': 'application/json',
      };
      if (path.endsWith('/openapi.json')) {
        return new Response(JSON.stringify({ paths: { '/a': {}, '/b': {} } }), { headers });
      }
      if (path.includes('/locations/autocomplete'))
        return new Response('{}', { status: 401, headers });
      if (path.includes('/files/download')) return new Response('{}', { status: 403, headers });
      if (path.includes('/webhooks/razorpay')) return new Response('{}', { status: 400, headers });
      void init;
      return new Response('{}', { headers });
    };
    const serverFetch = (
      override?: (path: string, init?: RequestInit) => Response | undefined,
    ): typeof fetch =>
      (async (url: string | URL | Request, init?: RequestInit) => {
        const path = String(url).replace(/^https?:\/\/[^/]+/, '');
        return override?.(path, init) ?? good(path, init);
      }) as unknown as typeof fetch;

    it('passes a healthy, closed-up server', async () => {
      const r = await runChecks({
        env: mockEnv,
        providers: createMockProviders(),
        fetchFn: serverFetch(),
        targets: { baseUrl: 'https://api.example.com' },
      });
      const server = r.filter((x) => x.name.startsWith('server:'));
      expect(server.map((x) => x.status)).toEqual(['PASS', 'PASS', 'PASS', 'PASS', 'PASS']);
      expect(byName(r, 'server: API description is published').detail).toBe('2 paths');
    });

    it('fails an open door, a missing header, and plain http', async () => {
      const r = await runChecks({
        env: mockEnv,
        providers: createMockProviders(),
        fetchFn: serverFetch((path) => {
          if (path.includes('/locations/autocomplete')) return new Response('{}', { status: 200 });
          if (path.endsWith('/health/live')) return new Response('{}', { status: 200 });
          return undefined;
        }),
        targets: { baseUrl: 'http://api.example.com' },
      });
      expect(byName(r, 'server: https').status).toBe('FAIL');
      expect(byName(r, 'server: security headers').status).toBe('FAIL');
      expect(byName(r, 'server: protected doors are closed')).toMatchObject({
        status: 'FAIL',
        detail: expect.stringContaining('not 401'),
      });
    });

    it('lets a local address use http', async () => {
      const r = await runChecks({
        env: mockEnv,
        providers: createMockProviders(),
        fetchFn: serverFetch(),
        targets: { baseUrl: 'http://localhost:4000' },
      });
      expect(byName(r, 'server: https').status).toBe('SKIP');
    });
  });

  it('prints a readable table with totals', async () => {
    const text = formatResults(await runChecks({ env: mockEnv, providers: createMockProviders() }));
    expect(text).toMatch(/SKIP\s+maps: road route/);
    expect(text).toMatch(/0 passed, 0 failed, \d+ skipped/);
  });
});
