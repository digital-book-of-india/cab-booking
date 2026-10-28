import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { createLogger } from '../src/common/logger';
import type { Role } from '../src/common/enums';
import { normalizePhone } from '../src/common/phone';
import { createProviders } from '../src/providers';
import type { AuthConfig } from '../src/modules/auth/auth.config';
import { User } from '../src/modules/users/user.model';
import { CabCategory } from '../src/modules/categories/cabCategory.model';
import { ServiceZone } from '../src/modules/zones/serviceZone.model';
import { seedAll } from '../src/seed/seed';
import type { DispatchConfig } from '../src/modules/dispatch/dispatch.config';
import type { DispatchService } from '../src/modules/dispatch/dispatch.service';
import { DriverProfile } from '../src/modules/drivers/driverProfile.model';
import { DriverDocument } from '../src/modules/drivers/driverDocument.model';
import { REQUIRED_DOCUMENT_TYPES } from '../src/common/enums';
import type { NotificationsService } from '../src/modules/notifications/notifications.service';
import type { PresenceService } from '../src/modules/presence/presence.service';
import type { PushPayload } from '../src/providers';
import type { Envelope } from '../src/realtime/events';
import { createSocketBus, type SocketBus } from '../src/realtime/socketServer';
import { createHmac } from 'node:crypto';
import { createRazorpayPayments } from '../src/providers/razorpay';
import { createRazorpayXPayouts } from '../src/providers/razorpayx';
import type { FinanceConfig } from '../src/modules/ledger/finance.config';

export const ACCESS_SECRET = 'a'.repeat(32);
export const HASH_SECRET = 'b'.repeat(32);

export type TestEnv = {
  app: Express;
  /** Last OTP the fake SMS provider "sent" to each phone. */
  otps: Map<string, string>;
  /** Move the app's clock (quote expiry, operating hours). Pass null to return to real time. */
  setNow: (d: Date | null) => void;
  /** Run one dispatch housekeeping pass (what the background sweeper does every 2 s). */
  sweep: () => Promise<void>;
  /** Run the reconciler (repairs half-finished writes, sets silent drivers OFFLINE). */
  reconcile: () => ReturnType<DispatchService['reconcile']>;
  /** Base URL of the real HTTP server (REST + Socket.IO on one port). */
  url: string;
  /** The socket layer, for tests that re-check or close connections. */
  sockets: SocketBus;
  /** Every text message the fake SMS provider "sent" (emergency alerts), in order. */
  texts: { phone: string; message: string }[];
  /** Files the fake storage holds. Only used when the environment is started with strictUploads. */
  uploads: Map<string, { sizeBytes: number; contentType: string }>;
  /** Every email the fake provider "sent", in order. */
  emails: { to: string; subject: string; text: string }[];
  /** Every push the fake provider "delivered", in order. */
  pushed: { token: string; payload: PushPayload }[];
  /** Make a push token fail: 'invalid' = permanently dead, 'error' = temporary outage. */
  failPush: Map<string, 'invalid' | 'error'>;
  /** Run the push worker once (what the background job does every 2 s). */
  deliverPush: () => ReturnType<NotificationsService['deliverDue']>;
  /** A fake Razorpay behind the real adapter: real signatures, canned API answers. */
  razorpay: FakeRazorpay;
  /** A fake RazorpayX behind the real payout adapter. */
  razorpayx: FakeRazorpayX;
  /** Run the money repair job once (what the background job does every minute). */
  runFinance: () => Promise<unknown>;
  /** Open a socket as this user. Waits for the server's `hello`. Closed automatically on stop. */
  connect: (token: string, options?: { waitForHello?: boolean }) => Promise<TestSocket>;
  stop: () => Promise<void>;
  reset: () => Promise<void>;
};

export type FakeRazorpay = {
  keyId: string;
  /** Orders the server asked Razorpay to create, in order. */
  orders: { id: string; amount: number; receipt: string }[];
  refundRequests: { paymentId: string; amount: number }[];
  /** Make the next calls fail like an outage. */
  failOrders: boolean;
  failRefunds: boolean;
  /** What Razorpay answers to a refund request. */
  refundStatus: 'pending' | 'processed' | 'failed';
  /** The signature the checkout screen would return for a successful payment. */
  sign: (orderId: string, paymentId: string) => string;
  /** Deliver a signed webhook to the server, exactly as Razorpay would. */
  webhook: (
    body: object,
    options?: { eventId?: string; badSignature?: boolean },
  ) => Promise<import('supertest').Response>;
  captured: (orderId: string, paymentId: string, amount: number) => object;
};

