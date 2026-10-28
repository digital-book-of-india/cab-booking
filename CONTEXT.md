# Cab Booking Platform: Project Context & Progress

> Living document. After EVERY phase, update the Phase tracker (section 5: completed vs left) and the phase record (section 8). Last updated: 2026-10-17 (after Phase 1).

## 1. Project summary
Uber/Ola-style cab booking platform with four deliverables:
- **backend/**: Node.js + Express 5 + TypeScript modular monolith (MongoDB/Mongoose, Redis, BullMQ, Socket.IO)
- **customer-app/**: React Native + TS (owner/timing TBD, placeholder folder)
- **driver-app/**: React Native + TS (owner/timing TBD, placeholder folder)
- **admin-panel/**: Next.js 16 + React 19 + TypeScript + TailwindCSS v4 enterprise operations dashboard (**100% COMPLETE & VERIFIED**, 38 production routes across 8 departments, 124 passing automated tests, Vitest runner, zero lint/type errors)

Integrations (behind adapter interfaces, mocks first): Google Maps, Razorpay, FCM, SMS/OTP provider, object storage (R2).

## 2. Source specs
Two specs were provided in chat (NOT yet saved verbatim into `docs/specs/`; copy the original PDFs there):
- **Spec A**: "Backend Developer Specification": 2-day core API target + module blueprint (M01-M17, P0/P1/P2).
- **Spec B**: "Technical Specification v1.0": full blueprint (30 modules M01-M30, ~150 endpoints, state machines, ledger, payments, Socket.IO events, QA plan, phases P0-P7).

**Relationship:** A is a slice of B. We use **B's naming/structure** as the frozen contract (provisional, see `docs/decisions.md` D1) and implement the P0 subset first (A's Day-2 core).

## 3. Key architecture decisions
- Modular monolith; every module follows route -> validation (zod, `*.schemas.ts`) -> controller -> service -> model: `*.routes.ts` only maps paths + middleware, `*.controller.ts` parses input and shapes the response, `*.service.ts` holds business rules and DB access (services take an `Actor` for audit, never `req`). `health` is the only module without a controller/service (no logic).
- MongoDB is the source of truth. Redis is only a coordination layer (presence, geo, dispatch cache).
- Money = integer paise. Timestamps = UTC ISO-8601. GeoJSON = `[lng, lat]`; API uses `{lat, lng}`.
- Ride/booking state and payment state are **separate** state machines.
- Atomic driver assignment via conditional update, else `409 RIDE_ALREADY_ASSIGNED` (the same conditional-update pattern is already used for driver approval and OTP consumption).
- Ledger is append-only; corrections are compensating entries.
- Idempotency via `Idempotency-Key` header (booking, payment, refund).
- Never trust the client for fare, role, payment status, ride status or driver eligibility. Role is read from the DB on every request, not from the token.
- Standard envelopes: `{success, data, meta.requestId}` / `{success:false, error:{code,message,fieldErrors,requestId}}`.

## 4. Naming conflicts between specs (frozen to Spec B, provisional)
| Concept | Spec A | Spec B (adopted) |
|---|---|---|
| Ride states | SEARCHING, CANCELLED_BY_* | DISPATCHING, single CANCELLED (+actor field), NO_DRIVER_FOUND, NO_SHOW |
| Estimate | POST /fare/estimate | POST /fare-quotes |
| Create ride | POST /rides | POST /bookings |
| Accept | POST /rides/:id/accept | POST /ride-offers/:offerId/accept |
| Auth | register/login | otp/request, otp/verify |
| Idempotency | body field | header |
| Presence | PATCH /drivers/availability | POST /drivers/me/presence |
| Health | /health, /ready | /health/live, /health/ready |

## 5. Phase tracker (completed vs left) - UPDATE AFTER EVERY PHASE
Legend: [x] done and tested, [~] done but unverified in a real environment, [ ] left.

### P0 Foundation: DONE (with unverified items)
- [x] Contract docs (decisions, api-contract, enums), repo files, backend scaffold, config/env validation, logger, request IDs, error handler, health endpoints, graceful shutdown, provider adapters + mocks, OpenAPI, 16 tests
- [~] docker-compose (Mongo replica set + Redis): written, never run (Docker not installed)
- [~] CI workflow: written, never run on GitHub
- [~] Health readiness against real Mongo/Redis: only tested with fakes
- [x] Save original specs into `docs/specs/` (spec-a-backend-developer-specification.md and spec-b-technical-specification-v1.0.md)
- [ ] Choose staging hosting; metrics/alerting (deferred to P8)

### P1 Accounts: DONE (with unverified items)
- [x] OTP auth, refresh rotation + reuse detection, sessions, RBAC, customer profile, driver application/documents, vehicles, categories, admin driver/document/vehicle review, audit log, seed script, Postman + OpenAPI generation, 82 tests
- [~] Server boot + `npm run seed` against real MongoDB (needs user's Mongo URL)
- [~] Postman collection generated but not imported/run
- [ ] Real SMS provider, real object storage (R2/S3) adapters
- [ ] Redis-backed rate limiter (before multi-instance deploy)
- [ ] Decide driver approval gate (documents/vehicle required?) and admin login method
- [x] Customer saved places (Implemented in DEV 2 with CRUD, 20-place cap, GeoJSON coordinates, privacy export/deletion integration)

### P2 Booking & pricing: DONE (with unverified items)
- [x] Service zones (GeoJSON polygon, 2dsphere, operating hours Asia/Kolkata) + admin CRUD, serviceability endpoint
- [x] Versioned immutable fare configs (per zone + category), active-config selection by effective date, admin create/list/active-preview
- [x] Quote engine: server-side integer-paise fare, 10 min expiry, single use, ownership, refresh
- [x] Bookings from quotes with `Idempotency-Key` (replay, mismatch detection, concurrency-safe), ownership checks, status timeline
- [x] Seed: Delhi NCR placeholder zone + v1 placeholder fares for MINI/SEDAN/SUV
- [x] 135 tests total (53 new), Postman + OpenAPI regenerated (41 routes)
- [~] Never run against a real MongoDB (2dsphere `$geoIntersects` verified only on in-memory MongoDB)
- [~] Maps are the mock (straight-line x1.3 at 30 km/h): real Google Maps adapter not built
- [ ] Real zone polygon, real fares, real category list (need lead's numbers); taxes/tolls/waiting in fare are 0 for now
- [ ] Booking does not yet move to DISPATCHING (dispatch is P3); no cancel yet (P3 basic, P5 fees)
- [ ] Booking list / ride history for customers (P3)
- [ ] Stops, destination change, scheduled rides (P5 / P9)

### P3 Dispatch & ride lifecycle (Day-2 demo): DONE (with unverified items)
- [x] Driver presence (online/offline) + GPS heartbeat with freshness, accuracy, throttle and impossible-jump checks; 2dsphere index
- [x] Matching (eligibility filters, radius stages, route-ETA ranking), timed offers, reject/expire/re-offer, NO_DRIVER_FOUND, admin retry
- [x] Atomic accept (offer + driver + booking each claimed by a conditional update; loser gets 409 RIDE_ALREADY_ASSIGNED); idempotent re-accept
- [x] Lifecycle: en-route, arrived (server-side proximity check), OTP start, complete (server-computed fare, payment DUE), cancel by customer / driver
- [x] Pickup OTP derived (never stored), 5 attempts, expiry, resend; ride views per viewer; polling track; customer + driver history
- [x] State machine table + single transition helper; 206 tests incl. concurrency races and a 1 customer + 2 drivers journey; Postman/OpenAPI (60 routes)
- [~] Never run against a real MongoDB / real clock for hours; offers expire via a 2 s DB sweeper (`jobs/dispatchSweeper.ts`), not BullMQ
- [~] Maps are the mock (ETA, route); no Google Maps
- [ ] Redis geo / BullMQ (swap in once a Redis URL exists)
- [ ] Final fare uses quoted distance + measured time (clamped 0.5x-3x); GPS/odometer reconciliation not built
- [ ] Cancellation fees, no-show, automatic re-dispatch after a driver cancels (P5; today a driver cancel ends the booking)
- [ ] Cash collection / payment (P6): completion only sets paymentStatus DUE
- [ ] Driver document-expiry check for going online (P5); KYC gate beyond approved driver + verified vehicle
- [ ] Staging deploy (P3.5)

### P3.5 Handover: DONE; real-DB verified; staging deploy LEFT (needs a host)
- [x] Admin API for ops: dashboard, user search/detail, suspend/reactivate customers (ends sessions, audited), booking search and full booking detail (audited). Driver/vehicle/document review, categories, zones, fare versions already existed from P1/P2
- [x] Contract frozen as v1.0 (additive-only change policy in `docs/api-contract.md`); OpenAPI `1.0.0`; Postman regenerated (66 requests)
- [x] `docs/mobile-integration-guide.md` for customer, driver and admin developers
- [x] Staging login without SMS: `STAGING_FIXED_OTP` (refused in production); Redis URL optional outside production
- [x] Dockerfile (multi-stage, non-root, healthcheck), `.dockerignore`, `seed:prod` script, CI job that builds the image and checks it refuses an unsafe production config
- [x] 223 tests (17 new); mutation-checked the staff-account guard and session revocation
- [~] Dockerfile and the CI docker job have NOT been run: Docker is not installed here and nothing is pushed
- [x] Real MongoDB verified (2026-10-17) on the user's own Atlas M0 cluster (MongoDB 8.0.34, project `cab-booking`): server boots, `/health/ready` reports mongo up, seed ran (3 categories, 1 zone, 3 fare configs), polygon serviceability lookup works, all 16 collections and the 2dsphere index were created. Full suite on that cluster: 221/223 on the first run (the 2 failures were 30 s timeouts in the 8-iteration race loops, which are slow over the internet); the race file passed 5/5 with a 240 s timeout. So all 223 pass on real MongoDB
- [~] The first Atlas URL given (shared cluster, 485/500 collections) was left alone; two throwaway `test_*` databases from a partial run were dropped. `TEST_MONGO_URI` runs on the new cluster only
- [ ] Staging host and deploy (needs a hosting choice); Redis not yet needed
- [ ] Real zone, categories, fares from the lead (the seed is placeholders)
- [ ] Rotate the Atlas passwords that were pasted into the chat (old shared cluster, and the new cab-booking cluster once real data goes in)

### P3.6 Database hardening (added after the P1-P3 database review): DONE
- [x] Reconciler (`DispatchService.reconcile`, runs every 15 s with the sweeper): frees driver ride-locks left behind by a crash (cancelled/never-assigned ride), rolls back an assignment that has no ride, links a ride id the booking never received; all skipped inside a 30 s grace period so an in-flight accept is never undone
- [x] Stale presence: ONLINE drivers with no GPS for 5 min are set OFFLINE, their open offers withdrawn (never while on a ride); the dashboard count is now truthful
- [x] Index control: production no longer builds indexes at boot; `npm run indexes[:prod]` (+ `--prune`) is the release step; a test fails if a model is missing from the registry
- [x] Connection: `w: majority` + journal, retryWrites, pool size (`MONGO_MAX_POOL_SIZE`, default 20), reads on the primary
- [x] 11 new indexes for the admin lists, dashboard counters, sweeper and reconciler; query plans asserted to use an index (no collection scans)
- [x] 21 new tests (244 total), including simulated crashes; 4 mutation checks fail the right tests; the hardening + admin tests also pass on the real Atlas cluster; indexes built and pruned there
- [ ] Not changed (needs a policy answer or belongs to a later phase): one active booking per customer (business rule); document versioning per type and expiry job (P5); vehicle registration released when a vehicle is rejected; retention/archival of offers, events and old bookings; account deletion/export (DELETED status has no process); append-only enforcement of the audit log; field-level validation of fare snapshots and integer-only money at the database; location history and moving live GPS off MongoDB (P4); quote consumed with no booking after a crash (the customer just requests a new quote); backups, restore drill and a paid Atlas tier (production); explicit transactions for the P6 ledger
- [~] Not tested: TTL cleanup timing; behaviour with large data volumes

### P4 Realtime & notifications: DONE (Redis and real Firebase deferred, by the user's choice / missing credentials)
- [x] Socket.IO on the REST port: same auth as REST at the handshake (token or header), per-user rooms the client cannot choose, staff `ops` room, token-expiry warning + `auth:refresh`, 30 s re-check of every live socket, immediate disconnect on suspension, max 5 connections per user
- [x] Events (`offer:new|closed`, `booking:status`, `ride:status`, `driver:location`, `ops:booking`) sent after the database change, never throw, dedupe ids; contract in `docs/realtime-contract.md`
- [x] Live tracking: rider sees the driver only from assignment to ride end (checked against booking state), max every 2 s; driver GPS also over the socket (`location:update`, same rules)
- [x] GPS database writes throttled (25 m or 10 s); sampled route trail during active rides (10 s, 30-day TTL) + audited admin endpoint `GET /admin/rides/{id}/trail`
- [x] Devices (`POST /devices`, `DELETE /devices/{id}`), push outbox with retries/backoff/lease/dedupe, dead-token removal, expired-offer and cancelled-offer pushes dropped, inbox (`GET /notifications`, `POST /notifications/read`)
- [x] Firebase adapter over the HTTP API (no firebase-admin: it brought 8 vulnerable packages), `PUSH_DRIVER=fcm`
- [x] 312 tests (68 new); 8 mutation checks fail the right tests; new tests (85) + the real server (login, socket hello, device, inbox) verified on Atlas
- [~] Real Firebase delivery NOT tested (no Firebase project): adapter only unit-tested with a fake Firebase
- [~] Real phones, flaky mobile networks, battery use, long-lived sockets over hours: not tested
- [ ] Redis (deferred by the user to the hardening phase): socket adapter for several server instances, shared rate limiter, BullMQ. Until then run ONE server instance
- [ ] Payload wording, retention (30 days), 2 s/10 s intervals are placeholders for the lead
- [ ] Admin panel live dashboard UI (only the `ops:booking` events exist)

### P5 Ride extras: DONE (policy numbers are placeholders; payment of fees is P6)
- [x] Waiting time measured by the server (pickup + each stop, 3 free min each, 30 min cap) and shown as its own fare line
- [x] Up to 3 stops: quote/booking/route/fare, driver arrive/depart per stop with proximity + order checks, waiting at stops billed as waiting (not also ride time)
- [x] Destination change: rider request, server pricing, driver accept/decline in 30 s, 3 changes max, fare amendment history
- [x] Cancellation/no-show policy (versioned per zone, admin API, frozen onto each booking), cancel preview, late-cancel fee, no-show after the wait, fee waiver (audited)
- [x] Driver cancel re-offers the booking (max 2, driver excluded, same ride record); old driver loses access to the ride (closes D35)
- [x] Receipts (`GET /rides/{id}/receipt`): numbered once, built from the stored fare, fee receipts
- [x] Required driver documents gate approval and going online; supersede on approval; reminder/expiry job (30/7/1 days; offline unless mid-ride); admin expiring list + dashboard counts (closes D19)
- [x] Rejected vehicle frees its plate
- [x] 385 tests (73 new); money and safety rules mutation-checked
- [ ] Fees are recorded (`fee`, `paymentStatus: DUE`) but not collected: Phase 6
- [ ] Policy numbers (cancel window/fee, no-show wait/fee, waiting cap, destination rule, required document list, reminders) are placeholders for the lead
- [ ] Multi-stop and destination routes use the mock map until Google Maps is connected
- [ ] Receipts are JSON with a placeholder issuer; PDF and GST invoice later
- [~] Real Firebase/SMS/maps/storage still not connected

### P6 Payments & ledger: DONE (real Razorpay not yet exercised; policy numbers are placeholders)
- [x] Append-only double-entry ledger: one document per business event, entries sum to zero, idempotent by key, edits/deletes refused; balances derived from entries
- [x] Commission per zone (versioned, frozen on each booking); ride and fee accrual (rider owes, driver is owed their share, platform keeps the commission); driver earnings and rider balance views
- [x] Online payments via Razorpay: server-set amount, order, signature verify, signed + idempotent webhook (captured/failed/refunds), abandoned attempts expire, duplicate/late payments are refunded automatically
- [x] Cash: driver confirms the exact fare; cash held; cash limit takes the driver offline until finance records a deposit
- [x] Unpaid ride older than 24 h blocks new bookings (402); dispute and write-off lift it
- [x] Refunds (finance, idempotent, never over-refund, completed by webhook), write-off (super admin), settlements (draft -> approve -> paid; nets cash against earnings; stale figures refused)
- [x] Repair job every minute (payments, accruals, cash, settlements, waivers); consistency report (books balance, nothing unrecorded, gateway balance = captured - refunded)
- [x] 37 new tests (424 total) incl. crash repair and replayed webhooks; found and fixed a latent pickup-start race
- [x] Razorpay TEST mode verified live (2026-10-17): our adapter created a real Rs 1 order, Razorpay returned it with the right amount/currency/receipt, and a wrong secret was refused with 401
- [~] Still NOT verified: a real checkout payment, a real webhook delivery (needs a public URL), a real refund (needs a captured payment), and bank payouts
- [ ] Automatic bank payouts to drivers (settlements are recorded by hand with a bank reference)
- [ ] Policy numbers placeholders (20% commission, 24 h unpaid grace, Rs 2,000 cash limit, who bears refunds/write-offs); GST on fares/commission not modelled
- [ ] Cash refunds; partial cash payments; wallet/credits; coupons; tips
- [ ] A finance admin screen (only the API exists)

### P7 Ops, safety, admin: BACKEND DONE (API only; no admin screens; SOS needs a staffed team before it is switched on)
- [x] Feature flags (SOS, TRIP_SHARING, SUPPORT_TICKETS, RATINGS, COUPONS): per role, audited, apps read `GET /config/flags`; SOS defaults OFF in production
- [x] Staff accounts: super admin creates staff by phone + role, changes roles (never their own; sessions ended and sockets dropped at once), audited
- [x] Safety: SOS for rider or driver during a live ride (idempotent), alert to the safety desk by `ops:sos` event + push, saved emergency contacts (max 3) texted a trip link, acknowledge / notes / live location / resolve, escalation to super admins if nobody takes it in 2 min, every incident view audited
- [x] Trip sharing: tokenised public link (hash stored), no phone numbers, dies when stopped or the ride ends, per-IP rate limit
- [x] Support tickets: rider/driver open, reply, close; desk queue with filters, assign, internal notes (never shown to users), overdue flag after 24 h, resolve with outcome; a safety concern is high priority
- [x] Ratings: both sides rate once within 7 days; tags per side; driver average counted by claim-then-increment and repaired by a job; shown to riders only after 5 ratings; staff review low ratings and hide abusive comments
- [x] Reports: summary (rides, rates, money, discounts, dispatch speed, per-day in India time) and CSV exports (rides for OPS/FINANCE, money files for FINANCE only; 50,000-row cap; formula-safe cells; no phone numbers; each download audited)
- [x] Coupons: percent/flat, cap, minimum fare, dates, total and per-rider limits (atomic), zones, cab types; frozen on the quote and booking; rider pays the discounted fare; driver and commission are on the FULL fare; the platform pays the difference (PROMOTIONS ledger account); uses given back for rides that never happen
- [x] RBAC matrix test: every documented route x every role (8 roles); found and fixed `GET /payments/{id}` having no role gate
- [x] 149 documented routes; 468 tests passing (44 new: flags/staff, safety, support, ratings, coupons, reports, RBAC matrix)
- [x] Docs written (enums, api-contract, realtime-contract, mobile guide, staging notes); `npm run indexes` run on Atlas (34 collections, all Phase 7 indexes present); the 48 Phase 7 + contract tests also pass against the real Atlas cluster (2026-10-18)
- [~] Not verified: SMS to emergency contacts and staff pushes (mock SMS / no Firebase project); a real staffed SOS process; escalation timing under real load
- [ ] Admin panel screens (Next.js) - only the APIs exist
- [x] Ticket resolution is tied to reality: `REFUNDED` / `FEE_WAIVED` are refused unless the ride really has a refund / a waived fee (support cannot move money itself; finance/ops do it first)
- [x] Staff suspend/reactivate tested with staff roles (super admin only, ends sessions and sockets, blocks login until reactivated)
- [x] Real SMS adapter built (`providers/nimbus.ts`, `SMS_DRIVER=nimbus`), unit-tested with a fake gateway; emergency texts need a second DLT template + `TRIP_LINK_BASE`. NOT verified against the real gateway (no docs found; send one real OTP to check)
- [~] Real Firebase push: adapter already built; needs your service-account JSON in `FCM_SERVICE_ACCOUNT_JSON` and `PUSH_DRIVER=fcm`
- [ ] Driver payout to bank, GST, tips, wallet (not in P7)

### P8 Hardening & pilot: ALL DONE THAT NEEDS NO OUTSIDE ACCOUNT (528 tests); what remains needs the staging host, Redis, alert channel, backups and live provider checks
- [x] Release gate: `npm run gate` runs 13 suites covering 11 named properties (`docs/release-gate.md`); 4 new composite gate tests (ride isolation, books balance, cancel leaves nothing stuck, location expiry)
- [x] Security review with fixes: per-caller write limit (120/min), coupon-guess limit, socket connection-attempt limit, `no-store` on every API answer, HTTP timeouts, start-up refuses wildcard CORS and identical JWT secrets; verified already good: helmet, narrow CORS, 100 KB body cap, JWT algorithm pinned, refresh-token reuse detection, strict input schemas, no stack traces in errors, `npm audit` 0 vulnerabilities
- [x] Security tests (12): headers, CORS, oversized/malformed/operator-injection input, forged/unsigned/expired/logged-out tokens, all three new limits, unsafe settings
- [x] Monitoring: seven checks (ledger balanced, stuck searches, unanswered SOS, push backlog, unfinished webhooks, payments missing from the ledger, dead background jobs), `GET /admin/system/health`, alerts to log + optional webhook with cool-down and recovery messages (6 tests)
- [x] Metrics + error tracking without a third-party account: per-route counts/speed/status classes, 5xx window, memory and event-loop lag (`GET /admin/system/metrics`, Prometheus text at `GET /metrics` with `METRICS_TOKEN`); monitor check `error_rate` (8 checks now)
- [x] Load-test scripts: `npm run loadtest` (riders) and `npm run loadtest:rides` (approved drivers created through the staff API, locations, offers, full rides to completion); both smoke-tested at tiny scale on the test server; fixed a bug found on the way (the first script reused one phone number for every simulated rider)
- [x] Runbook (`docs/runbook.md`) and go/no-go checklist (`docs/release-gate.md`)
- [x] Local load run done (`npm run loadtest:local`, results in `docs/load-test-results.md`): 0 server errors; it found and we fixed a real dispatch defect (riders from the same area all queued behind one driver: median wait 8 s -> 2 s, slowest 36 s -> 6 s, rides completed 3x)
- [ ] Run both load tests on a real staging host and record the real limits (needs the host + a seeded staff account); try 200+ riders / 50+ drivers
- [ ] Redis for several server instances (needs a Redis URL; one instance is fine for the pilot)
- [ ] Alert channel: create a Slack/Discord webhook, set `ALERT_WEBHOOK_URL`, test by breaking a check on staging
- [ ] Backups + one restore drill (needs a paid Atlas tier; the free M0 has no backups) - record the result in the runbook
- [ ] Optional: Sentry-style error grouping (needs an account and key) and a dashboard on top of `GET /metrics` (e.g. Grafana); today: log + metrics endpoints + monitor alerts
- [ ] Fill in the go/no-go checklist with real dates and names; fill in the runbook contacts

### P8b Money extras: Tips, Wallet, Automatic driver payouts: DONE in code (payout service and wallet legality not verified live)
- [x] Tips: one per ride, within 24 h, Rs 10-Rs 2,000, paid online or from the wallet, the driver gets 100% through the ledger (no commission), driver is told by push; shown in driver earnings (`tipsPaise`, `tipCount`); flag `TIPS`
- [x] Wallet: closed wallet; top up through the normal Razorpay payment; pay a ride/fee/tip from the balance (instant, per-rider lock stops two spends using one balance, `402 INSUFFICIENT_WALLET_BALANCE`); refunds can go to the wallet (`destination: WALLET`; ride paid from the wallet can only go back to the wallet); staff view `/admin/wallets/{id}`; flag `WALLET`; consistency report now also catches an overdrawn wallet and ignores wallet payments/refunds in the gateway balance
- [x] Automatic driver payouts: driver adds bank/UPI (full number goes only to the payout provider; we keep the last digits), finance verifies the account, an APPROVED settlement is paid out by finance (button) or automatically (`AUTO_PAYOUTS=true`), the provider webhook completes it; failure leaves it payable and retryable; unanswered payouts are re-sent with the same idempotency key (never twice); missed webhooks are caught by polling; a payout the bank sends back restores the driver's balance; monitor check `payouts_need_attention`; manual mark-paid is refused while a payout is live
- [x] 36 new tests; 167 documented routes; found and fixed a bug (switching a payout account from bank to UPI kept the old IFSC)
- [~] NOT verified live: RazorpayX (adapter only tested with a fake network; needs a RazorpayX account with a funded current account), real wallet top-up/refund-to-wallet through Razorpay
- [ ] Legal/tax: confirm the wallet is allowed as designed (RBI prepaid-instrument rules), GST on tips/fares
- [ ] Wallet withdrawal to bank, wallet promotions/cashback, tip suggestions in the app, tips for cash rides (not built)

### P9 Expansion: analytics, scheduled rides, corporate, rentals and outstation all DONE in code (placeholders to confirm)
- [x] Analytics (read-only, India time): demand heatmap by weekday and hour + zones, fulfilment by hour (completion, no-driver, time to find a driver), cancellations by who/why/how soon + fees, revenue by day (finance only; fares, discounts, commission, driver earnings, tips, refunds, how collected), driver ranking (rides, earnings, tips, acceptance, rating), retention (active riders/drivers, weekly new-rider groups and who came back); 6 endpoints, 9 tests
- [x] Scheduled rides: quote/book for later (30 min to 7 days), new status `SCHEDULED`, zone hours checked at pickup time, 5 waiting per rider, reminder 1 h before, search starts 20 min before pickup (job every 30 s, safe on several instances), free cancel, reschedule, system cancel if missed by 30 min, driver offers show the pickup time, monitor check; 11 tests. Rules CONFIRMED by the owner (D97/D98/D101/D102): 30 min-7 days, search 20 min before, 10 min grace, 30 min gap, 5 waiting, fare locked; five-offer cap kept (D104, review after the pilot). Full suite: 554 tests passing
- [x] Scheduled-rides review fixes: rider booking list `GET /bookings` (history, and `?status=SCHEDULED` soonest first), the search continues until pickup time + 10 min (it used to give up after 60 s), no two waiting rides within 30 min, staff can cancel a waiting ride for the rider or start its search early (audited); 23 scheduled-ride tests
- [x] Corporate accounts: company with credit limit / terms / per-employee monthly limit / per-ride cap; admin and employees by phone invitation (one company each); `paymentMethod: CORPORATE` with every limit checked at booking; the company (not the rider) owes the fare through the ledger (`BILLED`, no cash, no online payment); finance generates, issues (gap-free numbers), takes bank payments for, and voids invoices; credits before invoicing; overdue monitor check; company admin sees employees, rides and invoices; 12 tests; full suite 566 passing; Atlas indexes run. All numbers are placeholders (D106); tax NOT calculated (D108)
- [x] Rentals: staff-defined packages per zone and cab type; quote with `rentalPackageId`, no drop; billed on server clock and server GPS trail (10 min / 2 km grace); odometer is evidence only. Placeholders D119
- [x] Outstation: per-km rates per zone and cab type; one way on quoted route unless 20% detour; round trip on max(real km, 250 km/day) plus night allowance; offered only to opted-in drivers; tolls/parking on actuals. Placeholders D120-D122
- [ ] Analytics rollup table if volume grows; scheduled-ride fare re-check close to the time (decision)

**Parallel product track (non-code, long lead time):** KYC/compliance review, staffed SOS response plan, finance/ledger/payout policy, Razorpay merchant approval, Google Maps + Firebase accounts, location retention policy.

Per-module rule: lint + typecheck + build + tests after each module; one commit per module; keep Postman/OpenAPI/enums in sync (routes list `backend/src/docs/routes.ts` is the single source; a contract test enforces it). After each phase, report work done in bullet points and record it here.

## 6. Go/no-go rule
No public launch if payment, authorization, ride-assignment or location-privacy tests fail.

## 7. Open decisions (need answers)
1. Login mechanism: phone OTP is assumed (provisional). Admin login method (email+password+MFA?) undecided.
2. Local infra: Docker not installed on dev machine. **MongoDB URL and Redis URL to be supplied by user** (needed only to run the server; tests use in-memory MongoDB).
3. Apps/admin: in this monorepo (folders exist) or separate repos/teams?
4. Package manager: npm (provisional).
5. Third-party credentials (Google Maps, Razorpay test, Firebase, SMS): none yet; mocks used.
6. Pilot city Delhi / INR (provisional).
7. Adopt Spec B naming as the frozen contract (provisional).
8. Payment policy (pay-after-ride default risk, unpaid-balance blocking, driver earnings timing, cash discrepancy, write-off authority): needed before P6.
9. Driver approval gate: currently an admin may approve once the application is submitted (no requirement for approved documents or a verified vehicle). Decide the KYC completeness rule.
10. Cab categories, capacities and display order are placeholders (MINI 4, SEDAN 4, SUV 6).
11. Which admin sub-roles may review drivers: currently OPS + SUPER_ADMIN review; CONFIG_ADMIN + SUPER_ADMIN manage categories; SUPER_ADMIN only reads audit logs.

## 8. Phase records

### Phase 0: Foundation (done 2026-10-17)
**Built**
- Repo: root `.gitignore`, `.editorconfig`, `README.md` (quick start), `.github/workflows/ci.yml` (lint, format check, typecheck, build, test), `infra/docker-compose.yml` (MongoDB 7 single-node replica set + Redis 7).
- Backend scaffold: TypeScript strict (module `node16`), Express 5, ESLint, Prettier, Vitest + Supertest. Scripts: `dev build start lint typecheck test format:check`.
- Config: zod env validation (fails fast, rejects mock providers in production), `.env.example` (placeholders only).
- Middleware: request IDs (`X-Request-Id`), helmet, narrow CORS, global rate limit, 100 kB body limit, central error handler with standard envelope.
- Logging: pino JSON, redacts auth headers, OTPs, tokens, payment signatures.
- Health: `GET /api/v1/health/live`, `GET /api/v1/health/ready` (Mongo + Redis with 2 s timeout; 503 while draining). Graceful shutdown (10 s cap).
- Provider adapter interfaces (maps, sms, push, payments, storage) + dev-only mocks (mock payment verifiers always return false).
- Docs: `docs/decisions.md`, `docs/api-contract.md`, `docs/enums.md`, `docs/staging-and-observability.md`.
- Module folders from Spec B created under `backend/src/modules/`.

**Tests:** 16 (health, error envelope, request id, openapi, env validation, provider guards).

**Not verified / not done**
- Docker not installed: compose file and real Mongo/Redis readiness never run. CI never run (no run on GitHub yet).
- Specs not saved verbatim into `docs/specs/`.
- Staging hosting undecided; metrics/alerting deferred to P8.

### Phase 1: Accounts and identity (done 2026-10-17)
**Models** (`backend/src/modules/*`): User (role, unique E.164 phone, accountStatus), OtpChallenge (HMAC hash, TTL index), Session (hashed refresh token + previous hash for reuse detection, TTL index), CustomerProfile, DriverProfile (approval/online status, decision reason), DriverDocument, Vehicle (unique normalised registration), CabCategory (unique code), AuditLog.

**Endpoints (28 documented routes; all in `backend/src/docs/routes.ts`)**
- Auth: `POST /auth/otp/request`, `/auth/otp/verify`, `/auth/refresh`, `/auth/logout`; `GET /auth/me`, `/auth/sessions`; `DELETE /auth/sessions/:sessionId`.
- Customers: `GET|PATCH /customers/me`.
- Catalog: `GET /cab-categories` (public); admin `GET|POST /admin/cab-categories`, `PATCH /admin/cab-categories/:id`.
- Drivers: `POST /drivers/applications`, `GET /drivers/me/application`, `POST|GET /drivers/me/documents`.
- Vehicles: `POST|GET /drivers/me/vehicles`, `PATCH /drivers/me/vehicles/:id`.
- Admin: `GET /admin/drivers` (filter/search/paginate), `GET /admin/drivers/:id` (audited), `PATCH /admin/drivers/:id/approval`, `PATCH /admin/drivers/:id/documents/:docId`, `PATCH /admin/vehicles/:id/verification`, `GET /admin/audit-logs`.
- Health + `GET /openapi.json`.

**Security behaviour implemented**
- OTP: 6 digits, 5 min expiry, 30 s resend cooldown and 5/hour per phone (DB-enforced), 5 attempts per challenge, single use (atomic consume), HMAC-hashed at rest, per-IP route limiter (30 per 15 min on `/auth/*`). Plaintext OTP only goes to the SMS adapter (dev: logged as `devOtpCode`, development env only).
- Tokens: access JWT HS256 15 min; refresh token random, hashed, rotated atomically; reuse of a rotated token revokes the session; logout and per-session revoke; suspended accounts are blocked on every request (status and role are read from DB each time).
- Self-signup limited to CUSTOMER or DRIVER; one role per phone (role mismatch returns 403). Admin users are created by seed only.
- RBAC: `authenticate` + `requireRole`. Review roles `OPS`, `SUPER_ADMIN`; category management `CONFIG_ADMIN`, `SUPER_ADMIN`; audit logs `SUPER_ADMIN`.
- Ownership: driver resources scoped by the authenticated driver id (other drivers' vehicles/documents return 404, not 403).
- Strict zod schemas (unknown fields rejected, so clients cannot send role/status/ids).
- Driver approval: conditional atomic status transition with allowed-from sets (see `drivers.service.ts`); reason mandatory except APPROVE; suspend/reject forces driver offline.
- KYC documents: server-generated object keys, signed upload/download URLs via storage adapter, only last 4 chars of document numbers stored, object keys never returned to drivers, admin document views audited.
- Audit: every admin mutation writes an AuditLog (actor, role, action, target, request id); `GET /admin/audit-logs` is paginated.

**Tooling added**: `npm run seed` (3 default categories + optional SUPER_ADMIN from `SEED_ADMIN_PHONE`; idempotent, never overwrites edits), `npm run postman` (generates `postman/cab-booking.postman_collection.json` and `postman/local.postman_environment.json` from the routes list), OpenAPI generated from the same list, new env vars for auth tuning.

**Tests:** 82 passing across 7 files (foundation 16, auth, otp-limits, authz, drivers, catalog, contract). Run against in-memory MongoDB (`mongodb-memory-server`, no external DB needed). Includes concurrency checks (two parallel OTP verifications, two opposite approval decisions), token forgery/expiry/alg-none, refresh-reuse theft detection, cross-user access, role escalation attempts. The contract test fails if any route is undocumented or any documented route is missing, and checks every protected route returns 401 without a token.

**Gate results:** lint, prettier check, typecheck, build, tests all pass; `npm audit --omit=dev` found 0 vulnerabilities.

**Not verified / known limitations**
- The server has never been started against a real MongoDB/Redis (no URL yet; Docker absent). `npm run seed` and real boot untested outside the in-memory test database.
- No real SMS provider; live providers throw "not implemented". No real object storage.
- Rate limiter is in-memory (single instance only); move to a Redis store before multi-instance deploy.
- `JWT_REFRESH_SECRET` doubles as the HMAC key for OTP and refresh hashes (rotating it invalidates all sessions and pending OTPs).
- A refresh-token replay race between two legitimate devices sharing one session would revoke it (by design).
- Customer saved places / ride history, driver online status and location (P3), document-expiry jobs (P5), and finer admin permissions (P7) are not built yet.
- Postman collection was generated but not imported into Postman or run.
- Nothing committed yet from this phase.

### Phase 2: Booking and pricing (done 2026-10-17)
**Models:** ServiceZone (polygon + 2dsphere index), FareConfig (immutable, unique per zone+category+version), FareQuote (single use, TTL purge 7 days after expiry), Booking (unique per customer+idempotency key), BookingEvent (append-only timeline).

**Endpoints added (13; total 41):**
- Zones/pricing (CONFIG_ADMIN, SUPER_ADMIN): `GET|POST /admin/zones`, `PATCH /admin/zones/:id`, `POST|GET /admin/pricing/configs`, `GET /admin/pricing/configs/active`.
- Public: `GET /serviceability`.
- Customer: `POST /fare-quotes`, `GET /fare-quotes/:id`, `POST /fare-quotes/:id/refresh`, `POST /bookings` (requires `Idempotency-Key`).
- Customer (owner) / OPS / SUPPORT / SUPER_ADMIN: `GET /bookings/:id`, `GET /bookings/:id/events`.

**Behaviour implemented**
- Fare = base + per-km x distance + per-minute x duration, top-up to minimum fare, rounded to the nearest rupee, all integer paise (`modules/pricing/fare.ts`, pure and unit-tested). Waiting, tolls, demand adjustment, discount and tax are 0 until their phases. Surge is off.
- Quote: both pickup and drop must be inside an active zone that is open now; pricing follows the pickup zone; category must be active and have a fare config in force; trip must be 100 m to 150 km; distance and duration come from the maps adapter, never the client. Any client-sent fare/distance/duration/version field is rejected (strict schemas).
- Fare configs are append-only: a change is a new version with an `effectiveFrom` (not more than 5 min in the past); the active config is the latest effectiveFrom not in the future. Concurrent creators get distinct versions (unique index + retry). No PATCH endpoint by design (deviation from Spec B's PATCH).
- Quotes: public id `fq_...`, valid 10 min, consumed atomically (one quote can back only one booking), another customer's quote is 404.
- Booking: public id `bk_...`; created in `REQUESTED` with `paymentStatus=NOT_DUE`; stores a frozen fare snapshot (later price changes never alter it). Optional echo of pickup/drop/category must match the quote or `QUOTE_MISMATCH` (quote not consumed). Same key + same body replays (200 + `Idempotent-Replayed: true`); same key + different body is `IDEMPOTENCY_KEY_REUSED`; concurrent retries create exactly one booking. If creation fails after the quote was consumed, the quote is released.
- Per-user rate limit (30/min default) on quote and booking creation.
- Injectable clock (`ctx.now`) for time rules; used in tests for expiry, operating hours and future-dated prices.
- New error codes: `NOT_SERVICEABLE`, `QUOTE_EXPIRED`, `QUOTE_ALREADY_USED`, `QUOTE_MISMATCH`, `IDEMPOTENCY_KEY_REUSED`.
- Seed now also creates the DELHI_NCR placeholder zone (rough box 76.84-77.55 E, 28.40-28.88 N) and v1 fares (MINI 40 base/12 per km/1.50 per min/min 100 rupees, SEDAN 50/14/1.75/120, SUV 70/18/2/150). All placeholders.

**Tests:** 135 total (was 82). New: fare math and operating hours (unit), zones admin + serviceability, fare config versioning, quotes, bookings and idempotency, rate limits. Mutation check: removing the atomic `usedAt: null` guard makes the double-booking tests fail, so they do detect it.

**Gate results:** lint, prettier, typecheck, build, tests pass; `npm audit --omit=dev` 0 vulnerabilities.

**Not verified / limitations**
- All real-database behaviour (especially geo queries and unique-index races) verified only on the in-memory MongoDB, never on the user's real MongoDB.
- Mock maps provider only; no Google Maps. Distance/time used for billing at completion is a P3 decision (provider route vs odometer/GPS).
- Pricing numbers, zone boundary, category list, quote validity (10 min), trip-distance limits (100 m, 150 km) and the 5-minute back-date tolerance are assumptions awaiting the lead.
- `/serviceability` is public and only rate limited by the global limiter.
- Nothing committed yet.

### Phase 3: Dispatch and ride lifecycle (done 2026-10-17)
**Models:** RideOffer (unique per booking+driver+round), Ride (OTP state, timestamps, evidence); DriverProfile gained presence fields (`currentVehicleId`, `currentLocation` 2dsphere, `locationUpdatedAt`, `activeRideId` lock); Booking gained `assignedDriverId`, `rideId`, `cancellation`, `finalFare*`, `dispatch{startedAt, round, lockUntil}`.

**Endpoints added (19; total 60):** presence `POST|GET /drivers/me/presence`, `POST /drivers/me/location`; dispatch `GET /drivers/me/offers`, `POST /ride-offers/:id/accept|reject`, `POST /bookings/:id/dispatch/retry` (OPS); rides `GET /rides/:id`, `POST /rides/:id/en-route|arrived|start|complete|cancel`, `GET /rides/:id/pickup-otp`, `POST /rides/:id/otp/resend`, `GET /rides/:id/track`; `POST /bookings/:id/cancel`; `GET /customers/me/rides`, `GET /drivers/me/rides`.

**Design decisions**
- The **booking owns the lifecycle status** (single source of truth); the Ride document holds OTP/timestamps/evidence. Every status change goes through `transitionBooking()` (conditional update guarded by `stateMachine.ts`), so duplicate or out-of-order calls fail with 409 `RIDE_INVALID_STATE`.
- Accept claims three things with conditional updates (offer, driver `activeRideId: null`, booking `DISPATCHING` + unassigned) and undoes earlier claims if a later one fails. Two guards on the booking (status and unassigned) mean either alone would still be safe.
- Offers: batch size configurable (default 1 = sequential). Uniqueness is per (booking, driver, round), not one-active-offer-per-booking, so batch offers and admin retries work. A short lease on the booking (`dispatch.lockUntil`) stops concurrent matching rounds.
- Dispatch timing runs on a DB sweeper (every 2 s, safe on many instances) because no Redis exists yet; it sits behind `DispatchService.sweep()` so BullMQ can replace it.
- Eligibility to receive/accept: APPROVED driver, ONLINE, fresh GPS (60 s), verified active vehicle in the booking's category, active user, no active ride, not already offered this round. (Resolves D19 for dispatch only.)
- Arrival is judged from the server-held driver location (within 300 m), never from coordinates in the request.
- Pickup OTP: 6 digits, derived as HMAC(secret, rideId+nonce), so nothing OTP-related is stored; valid 2 h, 5 attempts (counted atomically before comparing), resend has a 30 s cooldown. Uses new codes `PICKUP_OTP_*` (422/429) so apps do not mistake them for login failures.
- Final fare: quoted route distance + measured duration (server clock) clamped to 0.5x-3x the quoted duration, priced with the quoted config version; client odometer/fare fields are rejected or stored only as evidence. Payment becomes DUE, never PAID.
- Privacy: offers show no rider identity; the rider sees the driver's first name and vehicle (never phone); the driver sees the rider contact only after assignment; tracking is available only to that ride's customer while active.
- New error codes: `PICKUP_OTP_INVALID|EXPIRED|ATTEMPTS_EXCEEDED`, `DRIVER_NOT_ELIGIBLE`, `OFFER_UNAVAILABLE`, `NOT_AT_PICKUP`, `LOCATION_REJECTED`.
- Tunables (placeholders) are in `modules/dispatch/dispatch.config.ts`: offer 20 s, radii 3 km then 6 km, 5 offers per round, 60 s search window, 60 s GPS freshness, 1 s location throttle, 70 m/s plausibility, 100 m accuracy, OTP 2 h / 5 tries.

**Real bugs found and fixed by the tests during this phase**
- Two simultaneous verifications of one login OTP could return 429 (too many attempts) for the loser instead of 401 (already used).
- Idempotent booking retries sent concurrently could fail with 409 if the retry hit the gap between the first request consuming the quote and creating the booking (a Phase 2 race). A quote now records which key consumed it, and a retry with the same key waits for the original to finish.
- The loser of an accept race now always gets `RIDE_ALREADY_ASSIGNED` (not `OFFER_UNAVAILABLE`) when another driver holds the ride.
- Test infrastructure: every test file now uses its own database name, and the test timeout is 30 s (parallel in-memory MongoDB instances were timing out).

**Tests:** 206 total (was 135): presence, dispatch, dispatch races, rides lifecycle/OTP/fare/cancel/views/tracking/history, state machine, journey. Mutation checks done: removing the driver `activeRideId: null` guard fails the one-driver-two-rides test; removing both booking guards fails the two-drivers-accept test.

**Gate results:** lint, prettier, typecheck, build, tests pass; `npm audit --omit=dev` 0 vulnerabilities. Final stress: 10 consecutive full-suite runs, 0 failures.

**Not verified / limitations**
- Nothing run on a real MongoDB, real Redis, a real clock over time, or a real device; geo queries, unique-index races and TTL behaviour only checked on the in-memory MongoDB.
- Mock maps for routes/ETAs. Tracking is REST polling (Socket.IO is P4).
- A driver cancel ends the booking (no automatic re-dispatch); no cancellation fees.
- A very fast suite pass under heavy CPU load flaked a few times before the fixes above; after them 10 consecutive full runs were clean.
- Nothing committed yet.

### Phase 3.5: Handover (done locally 2026-10-17)
**Endpoints added (6; total 66):** `GET /admin/dashboard`, `GET /admin/users`, `GET /admin/users/:userId`, `PATCH /admin/users/:userId/status`, `GET /admin/bookings`, `GET /admin/bookings/:bookingId`.

**Design decisions**
- Roles: OPS/SUPPORT/SUPER_ADMIN may view; OPS/SUPER_ADMIN may suspend customers; only SUPER_ADMIN may touch staff accounts; nobody can change their own status; drivers are suspended through the existing driver approval decision (D38).
- Suspension revokes all sessions, and the access token stops working on the next request because status is read from the database each time. It does not cancel a ride already in progress (D39, open).
- The status change is a conditional update, so two admins acting at once get one success and one 409 (tested).
- Opening a booking detail shows the rider's phone, so it writes a `BOOKING_VIEWED` audit entry. The pickup OTP never appears in any admin view (tested).
- A "cannot suspend the last super admin" guard was written and then removed: the caller must be an active super admin other than the target, so one always remains.
- Contract frozen as v1.0 with an additive-only policy (D37); integration guide for app developers written from the real routes.
- `STAGING_FIXED_OTP` gives testers a login on a mock-SMS staging server. It is rejected at boot in production (D40).
- Redis is optional outside production because nothing uses it yet (D41). `TEST_MONGO_URI` is an opt-in way to run the suite on a real MongoDB with throwaway databases (D42).

**Tests:** 223 (was 206): `admin.test.ts` (role boundaries, search and paging, regex-injection-safe search, suspend/reactivate, staff protection, concurrent suspend, booking detail and audit, dashboard) and `staging-otp.test.ts`. Mutation checks: removing the staff guard and the session revocation each fail tests.

**Gate results:** lint, prettier, typecheck, build clean; 3 consecutive full runs 223/223; `npm audit --omit=dev` 0 vulnerabilities; the compiled server refuses mock providers in production.

**Not verified / left**
- Docker image build and the new CI docker job: not run.
- Real MongoDB: not run (see tracker).
- Staging URL: does not exist.
- Admin web panel UI: not built (API only).
- Nothing committed.

### Phase 3.6: Database hardening (done 2026-10-17)
Origin: a review of the P1-P3 database design found these gaps (see tracker for what remains).

**Design decisions**
- Why a reconciler and not transactions: every multi-step write (accept, cancel, complete) is already made of conditional updates, so a crash never corrupts a booking; it can only strand a driver lock or leave an assignment without a ride. An idempotent repair job covers exactly those windows, works with the existing test setup, and avoids transaction retry semantics. Transactions are still the right tool for the P6 ledger (D43).
- `DriverProfile.activeRideSince` records when a lock was taken; the reconciler only acts on locks older than `reconcileGraceMs` (30 s), so it cannot undo an accept that is still running. The remaining theoretical risk is a single accept stalling for more than 30 s mid-flight (an outage); then the reconciler could free the driver just before the booking claim lands (D44).
- The sweeper job now has two timers: fast sweep (2 s: offer expiry, advancing searches) and slow reconcile (15 s). Tests call `reconcile()` directly; the test clock is injectable.
- Booking states in which a driver legitimately keeps the lock: DRIVER_ASSIGNED, DRIVER_ARRIVING, DRIVER_ARRIVED, IN_PROGRESS, INCIDENT_REVIEW.
- New booking event type `ASSIGNMENT_ROLLED_BACK` (system) appears in the timeline when the reconciler undoes an assignment.

**Operational changes:** new env `MONGO_MAX_POOL_SIZE`; new commands `npm run indexes`, `npm run indexes:prod`; deploy checklist updated (docs/staging-and-observability.md).

**Gate results:** lint, prettier, typecheck, build clean; 244 tests on three consecutive in-memory runs; `npm audit --omit=dev` 0 vulnerabilities; `npm run indexes` and `--prune` ran on the Atlas cluster (16 collections); hardening + admin tests (34) passed there.

### Phase 4: Realtime and notifications (done 2026-10-17)
**Endpoints added (5; total 71):** `POST /devices`, `DELETE /devices/{deviceId}`, `GET /notifications`, `POST /notifications/read`, `GET /admin/rides/{rideId}/trail`. Plus the Socket.IO surface in `docs/realtime-contract.md`.

**New code:** `src/realtime/` (events, bus interface, `socketServer.ts`, `notifier.ts`), `modules/notifications/` (Device, Notification models, service, REST), `modules/tracking/locationPing.model.ts`, `providers/fcm.ts`.

**Design decisions** (D48-D55 in `docs/decisions.md`)
- Sockets only announce; REST is the only way to change state, so a missed event is repaired by a normal read and polling always works.
- Every status change already ends in one timeline write, so the services call `record()` (write the event, then `notifier.bookingChanged`). The notifier works out who is told what, emits sockets, and writes push outbox rows. It never throws, so a realtime or push fault cannot fail a ride action.
- Token auth is shared by REST and sockets (`resolveAuth`), so the rules cannot drift. Role/status come from the database each time.
- The push outbox is written inside the request and sent by a worker (third sweeper timer, 2 s) using the same lease-and-conditional-update pattern as dispatch, so it is safe on several instances and survives a Firebase outage.
- Bug found while testing and fixed: a driver could be pushed "New ride request" after the offer was accepted, declined, cancelled or taken, if the worker was behind. Unsent offer pushes are now cancelled when the offer closes.
- `firebase-admin` was installed and removed again: it pulled in 8 moderate advisories through packages we never use (Firestore, Cloud Storage). The adapter calls the HTTP API and signs with `jsonwebtoken` instead.
- A mistake caught by the tests: a bulk replace of `recordEvent(` also rewrote the line inside the new wrapper, making it call itself (typecheck caught it). Another: while adding the GPS write throttle I briefly dropped the stored-time rate limit; an existing presence test caught it.

**Tests:** 312 total (was 244): `realtime-auth`, `realtime-expiry` (real 2 s tokens), `realtime-events` (full ride over sockets, isolation, privacy scan, ops room), `realtime-race`, `tracking`, `notifications`, `fcm`. Mutation checks: privacy gate, user isolation, handshake auth, offer-event leakage, stale offer push, rider streaming GPS, suspension disconnect, dead-token handling.

**Gate results:** lint, prettier, typecheck, build clean; 312 tests x3 consecutive local runs; `npm audit --omit=dev` 0 vulnerabilities; on Atlas: indexes built (19 collections), 85 realtime/tracking/notification/hardening tests pass, and a booted server accepted a real login, a socket connection (hello), a device registration and an inbox read, and rejected a junk token (smoke data deleted afterwards).

**Not verified / left:** see the P4 tracker (real Firebase, real phones, Redis, placeholders). Nothing committed.

### Phase 5: Ride extras (done 2026-10-17)
**Endpoints added (11; total 82):** `GET /bookings/{id}/cancel-preview`, `POST /rides/{id}/no-show`, `POST /rides/{id}/stops/{index}/arrived|departed`, `POST /rides/{id}/destination`, `POST /rides/{id}/destination/respond`, `GET /rides/{id}/receipt`, `POST|GET /admin/pricing/cancellation-policies`, `POST /admin/bookings/{id}/fee/waive`, `GET /admin/documents/expiring`. Quotes and bookings now accept `stops`.

**Design decisions:** D56-D63 in `docs/decisions.md`. Notable: the booking owns a frozen copy of the cancellation rules, like the fare; a re-dispatch reuses the booking's single ride record (so the next driver takes it over with a fresh pickup code) and the old driver can no longer read it; the state machine gained `-> DISPATCHING` from the three assigned states.

**Found by the tests and fixed:** after a re-dispatch the driver who cancelled could still read the ride, including the rider's phone (now 404).

**Changed existing behaviour on purpose:** a driver cancel no longer ends the booking (first two times); approving a driver now needs documents; a rejected vehicle frees its plate; `GET /admin/dashboard` `reviewQueue` has two more counters. Eight existing tests were updated for these.

**Operational:** `registrationNumber` index changed shape: run `npm run indexes -- --prune` on every environment (done on Atlas).

**Not verified / left:** see the P5 tracker. Nothing committed.

### Phase 7: Ops, safety and admin (backend done 2026-10-17)
**Endpoints added (41; total 149 in Postman):** config flags (3), staff (3), safety (SOS 2, emergency contacts 3, trip share 3, desk 6), support (user 5, desk 6), ratings (5), reports (2), coupons (3).

**Design decisions:** D74+ in `docs/decisions.md`. Sockets only announce; REST stays the source of truth. Ratings and coupon uses use claim-then-increment with a repair job (no multi-document transactions). Coupons never touch the driver's pay: the platform funds the discount through the PROMOTIONS account, and the ledger still sums to zero.

**Found and fixed while testing:** `GET /payments/{id}` had no role gate (the RBAC matrix caught it); the flag cache survived a test reset (added `invalidate()`).

**Operational:** new collections (flags, emergency contacts, incidents, trip shares, tickets, ratings, coupons, coupon usage) need `npm run indexes` on release. Housekeeping job every 60 s, safety escalation every 30 s. `featureDefaults.SOS` is false when `NODE_ENV=production`.

**Not verified / left:** see the P7 tracker.

### Phase 6: Payments and ledger (done 2026-10-17)
**Endpoints added (26; total 108 in Postman):** rider `POST /bookings/{id}/payments`, `POST /payments/verify`, `GET /payments/{id}`, `GET /customers/me/balance`; webhook `POST /webhooks/razorpay`; driver `POST /rides/{id}/cash-collected`, `GET /drivers/me/balance|earnings|settlements`; dev-only `POST /dev/payments/{id}/complete`; staff payments list, refund, write-off, payment dispute, ledger, driver balances, consistency, cash deposits, settlements (generate/list/detail/approve/mark-paid/cancel), commission rates.

**Design decisions:** D65-D73 in `docs/decisions.md`. Key idea: a ledger transaction is a single document so it is atomic without multi-document transactions; every money action is a conditional update plus an idempotent ledger post, with a repair job for crash gaps. The booking records what settled it (`paidBy`), which is how a late duplicate payment is told apart and refunded.

**Found and fixed while testing:** a Phase 3 race in the pickup start (a parallel start that lost could be told "too many OTP attempts" instead of a plain conflict); `-0` leaking into driver balances.

**Operational:** `PAYMENTS_DRIVER` (mock default), webhook URL `/api/v1/webhooks/razorpay`, `npm run indexes:prod` on release (done on Atlas).

**Not verified / left:** see the P6 tracker. One real Razorpay TEST-mode Rs 1 order was created to confirm the connection (no money moves in test mode). Nothing committed.

### Phase 8: Hardening and pilot readiness, part 1 (done 2026-10-18)
**Added:** release gate (`npm run gate`), security fixes and tests, monitor + `GET /admin/system/health`, alerting, load-test script, runbook, go/no-go checklist. One endpoint added (150 documented routes).

**Design decisions:** D82-D87 in `docs/decisions.md`.

**Not verified / left:** see the P8 tracker. The load script was only run at tiny scale against the in-memory test server; no real latency numbers exist yet. Alerts were tested with a fake webhook, not a real Slack/Discord one. Backups and restore are not set up.

### Tips, wallet and payouts (done 2026-10-18)
**Added:** tips (2 endpoints), wallet (4: wallet, top-up, pay from wallet, staff view), payouts (9: driver account x2, finance review/send/list x5, dev completion, provider webhook). Refund gained `destination`. Total 167 documented routes.

**Design decisions:** D89-D95 in `docs/decisions.md`. Key idea: tips, top-ups and wallet payments are all `Payment` records (purpose + method), so refunds, reconciliation and duplicate-payment protection work for them too; the wallet balance is never stored, only derived from the ledger.

**Operational:** `PAYOUTS_DRIVER`, `RAZORPAYX_*`, `AUTO_PAYOUTS` settings; webhook `/api/v1/webhooks/razorpayx`; `npm run indexes` for 4 new collections.

**Not verified / left:** see the P8b tracker.

## 9. Repo layout (current)
```
Car-Booking Platform/
├── backend/            Express + TS API (src/{config,common,middleware,modules,providers,docs,seed}, tests, scripts)
├── customer-app/       placeholder
├── driver-app/         placeholder
├── admin-panel/        placeholder
├── docs/               decisions, api-contract, enums, staging-and-observability
├── postman/            generated collection + environment template
├── infra/              docker-compose.yml (Mongo replica set + Redis)
├── .github/workflows/  ci.yml
├── CONTEXT.md
├── README.md
└── package-lock.json   (pre-existing empty stub, unused)
```

## 10. Progress log
- 2026-10-17: Reviewed Spec A and Spec B; produced comparison and phased workflow; audited and revised phases (added P3.5, P5 ride extras, CI/staging/observability in P0, parallel mobile integration). User approved.
- 2026-10-17: Created folders and this file.
- 2026-10-17: Phase 0 completed.
- 2026-10-17: Phase 1 completed (82 tests passing).
- 2026-10-17: Refactor of P1 modules to the spec pattern (routes/schemas/controller/service per module, shared `Actor` type, audit service gained `list`). No behaviour change: same 82 tests pass; `docs/api-contract.md` unchanged. One test flaked once under parallel load; 18 reruns (6 full suites + 12 targeted) all passed.

- 2026-10-17: Phase 2 completed (135 tests passing, 41 documented routes).

- 2026-10-17: Phase 3 completed (206 tests passing, 60 documented routes).
- 2026-10-17: Phase 3.5 completed locally (223 tests, 66 routes). The first Atlas URL was a shared, nearly full cluster and was not used. The user then created a dedicated Atlas cluster: seeded, server booted, and all 223 tests pass on it (see tracker). Staging deploy waits for a host.
- 2026-10-17: Phase 3.6 database hardening completed (reconciler, stale-presence sweep, index control, write concern, new indexes; 244 tests; verified on Atlas).
- 2026-10-17: Phase 4 completed (312 tests, 71 documented routes; sockets, live tracking, push outbox; Redis and real Firebase deferred).
- 2026-10-17: Phase 5 completed (385 tests, 82 documented routes; stops, waiting, destination change, cancellation fees/no-show, re-dispatch, receipts, document expiry).
- 2026-10-17: Phase 6 completed (424 tests, 108 documented routes; ledger, Razorpay payments, cash, refunds, settlements).
- 2026-10-18: Backend completion pass finished: staff login, email, privacy, upload checks, cash tips, wallet bonus, invoice tax, rentals, outstation, Redis support (optional, fail-open). New collections need `npm run indexes`.
- 2026-10-18: Tips, wallet and automatic driver payouts built and tested (167 routes, 525 tests passing).
- 2026-10-18: Phase 8 part 1 completed (500 tests passing; gate, security fixes, monitoring/alerts, load script, runbook, checklist).
- 2026-10-17: Phase 7 backend completed (149 documented routes; flags, staff, SOS/trip share/emergency contacts, support, ratings, reports + CSV, coupons, RBAC matrix). 468 tests passing.

## 11. Next step
All backend code is written. Next: confirm the placeholder numbers (D116, D117, D119-D122), create rental packages and outstation rates for the pilot zone, run `npm run indexes` on the real database, then the live checks (SMTP, S3/R2, RazorpayX, NimbusIT, Firebase, Razorpay, Redis with two instances), staging deploy, and the apps/admin panel. Deliberately not built: wallet withdrawal to a bank (legal risk) and an analytics rollup table (premature). Not built either: a live-meter endpoint for rentals, and the overrun monitor covers city rides only.

(Previous note:)
Tips, wallet and payouts are built. Before real money: RazorpayX account + one test payout, legal check on the wallet, `npm run indexes`. Then Phase 8 part 2 (staging, load test, alerts, backups) and the apps/admin panel.

(Older note:)
Phase 7 is complete on the backend (docs written, Atlas indexes run, tests green on Atlas). Show the Phase 8 plan. Nothing is committed (P0-P7): commit when the user asks.

## 12. Work left (detail, as of end of P7 backend)
**Backend phases still to build**
- **P8 Hardening & pilot (next):** Spec A's 11-test regression gate; security review (rate limits, headers, secrets, dependency audit, abuse cases on public endpoints); load test of dispatch and tracking; reconciliation reports on a schedule; monitoring and alerts (error rate, stuck dispatch, unbalanced ledger, unacknowledged SOS); backups and restore drill; a runbook; Redis for multi-instance sockets/rate limits (deferred by the user to here); go/no-go checklist.
- **P9 Expansion:** scheduled rides, corporate accounts, rentals, outstation, analytics. Not started, not planned in detail.

**Not built at all (outside the backend)**
- Customer app, driver app, admin panel: only placeholder folders. The admin panel needs screens for every P7 desk (safety, support, coupons, flags, staff, reports, finance).

**Needs the user / outside services (cannot be finished by code alone)**
- Hosting for staging and a public URL (needed to test real webhooks); Docker build and the CI docker job have never run.
- Firebase project (real push), a real SMS provider (OTP and emergency texts), Google Maps key, file storage for documents.
- Razorpay: real checkout, real webhook delivery, real refund (only a Rs 1 TEST-mode order was confirmed).
- A staffed 24/7 safety desk before SOS is switched on in production; KYC/compliance review; location retention policy.
- Policy numbers still placeholders: commission 20%, 24 h unpaid grace, Rs 2,000 cash limit, who bears refunds/write-offs, coupon budgets, GST.
- Rotate the credentials that were pasted into chat; commit decision (nothing committed so far).

## 13. Tomorrow's guide: what to do, in order

### A. Finish Phase 7: DONE 2026-10-18 (docs, Atlas indexes and Atlas test run completed; only the commit decision remains)
1. Confirm the full test run is green (one run only; use `npx vitest run --maxWorkers=3`, four at once time out on Windows).
2. Run `npm run indexes` in `backend/` against Atlas (creates indexes for the 8 new collections). Add `-- --prune` only if it says an index changed shape.
3. Remaining docs: `docs/enums.md` (new enums: flag keys, incident status/outcome, ticket category/status/outcome, rating tags, coupon type), `docs/api-contract.md` (`FEATURE_DISABLED` 403 error, the new endpoints), `docs/realtime-contract.md` (`ops:sos`), `docs/mobile-integration-guide.md` (flags at start-up, SOS button, share link, ratings screen, coupon field on the quote), `docs/staging-and-observability.md` (new jobs: safety escalation 30 s, housekeeping 60 s).
4. Tell Claude: "commit P0-P7" only if you want a commit. Nothing is committed yet.

### B. Phase 8: Hardening & pilot (next phase; ask Claude "show the phase 8 plan")
Build, in this order:
1. **Regression gate**: Spec A's 11 minimum tests as one named suite (payment, authorization, ride assignment, location privacy first, as the go/no-go rule needs these).
2. **Security review**: rate limits on every public/OTP endpoint, security headers, CORS, secrets handling, `npm audit` result, abuse cases on `/public/trips/{token}`, webhook replay, role escalation.
3. **Redis**: move socket fan-out and rate limits to Redis so more than one server instance works (you deferred this to here; needs a Redis URL).
4. **Load test**: many drivers sending location + many ride requests; measure dispatch time and Mongo load.
5. **Monitoring and alerts**: unbalanced ledger, stuck dispatch, unacknowledged SOS, payment webhook failures, error rate. Needs a place to send alerts (email/Slack).
6. **Backups and restore drill** (Atlas backup settings + one tested restore).
7. **Runbook** (what to do when payments, dispatch, SOS or the database fail) and the **go/no-go checklist**.

### C. Phase 9: Expansion (only after a pilot)
Scheduled rides, corporate accounts, rentals, outstation, analytics. Plan it only when P8 is done; each is its own mini-phase.

### D. Things only YOU can do (start these early, they take days)
| Item | Why | Needed by |
|---|---|---|
| Staging host (e.g. a small VM or Render/Railway) + public HTTPS URL | real Razorpay webhooks, Docker build never run, real phones | P8 |
| Firebase project (server key) | real push notifications, incl. SOS alerts to staff | P8 |
| SMS provider (OTP + emergency texts) | right now SMS is a mock | P8 |
| Google Maps API key | real distance/ETA; maps is a mock | P8 |
| File storage (S3/Cloudinary) for driver documents | uploads are mocked | P8 |
| Razorpay: do one real TEST checkout, set webhook URL `/api/v1/webhooks/razorpay`, do one test refund | only a Rs 1 order creation was ever confirmed | P8 |
| A staffed safety team (who answers SOS, 24/7) | SOS stays OFF in production until this exists | before launch |
| Policy decisions: commission %, unpaid-grace hours, cash limit, who pays refunds/write-offs, coupon budget, GST | all are placeholders in the code | before launch |
| KYC/compliance review, location data retention policy | legal | before launch |
| Rotate the passwords/keys you pasted into chat (Atlas user, old .env values) | they are exposed | today |
| Build or hire for: customer app, driver app, admin panel | none exist; the backend API is ready for them (see `docs/mobile-integration-guide.md`) | in parallel |

### E. Suggested order for tomorrow
1. Section A (finish P7). 2. Ask for the P8 plan and approve it. 3. While P8 is built, create the staging host, Firebase project and SMS/Maps keys from section D and put them in `backend/.env`. 4. Start the apps/admin panel track with the people who will build it.

## 14. Backend completion pass (2026-10-18/19): what was added after Phase 9's first features
- [x] **Staff login security:** email + password + authenticator (TOTP, recovery codes), lockout, 12-hour sessions, setup/reset emails, phone-code login refused for staff in production, first admin via `npm run seed` link (13 + 4 tests)
- [x] **Email provider** (mock + SMTP via nodemailer 10.x, audit clean). NOT verified against a real mail server
- [x] **Privacy:** data export, account deletion (7-day wait, blockers, anonymise, keep money records), staff-initiated deletion, job (9 tests). Retention periods still to decide (D112)
- [x] **Document upload checks + S3/R2 storage adapter** (AWS SigV4 verified against the published AWS example; upload confirm endpoint; approval needs a real file) (7 tests). NOT verified against a real bucket
- [x] **Cash tips, wallet top-up bonus, invoice tax (GST placeholder)**
- [x] **Rentals and outstation** (quotes, bookings, dispatch preferences, final fare from the server trail, receipts, staff rate setup, 11 fare tests + 7 integration tests)
- [x] **Redis support** (shared rate-limit counts and Socket.IO adapter behind `REDIS_URL`, fail-open; unit-tested only, not against a real Redis)
- [x] **Monitor:** `rides_overrunning` check (city rides over 6 hours)

## 15. Admin Panel Completion Pass (2026-10-27): Dev 1 & Dev 2 Full Delivery (100% Complete & Verified)
Enterprise operations and fleet management dashboard built with Next.js 16 (App Router), React 19, TailwindCSS v4, React Query v5, Zustand v5, Socket.IO client v4, and Leaflet + Geoman. Fully connected to live backend on `http://localhost:4000/api/v1`.

### A. Route Coverage & Delivered Features (38 Production Routes across 8 Departments)
- [x] **Authentication & Staff Identity:** Login with MFA challenge (`/login`), active sessions monitor with remote revocation (`/settings/sessions`), Step-Up MFA privilege elevation modal for staff role mutations (`/settings/roles`).
- [x] **Fleet Operations & Real-Time Telemetry:** Live Socket.IO radar tracking with Leaflet map markers (`/dispatch/live-map`), active booking queue with manual driver override dispatching (`/dispatch/queue`).
- [x] **Driver KYC Inspection & Vehicle Verification:** Driver directory (`/drivers`), deep KYC inspection desk with presigned document sign-off and vehicle approval (`/drivers/[driverId]`), fleet verification desk (`/vehicles`), vehicle categories (`/vehicles/categories`).
- [x] **Customer Directory & Booking Governance:** Customer accounts directory (`/customers`), customer profile with wallet transactions, account suspension modal, and booking restriction drawer (`/customers/[customerId]`).
- [x] **GIS Geofencing & Tariff Configurator:** Leaflet-Geoman interactive polygon geofence builder with operating hours (`/pricing/zones`), versioned tariff configurator (`/pricing/configs`).
- [x] **Finance, Double-Entry Ledger & Bad Debt Desk:** Real-time transaction ledger (`/finance/payments`), driver settlements batching with cash netting (`/finance/settlements`), driver cash collection reconcile (`/finance/cash`), customer delinquent debts desk with super-admin write-off authorization (`/finance/outstanding`), corporate invoicing desk (`/corporate/invoices`).
- [x] **Safety Command Desk & Customer Support:** Real-time emergency SOS desk with audio alarms and deduplication (`/safety/sos`), customer support ticket queue with assignment and resolution workflows (`/support/tickets`), review moderation desk (`/moderation/ratings`).
- [x] **Marketing Coupons & Operational Reports:** Promotional discount configurator (`/marketing/coupons`), operational rides report (`/reports/rides`), financial revenue breakdown (`/reports/revenue`), driver fleet leaderboard (`/reports/drivers`).
- [x] **System Governance & QA Matrix:** Immutable platform audit trail with actor tracing (`/settings/audit-logs`), in-browser QA acceptance verification matrix (`/tools/verification-matrix`).

### B. Security Hardening & Spec Integrity
- [x] **Strict Mock Isolation:** MSW mocks isolated under `NEXT_PUBLIC_API_MOCKING=false`; all client desks talk directly to the real MongoDB/Express backend.
- [x] **Dual-Factor Step-Up Authorization:** Implemented in `/settings/roles` for role modifications, with target identity confirmation, 6-digit MFA code, and auditable reasons.
- [x] **Audit Trail Linking:** Direct links (`[View Audit Trail →](/settings/audit-logs)`) rendered in notification toasts for all critical state changes (vehicle sign-off, driver KYC, debt write-off, customer restrictions).
- [x] **Reports 50k Cap & PII Scrubbing:** All report exports enforce a 50,000-row slice ceiling and mask phone numbers (`+91 ••••• •XXXX`).

### C. Test Infrastructure & Quality Gates (124 Automated Tests, 100% PASS)
- [x] **Vitest Test Runner:** Wired `npm test` running 38 unit & integration tests (`idempotency.test.ts`, `verification-matrix.test.ts`, `dev2-acceptance.test.ts`) in ~0.9s.
- [x] **Dev 1 Verification Suite:** `npm run test:dev1` executing 30 backend & frontend route tests with automated database teardown (30/30 PASS).
- [x] **Dev 2 Verification Suite:** `npm run test:dev2` executing 56 acceptance and route tests with idempotency cache cleanup (56/56 PASS).
- [x] **Master Test Suite:** `npm run test:all` executing all 124 tests in sequence with 100% green exit code 0.
- [x] **Static Code Analysis:** `npm run lint` passing with 0 errors and 0 warnings; `npx tsc --noEmit` passing with 0 errors.

## 16. Realtime Contract & API Specification Sync (Phase 7 Complete)
- **Canonical Socket.IO Event Naming Conventions:**
  - Client-to-Server Events:
    - `location:update`: Driver GPS telemetry ping (`{ lat, lng, accuracyMeters?, headingDegrees?, speedMetersPerSecond?, recordedAt }`).
    - `auth:refresh`: Live token rotation on socket before 15m expiration (`{ token }`).
    - `ops:simulate_driver_location`: SUPER_ADMIN only simulation event for fleet radar testing (`{ driverId, lat, lng, headingDegrees?, speedKmh? }`).
  - Server-to-Client Events:
    - `hello`: Handshake subscription confirmation (`{ userId, role, serverTime }`).
    - `driver.location.updated`: Ops fleet radar room driver telemetry broadcast (`{ driverId, userId?, bookingId?, rideId?, lat, lng, headingDegrees?, speedKmh?, recordedAt, simulated?: boolean }`).
    - `driver:location`: Rider active ride tracking stream (`{ bookingId, rideId, lat, lng, headingDegrees?, recordedAt }`).
    - `booking:status`: Customer booking status transition (`{ bookingId, rideId | null, status }`).
    - `ride:status`: Assigned driver ride transition (`{ bookingId, rideId, status }`).
    - `ride:update`: Non-status mutations (`STOP_ARRIVED`, `STOP_DEPARTED`, `DESTINATION_REQUESTED`, `DESTINATION_ACCEPTED`, `FEE_WAIVED`).
    - `offer:new` & `offer:closed`: Driver dispatch dispatch/expiry stream.
    - `ops:booking`: Staff global booking status monitor.
    - `ops:sos`: Real-time emergency desk alert stream (`{ incidentId, bookingId, kind }`).
    - `auth:expired` & `auth:revoked`: Connection lifecycle management.
- **API Documentation & Contract Status:**
  - `backend/src/docs/routes.ts`: 100% matched to active routes in Express router (240 routes verified).
  - Legacy/unsafe `/admin/auth/login` and `/admin/auth/mfa/verify` routes completely purged.
  - OpenAPI 3.0 specification (`/api/v1/openapi.json`) dynamically generated from canonical route registry.
  - Postman collection regenerated (240 requests in `postman/`).
  - Contract test suite `tests/contract.test.ts`: 4/4 suites PASS.
