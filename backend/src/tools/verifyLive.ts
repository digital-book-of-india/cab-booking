import { randomInt, randomUUID } from 'node:crypto';
import { InvalidPushTokenError, type Providers } from '../providers';
import type { Env } from '../config/env';

/**
 * Checks every integration the server is configured to use, one by one, with the real adapters, and
 * says PASS, FAIL or SKIP for each. Run it on the staging host (or anywhere the .env points at real
 * accounts) before trusting an integration:
 *
 *   npm run verify:live            (development machine)
 *   npm run verify:live:prod       (built server / container: node dist/tools/verifyLiveRun.js)
 *
 * Nothing is sent to a real person unless you name one:
 *   VERIFY_PHONE=+91XXXXXXXXXX      sends ONE login-style SMS
 *   VERIFY_EMAIL=you@example.com    sends ONE email
 *   VERIFY_FCM_TOKEN=<device token> sends ONE push
 *   VERIFY_PAYOUTS=1                registers a TEST contact/UPI id with RazorpayX (no money moves)
 *   BASE_URL=https://api.example.com  also checks the deployed server (health, headers, closed doors)
 *   VERIFY_ALLOW_LIVE=1             allow a LIVE Razorpay key (creates a Rs 1 order; default is to skip)
 *
 * A driver set to `mock` is SKIPped, never passed: a mock proves nothing about the vendor.
 */
export type CheckStatus = 'PASS' | 'FAIL' | 'SKIP';
export type CheckResult = { name: string; status: CheckStatus; detail: string; ms: number };

export type VerifyTargets = {
  phone?: string | undefined;
  email?: string | undefined;
  fcmToken?: string | undefined;
  payouts?: boolean | undefined;
  allowLiveKeys?: boolean | undefined;
  baseUrl?: string | undefined;
};

export type RedisLike = {
  ping(): Promise<string>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
};

export type VerifyDeps = {
  env: Pick<
    Env,
    | 'MAPS_DRIVER'
    | 'PAYMENTS_DRIVER'
    | 'PAYOUTS_DRIVER'
    | 'SMS_DRIVER'
    | 'EMAIL_DRIVER'
    | 'PUSH_DRIVER'
    | 'STORAGE_DRIVER'
    | 'RAZORPAY_KEY_ID'
    | 'REDIS_URL'
  >;
  providers: Providers;
  targets?: VerifyTargets;
  fetchFn?: typeof fetch;
  /** Checks the database connection. Omit to skip. */
  pingMongo?: (() => Promise<void>) | undefined;
  redis?: RedisLike | null | undefined;
};