export type FakeRazorpayX = {
  /** What the server asked to be registered / sent, in order. */
  fundAccounts: { id: string; contactName: string; kind: string }[];
  payouts: {
    id: string;
    amount: number;
    mode: string;
    referenceId: string;
    key: string;
    status: string;
  }[];
  /** Make payout requests fail like an outage (the server gets no answer). */
  failPayouts: boolean;
  /** What the payout service answers when a payout is created. */
  payoutStatus: 'processing' | 'processed' | 'failed';
  /** Deliver a signed payout webhook to the server, exactly as RazorpayX would. */
  webhook: (
    body: object,
    options?: { eventId?: string; badSignature?: boolean },
  ) => Promise<import('supertest').Response>;
  /** A payout.<status> event for a payout the fake knows. */
  event: (
    payoutId: string,
    event: string,
    extra?: { utr?: string; failure_reason?: string },
  ) => object;
};

export type TestSocket = {
  socket: ClientSocket;
  /** Every server event received so far, oldest first. */
  events: Envelope[];
  /** Wait for (and return) the next event of this type, or one already received after `since`. */
  waitFor: (type: string, timeoutMs?: number, since?: number) => Promise<Envelope>;
  /** Number of events of a type received so far. */
  count: (type: string) => number;
  close: () => void;
};

