import { AuditLog } from '../src/modules/audit/auditLog.model';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../src/common/logger';
import { LedgerTransaction } from '../src/modules/ledger/ledgerTransaction.model';
import {
  createMonitorService,
  type MonitorService,
} from '../src/modules/monitoring/monitor.service';
import { Notification } from '../src/modules/notifications/notification.model';
import {
  NEAR_CP,
  assignTo,
  createDriver,
  loginAs,
  loginAsAdmin,
  nextPhone,
  requestRide,
  seedWorld,
  startRide,
  startTestEnv,
  type TestEnv,
} from './helpers';

let env: TestEnv;
beforeAll(async () => {
  // Every "how long is too long" is zero, so one fresh record is enough to trip a check.
  env = await startTestEnv(
    {},
    {
      monitorConfig: {
        stuckDispatchMs: 0,
        unackedSosMs: 0,
        pushBacklogMs: 0,
        moneyGraceMs: 0,
        jobMissedIntervals: 5,
      },
      metricsToken: 'metrics-token-1234567',
    },
  );
});
afterAll(() => env.stop());
beforeEach(() => env.reset());

const api = () => request(env.app);
const monitor = () => (env.app.locals['services'] as { monitor: MonitorService }).monitor;
const failing = async () => (await monitor().checks()).filter((c) => !c.ok).map((c) => c.name);

describe('system health', () => {
  it('is all clear on a quiet system, and only operations staff can look', async () => {
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const res = await api().get('/api/v1/admin/system/health').set(ops.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
    expect(res.body.data.checks.map((c: { name: string }) => c.name)).toEqual([
      'ledger_balanced',
      'dispatch_stuck',
      'rides_overrunning',
      'corporate_invoices_overdue',
      'scheduled_rides_overdue',
      'sos_unacknowledged',
      'push_backlog',
      'webhooks_unfinished',
      'payments_not_in_ledger',
      'payouts_need_attention',
      'error_rate',
      'jobs_alive',
    ]);
    const finance = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    const rider = await loginAs(env, nextPhone(), 'CUSTOMER');
    for (const who of [finance, rider]) {
      expect((await api().get('/api/v1/admin/system/health').set(who.auth)).status).toBe(403);
    }
  });

  it('notices a search that never ends and an SOS nobody took', async () => {
    const world = await seedWorld();
    const rider = await loginAs(env, nextPhone(), 'CUSTOMER');
    await requestRide(env, world, rider); // no driver online: it stays searching
    expect(await failing()).toEqual(['dispatch_stuck']);

    const driver = await createDriver(env, world, { at: NEAR_CP });
    const rider2 = await loginAs(env, nextPhone(), 'CUSTOMER');
    await requestRide(env, world, rider2);
    const rideId = await assignTo(env, driver);
    await startRide(env, rider2, driver, rideId);
    await api().post(`/api/v1/rides/${rideId}/sos`).set(rider2.auth).send({});
    expect(await failing()).toContain('sos_unacknowledged');
  });

  it('notices a ledger that does not add up and push messages that are not going out', async () => {
    // A transaction whose entries do not sum to zero can only get in by going around the service.
    await LedgerTransaction.collection.insertOne({
      txnId: 'txn_broken',
      kind: 'RIDE_ACCRUAL',
      idempotencyKey: 'broken-1',
      at: new Date(),
      entries: [{ account: 'GATEWAY', amountPaise: 500 }],
    });
    await Notification.collection.insertOne({
      userId: 'u1',
      status: 'PENDING',
      nextAttemptAt: new Date(Date.now() - 60_000),
      createdAt: new Date(),
    });
    expect(await failing()).toEqual(expect.arrayContaining(['ledger_balanced', 'push_backlog']));
  });
});

describe('test alert endpoint', () => {
  it('is for operations only, is audited, and says whether a webhook is configured', async () => {
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const support = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    const rider = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await api().post('/api/v1/admin/system/test-alert').set(rider.auth)).status).toBe(403);
    expect((await api().post('/api/v1/admin/system/test-alert').set(support.auth)).status).toBe(
      403,
    );
    expect((await api().post('/api/v1/admin/system/test-alert')).status).toBe(401);
    const res = await api().post('/api/v1/admin/system/test-alert').set(ops.auth);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // The test server has no webhook configured.
    expect(res.body.data).toEqual({ webhookConfigured: false, delivered: false });
    expect(await AuditLog.countDocuments({ action: 'system.test_alert' })).toBe(1);
  });
});

