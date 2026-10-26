# Staging plan and observability baseline

## Environments
| Env | Purpose | Providers |
|---|---|---|
| local | Developer machine; `infra/docker-compose.yml` | mocks |
| staging | Shared URL for app/admin developers and QA (Day-2 target) | provider **test mode** (Razorpay test, Maps key with quota) |
| production | Pilot and later | live only; `PROVIDER_MODE=mock` is rejected at boot |

**Hosting is undecided** (question to lead). Requirements: Node 20 runtime, managed MongoDB replica set (e.g. Atlas),
managed Redis, HTTPS, secret store, log shipping. Staging is deployed in Phase 3.5; Phase 0 only provides the
CI pipeline (`.github/workflows/ci.yml`) and the health endpoints a platform needs.

## Deployment checklist (to be filled when hosting is chosen)
- Build: `npm ci && npm run build`; start: `npm start`.
- Release step, BEFORE starting the new version: `npm run indexes:prod` (creates any new indexes; production does not build them at boot). Add `-- --prune` when an existing index changed shape (Phase 5 changed the vehicle registration index) or you mean to drop indexes no schema declares.
- First deploy only: `npm run seed:prod`, then replace the placeholder zone and fares with real ones (fare configs are versioned: add new versions, deactivate the placeholder zone).
- Liveness probe: `GET /api/v1/health/live`; readiness probe: `GET /api/v1/health/ready`.
- SIGTERM triggers graceful shutdown: readiness turns 503, server stops accepting, connections close (10 s hard cap).
- Secrets from the platform secret store, never from Git.
- **Run ONE instance while driver documents are on the server disk** (`STORAGE_DRIVER=local`): the files belong to one machine. With `REDIS_URL` set, the socket adapter and rate-limit counts are shared between instances (built, not yet tested with two real instances), and the database sweeper, reconciler and push worker are safe on several instances. Moving storage to S3/R2 removes the one-instance limit.
- **Step-by-step staging deploy:** `docs/staging-deploy.md` (files in `infra/staging/`). Check every integration with `npm run verify:live` (or `node dist/tools/verifyLiveRun.js` on the server).
- WebSockets must be allowed by the host/load balancer (sticky sessions are not needed with the websocket transport only).
- Real payments: set `PAYMENTS_DRIVER=razorpay` with `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (TEST keys outside production). In the Razorpay dashboard add a webhook to `https://<api-host>/api/v1/webhooks/razorpay` with the same secret and the events `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`, `refund.failed`. Leave `PAYMENTS_DRIVER` unset for mock payments (no real money; a development-only completion route is exposed outside production).
- Run `npm run indexes:prod` on release: Phase 6 added the ledger, payments, refunds, settlements and webhook collections.
- Real push: set `PUSH_DRIVER=fcm` and `FCM_SERVICE_ACCOUNT_JSON`; leave both unset to keep mock push.

## Observability baseline (Phase 0)
- Structured JSON logs (pino) with `requestId` on every line; request logging via pino-http (health probes excluded).
- Redaction: authorization header, cookies, passwords, OTPs, tokens, payment signatures.
- `X-Request-Id` on every response; the same id appears in error envelopes.

## Deferred to Phase 8 (listed so they are not forgotten)
Metrics (latency, dispatch timeouts, GPS staleness, payment failures, webhook lag, queue depth), error tracking
(e.g. Sentry), alerting, log shipping, backups and restore drill.

## Phase 7 additions
- **New background jobs** (started by the server with the other timers): safety escalation every 30 s (an SOS not acknowledged in 2 minutes is raised to super admins), housekeeping every 60 s (rating averages repaired from the ratings; coupon uses given back for bookings that never became rides).
- **Release step:** run `npm run indexes:prod` after deploying Phase 7 (new collections: feature flags, emergency contacts, safety incidents, trip shares, support tickets, ratings, coupons, coupon usage). Add `-- --prune` only if the report says an index changed shape.
- **SOS in production:** `featureDefaults.SOS` is `false` when `NODE_ENV=production`. Switch it on with `PUT /admin/feature-flags/SOS` `{ "enabled": true }` only when someone is staffed to answer `ops:sos`.
- **Alerts worth setting up in Phase 8:** an incident `OPEN` for more than 2 minutes, `ESCALATED` events, CSV exports of more than 10,000 rows, `report.export` and `safety.incident.view` audit entries.
- **Real SMS** (`backend/src/providers/nimbus.ts`, NOT yet verified live): set `SMS_DRIVER=nimbus` plus `SMS_API_URL, SMS_USER_ID, SMS_PASSWORD, SMS_SENDER_ID, SMS_ENTITY_ID, SMS_TEMPLATE_ID` (the DLT template for the login OTP) and `SMS_OTP_MESSAGE` (the exact registered wording with `{otp}`). Emergency texts to saved contacts are sent only if `SMS_ALERT_TEMPLATE_ID` is also set (a second DLT template: "{#var#} has raised an emergency alert during a ride. Follow the trip: {#var#}"); set `TRIP_LINK_BASE` to the web page that shows a shared trip. First live check: one OTP to a phone you hold.
- **Real push**: create a Firebase project, download a service-account JSON key, put it (one line) in `FCM_SERVICE_ACCOUNT_JSON` and set `PUSH_DRIVER=fcm`. Adapter is built and unit-tested; first live check is one push to a real device.

