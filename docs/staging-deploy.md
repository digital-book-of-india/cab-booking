# Deploying staging (one small server)

This is the step-by-step for the files in `infra/staging/`. **None of it has been run yet**: Docker was not available on the machine where it was written, so the first real run will find mistakes. The built server itself was started in live mode and checked (see "What was checked" at the end).

## What you need first

| Thing | Notes |
|---|---|
| A server (VM) | Ubuntu 22.04 or similar, 2 vCPU / 2 GB RAM is enough for staging. Public IP. Ports 22, 80 and 443 open. |
| A DNS name | An A record, e.g. `staging.yourdomain.com`, pointing at the server's IP. Caddy needs it to get the HTTPS certificate. |
| MongoDB Atlas | A cluster (a replica set). Use a **new database name** for staging. Allow the server's IP in Atlas network access. |
| Vendor TEST accounts | Razorpay (test keys), RazorpayX (test), a Firebase project, an SMTP account, the SMS gateway (DLT templates), a Google Maps key (see below). Any you do not have yet can stay on `mock`: set that `*_DRIVER=mock` **and** `PROVIDER_MODE=mock`. Live mode refuses to start while any one is still a mock. |

Google Maps key: create it in the Google Cloud console, enable **Routes API**, **Geocoding API** and **Places API (New)**, set a daily quota, and restrict it to the server's IP address.

## First deploy

On the server:

```bash
# 1. Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER      # log out and in again

# 2. The code
git clone <your repository> cab && cd cab/infra/staging

# 3. Settings (git-ignored file; this is where every secret lives)
cp env.staging.example .env.staging
nano .env.staging                  # fill it in; generate secrets as the file says

# 4. Start
docker compose --env-file .env.staging up -d --build
docker compose --env-file .env.staging logs -f api     # wait for "server listening"

# 5. Database: create the indexes, then the first data (once)
docker compose --env-file .env.staging run --rm api node dist/db/runIndexes.js
SEED_ADMIN_PHONE=+91XXXXXXXXXX docker compose --env-file .env.staging run --rm api node dist/seed/run.js
```

Open `https://<your domain>/api/v1/health/ready`. It should say `ready` with `mongo` and `redis` up.

The seed creates the **placeholder** Delhi zone, three cab types and fares. Replace them with real ones before anyone tests pricing.

## Point the vendors at the server

| Vendor | Setting |
|---|---|
| Razorpay (test mode) → Webhooks | `https://<domain>/api/v1/webhooks/razorpay`, the same secret as `RAZORPAY_WEBHOOK_SECRET`, events `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`, `refund.failed` |
| RazorpayX → Webhooks | `https://<domain>/api/v1/webhooks/razorpayx`, secret `RAZORPAYX_WEBHOOK_SECRET`, events `payout.processed`, `payout.failed`, `payout.reversed`, `payout.rejected` |

## Check every integration

Run the checker inside the stack. By default it sends nothing to any person.

```bash
docker compose --env-file .env.staging run --rm \
  -e BASE_URL=https://<domain> -e VERIFY_OUTPUT=/tmp/verify.json \
  api node dist/tools/verifyLiveRun.js
```

It prints PASS / FAIL / SKIP for the database, Redis, maps, payments, storage and the deployed server. Add these, one at a time, to also test the ones that contact someone or something (add each as another `-e` before `api`):

| Setting | Does |
|---|---|
| `-e VERIFY_PHONE=+91XXXXXXXXXX` | sends ONE SMS to a phone you hold |
| `-e VERIFY_EMAIL=you@example.com` | sends ONE email |
| `-e VERIFY_FCM_TOKEN=<device token>` | sends ONE push (get the token from a test device) |
| `-e VERIFY_PAYOUTS=1` | registers a TEST contact and UPI id with RazorpayX (no money moves) |

A check that FAILs says why. A check that is SKIPped says what to set. **Write the result of each into `docs/platform-status.md`** (date, PASS/FAIL), then fix the FAILs before moving on.

Two things the checker cannot do for you, because they need a person:
1. A real Razorpay test **checkout** and a real **refund** (webhooks only arrive after a payment is made). Follow `docs/mobile-integration-guide.md` section 9 "Payments" with Razorpay's test card, then refund it from the staff API, and confirm the booking becomes `PAID` and later `REFUNDED`.
2. Whether the SMS text arrives **word for word** as the DLT template. If the operator drops it silently, only the phone shows it.

## Load tests

From your own machine (never against production), with `STAGING_FIXED_OTP` set on the server and `LOAD_TEST_MODE=true` added to `.env.staging` for the duration of the test (remove it afterwards):

```bash
cd backend
BASE_URL=https://<domain> FIXED_OTP=123456 RIDERS=200 CONCURRENCY=40 npm run loadtest
BASE_URL=https://<domain> FIXED_OTP=123456 ADMIN_PHONE=+91XXXXXXXXXX DRIVERS=50 RIDERS=100 DURATION_SECONDS=300 npm run loadtest:rides
```

Record the numbers in `docs/load-test-results.md`.

## Alerts

1. Create an incoming webhook in Slack or Discord and put its address in `.env.staging` as `ALERT_WEBHOOK_URL`, then `docker compose --env-file .env.staging up -d`.
2. Prove it works, as an OPS or SUPER_ADMIN login: `POST /api/v1/admin/system/test-alert`. The answer says `webhookConfigured` and `delivered` (`delivered: true` only if the channel accepted it). A message starting `[staging] TEST ALERT` should appear in the channel. If `delivered` is false, the webhook address is wrong or deleted.
3. Do this again after any change to the webhook. What each real alert means and what to do is in `docs/runbook.md`.

## Backups

Back up the database and the uploads volume on a schedule and copy both off the server; commands and the restore drill are in `docs/runbook.md` ("Backups and restore"). The free Atlas tier has no backups of its own.

## Updating, logs, rollback

```bash
git pull
docker compose --env-file .env.staging up -d --build        # rebuilds and restarts the api
docker compose --env-file .env.staging run --rm api node dist/db/runIndexes.js   # whenever a release adds indexes
docker compose --env-file .env.staging logs --since 1h api   # JSON lines, one per request
docker compose --env-file .env.staging ps
```

Rollback: `git checkout <previous commit>` and run the same `up -d --build`.

## The uploads volume (driver documents)

Driver documents are files on this server's disk, in the Docker volume `uploads`. Until storage moves to S3/R2:

- **Run one api container only.** Do not scale `api` to more than one.
- **Back the volume up**, or a lost server loses every document. Example, daily from cron:
  `docker run --rm -v cab_uploads:/data -v $HOME/backups:/backup alpine tar czf /backup/uploads-$(date +%F).tar.gz -C /data .`
  (the volume name is `<folder>_uploads`; check with `docker volume ls`). Copy the backups off the server.

## What was checked while writing this

- The built server (`node dist/server.js`) was started in live mode (every integration on a real adapter, with fake credentials), against a throwaway Atlas database that was deleted afterwards. It reported ready with MongoDB up; the checker then passed a real file upload, read-back and delete through the signed links, the health and API-description endpoints, the security headers, and the closed-door checks (no token → 401, unsigned file link refused, forged webhook refused).
- Not checked: the Dockerfile build, `docker-compose.yml`, the Caddy HTTPS setup, Redis in the stack, any real vendor account.
