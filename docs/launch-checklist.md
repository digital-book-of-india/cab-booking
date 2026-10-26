# Launch checklist (production)

Owner: Dev 1. Work top to bottom. Everything marked **YOU** needs an account, a decision or a signature that code cannot supply. Run `npm run preflight:prod` (inside the container: `node dist/tools/preflightRun.js`) at the end: it exits 1 while anything blocks.

## 1. Accounts and keys (YOU)

| Item | Done when |
|---|---|
| Razorpay **live** keys + webhook secret | `RAZORPAY_KEY_ID` starts `rzp_live_`; webhook points at `https://<api>/api/v1/webhooks/razorpay` |
| RazorpayX live account number + keys + webhook | `PAYOUTS_DRIVER=razorpayx`, webhook `.../webhooks/razorpayx` |
| Google Maps key with billing | Routes, Geocoding and Places (New) enabled, a daily quota set, restricted to the server IP |
| SMS gateway, DLT-approved OTP template and **emergency-alert template** | `SMS_TEMPLATE_ID` and `SMS_ALERT_TEMPLATE_ID` set; the text arrives word for word |
| Firebase production project | `FCM_SERVICE_ACCOUNT_JSON` from the production project, not staging |
| SMTP account and a verified sender | `EMAIL_FROM` is a domain you own (SPF/DKIM set) |
| Production database | New Atlas cluster or database name; paid tier with backups and point-in-time restore; network access limited to the server IP |
| Redis | Real Redis, `REDIS_URL` set (the server refuses to start in production without it) |
| Alert webhook | `ALERT_WEBHOOK_URL`; `POST /admin/system/test-alert` returns `delivered: true` |

## 2. Credentials that were exposed (YOU)

The Atlas username and password for the development cluster, and the secrets in `backend/.env.bak-1792739369`, were pasted into chat or left in a backup file. Treat them as leaked:

1. Atlas: create a new database user, delete the old one.
2. Generate fresh values for every secret, never reuse the development ones: `openssl rand -hex 48` for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `UPLOAD_SIGNING_SECRET` (all different), plus new webhook secrets and `METRICS_TOKEN`.
3. Delete `backend/.env.bak-1792739369`. Check `git log -p -- '*.env*'` shows no secret was ever committed; if one was, rotate it and rewrite history.
4. Rotate any vendor key that was ever in a chat or screenshot.

## 3. Settings (production `.env`)

- `NODE_ENV=production`, `PROVIDER_MODE=live`, every `*_DRIVER` real.
- `CORS_ORIGINS` = the admin panel's HTTPS address only. `STAFF_PORTAL_URL`, `UPLOAD_PUBLIC_URL`, `TRIP_LINK_BASE` all HTTPS and public.
- `STAGING_FIXED_OTP` and `LOAD_TEST_MODE` absent. (The server refuses to start with them.)
- `STORAGE_DRIVER=s3` (R2 / S3) if you will ever run more than one api instance. `local` is single-instance only.
- `SELLER_GSTIN`, `SELLER_ADDRESS`, `SELLER_SAC_CODE` filled in. `INVOICE_TAX_BP=0` while `RIDE_TAX_BP` is on.
- `RIDE_TAX_BP` / `COMMISSION_TAX_BP` confirmed by an accountant, then `TAX_RATES_CONFIRMED=1` to silence the warning.
- `AUTO_PAYOUTS=false` for the first weeks: a person presses pay and watches the first real payouts.

## 4. Business data (YOU)

The seed creates a **placeholder** Delhi zone, three cab types and fares. Replace with real zones, cab types, fares, commission, cancellation fees, cash limit and the city GPS-billing policy (`cityDistanceBilling`, currently `QUOTED`) before any real booking.

## 5. Safety desk

SOS is **off by default in production** (`featureDefaults: { SOS: env.NODE_ENV !== 'production' }`). Do not switch it on (`PUT /admin/feature-flags/SOS`) until:

- someone is staffed to answer SOS alerts around the clock the app is open,
- the emergency SMS template is DLT-approved and a real test text reached a phone,
- the runbook's SOS section has been rehearsed.

When it is on, set `SAFETY_DESK_STAFFED=1` for the pre-flight check (it blocks if SOS is on and this is not set).

## 6. Verification (run in this order)

1. `npm run build && npm run lint && npm run format:check`.
2. `npm run gate` (the release-blocking subset) and `npm test` (everything). Run them with production-like settings, from a clean checkout of the release commit.
3. On the production host with **real** keys: `node dist/tools/verifyLiveRun.js` with `BASE_URL` set. Every row must be PASS (a SKIP is not acceptable for a launch).
4. One real small payment with a real card, then a real refund; one real payout of a small amount to a bank account you hold.
5. `node dist/db/runIndexes.js`, then the backup tool: `dump --encrypt`, `verify`, and a restore drill into a temporary database, `compare` says IDENTICAL. Keep the `BACKUP_ENCRYPTION_KEY` in a password manager.
6. `npm run preflight:prod` exits 0.
7. Staging load test at expected peak plus margin (see `docs/staging-deploy.md`), results in `docs/load-test-results.md`.

## 7. Day of launch

- Deploy the release commit, run indexes, run `verifyLiveRun`, run `preflight:prod`.
- Watch alerts, `/health/ready`, and the ledger consistency check (`/admin/finance/consistency`) for the first hours.
- Know the rollback: previous image, `docker compose up -d`; the database changes are additive.