/** A real 1x1 PNG, so the storage check uploads a file the server's own type checks accept. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const CP = { lat: 28.6315, lng: 77.2167 };
const IGI = { lat: 28.5562, lng: 77.1 };

type Runner = () => Promise<string>;
class Skip extends Error {}
const skip = (why: string): never => {
  throw new Skip(why);
};
const must = (cond: unknown, message: string) => {
  if (!cond) throw new Error(message);
};

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: string }).code;
    return code ? `${code}: ${err.message}` : err.message;
  }
  return String(err);
}

export async function runChecks(deps: VerifyDeps): Promise<CheckResult[]> {
  const { env, providers, targets = {} } = deps;
  const doFetch = deps.fetchFn ?? fetch;
  const results: CheckResult[] = [];

  async function check(name: string, run: Runner) {
    const started = Date.now();
    let status: CheckStatus = 'PASS';
    let detail: string;
    try {
      detail = await run();
    } catch (err) {
      if (err instanceof Skip) {
        status = 'SKIP';
        detail = err.message;
      } else {
        status = 'FAIL';
        detail = describeError(err);
      }
    }
    results.push({ name, status, detail, ms: Date.now() - started });
  }

  /* ---------------- database and cache ---------------- */

  await check('database: reachable', async () => {
    if (!deps.pingMongo) return skip('no database connection given');
    await deps.pingMongo();
    return 'ping ok';
  });

  await check('redis: reachable and readable', async () => {
    if (!env.REDIS_URL) return skip('REDIS_URL is not set');
    if (!deps.redis) return skip('no redis connection given');
    must((await deps.redis.ping()) === 'PONG', 'ping did not answer PONG');
    const key = `verify:${randomUUID()}`;
    await deps.redis.set(key, 'ok', 'EX', 30);
    const back = await deps.redis.get(key);
    await deps.redis.del(key);
    must(back === 'ok', 'wrote a value and read back something else');
    return 'ping, write, read, delete ok';
  });

  /* ---------------- maps ---------------- */

  const mapsOn = env.MAPS_DRIVER === 'google';
  const needMaps = () => (mapsOn ? undefined : skip('MAPS_DRIVER is not google'));
  await check('maps: road route', async () => {
    needMaps();
    const r = await providers.maps.route(CP, IGI);
    must(
      r.distanceMeters > 8000 && r.distanceMeters < 40_000,
      `odd distance ${r.distanceMeters} m`,
    );
    must(r.durationSeconds > 300, `odd duration ${r.durationSeconds} s`);
    return `${(r.distanceMeters / 1000).toFixed(1)} km, ${Math.round(r.durationSeconds / 60)} min, path ${r.polyline ? 'yes' : 'no'}`;
  });
  await check('maps: address to coordinates', async () => {
    needMaps();
    const p = await providers.maps.geocode('India Gate, New Delhi');
    must(p, 'no result for India Gate');
    must(
      Math.abs(p!.lat - 28.61) < 0.1 && Math.abs(p!.lng - 77.23) < 0.1,
      'result is not in Delhi',
    );
    return `${p!.lat.toFixed(4)}, ${p!.lng.toFixed(4)}`;
  });
  await check('maps: coordinates to address', async () => {
    needMaps();
    const a = await providers.maps.reverseGeocode(CP);
    must(a && a.length > 5, 'no address returned');
    return a!;
  });
  await check('maps: place search and details', async () => {
    needMaps();
    const sessionToken = randomUUID();
    const found = await providers.maps.autocomplete('Connaught Place', { sessionToken, near: CP });
    must(found.length > 0, 'no suggestions');
    const place = await providers.maps.place(found[0]!.placeId, { sessionToken });
    must(place, 'the suggestion could not be opened');
    must(Math.abs(place!.point.lat - 28.63) < 0.2, 'place is not in Delhi');
    return `${found.length} suggestions; "${found[0]!.description}"`;
  });

  /* ---------------- payments and payouts ---------------- */

  await check('payments: create a test order', async () => {
    if (env.PAYMENTS_DRIVER !== 'razorpay') return skip('PAYMENTS_DRIVER is not razorpay');
    if ((env.RAZORPAY_KEY_ID ?? '').startsWith('rzp_live_') && !targets.allowLiveKeys) {
      return skip('this is a LIVE key; set VERIFY_ALLOW_LIVE=1 to create a Rs 1 order with it');
    }
    const order = await providers.payments.createOrder({
      amountPaise: 100,
      receipt: `verify-${Date.now()}`,
      notes: { purpose: 'verify-live' },
    });
    must(/^order_/.test(order.orderId), `unexpected order id ${order.orderId}`);
    return `order ${order.orderId} (Rs 1, never paid)`;
  });
  await check('payments: a forged webhook is refused', async () => {
    if (env.PAYMENTS_DRIVER !== 'razorpay') return skip('PAYMENTS_DRIVER is not razorpay');
    must(
      providers.payments.verifyWebhookSignature(
        Buffer.from('{"event":"payment.captured"}'),
        'f'.repeat(64),
      ) === false,
      'accepted a bad webhook signature',
    );
    return 'bad signature rejected';
  });
  await check('payouts: register a test payout account', async () => {
    if (env.PAYOUTS_DRIVER !== 'razorpayx') return skip('PAYOUTS_DRIVER is not razorpayx');
    if (!targets.payouts)
      return skip('set VERIFY_PAYOUTS=1 (registers a TEST contact; no money moves)');
    const acct = await providers.payouts.createFundAccount({
      referenceId: `verify-${Date.now()}`,
      name: 'Verify Test',
      destination: { type: 'UPI', vpa: 'success@razorpay' },
    });
    must(acct.contactId && acct.fundAccountId, 'no contact / fund account ids');
    return `contact ${acct.contactId}, fund account ${acct.fundAccountId}`;
  });

  /* ---------------- messages ---------------- */

  await check('sms: send one text', async () => {
    if (env.SMS_DRIVER !== 'nimbus') return skip('SMS_DRIVER is not nimbus');
    if (!targets.phone) return skip('set VERIFY_PHONE to a phone you hold (sends ONE SMS)');
    const code = String(randomInt(100_000, 1_000_000));
    const sent = await providers.sms.sendOtp(targets.phone, code);
    return `accepted by the gateway (${sent.providerMessageId}); check the phone for "${code}"`;
  });
  await check('email: send one email', async () => {
    if (env.EMAIL_DRIVER !== 'smtp') return skip('EMAIL_DRIVER is not smtp');
    if (!targets.email) return skip('set VERIFY_EMAIL to an inbox you own (sends ONE email)');
    const sent = await providers.email.send({
      to: targets.email,
      subject: 'Cab platform: email check',
      text: 'This is a delivery check from verify:live. No action needed.',
    });
    return `accepted by the mail server (${sent.providerMessageId}); check the inbox`;
  });
  await check('push: send one notification', async () => {
    if (env.PUSH_DRIVER !== 'fcm') return skip('PUSH_DRIVER is not fcm');
    if (!targets.fcmToken) return skip('set VERIFY_FCM_TOKEN to a device token you hold');
    try {
      const sent = await providers.push.send(targets.fcmToken, {
        title: 'Cab platform',
        body: 'Push check from verify:live',
        priority: 'normal',
        ttlSeconds: 60,
      });
      return `accepted by Firebase (${sent.providerMessageId}); check the device`;
    } catch (err) {
      if (err instanceof InvalidPushTokenError) {
        throw new Error('Firebase says the device token is dead', { cause: err });
      }
      throw err;
    }
  });

  /* ---------------- file storage ---------------- */

  await check('storage: upload, read back, delete', async () => {
    if (env.STORAGE_DRIVER === 'mock') return skip('STORAGE_DRIVER is mock');
    const key = `private/verify/${randomUUID()}`;
    const up = await providers.storage.createUploadUrl(key, 'image/png');
    let put: Response;
    try {
      put = await doFetch(up.url, {
        method: 'PUT',
        headers: { 'content-type': 'image/png' },
        body: new Uint8Array(TINY_PNG),
      });
    } catch (err) {
      throw new Error(
        `could not reach the upload link (${describeError(err)}); for local storage the server must be running at UPLOAD_PUBLIC_URL`,
        { cause: err },
      );
    }
    must(put.status >= 200 && put.status < 300, `upload answered ${put.status}`);
    const stat = await providers.storage.statObject(key);
    must(stat.exists, 'the file is not there after the upload');
    must(stat.exists && stat.sizeBytes === TINY_PNG.length, 'the stored size is wrong');
    const down = await providers.storage.createDownloadUrl(key);
    const got = await doFetch(down.url);
    must(got.status === 200, `download answered ${got.status}`);
    must(Buffer.from(await got.arrayBuffer()).equals(TINY_PNG), 'downloaded bytes differ');
    await providers.storage.deleteObject(key);
    must(!(await providers.storage.statObject(key)).exists, 'the file is still there after delete');
    return `${env.STORAGE_DRIVER}: ${TINY_PNG.length} bytes up, down and deleted`;
  });

  /* ---------------- the deployed server ---------------- */

  if (targets.baseUrl) {
    const base = targets.baseUrl.replace(/\/$/, '');
    const url = (p: string) => `${base}/api/v1${p}`;
    const get = (p: string) => doFetch(url(p));
    await check('server: https', async () => {
      const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base);
      if (base.startsWith('https://')) return 'served over https';
      if (local) return skip('local address');
      throw new Error('a non-local server must be served over https');
    });
    await check('server: alive and ready', async () => {
      const live = await get('/health/live');
      must(live.status === 200, `/health/live answered ${live.status}`);
      const ready = await get('/health/ready');
      must(ready.status === 200, `/health/ready answered ${ready.status}: ${await ready.text()}`);
      return 'live and ready';
    });
    await check('server: API description is published', async () => {
      const res = await get('/openapi.json');
      must(res.status === 200, `answered ${res.status}`);
      const body = (await res.json()) as { paths?: Record<string, unknown> };
      return `${Object.keys(body.paths ?? {}).length} paths`;
    });
    await check('server: security headers', async () => {
      const res = await get('/health/live');
      must(
        res.headers.get('x-content-type-options') === 'nosniff',
        'missing X-Content-Type-Options',
      );
      must(!res.headers.get('x-powered-by'), 'X-Powered-By is exposed');
      must(res.headers.get('cache-control')?.includes('no-store'), 'API answers can be cached');
      return 'nosniff, no x-powered-by, no-store';
    });
    await check('server: protected doors are closed', async () => {
      const noToken = await doFetch(url('/locations/autocomplete'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"input":"a"}',
      });
      must(noToken.status === 401, `a call with no token answered ${noToken.status}, not 401`);
      const file = await get('/files/download?key=private/x&exp=1&sig=bad');
      must([403, 404].includes(file.status), `an unsigned file link answered ${file.status}`);
      const hook = await doFetch(url('/webhooks/razorpay'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'bad' },
        body: '{}',
      });
      must(hook.status < 500 && hook.status !== 200, `a forged webhook answered ${hook.status}`);
      return 'no token -> 401, unsigned file -> refused, forged webhook -> refused';
    });
  }

  return results;
}

/** A plain-text table for the terminal. */
export function formatResults(results: CheckResult[]): string {
  const width = Math.max(...results.map((r) => r.name.length), 10);
  const rows = results.map(
    (r) => `${r.status.padEnd(5)} ${r.name.padEnd(width)}  ${r.detail}  (${r.ms} ms)`,
  );
  const count = (s: CheckStatus) => results.filter((r) => r.status === s).length;
  return [
    ...rows,
    '',
    `${count('PASS')} passed, ${count('FAIL')} failed, ${count('SKIP')} skipped`,
  ].join('\n');
}