describe('alerts', () => {
  function build(
    sent: { url: string; text: string }[],
    clock: { t: number },
    ok = { ledger: true },
  ) {
    const fetchFn = (async (url: string, init: { body: string }) => {
      sent.push({ url, text: JSON.parse(init.body).text });
      return new Response('ok');
    }) as unknown as typeof fetch;
    return createMonitorService({
      ledger: {
        checkBalance: async () => ({
          ledgerTotalPaise: ok.ledger ? 0 : 7,
          unbalancedTransactions: [],
          completedRidesWithoutAccrual: 0,
        }),
      },
      logger: createLogger('silent'),
      now: () => new Date(clock.t),
      alertWebhookUrl: 'https://hooks.example.com/abc',
      environment: 'staging',
      config: { alertCooldownMs: 30 * 60_000, jobMissedIntervals: 5 },
      fetchFn,
    });
  }

  it('alerts once when something breaks, again only after the cool-down, and says when it recovers', async () => {
    const sent: { url: string; text: string }[] = [];
    const clock = { t: Date.now() };
    const state = { ledger: false };
    const m = build(sent, clock, state);

    expect((await m.run()).alerted).toEqual(['ledger_balanced']);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toMatch(/^\[staging\] ALERT ledger_balanced/);
    expect(sent[0]!.url).toBe('https://hooks.example.com/abc');

    clock.t += 60_000;
    expect((await m.run()).alerted).toEqual([]); // still broken, but not repeated every minute
    expect(sent).toHaveLength(1);

    clock.t += 31 * 60_000;
    expect((await m.run()).alerted).toEqual(['ledger_balanced']); // reminder after the cool-down
    expect(sent).toHaveLength(2);

    state.ledger = true;
    expect((await m.run()).recovered).toEqual(['ledger_balanced']);
    expect(sent[2]!.text).toMatch(/RECOVERED ledger_balanced/);
    expect((await m.run()).recovered).toEqual([]);
  });

  it('notices a background job that stopped, and one that came back', async () => {
    const sent: { url: string; text: string }[] = [];
    const clock = { t: Date.now() };
    const m = build(sent, clock);
    m.recordJob('finance repair', 60_000, true);
    expect((await m.run()).alerted).toEqual([]);
    clock.t += 6 * 60_000; // five missed runs
    expect((await m.run()).alerted).toEqual(['jobs_alive']);
    expect(sent[0]!.text).toContain('finance repair');
    m.recordJob('finance repair', 60_000, true);
    expect((await m.run()).recovered).toEqual(['jobs_alive']);
  });

  it('the test alert reaches the webhook and says so; a refusing or missing webhook says delivered: false', async () => {
    const mk = (fetchFn?: typeof fetch, url: string | null = 'https://hooks.example.com/abc') =>
      createMonitorService({
        ledger: {
          checkBalance: async () => ({
            ledgerTotalPaise: 0,
            unbalancedTransactions: [],
            completedRidesWithoutAccrual: 0,
          }),
        },
        logger: createLogger('silent'),
        now: () => new Date('2026-10-23T10:00:00Z'),
        alertWebhookUrl: url ?? undefined,
        environment: 'staging',
        ...(fetchFn ? { fetchFn } : {}),
      });
    const sent: string[] = [];
    const accepted = mk((async (_u: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body).text);
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch);
    expect(await accepted.testAlert()).toEqual({ webhookConfigured: true, delivered: true });
    expect(sent[0]).toMatch(/^\[staging\] TEST ALERT: nothing is wrong/);

    // A deleted Slack hook answers 404: that is not a delivered alert.
    const refused = mk(
      (async () => new Response('no_service', { status: 404 })) as unknown as typeof fetch,
    );
    expect(await refused.testAlert()).toEqual({ webhookConfigured: true, delivered: false });
    const down = mk((async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch);
    expect(await down.testAlert()).toEqual({ webhookConfigured: true, delivered: false });
    expect(await mk(undefined, null).testAlert()).toEqual({
      webhookConfigured: false,
      delivered: false,
    });
  });

  it('a dead alert webhook never breaks monitoring', async () => {
    const m = createMonitorService({
      ledger: {
        checkBalance: async () => ({
          ledgerTotalPaise: 9,
          unbalancedTransactions: [],
          completedRidesWithoutAccrual: 0,
        }),
      },
      logger: createLogger('silent'),
      now: () => new Date(),
      alertWebhookUrl: 'https://hooks.example.com/abc',
      fetchFn: (async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
    });
    expect((await m.run()).alerted).toEqual(['ledger_balanced']);
  });
});

describe('metrics and error rate', () => {
  it('counts requests by route pattern (never by real id) and shows speed and status classes', async () => {
    const rider = await loginAs(env, nextPhone(), 'CUSTOMER');
    await api().get('/api/v1/rides/ride_aaaaaaaaaaaa').set(rider.auth);
    await api().get('/api/v1/rides/ride_bbbbbbbbbbbb').set(rider.auth);
    await api().get('/api/v1/no/such/route/1');
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const res = await api().get('/api/v1/admin/system/metrics').set(ops.auth);
    expect(res.status).toBe(200);
    const byRoute = Object.fromEntries(
      res.body.data.routes.map((r: { route: string }) => [r.route, r]),
    );
    expect(byRoute['GET /api/v1/rides/:rideId'].count).toBe(2);
    expect(byRoute['GET /api/v1/rides/:rideId'].statuses).toEqual({ '4xx': 2 });
    expect(byRoute['GET UNMATCHED']).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain('ride_aaaa');
    expect(res.body.data.process.rssMb).toBeGreaterThan(0);
    expect(res.body.data.last5Minutes.requests).toBeGreaterThan(3);
    const rider2 = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await api().get('/api/v1/admin/system/metrics').set(rider2.auth)).status).toBe(403);
  });

  it('gives a metrics tool the same numbers as text, only with the shared token', async () => {
    await api().get('/api/v1/health/live');
    expect((await api().get('/api/v1/metrics')).status).toBe(401);
    expect(
      (await api().get('/api/v1/metrics').set('Authorization', 'Bearer wrong-token-123456')).status,
    ).toBe(401);
    const ok = await api()
      .get('/api/v1/metrics')
      .set('Authorization', 'Bearer metrics-token-1234567');
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toContain('text/plain');
    expect(ok.text).toContain(
      'http_requests_total{method="GET",route="/api/v1/health/live",status="2xx"}',
    );
    expect(ok.text).toContain('http_request_duration_ms_bucket');
    expect(ok.text).toContain('process_resident_memory_bytes');
  });

  function withErrors(serverErrors: number, requests: number) {
    return createMonitorService({
      ledger: {
        checkBalance: async () => ({
          ledgerTotalPaise: 0,
          unbalancedTransactions: [],
          completedRidesWithoutAccrual: 0,
        }),
      },
      errorWindow: () => ({ requests, serverErrors }),
      logger: createLogger('silent'),
      now: () => new Date(),
    });
  }

  it('alerts on a real rise in server errors, not on a few or a tiny share', async () => {
    const failing = async (m: MonitorService) =>
      (await m.checks()).filter((c) => !c.ok).map((c) => c.name);
    expect(await failing(withErrors(6, 50))).toEqual(['error_rate']); // 12%
    expect(await failing(withErrors(3, 20))).toEqual([]); // under 5 errors
    expect(await failing(withErrors(6, 1000))).toEqual([]); // 0.6%: noise
  });
});