export async function startTestEnv(
  authOverrides: Partial<AuthConfig> = {},
  appOverrides: {
    authRateLimitMax?: number;
    bookingRateLimitMax?: number;
    locationsPerMinute?: number;
    dispatchConfig?: Partial<DispatchConfig>;
    featureDefaults?: Partial<import('../src/modules/flags/flags.service').FlagDefaults>;
    safetyAckWindowMs?: number;
    socket?: {
      refreshGraceMs?: number;
      revalidateMs?: number;
      maxSocketsPerUser?: number;
      handshakesPerMinute?: number;
    };
    callerWriteLimitPerMinute?: number;
    couponGuessLimit?: number;
    metricsToken?: string;
    /** Make the fake storage hold only the files a test puts there (default: every file is there). */
    strictUploads?: boolean;
    corsOrigins?: string[];
    monitorConfig?: Partial<import('../src/modules/monitoring/monitor.service').MonitorConfig>;
    financeConfig?: Partial<FinanceConfig>;
    devPayments?: boolean;
    /** Replace the fake storage (for example with the real local-disk one). */
    storage?: import('../src/providers').StorageProvider;
  } = {},
): Promise<TestEnv> {
  // Opt-in: TEST_MONGO_URI runs the suite against a real MongoDB (each file gets a throwaway
  // database that is dropped afterwards). Default is the in-memory server.
  const realUri = process.env['TEST_MONGO_URI'];
  // Starting the in-memory server can fail on a busy CI machine (port or binary start-up); try once more.
  const mongod = realUri
    ? null
    : await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } }).catch(() => MongoMemoryServer.create({ instance: { launchTimeout: 60000 } }));
  // Unique per environment: even if two files ever shared a server they could not touch each other's data.
  const dbName = `test_${randomBytes(6).toString('hex')}`;
  await mongoose.connect(realUri ?? mongod!.getUri(), { dbName });
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));

  let fixedNow: Date | null = null;
  const otps = new Map<string, string>();
  const pushed: TestEnv['pushed'] = [];
  const texts: TestEnv['texts'] = [];
  const emails: TestEnv['emails'] = [];
  const uploads: TestEnv['uploads'] = new Map();
  const failPush: TestEnv['failPush'] = new Map();
  const baseProviders = createProviders(
    { NODE_ENV: 'test', PROVIDER_MODE: 'mock' },
    {
      onOtp: (phone, otp) => otps.set(phone, otp),
      onText: (phone, message) => texts.push({ phone, message }),
      onEmail: (m) => emails.push(m),
      ...(appOverrides.strictUploads ? { objects: uploads } : {}),
      onPush: (token, payload) => pushed.push({ token, payload }),
      pushFailure: (token) => failPush.get(token),
    },
  );
  const socketBus = createSocketBus();

  // Real Razorpay adapter (so the signature maths is the real thing) over a fake network.
  const KEY_SECRET = 'rzp_test_secret_for_tests';
  const WEBHOOK_SECRET = 'rzp_test_webhook_secret';
  const razorpay: FakeRazorpay = {
    keyId: 'rzp_test_key_id',
    orders: [],
    refundRequests: [],
    failOrders: false,
    failRefunds: false,
    refundStatus: 'pending',
    sign: (orderId, paymentId) =>
      createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex'),
    webhook: async (body, options = {}) => {
      const raw = JSON.stringify(body);
      const signature = options.badSignature
        ? 'f'.repeat(64)
        : createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
      return request(app)
        .post('/api/v1/webhooks/razorpay')
        .set('content-type', 'application/json')
        .set('x-razorpay-signature', signature)
        .set('x-razorpay-event-id', options.eventId ?? `evt_${Math.random().toString(36).slice(2)}`)
        .send(raw);
    },
    captured: (orderId, paymentId, amount) => ({
      event: 'payment.captured',
      payload: {
        payment: { entity: { id: paymentId, order_id: orderId, amount, status: 'captured' } },
      },
    }),
  };
  const X_WEBHOOK_SECRET = 'rzpx_test_webhook_secret';
  const razorpayx: FakeRazorpayX = {
    fundAccounts: [],
    payouts: [],
    failPayouts: false,
    payoutStatus: 'processing',
    webhook: async (body, options = {}) => {
      const raw = JSON.stringify(body);
      const signature = options.badSignature
        ? 'f'.repeat(64)
        : createHmac('sha256', X_WEBHOOK_SECRET).update(raw).digest('hex');
      return request(app)
        .post('/api/v1/webhooks/razorpayx')
        .set('content-type', 'application/json')
        .set('x-razorpay-signature', signature)
        .set('x-razorpay-event-id', options.eventId ?? `evx_${Math.random().toString(36).slice(2)}`)
        .send(raw);
    },
    event: (payoutId, event, extra = {}) => ({
      event,
      payload: { payout: { entity: { id: payoutId, ...extra } } },
    }),
  };
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    if (u.endsWith('/orders')) {
      if (razorpay.failOrders) return json({ error: 'down' }, 500);
      const id = `order_test_${razorpay.orders.length + 1}`;
      razorpay.orders.push({ id, amount: body.amount, receipt: body.receipt });
      return json({ id });
    }
    if (u.includes('/refund')) {
      if (razorpay.failRefunds) return json({ error: 'down' }, 500);
      const paymentId = decodeURIComponent(u.split('/payments/')[1]!.split('/refund')[0]!);
      razorpay.refundRequests.push({ paymentId, amount: body.amount });
      return json({
        id: `rfnd_test_${razorpay.refundRequests.length}`,
        status: razorpay.refundStatus,
      });
    }
    if (u.endsWith('/contacts'))
      return json({ id: `cont_test_${razorpayx.fundAccounts.length + 1}` });
    if (u.endsWith('/fund_accounts')) {
      const id = `fa_test_${razorpayx.fundAccounts.length + 1}`;
      razorpayx.fundAccounts.push({
        id,
        contactName: body.bank_account?.name ?? body.vpa?.address,
        kind: body.account_type,
      });
      return json({ id });
    }
    if (u.endsWith('/payouts') && init?.method === 'POST') {
      if (razorpayx.failPayouts) return json({ error: 'down' }, 500);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const key = headers['X-Payout-Idempotency'] ?? '';
      const existing = razorpayx.payouts.find((p) => p.key === key);
      if (existing) return json({ id: existing.id, status: existing.status });
      const id = `pout_test_${razorpayx.payouts.length + 1}`;
      razorpayx.payouts.push({
        id,
        amount: body.amount,
        mode: body.mode,
        referenceId: body.reference_id,
        key,
        status: razorpayx.payoutStatus,
      });
      return json({
        id,
        status: razorpayx.payoutStatus,
        ...(razorpayx.payoutStatus === 'processed' ? { utr: `UTR${id}` } : {}),
      });
    }
    if (u.includes('/payouts/')) {
      const id = decodeURIComponent(u.split('/payouts/')[1]!);
      const p = razorpayx.payouts.find((x) => x.id === id);
      return p
        ? json({ id, status: p.status, ...(p.status === 'processed' ? { utr: `UTR${id}` } : {}) })
        : json({ error: 'not found' }, 404);
    }
    return json({ error: 'unexpected' }, 404);
  }) as typeof fetch;
  const providers = {
    ...baseProviders,
    ...(appOverrides.storage ? { storage: appOverrides.storage } : {}),
    payments: createRazorpayPayments({
      keyId: razorpay.keyId,
      keySecret: KEY_SECRET,
      webhookSecret: WEBHOOK_SECRET,
      fetchFn: fakeFetch,
    }),
    payouts: createRazorpayXPayouts({
      keyId: 'rzpx_key',
      keySecret: 'rzpx_secret',
      accountNumber: '2323230000000000',
      webhookSecret: X_WEBHOOK_SECRET,
      fetchFn: fakeFetch,
    }),
  };
  const authConfig: AuthConfig = {
    accessSecret: ACCESS_SECRET,
    hashSecret: HASH_SECRET,
    accessTtlSeconds: 900,
    refreshTtlDays: 30,
    otpTtlSeconds: 300,
    otpResendSeconds: 0,
    otpMaxAttempts: 5,
    otpMaxPerHour: 1000,
    staffOtpLogin: true,
    staffRefreshTtlHours: 12,
    ...authOverrides,
  };
  const app = createApp({
    logger: createLogger(process.env['TEST_LOG'] ?? 'silent'),
    corsOrigins: appOverrides.corsOrigins ?? [],
    readinessChecks: [],
    providers,
    authConfig,
    rateLimitMax: 100_000,
    authRateLimitMax: appOverrides.authRateLimitMax ?? 100_000,
    bookingRateLimitMax: appOverrides.bookingRateLimitMax ?? 100_000,
    locationsPerMinute: appOverrides.locationsPerMinute ?? 100_000,
    callerWriteLimitPerMinute: appOverrides.callerWriteLimitPerMinute ?? 100_000,
    couponGuessLimit: appOverrides.couponGuessLimit ?? 100_000,
    ...(appOverrides.metricsToken ? { metricsToken: appOverrides.metricsToken } : {}),
    ...(appOverrides.monitorConfig ? { monitorConfig: appOverrides.monitorConfig } : {}),
    now: () => fixedNow ?? new Date(),
    realtimeBus: socketBus.bus,
    financeConfig: appOverrides.financeConfig ?? {},
    ...(appOverrides.featureDefaults ? { featureDefaults: appOverrides.featureDefaults } : {}),
    ...(appOverrides.safetyAckWindowMs
      ? { safetyAckWindowMs: appOverrides.safetyAckWindowMs }
      : {}),
    devPayments: appOverrides.devPayments ?? false,
    // Tests drive time and call sweep() themselves; no throttle by default. Every GPS fix is stored
    // and sent live unless a test turns the throttles on.
    dispatchConfig: {
      minLocationIntervalMs: 0,
      persistMinDistanceMeters: 0,
      persistMinIntervalMs: 0,
      trackMinIntervalMs: 0,
      trailMinIntervalMs: 0,
      ...appOverrides.dispatchConfig,
    },
  });
  const services = app.locals['services'] as {
    dispatch: DispatchService;
    presence: PresenceService;
    notifications: NotificationsService;
    finance: { run: () => Promise<unknown> };
  };
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  socketBus.attach(server, {
    accessSecret: ACCESS_SECRET,
    logger: createLogger(process.env['TEST_LOG'] ?? 'silent'),
    presence: services.presence,
    corsOrigins: [],
    handshakesPerMinute: 100_000,
    ...appOverrides.socket,
  });
  const opened: ClientSocket[] = [];

  return {
    app,
    otps,
    url,
    sockets: socketBus,
    pushed,
    texts,
    emails,
    uploads,
    failPush,
    deliverPush: () => services.notifications.deliverDue(),
    razorpay,
    razorpayx,
    runFinance: () => services.finance.run(),
    connect: (token, options = {}) =>
      new Promise<TestSocket>((resolve, reject) => {
        const socket = connectClient(url, {
          auth: { token },
          transports: ['websocket'],
          reconnection: false,
          forceNew: true,
        });
        opened.push(socket);
        const events: Envelope[] = [];
        const listeners: { type: string; since: number; fn: (e: Envelope) => void }[] = [];
        socket.onAny((type: string, e: Envelope) => {
          events.push(e);
          for (const l of [...listeners]) if (l.type === type) l.fn(e);
        });
        const waitFor: TestSocket['waitFor'] = (type, timeoutMs = 3000, since = 0) =>
          new Promise<Envelope>((res, rej) => {
            const seen = events.slice(since).find((e) => e.type === type);
            if (seen) return res(seen);
            const timer = setTimeout(() => {
              const at = listeners.findIndex((l) => l.fn === fn);
              if (at >= 0) listeners.splice(at, 1);
              rej(new Error(`timed out waiting for "${type}"`));
            }, timeoutMs);
            const fn = (e: Envelope) => {
              clearTimeout(timer);
              const at = listeners.findIndex((l) => l.fn === fn);
              if (at >= 0) listeners.splice(at, 1);
              res(e);
            };
            listeners.push({ type, since, fn });
          });
        const handle: TestSocket = {
          socket,
          events,
          waitFor,
          count: (type) => events.filter((e) => e.type === type).length,
          close: () => void socket.close(),
        };
        socket.on('connect_error', (err) => reject(err));
        if (options.waitForHello === false) socket.on('connect', () => resolve(handle));
        else socket.on('hello', () => resolve(handle));
      }),
    setNow: (d) => {
      fixedNow = d;
    },
    sweep: () => (app.locals['services'] as { dispatch: DispatchService }).dispatch.sweep(),
    reconcile: () => (app.locals['services'] as { dispatch: DispatchService }).dispatch.reconcile(),
    stop: async () => {
      opened.forEach((s) => s.close());
      await socketBus.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (realUri) await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
      await mongod?.stop();
    },
    reset: async () => {
      // At the driver level on purpose: the ledger model refuses deletes (it is append-only).
      await Promise.all(Object.values(mongoose.models).map((m) => m.collection.deleteMany({})));
      (app.locals['services'] as { flags: { invalidate: () => void } }).flags.invalidate();
      otps.clear();
      emails.length = 0;
      fixedNow = null;
    },
  };
}