## Phase 8 additions
- **Monitor** (`monitoring/monitor.service.ts`): runs every 60 s as a background job and on demand at `GET /admin/system/health`. Set `ALERT_WEBHOOK_URL` to a Slack/Discord-style incoming webhook (accepts `{ "text": "..." }`) to get alerts; without it alerts are only in the log (`"alert": true`). What each alert means and what to do: `docs/runbook.md`.
- **Thresholds** (code defaults, `MonitorConfig`): search stuck 10 min, SOS open 5 min, push waiting 5 min, money grace 10 min, a job dead after 5 missed runs, same alert repeated every 30 min.
- **Limits** (code defaults): 120 writes/min per caller, 15 coupon-code quotes per 5 min, 120 socket connection attempts/min per address, HTTP header timeout 15 s, request timeout 30 s, keep-alive 65 s.
- **Start-up checks:** `CORS_ORIGINS` may not contain `*` in staging/production; access and refresh JWT secrets must differ.
- **Metrics** (`monitoring/metrics.ts`, in memory per server instance): request count and speed per route pattern (never real ids), status classes, server errors in the last 5 minutes, memory and event-loop lag. Read them at `GET /admin/system/metrics` (OPS, SUPER_ADMIN) or, for a metrics tool, `GET /api/v1/metrics` in Prometheus text with `Authorization: Bearer <METRICS_TOKEN>` (set `METRICS_TOKEN`, 16+ characters; without it that endpoint does not exist). The monitor raises `error_rate` when 5+ server errors happen in 5 minutes and they are 5%+ of requests. Not built: Sentry-style error grouping; the log (`unhandled error`, with request id) is the record.
- **Load tests** (server needs `STAGING_FIXED_OTP` and raised limits for the test machine; never production):
  - Riders only: `BASE_URL=https://<staging> FIXED_OTP=<code> RIDERS=200 CONCURRENCY=40 npm run loadtest`. Sign-in, quote, book, cancel, live connection.
  - Full rides: `BASE_URL=... FIXED_OTP=<code> ADMIN_PHONE=<staff phone> DRIVERS=20 RIDERS=30 DURATION_SECONDS=120 npm run loadtest:rides`. Creates approved drivers through the staff API, drivers send locations and answer offers, riders book, every ride is driven to completion. Reports time to assign a driver, rides completed, location updates and speed per endpoint. The staff account must exist (seed) and sign in with the fixed OTP.
  - Both exit non-zero above 1% server errors/no-answer (4xx rule answers and rate limits are not counted as errors).
- **Local load test (one command):** `npm run loadtest:local` starts an in-memory database, the real server with `LOAD_TEST_MODE=true`, runs both load tests and writes `load-results.json` (ignored by git). Sizes by environment: `RIDERS`, `CONCURRENCY`, `DRIVERS`, `RIDE_RIDERS`, `DURATION_SECONDS`, `SKIP_RIDERS=true`. Results and findings: `docs/load-test-results.md`.
- **LOAD_TEST_MODE=true** lifts every rate limit (needed to load test staging; the server refuses to start with it in production).
- **Release gate:** `npm run gate`; checklist in `docs/release-gate.md`.

