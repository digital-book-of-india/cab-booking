# Platform status (Dev 1: platform, money and integrations)

Last updated: 2026-10-23. Owner of this file: Dev 1. (`CONTEXT.md` and `decisions.md` belong to Dev 2; the decisions below are listed here so they can be copied over.)

## Phase 0: Unblock. DONE

- `PROVIDER_MODE=live` builds the real adapter for every integration. A live config with any integration still on a mock is refused at start-up, and the error names all of them at once.
- CI docker job also checks that live mode with mock drivers is refused.
- `.env.example` rewritten to match what the code reads; Prettier is clean.

## Phase 1: Build. DONE in code (nothing verified against a real vendor yet)

| Item | State |
|---|---|
| Local-disk file storage (`STORAGE_DRIVER=local`) | Built, tested. Signed upload/download links through `PUT /files/upload` and `GET /files/download`. **One server instance only** until storage moves to S3/R2. |
| Google Maps adapter (`MAPS_DRIVER=google`) | Built, tested against a fake network. Not yet run with a real key. |
| Location endpoints | `POST /locations/autocomplete`, `POST /locations/place` (added: needed to turn a suggestion into coordinates), `POST /locations/reverse-geocode`, `POST /routes/estimate`. Customer and driver only, limited per user per minute. |
| Customer cash confirmation | `POST /rides/{rideId}/cash-collection/customer-confirm`. Never moves money; a different amount than the fare is audited as a cash dispute. |
| GPS reconciliation of city fares | Built. Default `QUOTED`: bills the quote, records the trail, flags big mismatches (`DISTANCE_MISMATCH` booking event). `RECONCILED` is switchable in the dispatch config. |
| GST on ride fares and commission | Built. See below. |
| Explicit waiting start/stop | Not built (optional item, not confirmed). The server already measures waiting itself. |

New routes: 7 (228 documented in total). Postman collection regenerated.

## Decisions to copy into `decisions.md`

| ID | Decision | Status |
|---|---|---|
| P1-1 | Driver documents are stored in the server upload folder for now. Files are reached only through signed links (10 min to upload, 5 min to download), never a public folder. The file must be a real JPEG, PNG or PDF within the size limit. Moving to S3/R2 later is a change of `STORAGE_DRIVER` only. | LOCKED for now; single instance |
| P1-2 | Maps answers are never invented: if Google fails twice the call fails with `PROVIDER_ERROR` and the quote is refused, so an outage can stop a booking but never misprice one. Routes are cached for 5 minutes by coordinates rounded to about 11 m. | LOCKED |
| P1-3 | Ride GST is **added on top** of the fare. The rider pays fare + tax. Driver pay, commission and coupon discount are all worked out on the fare **before tax**. The tax is held in `TAX_PAYABLE`. A coupon never reduces the tax. Tax is exact paise (not rounded to a rupee). The rate is frozen on the quote (`taxBp`) so booking and final fare use the same one. | PLACEHOLDER rate, confirm with an accountant |
| P1-4 | Default rates: `RIDE_TAX_BP=500` (5%), `COMMISSION_TAX_BP=1800` (18%). Set either to 0 to turn it off. | PLACEHOLDER |
| P1-5 | GST on the platform's commission is **borne by the driver**: taken out of the driver's share and held in `TAX_PAYABLE`; the platform keeps its full commission. Driver earnings shown by the app are net of it (`earningsPaise`), and `taxPaise` / `commissionTaxPaise` are shown beside them. | PLACEHOLDER, confirm with an accountant |
| P1-6 | Company-invoice tax (`INVOICE_TAX_BP`) must be 0 while `RIDE_TAX_BP` is on, because the tax is already inside each ride. The server refuses to start otherwise. | LOCKED |
| P1-7 | City fares keep billing the quoted distance (`cityDistanceBilling: QUOTED`). Reconciling to the GPS trail (`RECONCILED`: longer than +20% or shorter than -20% bills the trail, between 0.5x and 2x of the quote, trail needs 5+ points) is built but off. A trail more than 30% away from the quote is logged for staff either way. | PLACEHOLDER policy, decide with the lead |

## Known gaps (not done on purpose)

