import 'dotenv/config';
import http from 'node:http';
import { loadEnv } from './config/env';
import { useRedisForLimits } from './middleware/limiterStore';
import { connectMongo, createRedis, disconnectMongo, pingMongo } from './config/db';
import { createLogger } from './common/logger';
import { createApp } from './app';
import { createProviders } from './providers';
import { authConfigFromEnv } from './modules/auth/auth.config';
import { startDispatchSweeper } from './jobs/dispatchSweeper';
import type { DispatchService } from './modules/dispatch/dispatch.service';
import type { DocumentExpiryService } from './modules/drivers/documentExpiry.service';
import type { NotificationsService } from './modules/notifications/notifications.service';
import type { PresenceService } from './modules/presence/presence.service';
import { createSocketBus } from './realtime/socketServer';
import dns from "node:dns";

dns.setServers(["8.8.8.8", "1.1.1.1"]);

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

  await connectMongo(env);
  const redis = createRedis(env);
  if (redis) redis.on('error', (err) => logger.warn({ err: err.message }, 'redis error'));
  useRedisForLimits(redis);

  let shuttingDown = false;
  const sockets = createSocketBus();
  const providers = createProviders(env, {
    // Dev convenience only: lets you log in without an SMS provider. Never runs in production.
    onOtp:
      env.NODE_ENV === 'development'
        ? (phone, otp) => logger.info({ phone, devOtpCode: otp }, 'DEV OTP')
        : undefined,
  });
  // Load-test mode: nothing is throttled, so the numbers show what the server itself can do.
  const unlimited = env.LOAD_TEST_MODE
    ? {
        rateLimitMax: 10_000_000,
        authRateLimitMax: 10_000_000,
        bookingRateLimitMax: 10_000_000,
        callerWriteLimitPerMinute: 10_000_000,
        couponGuessLimit: 10_000_000,
      }
    : {};
  if (env.LOAD_TEST_MODE) logger.warn('LOAD_TEST_MODE is on: rate limits are off');
  const app = createApp({
    ...unlimited,
    logger,
    providers,
    authConfig: authConfigFromEnv(env),
    corsOrigins: env.CORS_ORIGINS,
    realtimeBus: sockets.bus,
    // SOS stays off in production until a staffed response process exists; staff can switch it on.
    featureDefaults: { SOS: env.NODE_ENV !== 'production' },
    tripLinkBase: env.TRIP_LINK_BASE?.replace(/\/$/, ''),
    alertWebhookUrl: env.ALERT_WEBHOOK_URL,
    metricsToken: env.METRICS_TOKEN,
    staffPortalUrl: env.STAFF_PORTAL_URL,
    financeConfig: {
      autoPayouts: env.AUTO_PAYOUTS,
      invoiceTaxBp: env.INVOICE_TAX_BP,
      invoiceTaxLabel: env.INVOICE_TAX_LABEL,
      rideTaxBp: env.RIDE_TAX_BP,
      commissionTaxBp: env.COMMISSION_TAX_BP,
      seller: {
        name: env.SELLER_NAME,
        gstin: env.SELLER_GSTIN ?? null,
        address: env.SELLER_ADDRESS ?? null,
        sacCode: env.SELLER_SAC_CODE ?? null,
      },
    },
    environmentName: env.NODE_ENV,
    // "Pretend the rider paid" for app developers, only with mock payments and never in production.
    devPayments: env.NODE_ENV !== 'production' && env.PAYMENTS_DRIVER === 'mock',
    isShuttingDown: () => shuttingDown,
    readinessChecks: [
      { name: 'mongo', check: pingMongo },
      ...(redis ? [{ name: 'redis', check: async () => void (await redis.ping()) }] : []),
    ],
  });

  // Offer expiry and re-dispatch. DB-driven so it needs no Redis; safe to run on every instance.
  const services = app.locals['services'] as {
    dispatch: DispatchService;
    presence: PresenceService;
    notifications: NotificationsService;
    documentExpiry: DocumentExpiryService;
    finance: { run: () => Promise<unknown> };
    safety: { escalate: () => Promise<unknown> };
    scheduled: { run: () => Promise<unknown> };
    monitor: {
      run: () => Promise<unknown>;
      recordJob: (name: string, intervalMs: number, ok: boolean) => void;
    };
    housekeeping: { run: () => Promise<unknown> };
  };
  const sweeper = startDispatchSweeper(
    services.dispatch,
    logger,
    {},
    services.notifications,
    services.documentExpiry,
    services.finance,
    [
      // An SOS nobody has picked up is raised again to a super admin.
      { name: 'safety escalation', ms: 30_000, run: () => services.safety.escalate() },
      { name: 'housekeeping', ms: 60_000, run: () => services.housekeeping.run() },
      // Rides booked for later: reminders, starting the search near pickup time, giving up on missed ones.
      { name: 'scheduled rides', ms: 30_000, run: () => services.scheduled.run() },
      // Looks for trouble that needs a person (money, stuck searches, unanswered SOS, dead jobs).
      { name: 'monitor', ms: 60_000, run: () => services.monitor.run() },
    ],
    (name, ms, ok) => services.monitor.recordJob(name, ms, ok),
  );

  const server = http.createServer(app);
  // Slow or stalled clients must not hold connections open forever.
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 65_000; // longer than a typical load balancer's idle timeout
  // Live updates ride on the same port and the same login as the REST API.
  sockets.attach(server, {
    accessSecret: env.JWT_ACCESS_SECRET,
    logger,
    presence: services.presence,
    corsOrigins: env.CORS_ORIGINS,
    ...(redis ? { redisAdapter: { pub: redis.duplicate(), sub: redis.duplicate() } } : {}),
    ...(env.LOAD_TEST_MODE ? { handshakesPerMinute: 10_000_000 } : {}),
  });
  server.listen(env.PORT, () => logger.info({ port: env.PORT }, 'server listening'));

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    sweeper.stop();
    logger.info({ signal }, 'shutting down');
    await sockets.close();
    const force = setTimeout(() => {
      logger.error('forced exit after timeout');
      process.exit(1);
    }, 10_000);
    force.unref();
    server.close(async () => {
      try {
        await Promise.allSettled([disconnectMongo(), redis?.quit()]);
        logger.info('shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'error during shutdown');
        process.exit(1);
      }
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
}

main().catch((err) => {
  // Logger may not exist if env validation failed.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
