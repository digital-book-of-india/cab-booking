import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import { requestId } from './middleware/requestId';
import { errorHandler, notFound } from './middleware/errorHandler';
import { globalRateLimiter, userRateLimiter } from './middleware/rateLimit';
import { limiterStore } from './middleware/limiterStore';
import { healthRouter, type ReadinessCheck } from './modules/health/health.routes';
import { openApiSpec } from './docs/openapi';
import { createHash } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { AppError } from './common/errors';
import type { Providers } from './providers';
import type { LocalFilesHandlers } from './providers/local';
import type { ModuleContext } from './context';
import { authenticate } from './middleware/auth';
import { createAuditService } from './modules/audit/audit.service';
import { auditRouter } from './modules/audit/audit.routes';
import { createAuthService } from './modules/auth/auth.service';
import { authRouter } from './modules/auth/auth.routes';
import type { AuthConfig } from './modules/auth/auth.config';
import { customersRouter } from './modules/customers/customers.routes';
import { categoriesRouter } from './modules/categories/categories.routes';
import { driversRouter } from './modules/drivers/drivers.routes';
import { vehiclesRouter } from './modules/vehicles/vehicles.routes';
import { createZonesService } from './modules/zones/zones.service';
import { zonesRouter } from './modules/zones/zones.routes';
import { createPricingService } from './modules/pricing/pricing.service';
import { pricingRouter } from './modules/pricing/pricing.routes';
import { createCancellationPolicyService } from './modules/pricing/cancellationPolicy.service';
import { cancellationPolicyRouter } from './modules/pricing/cancellationPolicy.routes';
import { createDocumentExpiryService } from './modules/drivers/documentExpiry.service';
import { createMonitorService, type MonitorConfig } from './modules/monitoring/monitor.service';
import { monitorRouter } from './modules/monitoring/monitor.routes';
import { createMetrics } from './modules/monitoring/metrics';
import { createAnalyticsService } from './modules/analytics/analytics.service';
import { analyticsRouter } from './modules/analytics/analytics.routes';
import { createTipsService } from './modules/tips/tips.service';
import { tipsRouter } from './modules/tips/tips.routes';
import { walletRouter } from './modules/wallet/wallet.routes';
import { createPayoutsService, type PayoutsService } from './modules/payouts/payouts.service';
import { payoutsRouter } from './modules/payouts/payouts.routes';
import { scheduledRouter } from './modules/bookings/scheduled.routes';
import { createCorporateService } from './modules/corporate/corporate.service';
import { corporateRouter } from './modules/corporate/corporate.routes';
import { createTripsService } from './modules/trips/trips.service';
import { tripsRouter } from './modules/trips/trips.routes';
import { createScheduledService } from './modules/bookings/scheduled.service';
import { createWalletService } from './modules/wallet/wallet.service';
import { createLedgerService } from './modules/ledger/ledger.service';
import { createFlagsService, type FlagDefaults } from './modules/flags/flags.service';
import { flagsRouter } from './modules/flags/flags.routes';
import { createPrivacyService } from './modules/privacy/privacy.service';
import { privacyRouter } from './modules/privacy/privacy.routes';
import { createStaffAuthService } from './modules/staffauth/staffauth.service';
import { staffAuthRouter } from './modules/staffauth/staffauth.routes';
import { createStaffService } from './modules/staff/staff.service';
import { staffRouter } from './modules/staff/staff.routes';
import { createCouponsService } from './modules/coupons/coupons.service';
import { createReferralsService } from './modules/referrals/referrals.service';
import { referralsRouter } from './modules/referrals/referrals.routes';
import { couponsRouter } from './modules/coupons/coupons.routes';
import { createSafetyService } from './modules/safety/safety.service';
import { safetyRouter } from './modules/safety/safety.routes';
import { createSupportService } from './modules/support/support.service';
import { supportRouter } from './modules/support/support.routes';
import { createRatingsService } from './modules/ratings/ratings.service';
import { ratingsRouter } from './modules/ratings/ratings.routes';
import { createReportsService } from './modules/reports/reports.service';
import { reportsRouter } from './modules/reports/reports.routes';
import { createCommissionService } from './modules/ledger/commission.service';
import { defaultFinanceConfig, type FinanceConfig } from './modules/ledger/finance.config';
import { createPaymentsService, type PaymentsService } from './modules/payments/payments.service';
import { createCashService } from './modules/cash/cash.service';
import { createSettlementsService } from './modules/settlements/settlements.service';
import { createBalancesService } from './modules/balances/balances.service';
import { financeRouter } from './modules/balances/finance.routes';
import { createQuotesService } from './modules/quotes/quotes.service';
import { quotesRouter } from './modules/quotes/quotes.routes';
import { createLocationsService } from './modules/locations/locations.service';
import { locationsRouter } from './modules/locations/locations.routes';
import { createBookingsService } from './modules/bookings/bookings.service';
import { bookingsRouter } from './modules/bookings/bookings.routes';
import { defaultDispatchConfig, type DispatchConfig } from './modules/dispatch/dispatch.config';
import { createDispatchService } from './modules/dispatch/dispatch.service';
import { dispatchRouter } from './modules/dispatch/dispatch.routes';
import { createPresenceService } from './modules/presence/presence.service';
import { presenceRouter } from './modules/presence/presence.routes';
import { createRidesService } from './modules/rides/rides.service';
import { ridesRouter } from './modules/rides/rides.routes';
import { createAdminService } from './modules/admin/admin.service';
import { adminRouter } from './modules/admin/admin.routes';
import { createNotificationsService } from './modules/notifications/notifications.service';
import { notificationsRouter } from './modules/notifications/notifications.routes';
import { nullBus, type RealtimeBus } from './realtime/bus';
import { createNotifier } from './realtime/notifier';