export type Session = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  auth: { Authorization: string };
};

/** Full OTP login through the real HTTP API. */
export async function loginAs(
  env: TestEnv,
  phone: string,
  role?: 'CUSTOMER' | 'DRIVER',
): Promise<Session> {
  const req = await request(env.app).post('/api/v1/auth/otp/request').send({ phone });
  if (req.status !== 201) throw new Error(`otp request failed: ${JSON.stringify(req.body)}`);
  const normalized = normalizePhone(phone)!;
  const verify = await request(env.app)
    .post('/api/v1/auth/otp/verify')
    .send({
      challengeId: req.body.data.challengeId,
      phone,
      otp: env.otps.get(normalized),
      ...(role ? { role } : {}),
    });
  if (verify.status !== 200) throw new Error(`otp verify failed: ${JSON.stringify(verify.body)}`);
  const d = verify.body.data;
  return {
    accessToken: d.accessToken,
    refreshToken: d.refreshToken,
    userId: d.user.id,
    auth: { Authorization: `Bearer ${d.accessToken}` },
  };
}

/** Admin-type users can't self-register: create directly, then log in via the real flow. */
export async function loginAsAdmin(
  env: TestEnv,
  phone: string,
  role: Role = 'SUPER_ADMIN',
): Promise<Session> {
  await User.create({ phone, role, name: 'Admin', phoneVerifiedAt: new Date() });
  return loginAs(env, phone);
}