## Tips, wallet and payouts additions
- **Payout service (RazorpayX).** `PAYOUTS_DRIVER=razorpayx` plus `RAZORPAYX_KEY_ID`, `RAZORPAYX_KEY_SECRET`, `RAZORPAYX_ACCOUNT_NUMBER` (your RazorpayX current account), `RAZORPAYX_WEBHOOK_SECRET`. Webhook URL: `https://<host>/api/v1/webhooks/razorpayx` for `payout.processed`, `payout.failed`, `payout.reversed`, `payout.rejected`. `mock` (default) sends nothing; in development `POST /dev/payouts/{id}/complete` (finance login) finishes a mock payout. NOT verified live: first check is one small payout to an account you control, using a RazorpayX TEST account.
- **Automatic payouts.** `AUTO_PAYOUTS=true`: the finance job (every minute) pays approved settlements whose driver has a verified account, at most 20 per run, and stops retrying after 3 failures (a person looks). Default `false`: finance presses "pay" (`POST /admin/settlements/{id}/payout`). Approval of the settlement stays a person's decision either way.
- **Repair job** (`payouts.reconcile`, inside the finance job): re-sends payouts that never got an answer (same idempotency key, so never twice), asks the provider about payouts "on their way" for 10+ minutes (a missed webhook), finishes settlements whose payout is paid.
- **Monitor** check `payouts_need_attention`: a payout unanswered, on its way over a day, or failed and not retried.
- **Wallet** has no extra settings (limits are code defaults in `FinanceConfig`). **Run `npm run indexes`** after deploying (new collections: tips, wallets, payouts, payout accounts).
- **Legal check before real use:** holding rider money in a wallet may fall under RBI rules for prepaid payment instruments (a closed wallet usable only for your own services is generally lighter, but confirm with a lawyer/accountant before enabling `WALLET` in production). Tips and payouts need the same tax review as fares.

## Scheduled rides and analytics additions
- **Job:** `scheduled rides` every 30 s (reminders, start the search near pickup, cancel rides missed by 30+ minutes). Runs on every instance safely (conditional updates).
- **Monitor check** `scheduled_rides_overdue`: a SCHEDULED ride 10+ minutes past its pickup time means the job is not working. Runbook entry added.
- **Settings** (`DispatchConfig`; confirmed by the owner 2026-10-18; change in code): min lead 30 min, max 7 days ahead, search starts 20 min before pickup, reminder 60 min before, missed after 30 min, 5 waiting rides per rider.
- **Analytics** are computed live from the bookings, payments and tips collections. Fine for a pilot; with large volume add a daily rollup table (not built).

## Corporate accounts additions
- **Repair job:** the finance job (every minute) also posts any company payment that was saved but never reached the ledger (`corporate.reconcile`).
- **Monitor check** `corporate_invoices_overdue`: an issued invoice past its due date and unpaid (see the runbook).
- **No settings to set.** Defaults are in code / chosen when finance creates the company. Run `npm run indexes` after deploying (new collections: companies, memberships, invoices, invoice counters).
- Tax (GST) is **not calculated or shown** on invoices. Get the rules from an accountant before sending invoices to real companies.

## Staff login, email, storage and privacy additions
- **Email** (`EMAIL_DRIVER=smtp` + `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`): used for staff invitations and password resets (and later invoices). `mock` (default) only records. NOT verified against a real mail server: first check is a staff invitation to an address you can read.
- **Staff login settings:** `STAFF_OTP_LOGIN` (default true outside production; production refuses true), `STAFF_REFRESH_TTL_HOURS` (12), `STAFF_PORTAL_URL` (the admin panel address used in email links). First super admin: set `SEED_ADMIN_PHONE` and `SEED_ADMIN_EMAIL`, run `npm run seed`, and open the printed one-time setup link.
- **File storage** (`STORAGE_DRIVER=s3` + `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION` (`auto` for Cloudflare R2), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PATH_STYLE` (true for R2/MinIO)): any S3-compatible bucket. Make the bucket PRIVATE and set a CORS rule allowing PUT from the apps if a web client uploads. The signing is checked against AWS's published example; NOT verified against a real bucket: first check is one real upload through a signed link.
- **Privacy job:** the finance job (every minute) also carries out due account deletions and finishes cut-short ones. `npm run indexes` after deploying (new: staff credentials; a user index).
- **Retention policy to decide:** which records are kept after deletion and for how long (money records and invoices for the legal period; driver KYC documents; support tickets). The code keeps money records and driver KYC documents and removes the rest.

## Added in the backend completion pass
- **Redis (optional, `REDIS_URL`):** shared rate-limit counts and live updates across several server instances. Fails open: if Redis is down the API keeps running. Verify on staging with two instances before relying on it.
- **Invoice tax and bonus settings:** `INVOICE_TAX_BP`, `INVOICE_TAX_LABEL`, `SELLER_*`, wallet bonus settings (decisions D116, D117).
- **Trip settings** (code defaults in `dispatch.config.ts`): rental grace 10 min / 2 km, one-way detour 20%, outstation max 30 days.
- **New collections:** `RentalPackage`, `OutstationRate`, `StaffCredential`: run `npm run indexes` after deploying.
- **New health check:** `rides_overrunning` (a city ride in progress for over 6 hours).