export type AppDeps = {
  logger: Logger;
  corsOrigins: string[];
  readinessChecks: ReadinessCheck[];
  isShuttingDown?: () => boolean;
  rateLimitMax?: number;
  /** Per-IP cap on /auth/* endpoints per 15 min. */
  authRateLimitMax?: number;
  authConfig: AuthConfig;
  providers: Providers;
  /** Clock override for tests. */
  now?: () => Date;
  /** Dispatch / ride-lifecycle tuning. Defaults are placeholders; tests override. */
  dispatchConfig?: Partial<DispatchConfig>;
  /** Per-user cap per minute on quote/booking creation. */
  bookingRateLimitMax?: number;
  /** Address-search / route-preview calls one signed-in user may make per minute. Default 60. */
  locationsPerMinute?: number;
  /** Live-event delivery to connected apps. Defaults to a no-op (REST still works everywhere). */
  realtimeBus?: RealtimeBus;
  /** Money policies (commission, unpaid-ride blocking, cash limit). Defaults are placeholders. */
  financeConfig?: Partial<FinanceConfig>;
  /** Development only: lets a rider "complete" a mock payment. Never enable in production. */
  devPayments?: boolean;
  /** Which features are on until staff say otherwise (SOS is switched off in production by the server). */
  featureDefaults?: Partial<FlagDefaults>;
  /** An SOS nobody acknowledges within this time is escalated. Default 2 minutes. */
  safetyAckWindowMs?: number;
  /** Web address a shared trip is shown at, used in emergency texts. */
  tripLinkBase?: string | undefined;
  /** Writes (POST/PUT/PATCH/DELETE) one signed-in caller may make per minute across the whole API. Default 120. */
  callerWriteLimitPerMinute?: number;
  /** Quotes carrying a coupon code one caller may ask for per 5 minutes (stops code guessing). Default 15. */
  couponGuessLimit?: number;
  /** Where monitor alerts are sent (Slack/Discord-style webhook). Empty = logged only. */
  alertWebhookUrl?: string | undefined;
  /** Token a metrics tool uses for GET /metrics. Without it that endpoint is off. */
  metricsToken?: string | undefined;
  /** Where the admin panel lives, for links in staff emails. */
  staffPortalUrl?: string | undefined;
  environmentName?: string;
  monitorConfig?: Partial<MonitorConfig>;
};