let counter = 0;
/** Unique valid Indian mobile numbers. */
export function nextPhone(): string {
  counter += 1;
  return `+9198${String(10_000_000 + counter).padStart(8, '0')}`;
}

/** Delhi coordinates used across the booking tests (both inside the seeded DELHI_NCR zone). */
export const CP = { lat: 28.6315, lng: 77.2167, label: 'Connaught Place' };
export const IGI = { lat: 28.5562, lng: 77.1, label: 'IGI Airport T3' };
export const MUMBAI = { lat: 19.076, lng: 72.8777, label: 'Mumbai' };

/** Seed categories, the Delhi zone and v1 fares; return their ids. */
export async function seedWorld(): Promise<{ zoneId: string; cats: Record<string, string> }> {
  await seedAll();
  const zone = await ServiceZone.findOne({ code: 'DELHI_NCR' }).lean();
  const cats = Object.fromEntries(
    (await CabCategory.find().lean()).map((c) => [c.code, c._id.toString()]),
  );
  return { zoneId: zone!._id.toString(), cats };
}

/* ---------------- Phase 3 helpers ---------------- */

export const NEAR_CP = { lat: 28.6335, lng: 77.2167 }; // ~220 m from CP
export const NEARISH_CP = { lat: 28.6395, lng: 77.2167 }; // ~900 m
export const FAR_FROM_CP = { lat: 28.75, lng: 77.2167 }; // ~13 km, outside every search radius

