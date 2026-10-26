import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import { EnvValidationError, loadEnv } from '../src/config/env';
import { createProviders, InvalidPushTokenError } from '../src/providers';
import { createFcmPush, parseServiceAccount } from '../src/providers/fcm';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const serviceAccount = {
  project_id: 'cab-test',
  client_email: 'push@cab-test.iam.gserviceaccount.com',
  private_key: privateKey,
};

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (call: Call, n: number) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    const { status, body } = handler(call, calls.length);
    return new Response(JSON.stringify(body), { status });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}
const isAuth = (c: Call) => c.url.includes('oauth2');
const authOk = { status: 200, body: { access_token: 'ya29.token', expires_in: 3600 } };
const sendBody = (c: Call) => JSON.parse(String(c.init.body)).message;

describe('Firebase push adapter', () => {
  it('signs a proper OAuth assertion, sends the message, and reuses the access token', async () => {
    const f = fakeFetch((c) =>
      isAuth(c) ? authOk : { status: 200, body: { name: 'projects/x/messages/1' } },
    );
    const push = createFcmPush({ serviceAccount, fetchFn: f.fn });
    const a = await push.send('device-token-1', {
      title: 'New ride request',
      body: 'Connaught Place',
      data: { offerId: 'ofr_1' },
      priority: 'high',
      ttlSeconds: 20,
    });
    await push.send('device-token-2', { title: 't', body: 'b' });
    expect(a.providerMessageId).toBe('projects/x/messages/1');

    // One token exchange for two sends.
    expect(f.calls.filter(isAuth)).toHaveLength(1);
    const form = new URLSearchParams(String(f.calls[0]!.init.body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const claims = jwt.verify(form.get('assertion')!, publicKey, {
      algorithms: ['RS256'],
    }) as Record<string, unknown>;
    expect(claims).toMatchObject({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
    });

    const first = f.calls.find((c) => !isAuth(c))!;
    expect(first.url).toBe('https://fcm.googleapis.com/v1/projects/cab-test/messages:send');
    expect((first.init.headers as Record<string, string>)['authorization']).toBe(
      'Bearer ya29.token',
    );
    expect(sendBody(first)).toMatchObject({
      token: 'device-token-1',
      notification: { title: 'New ride request', body: 'Connaught Place' },
      data: { offerId: 'ofr_1' },
      android: { priority: 'HIGH', ttl: '20s' },
      apns: { headers: { 'apns-priority': '10' } },
    });
    expect(sendBody(f.calls.filter((c) => !isAuth(c))[1]!)).toMatchObject({
      android: { priority: 'NORMAL' },
      apns: { headers: { 'apns-priority': '5' } },
    });
  });

  it('refreshes the access token when it is about to expire', async () => {
    let now = 1_000_000_000_000;
    const f = fakeFetch((c) => (isAuth(c) ? authOk : { status: 200, body: { name: 'm' } }));
    const push = createFcmPush({ serviceAccount, fetchFn: f.fn, nowMs: () => now });
    await push.send('device-token-1', { title: 't', body: 'b' });
    now += 3_550_000; // 59 minutes later: inside the 60 s safety margin of a 1 h token
    await push.send('device-token-1', { title: 't', body: 'b' });
    expect(f.calls.filter(isAuth)).toHaveLength(2);
  });

  it('treats an unregistered or malformed token as permanently dead', async () => {
    const unregistered = fakeFetch((c) =>
      isAuth(c)
        ? authOk
        : {
            status: 404,
            body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } },
          },
    );
    await expect(
      createFcmPush({ serviceAccount, fetchFn: unregistered.fn }).send('t', {
        title: 'a',
        body: 'b',
      }),
    ).rejects.toBeInstanceOf(InvalidPushTokenError);

    const malformed = fakeFetch((c) =>
      isAuth(c)
        ? authOk
        : {
            status: 400,
            body: {
              error: {
                status: 'INVALID_ARGUMENT',
                message: 'The registration token is not a valid FCM registration token',
              },
            },
          },
    );
    await expect(
      createFcmPush({ serviceAccount, fetchFn: malformed.fn }).send('t', { title: 'a', body: 'b' }),
    ).rejects.toBeInstanceOf(InvalidPushTokenError);
  });

  it('does NOT treat our own bad request or an outage as a dead token (so they are retried or noticed)', async () => {
    const badRequest = fakeFetch((c) =>
      isAuth(c)
        ? authOk
        : {
            status: 400,
            body: {
              error: { status: 'INVALID_ARGUMENT', message: 'Invalid value at message.data' },
            },
          },
    );
    const err1 = await createFcmPush({ serviceAccount, fetchFn: badRequest.fn })
      .send('t', { title: 'a', body: 'b' })
      .catch((e: unknown) => e);
    expect(err1).toBeInstanceOf(Error);
    expect(err1).not.toBeInstanceOf(InvalidPushTokenError);

    const outage = fakeFetch((c) =>
      isAuth(c) ? authOk : { status: 503, body: { error: { status: 'UNAVAILABLE' } } },
    );
    const err2 = await createFcmPush({ serviceAccount, fetchFn: outage.fn })
      .send('t', { title: 'a', body: 'b' })
      .catch((e: unknown) => e);
    expect(String(err2)).toMatch(/503/);
    expect(err2).not.toBeInstanceOf(InvalidPushTokenError);
  });

  it('on a 401 it fetches a new access token once and retries', async () => {
    let sends = 0;
    const f = fakeFetch((c) => {
      if (isAuth(c)) return authOk;
      sends += 1;
      return sends === 1 ? { status: 401, body: {} } : { status: 200, body: { name: 'm' } };
    });
    const push = createFcmPush({ serviceAccount, fetchFn: f.fn });
    await expect(push.send('t', { title: 'a', body: 'b' })).resolves.toBeDefined();
    expect(f.calls.filter(isAuth)).toHaveLength(2);

    const always401 = fakeFetch((c) => (isAuth(c) ? authOk : { status: 401, body: {} }));
    await expect(
      createFcmPush({ serviceAccount, fetchFn: always401.fn }).send('t', { title: 'a', body: 'b' }),
    ).rejects.toThrow(/401/);
    expect(always401.calls.filter((c) => !isAuth(c))).toHaveLength(2); // one retry, not a loop
  });

  it('a failed OAuth exchange is a retryable error', async () => {
    const f = fakeFetch(() => ({ status: 400, body: { error: 'invalid_grant' } }));
    await expect(
      createFcmPush({ serviceAccount, fetchFn: f.fn }).send('t', { title: 'a', body: 'b' }),
    ).rejects.toThrow(/auth failed/);
  });
});