/** Who is calling, for rate limits: a hash of the login token, else the network address. */
function callerKey(req: express.Request): string {
  const header = req.header('authorization');
  return header
    ? `t:${createHash('sha256').update(header).digest('hex').slice(0, 24)}`
    : `ip:${req.ip}`;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);
  const metrics = createMetrics(deps.now);
  app.use(metrics.middleware);
  app.use(
    pinoHttp({
      logger: deps.logger,
      genReqId: (req) => (req as express.Request).id,
      // Health probes are noisy; keep them out of access logs.
      autoLogging: { ignore: (req) => (req.url ?? '').includes('/health/') },
    }),
  );
  app.use(helmet());
  // Narrow CORS: only explicitly listed origins; no wildcard.
  app.use(cors({ origin: deps.corsOrigins, credentials: false }));
  app.use(globalRateLimiter(deps.rateLimitMax));
  // Razorpay's webhook is signed over the EXACT bytes it sends, so it is read raw, before the JSON parser.
  let paymentsForWebhook: PaymentsService | null = null;
  let payoutsForWebhook: PayoutsService | null = null;
  app.post(
    '/api/v1/webhooks/razorpay',
    express.raw({ type: () => true, limit: '200kb' }),
    async (req, res) => {
      if (!paymentsForWebhook) throw new AppError('SERVICE_UNAVAILABLE');
      const result = await paymentsForWebhook.handleWebhook(
        Buffer.isBuffer(req.body) ? req.body : Buffer.from(''),
        String(req.header('x-razorpay-signature') ?? ''),
        req.header('x-razorpay-event-id') ?? undefined,
      );
      res.status(200).json({ success: true, data: { received: true, outcome: result.outcome } });
    },
  );
  // The payout service (RazorpayX) signs its webhooks the same way, with its own secret.
  app.post(
    '/api/v1/webhooks/razorpayx',
    express.raw({ type: () => true, limit: '200kb' }),
    async (req, res) => {
      if (!payoutsForWebhook) throw new AppError('SERVICE_UNAVAILABLE');
      const result = await payoutsForWebhook.handleWebhook(
        Buffer.isBuffer(req.body) ? req.body : Buffer.from(''),
        String(req.header('x-razorpay-signature') ?? ''),
        req.header('x-razorpay-event-id') ?? undefined,
      );
      res.status(200).json({ success: true, data: { received: true, outcome: result.outcome } });
    },
  );
  // Signed file links (server upload folder). The body is the file itself, streamed to disk, so these
  // sit before the JSON parser. Without local storage both answer 404.
  const localFiles = (deps.providers.storage as { handlers?: LocalFilesHandlers }).handlers;
  const noLocalFiles: RequestHandler = () => {
    throw new AppError('NOT_FOUND');
  };
  const noStore: RequestHandler = (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
  app.put('/api/v1/files/upload', noStore, localFiles?.upload ?? noLocalFiles);
  app.get('/api/v1/files/download', noStore, localFiles?.download ?? noLocalFiles);
  app.use(express.json({ limit: '100kb' }));

  const v1 = express.Router();
  // API answers can hold ride details, phone numbers and tokens: never let a proxy or browser keep them.
  v1.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // One caller cannot hammer any write endpoint, whatever its own limits are. Keyed by the login token
  // (or the address when there is none); reads and the payment webhook are not counted.
  v1.use(
    rateLimit({
      ...limiterStore('caller-writes'),
      windowMs: 60_000,
      limit: deps.callerWriteLimitPerMinute ?? 120,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
      keyGenerator: (req) => callerKey(req),
      handler: (_req, _res, next) => next(new AppError('RATE_LIMITED')),
    }),
  );
  // Guessing coupon codes: only quotes that carry a code count here.
  v1.use(
    '/fare-quotes',
    rateLimit({
      ...limiterStore('coupon-guess'),
      windowMs: 5 * 60_000,
      limit: deps.couponGuessLimit ?? 15,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) =>
        req.method !== 'POST' ||
        !(req.body && typeof req.body === 'object' && 'couponCode' in req.body),
      keyGenerator: (req) => callerKey(req),
      handler: (_req, _res, next) => next(new AppError('RATE_LIMITED')),
    }),
  );
  v1.use(healthRouter(deps.readinessChecks, deps.isShuttingDown ?? (() => false)));
  const ctx: ModuleContext = {
    logger: deps.logger,
    providers: deps.providers,
    audit: createAuditService(),
    authenticate: authenticate(deps.authConfig.accessSecret),
    now: deps.now ?? (() => new Date()),
  };
  const authLimiter = rateLimit({
    ...limiterStore('auth'),
    windowMs: 15 * 60_000,
    limit: deps.authRateLimitMax ?? 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError('RATE_LIMITED')),
  });
  const authService = createAuthService(deps.authConfig, deps.providers, deps.logger);
  v1.use(authRouter(authService, ctx.authenticate, authLimiter));
  const staffAuth = createStaffAuthService({
    hashSecret: deps.authConfig.hashSecret,
    staffRefreshTtlHours: deps.authConfig.staffRefreshTtlHours,
    portalUrl: deps.staffPortalUrl ?? 'http://localhost:3000',
    auth: authService,
    email: deps.providers.email,
    audit: ctx.audit,
    now: ctx.now,
    logger: deps.logger,
  });
  v1.use(staffAuthRouter(ctx, staffAuth, authLimiter, authService));
  v1.use(customersRouter(ctx));
  v1.use(categoriesRouter(ctx));
  v1.use(vehiclesRouter(ctx));
  v1.use(auditRouter(ctx));

  // Phase 2: zones -> pricing -> quotes -> bookings (each depends on the one before it).
  const zones = createZonesService({ audit: ctx.audit });
  const pricing = createPricingService({ audit: ctx.audit, now: ctx.now });
  const cancellationPolicy = createCancellationPolicyService({ audit: ctx.audit, now: ctx.now });
  const flags = createFlagsService({
    audit: ctx.audit,
    defaults: {
      SOS: true,
      TRIP_SHARING: true,
      SUPPORT_TICKETS: true,
      RATINGS: true,
      COUPONS: true,
      TIPS: true,
      WALLET: true,
      CORPORATE: true,
      REFERRALS: true,
      ...deps.featureDefaults,
    },
  });
  const coupons = createCouponsService({
    flags,
    audit: ctx.audit,
    now: ctx.now,
    logger: deps.logger,
  });
  const dispatchConfig: DispatchConfig = { ...defaultDispatchConfig, ...deps.dispatchConfig };
  const trips = createTripsService({ audit: ctx.audit, zones });
  const quotes = createQuotesService({
    taxBp: deps.financeConfig?.rideTaxBp ?? defaultFinanceConfig.rideTaxBp,
    trips,
    outstationMaxDays: dispatchConfig.outstationMaxDays,
    zones,
    pricing,
    maps: deps.providers.maps,
    now: ctx.now,
    coupons,
    schedule: {
      minLeadMs: dispatchConfig.scheduleMinLeadMs,
      maxAheadMs: dispatchConfig.scheduleMaxAheadMs,
    },
  });
  const bus = deps.realtimeBus ?? nullBus;
  const notifications = createNotificationsService({
    push: deps.providers.push,
    sms: deps.providers.sms,
    audit: ctx.audit,
    now: ctx.now,
    logger: deps.logger,
  });
  const notifier = createNotifier({
    bus,
    notifications,
    now: ctx.now,
    logger: deps.logger,
    config: dispatchConfig,
  });
  const dispatch = createDispatchService({
    maps: deps.providers.maps,
    now: ctx.now,
    config: dispatchConfig,
    logger: deps.logger,
    notifier,
  });
  // Phase 6: money. The ledger is the single record of who owes whom.
  const financeConfig: FinanceConfig = { ...defaultFinanceConfig, ...deps.financeConfig };
  const ledger = createLedgerService({ now: ctx.now, logger: deps.logger, config: financeConfig });
  const commission = createCommissionService({
    audit: ctx.audit,
    now: ctx.now,
    defaultRateBp: financeConfig.defaultCommissionBp,
  });
  const balances = createBalancesService({
    ledger,
    audit: ctx.audit,
    now: ctx.now,
    config: financeConfig,
  });
  const wallet = createWalletService({ ledger, now: ctx.now, config: financeConfig });
  const payments = createPaymentsService({
    wallet,
    provider: deps.providers.payments,
    ledger,
    audit: ctx.audit,
    now: ctx.now,
    logger: deps.logger,
    config: financeConfig,
  });
  paymentsForWebhook = payments;
  const cash = createCashService({ ledger, audit: ctx.audit, now: ctx.now, config: financeConfig });
  const settlements = createSettlementsService({
    ledger,
    audit: ctx.audit,
    now: ctx.now,
    config: financeConfig,
  });
  const payouts = createPayoutsService({
    provider: deps.providers.payouts,
    settlements,
    notifications,
    audit: ctx.audit,
    now: ctx.now,
    logger: deps.logger,
    config: financeConfig,
  });
  payoutsForWebhook = payouts;
  const finance = {
    run: async () => {
      await payments.reconcile();
      await ledger.reconcile();
      await cash.reconcile();
      await settlements.reconcile();
      await payouts.reconcile();
      await corporate.reconcile();
    },
  };
  const presence = createPresenceService({
    now: ctx.now,
    config: dispatchConfig,
    notifier,
    cashLimit: { ledger, limitPaise: financeConfig.driverCashLimitPaise },
  });
  const rides = createRidesService({
    now: ctx.now,
    config: dispatchConfig,
    maps: deps.providers.maps,
    dispatch,
    otpSecret: deps.authConfig.hashSecret,
    notifier,
    quotes,
    ledger,
  });
  const corporate = createCorporateService({
    ledger,
    flags,
    audit: ctx.audit,
    notifications,
    now: ctx.now,
    logger: deps.logger,
    reconcileGraceMs: financeConfig.reconcileGraceMs,
    email: deps.providers.email,
    finance: financeConfig,
  });
  const bookings = createBookingsService({
    corporate,
    quotes,
    policy: cancellationPolicy,
    commission,
    balances,
    coupons,
    dispatch,
    logger: deps.logger,
    now: ctx.now,
    maxScheduledPerRider: dispatchConfig.maxScheduledPerRider,
    scheduleOverlapMs: dispatchConfig.scheduleOverlapMs,
  });
  const scheduled = createScheduledService({
    dispatch,
    notifications,
    audit: ctx.audit,
    config: dispatchConfig,
    now: ctx.now,
    logger: deps.logger,
  });
  const documentExpiry = createDocumentExpiryService({
    notifications,
    now: ctx.now,
    logger: deps.logger,
  });
  const writeLimiter = userRateLimiter(deps.bookingRateLimitMax ?? 30);
  v1.use(zonesRouter(ctx, zones));
  v1.use(pricingRouter(ctx, pricing));
  v1.use(cancellationPolicyRouter(ctx, cancellationPolicy));
  v1.use(quotesRouter(ctx, quotes, writeLimiter));
  v1.use(
    locationsRouter(
      ctx,
      createLocationsService({ maps: deps.providers.maps }),
      deps.locationsPerMinute,
    ),
  );
  v1.use(bookingsRouter(ctx, bookings, writeLimiter));
  v1.use(scheduledRouter(ctx, scheduled));
  v1.use(presenceRouter(ctx, presence));
  v1.use(dispatchRouter(ctx, dispatch));
  v1.use(ridesRouter(ctx, rides));
  v1.use(
    adminRouter(ctx, createAdminService({ audit: ctx.audit, now: ctx.now, bus, notifier, ledger, dispatch })),
  );
  v1.use(driversRouter(ctx));
  v1.use(notificationsRouter(ctx, notifications));
  v1.use(
    financeRouter(ctx, {
      payments,
      cash,
      settlements,
      balances,
      commission,
      devPayments: deps.devPayments === true,
    }),
  );
  // Tips and the wallet (build on the payments above).
  const tips = createTipsService({
    payments,
    flags,
    notifications,
    now: ctx.now,
    config: financeConfig,
    logger: deps.logger,
  });
  payments.setPaidHook(tips.onPaid);
  v1.use(tipsRouter(ctx, tips));
  v1.use(tripsRouter(ctx, trips));
  const privacy = createPrivacyService({
    ledger,
    audit: ctx.audit,
    notifications,
    now: ctx.now,
    logger: deps.logger,
  });
  v1.use(privacyRouter(ctx, privacy));
  v1.use(corporateRouter(ctx, corporate));
  v1.use(analyticsRouter(ctx, createAnalyticsService({ now: ctx.now })));
  v1.use(payoutsRouter(ctx, payouts, { devPayments: deps.devPayments === true }));
  v1.use(walletRouter(ctx, { wallet, payments, flags }));
  // Phase 7: safety, support, ratings, reports, staff, flags, coupons.
  const safety = createSafetyService({
    flags,
    audit: ctx.audit,
    notifications,
    bus,
    sms: deps.providers.sms,
    now: ctx.now,
    logger: deps.logger,
    ackWindowMs: deps.safetyAckWindowMs ?? 120_000,
    tripLinkBase: deps.tripLinkBase,
  });
  const support = createSupportService({
    flags,
    audit: ctx.audit,
    notifications,
    now: ctx.now,
    firstResponseSlaMs: 24 * 3_600_000,
  });
  const ratings = createRatingsService({
    flags,
    audit: ctx.audit,
    now: ctx.now,
    windowMs: 7 * 86_400_000,
    minRatingsShown: 5,
  });
  const reports = createReportsService({ audit: ctx.audit, now: ctx.now });
  const staff = createStaffService({ audit: ctx.audit, now: ctx.now, bus, credentials: staffAuth });
  v1.use(flagsRouter(ctx, flags));
  v1.use(staffRouter(ctx, staff));
  v1.use(couponsRouter(ctx, coupons));
  const referrals = createReferralsService({ flags, audit: ctx.audit, now: ctx.now });
  v1.use(referralsRouter(ctx, referrals));
  v1.use(safetyRouter(ctx, safety));
  v1.use(supportRouter(ctx, support));
  v1.use(ratingsRouter(ctx, ratings));
  v1.use(reportsRouter(ctx, reports));
  // Small repairs that are not about money: rating averages, coupon uses for rides that never happened.
  const housekeeping = {
    run: async () => {
      await ratings.reconcile();
      await privacy.run();
      await coupons.reconcile();
    },
  };
  const monitor = createMonitorService({
    ledger,
    errorWindow: metrics.window,
    logger: deps.logger,
    now: ctx.now,
    config: deps.monitorConfig,
    alertWebhookUrl: deps.alertWebhookUrl,
    environment: deps.environmentName,
  });
  v1.use(monitorRouter(ctx, monitor, metrics, deps.metricsToken));
  // Background jobs (the dispatch sweeper) and tests reach services through here.
  app.locals['services'] = {
    privacy,
    corporate,
    scheduled,
    payouts,
    tips,
    wallet,
    metrics,
    monitor,
    flags,
    safety,
    coupons,
    referrals,
    ratings,
    housekeeping,
    dispatch,
    presence,
    notifications,
    documentExpiry,
    finance,
    ledger,
    payments,
  };
  v1.get('/openapi.json', (_req, res) => {
    res.json(openApiSpec);
  });
  app.use('/api/v1', v1);

  app.use(notFound);
  app.use(errorHandler(deps.logger));
  return app;
}