/**
 * Give a driver a current approved document of every required type, straight in the database.
 * (Tests about the document workflow itself use the real API; everything else just needs a driver
 * who is allowed to be approved.)
 */
export async function addApprovedDocuments(
  driverId: string,
  expiresAt: Date = new Date(Date.now() + 365 * 86_400_000),
): Promise<void> {
  await DriverDocument.insertMany(
    REQUIRED_DOCUMENT_TYPES.map((type) => ({
      driverId,
      type,
      objectKey: `private/driver-docs/${driverId}/${type}`,
      status: 'APPROVED',
      expiresAt,
    })),
  );
}

let regCounter = 0;

export type TestDriver = Session & { driverId: string; vehicleId: string };

/** A driver created through the real API: apply, get approved, add + verify a vehicle, go online. */
export async function createDriver(
  env: TestEnv,
  world: { cats: Record<string, string> },
  opts: {
    at?: { lat: number; lng: number };
    category?: string;
    approve?: boolean;
    verifyVehicle?: boolean;
    online?: boolean;
    name?: string;
  } = {},
): Promise<TestDriver> {
  const app = env.app;
  const s = await loginAs(env, nextPhone(), 'DRIVER');
  const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
  const profile = await DriverProfile.findOne({ userId: s.userId });
  await request(app)
    .post('/api/v1/drivers/applications')
    .set(s.auth)
    .send({ fullName: opts.name ?? 'Ravi Kumar', city: 'Delhi' });
  if (opts.approve !== false) {
    await addApprovedDocuments(profile!.id);
    await request(app)
      .patch(`/api/v1/admin/drivers/${profile!.id}/approval`)
      .set(ops.auth)
      .send({ decision: 'APPROVE' });
  }
  regCounter += 1;
  const vehicle = await request(app)
    .post('/api/v1/drivers/me/vehicles')
    .set(s.auth)
    .send({
      categoryId: world.cats[opts.category ?? 'MINI'],
      registrationNumber: `DL01AB${String(1000 + regCounter)}`,
      make: 'Maruti',
      model: 'Dzire',
      color: 'White',
      seats: 4,
    });
  if (vehicle.status !== 201) throw new Error(`vehicle failed: ${JSON.stringify(vehicle.body)}`);
  const vehicleId = vehicle.body.data.id as string;
  if (opts.verifyVehicle !== false) {
    await request(app)
      .patch(`/api/v1/admin/vehicles/${vehicleId}/verification`)
      .set(ops.auth)
      .send({ status: 'VERIFIED' });
  }
  if (opts.online !== false) {
    const res = await request(app)
      .post('/api/v1/drivers/me/presence')
      .set(s.auth)
      .send({ status: 'ONLINE', vehicleId, location: opts.at ?? NEAR_CP });
    if (res.status !== 200) throw new Error(`go online failed: ${JSON.stringify(res.body)}`);
  }
  return { ...s, driverId: profile!.id, vehicleId };
}