- **Write-offs do not reverse tax.** A written-off ride leaves its GST in `TAX_PAYABLE`. (Refunds do reverse it, see "Completion round" below.) Needs the accountant's rule on bad debt before real money moves.
- **Fees and tips carry no GST** (cancellation/no-show fees, tips, wallet top-ups).
- ~~Reports and analytics "gross" revenue includes the ride tax.~~ Fixed: both reports now also show `taxPaise` and `netFaresPaise` (see "Completion round").
- The new city-distance and tax settings in `dispatch.config.ts` / `finance.config.ts` are placeholders.
- Local storage has no antivirus scan. Orphan cleanup is a manual command (`npm run uploads:sweep`), not scheduled.

## Phase 2: Staging and live verification. TOOLING DONE, live checks waiting on accounts and a host

Built and tested:

- `npm run verify:live` (and `node dist/tools/verifyLiveRun.js` inside the container): checks the database, Redis, maps, payments, payouts, SMS, email, push, file storage and a deployed server, and prints PASS / FAIL / SKIP. A mock driver is always SKIP, never PASS. Anything that contacts a person needs an explicit `VERIFY_*` recipient. 13 tests.
- Staging kit in `infra/staging/` (api + Redis + Caddy HTTPS, Atlas for the database, a volume for uploads), an env template, and `docs/staging-deploy.md` step by step.
- `docs/staging-and-observability.md` corrected (the old "one instance until the Redis adapter exists" note).

Results so far (2026-10-23, from the developer machine):

| Check | Result | Where |
|---|---|---|
| Database reachable | PASS | real Atlas cluster |
| Built server (`node dist/server.js`) boots in live mode and reports ready | PASS | throwaway Atlas database, deleted afterwards |
| Local storage: signed upload, read back, delete | PASS | the built server |
| Server: health, API description, security headers, closed doors (no token 401, unsigned file link refused, forged webhook refused) | PASS | the built server |
| Dockerfile build, `docker-compose.yml`, Caddy HTTPS | NOT RUN | Docker is not installed on this machine |
| Redis, two instances | NOT RUN | no Redis |
| Google Maps (route, geocode, search, place) | NOT RUN | no key |
| Razorpay order / checkout / webhook / refund | NOT RUN | `PAYMENTS_DRIVER` is not set in `.env` (test keys are there) |
| RazorpayX payout account | NOT RUN | no RazorpayX keys |
| Nimbus SMS | NOT RUN | `SMS_DRIVER` is not set; needs `VERIFY_PHONE` |
| SMTP email | NOT RUN | `.env` has SMTP set; needs `VERIFY_EMAIL` |
| Firebase push | NOT RUN | no service account |

To finish Phase 2 someone needs to: get a server and DNS name, put the vendor test accounts into `infra/staging/.env.staging`, run the deploy steps and the checker as `docs/staging-deploy.md` says, and paste the table it prints here.

## Phase 3: Scale and operations. DONE except what needs Redis, a host or a paid tier

Built and tested:

- **Alert channel check:** `POST /admin/system/test-alert` (OPS, SUPER_ADMIN, audited) sends a harmless test alert through the real path and says whether the webhook accepted it. Also fixed: an alert webhook that answered with an error status (a deleted Slack hook) used to count as delivered.
- **Backup, verify, restore, compare tool** (`npm run backup -- dump | verify | restore | compare`, in the container `node dist/tools/backupRun.js`): no mongodump needed, checksums per collection, refuses a non-empty target or a backup that fails verification, restore needs the target database name typed out. 7 tests. It found and fixed a flaw while being written (empty collections were not restored).
- **Restore drill on the real Atlas cluster** (developer data): 48 collections, 7 documents, dumped, verified, restored into a temporary database, compared IDENTICAL, temporary database deleted.
- **Load tests re-run locally after the Phase 1 changes** (`docs/load-test-results.md`): no regression at the old sizes; at 200 riders / 50 drivers still 0 errors, time to get a driver median 6 s, 95th 23 s (laptop-bound, repeat on staging).
- **Runbook:** backup and restore procedure written; staging guide has the alert and backup steps.

### Review: do money flows need multi-document database transactions? Decision: no, not now