describe('push configuration', () => {
  const base = {
    NODE_ENV: 'staging',
    MONGODB_URI: 'mongodb://x',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    PROVIDER_MODE: 'mock',
  };

  it('parses a service account and rejects junk', () => {
    expect(parseServiceAccount(JSON.stringify(serviceAccount)).project_id).toBe('cab-test');
    expect(() => parseServiceAccount('not json')).toThrow(/not valid JSON/);
    expect(() => parseServiceAccount('{"project_id":"x"}')).toThrow(/must contain/);
  });

  it('mock push is the default; fcm needs a valid service account', () => {
    expect(loadEnv(base).PUSH_DRIVER).toBe('mock');
    expect(() => loadEnv({ ...base, PUSH_DRIVER: 'fcm' })).toThrow(EnvValidationError);
    expect(() => loadEnv({ ...base, PUSH_DRIVER: 'fcm', FCM_SERVICE_ACCOUNT_JSON: '{}' })).toThrow(
      /PUSH_DRIVER=fcm/,
    );
    const ok = loadEnv({
      ...base,
      PUSH_DRIVER: 'fcm',
      FCM_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount),
    });
    expect(ok.PUSH_DRIVER).toBe('fcm');
  });

  it('real push can be switched on while everything else stays a mock', async () => {
    const mocks = createProviders({ NODE_ENV: 'staging', PROVIDER_MODE: 'mock' });
    const real = createProviders({
      NODE_ENV: 'staging',
      PROVIDER_MODE: 'mock',
      PUSH_DRIVER: 'fcm',
      FCM_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccount),
    });
    expect(real.push).not.toBe(mocks.push);
    expect(Object.keys(real).sort()).toEqual(Object.keys(mocks).sort());
    // The mock maps still answer, so only push became real.
    expect(
      (await real.maps.route({ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 })).distanceMeters,
    ).toBeGreaterThan(0);
  });
});