/** Quote + book a ride as `customer`. Returns the booking as the API shows it. */
export async function requestRide(
  env: TestEnv,
  world: { cats: Record<string, string> },
  customer: Session,
  opts: {
    category?: string;
    pickup?: object;
    drop?: object;
    paymentMethod?: 'CASH' | 'ONLINE';
  } = {},
) {
  const q = await request(env.app)
    .post('/api/v1/fare-quotes')
    .set(customer.auth)
    .send({
      pickup: opts.pickup ?? CP,
      drop: opts.drop ?? IGI,
      categoryId: world.cats[opts.category ?? 'MINI'],
    });
  if (q.status !== 201) throw new Error(`quote failed: ${JSON.stringify(q.body)}`);
  const b = await request(env.app)
    .post('/api/v1/bookings')
    .set(customer.auth)
    .set('Idempotency-Key', `k-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    .send({ quoteId: q.body.data.quoteId, paymentMethod: opts.paymentMethod ?? 'CASH' });
  if (b.status !== 201) throw new Error(`booking failed: ${JSON.stringify(b.body)}`);
  return b.body.data as {
    bookingId: string;
    status: string;
    estimatedFarePaise: number;
    fare: { estimatedDistanceMeters: number; estimatedDurationSeconds: number };
  };
}

export async function currentOffer(env: TestEnv, driver: Session) {
  const res = await request(env.app).get('/api/v1/drivers/me/offers').set(driver.auth);
  return (res.body.data as { offerId: string; bookingId: string }[])[0] ?? null;
}

export async function acceptOffer(env: TestEnv, driver: Session, offerId: string) {
  return request(env.app).post(`/api/v1/ride-offers/${offerId}/accept`).set(driver.auth);
}

/** Walk a booking from DISPATCHING to DRIVER_ASSIGNED with `driver`. Returns the ride id. */
export async function assignTo(env: TestEnv, driver: Session): Promise<string> {
  await env.sweep();
  const offer = await currentOffer(env, driver);
  if (!offer) throw new Error('driver has no offer');
  const res = await acceptOffer(env, driver, offer.offerId);
  if (res.status !== 200) throw new Error(`accept failed: ${JSON.stringify(res.body)}`);
  return res.body.data.rideId as string;
}

export const rideCall = (
  env: TestEnv,
  driver: Session,
  rideId: string,
  action: string,
  body: object = {},
) => request(env.app).post(`/api/v1/rides/${rideId}/${action}`).set(driver.auth).send(body);

export async function pickupOtpOf(env: TestEnv, customer: Session, rideId: string) {
  const res = await request(env.app).get(`/api/v1/rides/${rideId}/pickup-otp`).set(customer.auth);
  return res.body.data.pickupOtp as string;
}

/** Drive a ride DRIVER_ASSIGNED -> IN_PROGRESS (driver is already at the pickup). */
export async function startRide(env: TestEnv, customer: Session, driver: Session, rideId: string) {
  await rideCall(env, driver, rideId, 'en-route');
  await request(env.app)
    .post('/api/v1/drivers/me/location')
    .set(driver.auth)
    .send({ lat: CP.lat, lng: CP.lng });
  const arrived = await rideCall(env, driver, rideId, 'arrived');
  if (arrived.status !== 200) throw new Error(`arrived failed: ${JSON.stringify(arrived.body)}`);
  const otp = await pickupOtpOf(env, customer, rideId);
  const start = await rideCall(env, driver, rideId, 'start', { pickupOtp: otp });
  if (start.status !== 200) throw new Error(`start failed: ${JSON.stringify(start.body)}`);
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Poll until `check` is true (for effects that arrive over a socket), or fail with a clear message. */
export async function until(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`);
    await sleep(15);
  }
}

/** A finished ride, ready to be paid. Rides in one test should share one driver (offers go to the nearest). */
export async function completedRide(
  env: TestEnv,
  world: { cats: Record<string, string> },
  rider: Session,
  driver: TestDriver,
  paymentMethod: 'CASH' | 'ONLINE' = 'CASH',
) {
  const booking = await requestRide(env, world, rider, { paymentMethod });
  const rideId = await assignTo(env, driver);
  await startRide(env, rider, driver, rideId);
  const done = await rideCall(env, driver, rideId, 'complete');
  if (done.status !== 200) throw new Error(`complete failed: ${JSON.stringify(done.body)}`);
  return { booking, rideId, fare: done.body.data.finalFarePaise as number };
}