- Every money step writes through `ledger.post`, which is idempotent by a key, so doing it twice is harmless.
- A step that touches two documents (for example, booking marked PAID, then the ledger entry) is closed by the repair job within about a minute and a half (every minute, plus a 30 s grace). The job covers payments, ride and fee accruals, cash, settlements and waivers, and crash tests exist for each.
- If a repair ever fails, the monitor alerts (`ledger_balanced`, `payments_not_in_ledger`, `jobs_alive`).
- What a transaction would add: no window at all in which a booking says PAID while the ledger has no entry. The cost: a replica set everywhere (Atlas has it), retry handling, and a rewrite of the best-tested part of the system. Revisit only if the window causes a real problem (for example a driver's cash limit lagging by a minute).

### Not done in Phase 3

- **Redis with two instances:** skipped by decision (no Redis available here). The code is unchanged and untested against a real Redis.
- **Load tests on staging, real alert channel, Atlas backups, a restore drill on staging:** need the staging host, a webhook, and a paid Atlas tier.
- **Redis geo / BullMQ:** not built. The load runs did not show the database approach failing (0 errors); the 95th-percentile dispatch time of 23 s at 50 drivers is the number to watch on staging.
- **Grafana dashboard / error grouping (Sentry):** optional, not built. `GET /metrics` (Prometheus text) is ready for one.
- **Backups are not point-in-time.** Encryption is built (`--encrypt`, see "Completion round"); it is off unless asked for.


## Phase 4: Pre-launch. DONE in code and docs; the launch itself waits on accounts and decisions

Built and tested:

- **Launch pre-flight** (`npm run preflight:prod`, in the container `node dist/tools/preflightRun.js`): reads the settings and the SOS flag, changes nothing, exits 1 while anything blocks. It blocks on test Razorpay/RazorpayX keys, local or non-HTTPS addresses, tax charged with no `SELLER_GSTIN`, no alert webhook, upload secret equal to a JWT secret, and SOS on without `SAFETY_DESK_STAFFED=1`. It warns about placeholder tax rates, placeholder secrets, local-disk storage, auto payouts, debug logging and a missing emergency-SMS template. 4 tests.
- **`docs/launch-checklist.md`**: accounts and keys, credential rotation, production settings, business data, safety desk, verification order, launch day.
- **SOS** stays off in production by default (`server.ts`); turning it on is a staff action and the pre-flight blocks it until the desk is declared staffed.

Verified on 2026-10-23 (the first full run since the phases began): `npm run build`, `npm run lint`, `npm run format:check` clean; **full suite 76 of 76 files, 713 of 713 tests passed** (446 s). The gate is a subset of that run. Not run: anything against real vendors or production-like infrastructure (no Docker, Redis or accounts on this machine).

Needs the owner (cannot be done in code): live vendor keys, rotating the exposed Atlas and `.env.bak` secrets, deleting `backend/.env.bak-1792739369`, accountant sign-off on tax, real zones/fares, S3/R2 account if more than one instance, staffing the safety desk.

## Completion round (2026-10-23): code gaps closed, with tests

- **Refunds hand ride GST back.** A processed refund of a fare payment debits `TAX_PAYABLE` by the refunded share of the ride tax (`refund x tax / payment`), so the platform's `REFUNDS` expense is the refund minus that tax. The share is fixed on the refund (`taxReversedPaise`), is never more than the tax still held, and all refunds of a payment add up to exactly the tax charged. Fees, tips, top-ups and the commission GST are untouched. `tests/gst-refund.test.ts`.
- **Reports show tax apart from the fare.** `/admin/analytics/revenue` and `/admin/reports/summary` now include `taxPaise` and `netFaresPaise` beside `grossFaresPaise` (gross still includes the tax, so nothing existing changed).
- **Orphan upload cleanup.** `npm run uploads:sweep` (prod: `node dist/tools/uploadSweepRun.js`) lists stored files no driver document points at and half-written uploads. Dry run by default; `--delete` removes them; files younger than 24 h (`--min-age-hours`) are never touched. 3 tests.
- **Encrypted backups.** `BACKUP_ENCRYPTION_KEY` (64 hex characters) plus `--encrypt` seals every file with AES-256-GCM. The whole file is authenticated before any of it is read, so a wrong key, a changed byte or a cut-off file is refused. Verify and restore need the same key. 4 tests, and a real encrypted dump + verify + wrong-key refusal against the Atlas development database (scratch folder deleted).
- **Razorpay verified for real (test keys):** order created and forged webhook refused (`npm run verify:live` with `PAYMENTS_DRIVER=razorpay`, 2026-10-23).
- **CI flake fixed:** the notifications inbox sorts by `createdAt` then `_id`; the test environment retries a failed in-memory MongoDB start once.

Still not done and why: write-off tax, fees/tips GST (accountant); explicit waiting start/stop (not confirmed as wanted); antivirus scan; point-in-time backups; everything that needs a vendor account, a host, Redis or Docker.
