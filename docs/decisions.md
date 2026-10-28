# Decision log

Status: **PROVISIONAL** = default assumed by the engineer, awaiting lead confirmation. **LOCKED** = confirmed.

| # | Decision | Status | Notes |
|---|---|---|---|
| D1 | Spec B (Technical Spec v1.0) naming and structure is the API contract; Spec A's 2-day core is the first milestone | PROVISIONAL | Names differ between specs (see CONTEXT.md §4) |
| D2 | Backend: Node 20, Express 5, TypeScript, modular monolith | LOCKED by spec | Do not split into services until scale demands |
| D3 | Database: MongoDB (replica set for transactions) via Mongoose | LOCKED by spec | |
| D4 | Redis = coordination only (presence, geo, dispatch cache, BullMQ). Durable state lives in MongoDB | LOCKED by spec | |
| D5 | Package manager: npm | PROVISIONAL | |
| D6 | Login: phone OTP for customers/drivers | PROVISIONAL | Admin login method undecided |
| D7 | Pilot city: Delhi, currency INR | PROVISIONAL | |
| D8 | Money: integer paise. Time: UTC ISO-8601. Coordinates stored as GeoJSON `[lng, lat]`; API uses `{lat, lng}` objects | LOCKED by spec | |
| D9 | Ride state and payment state are separate state machines | LOCKED by spec | |
| D10 | Driver assignment via atomic conditional update; loser gets `409 RIDE_ALREADY_ASSIGNED` | LOCKED by spec | |
| D11 | Idempotency via `Idempotency-Key` header (Spec B), not a body field | PROVISIONAL | follows D1 |
| D12 | Provider adapters (maps, SMS, push, payments, storage) behind interfaces; mocks allowed only when `NODE_ENV != production` | LOCKED | Mocks never report payment success |
| D13 | Health endpoints: `/api/v1/health/live`, `/api/v1/health/ready` | PROVISIONAL | follows D1 |
| D14 | Logging: pino, JSON, secrets/OTPs/tokens redacted, request id on every request | LOCKED | |
| D15 | `express-rate-limit` default in-memory store for now; move to Redis store before multi-instance deploy | PROVISIONAL | |
| D16 | OTP login, 6 digits, 5 min expiry, 30 s resend, 5 per hour, 5 attempts; OTP and refresh tokens stored as HMAC hashes | PROVISIONAL | thresholds are configurable env vars |
| D17 | Access JWT 15 min (HS256); refresh token random, rotating, reuse revokes the session; role/status read from DB every request | PROVISIONAL | |
| D18 | One role per phone number; self-signup only CUSTOMER or DRIVER; admins created by seed | PROVISIONAL | |
| D19 | Driver approval does not yet require approved documents or a verified vehicle | OPEN | decide KYC completeness rule with lead |
| D20 | Document object keys are generated server-side; only last 4 characters of document numbers stored | LOCKED | privacy by design |
| D21 | Foreign resources return 404 (not 403) when not visible to the caller | LOCKED | per api-contract |
| D22 | Endpoint docs, OpenAPI and Postman are generated from `backend/src/docs/routes.ts`; a contract test enforces parity | LOCKED | |

| D23 | Quote valid 10 min, single use, priced entirely server-side; the client never sends distance, duration or fare | LOCKED | |
| D24 | Fare configs are immutable and versioned per zone+category; a change is a new version with an effective date (no PATCH) | PROVISIONAL | Spec B listed a PATCH; this is stricter |
| D25 | Pricing follows the pickup zone; both pickup and drop must be in an open active zone | PROVISIONAL | cross-zone trips need a rule from the lead |
| D26 | Public ids are opaque (`fq_`, `bk_` + 12 hex), not Mongo ObjectIds | LOCKED | |
| D27 | Booking creation requires an `Idempotency-Key` header (8-128 chars), unique per customer | LOCKED | |
| D28 | Zone operating hours are interpreted in Asia/Kolkata | PROVISIONAL | single-timezone assumption |
| D29 | Placeholder rates, Delhi NCR box and categories in the seed are NOT real business data | OPEN | confirm with lead |

| D30 | Booking owns lifecycle status; Ride holds OTP/timestamps/evidence. All transitions via one conditional-update helper | LOCKED | |
| D31 | Dispatch timing via a DB sweeper (no Redis yet); BullMQ later behind `DispatchService.sweep()` | PROVISIONAL | spec asks for BullMQ |
| D32 | Final fare = quoted distance + measured time clamped 0.5x-3x of quoted duration, under the quoted config version | PROVISIONAL | confirm with lead; odometer/GPS billing later |
| D33 | Driver must be APPROVED with a VERIFIED vehicle to go online (documents not yet checked) | PROVISIONAL | partly answers D19 |
| D34 | Pickup OTP is derived (HMAC), never stored; 6 digits, 2 h, 5 attempts | LOCKED | |
| D35 | A driver cancel ends the booking (no auto re-dispatch); no cancellation fees yet | OPEN | decide policy with lead (P5) |
| D36 | Dispatch numbers (20 s offers, 3/6 km, 60 s search, 60 s GPS freshness) are placeholders | OPEN | tune with lead |

| D37 | API contract v1.0 frozen for P0-P3.5: additive changes only, breaking changes need `/api/v2` | PROVISIONAL | lead to confirm; values (fares, zone, timings) stay changeable |
| D38 | Admin views (users, bookings, dashboard) readable by OPS/SUPPORT/SUPER_ADMIN; suspending customers by OPS/SUPER_ADMIN; staff accounts only by SUPER_ADMIN; drivers via driver approval | PROVISIONAL | confirm role matrix with lead |
| D39 | Suspending a customer ends their sessions but does not cancel a ride already in progress | OPEN | policy for suspended users mid-ride |
| D40 | `STAGING_FIXED_OTP` (6 digits, refused in production) lets testers log in without SMS on staging | LOCKED | |
| D41 | Redis URL optional outside production until P4 (nothing uses Redis yet) | LOCKED | |
| D42 | `TEST_MONGO_URI` runs the suite on a real MongoDB with throwaway DBs. Never point it at a shared cluster | LOCKED | free Atlas tier caps at 500 collections |

| D43 | Half-finished writes (crash between steps) are repaired by an idempotent reconciler, not multi-document transactions. Every step is already a conditional update, so nothing is corrupted; the reconciler heals a stuck driver lock, an assignment with no ride, and a missing ride id. Revisit transactions for the payments ledger (P6) | PROVISIONAL | transactions would need a replica-set test harness; the reconciler covers the known crash windows |
| D44 | A ride lock or assignment must be 30 s old before the reconciler touches it (`reconcileGraceMs`); a stall inside one accept longer than that is treated as an outage | PROVISIONAL | |
| D45 | An ONLINE driver with no GPS for 5 min is set OFFLINE (never while on a ride) (`staleOnlineMs`) | PROVISIONAL | placeholder number |
| D46 | Indexes are not built at boot in production; `npm run indexes:prod` is a release step (additive; `--prune` drops unknown indexes) | LOCKED | |
| D47 | Mongo writes use `w: majority` + journal; reads stay on the primary | LOCKED | stale secondary reads could break eligibility checks |

| D48 | Sockets only announce; REST stays the single way to change state. Missed events are never replayed: clients re-read over REST on every reconnect | LOCKED | keeps one source of truth and a polling fallback |
| D49 | Clients cannot join rooms: the server puts each user in their own room (and staff in `ops`); the same auth checks as REST apply at the handshake, plus a 30 s database re-check and immediate disconnect on suspension | LOCKED | |
| D50 | The rider sees the driver's position only from assignment to the end of the ride, at most every 2 s; checked against the booking state, not only the driver lock | LOCKED | privacy |
| D51 | Route trail: one sampled point per 10 s during active rides only, deleted after 30 days; staff reads are audited | PROVISIONAL | retention and sampling are placeholders; confirm with lead/legal |
| D52 | Push goes through an outbox (written inside the request, sent by a worker with retries 5 s/30 s/2 m/10 m/30 m, then FAILED); a push for an offer is dropped if the offer expires or is taken first; notifications and inbox are kept 30 days | PROVISIONAL | wording and retention are placeholders |
| D53 | Firebase is called over its HTTP API with a self-signed token, not the firebase-admin SDK | LOCKED | the SDK pulled in 8 vulnerable unused packages; untested against real Firebase |
| D54 | Matching still runs on MongoDB; GPS is written to the database only after about 25 m of movement or 10 s. Redis is deferred (single-instance deploy until the Redis adapter is added, planned for hardening) | PROVISIONAL | lead asked to add Redis last |
| D55 | `PUSH_DRIVER=fcm` switches real push on alone while other providers stay mocks | LOCKED | |

| D56 | Waiting is measured by the server (arrived -> started, and at each stop). Pickup and each stop get their own 3-minute free allowance; the rest is billed at the zone's waiting rate, capped at 30 minutes in total. Time standing at a stop is billed as waiting, never also as ride time | PROVISIONAL | placeholder numbers; rate and free time come from the fare config |
| D57 | Up to 3 intermediate stops, priced as a route through them; stop arrival is judged from the server-held driver position | PROVISIONAL | |
| D58 | Destination change: rider asks, server prices pickup -> stops -> new drop under the booking's fare version, driver has 30 s to accept; max 3 accepted changes; the old fare is kept in `fareAmendments` | PROVISIONAL | pricing rule to confirm with lead |
| D59 | Cancellation / no-show rules are a versioned per-zone policy (default 2 min free, Rs 30 after that once the driver is moving; no-show after 5 min wait, Rs 50). The rules are frozen onto each booking when it is made. Only a rider's late cancel or a no-show costs the rider; a driver or staff cancel never does | PROVISIONAL | placeholder numbers; fee is recorded here, collected in P6 |
| D60 | A driver cancelling before the trip puts the booking back in the search (max 2 times, excluding that driver) and the same ride record is reused. Closes D35 | PROVISIONAL | after the limit it ends as cancelled by the driver |
| D61 | Receipts are JSON, numbered once (`rcpt_...`), built only from the stored final fare so they never change; issuer name/GSTIN are placeholders | PROVISIONAL | PDF and GST later |
| D62 | A driver is approved, and may go online, only with a current approved licence, vehicle RC, insurance and ID proof; expired ones take the driver offline (not mid-ride). Reminders at 30/7/1 days. Closes D19 | PROVISIONAL | confirm the required list with lead |
| D63 | A rejected vehicle frees its registration number (partial unique index on `holdsRegistration`). Changing an index shape needs `npm run indexes -- --prune` on each environment | LOCKED | |

| D64 | A driver sees the rider's name and phone only while the ride is live (assigned to in progress); once it ends or is cancelled the ride shows no rider contact. Staff still see it | PROVISIONAL | privacy default; confirm retention rule with lead/legal |

| D65 | Money lives in an append-only, double-entry ledger. Each business event is ONE document holding all its entries (so it is written atomically without multi-document transactions), entries sum to zero, and a unique idempotency key makes repeats harmless. Mistakes are fixed by posting an opposite transaction | PROVISIONAL | revisit real transactions if the ledger ever needs cross-document writes |
| D66 | Commission is a versioned per-zone rate (default 20%) frozen onto each booking when it is made; fares and fees both carry it | PROVISIONAL | placeholder rate |
| D67 | Online payments: the server fixes the amount; only a valid Razorpay signature (verify) or a signed webhook marks a booking paid; each webhook event is processed once; late/duplicate payments are refunded automatically | LOCKED | |
| D68 | Cash: the driver confirms the exact fare for CASH bookings; it becomes cash they hold. A driver whose net owed to the platform exceeds the limit (Rs 2,000) goes offline and cannot go online until finance records a deposit | PROVISIONAL | placeholder limit |
| D69 | A rider with an unpaid ride older than 24 h cannot book again (402 UNPAID_BALANCE); a dispute or write-off lifts it | PROVISIONAL | placeholder grace |
| D70 | Refunds: finance only, never more than paid in total, completed by Razorpay's webhook; the platform bears the cost and the driver keeps their share. Cash refunds are out of scope | PROVISIONAL | confirm who bears refunds |
| D71 | Write-off: SUPER_ADMIN only; the driver is still paid and the platform takes the loss. A waived fee is treated the same way | PROVISIONAL | confirm write-off authority |
| D72 | Settlements nets a driver's cash against what they are owed; the rest is a payout (recorded by hand with a bank reference; no automatic bank transfer yet) or a deposit still due. One open settlement per driver; approval refuses stale figures | PROVISIONAL | automatic payouts later |
| D73 | `PAYMENTS_DRIVER=razorpay` switches real payments on alone (use TEST keys outside production); `mock` (default) moves no money and exposes a development-only "complete payment" route | LOCKED | |

## Open items (need lead / finance / legal)
See the question list in the project hand-off. Not blocking P0.
Payment-after-ride default risk, driver earnings timing, unpaid-balance policy and KYC rules must be
decided before Phase 6 / pilot.
| D74 | Feature flags (SOS, TRIP_SHARING, SUPPORT_TICKETS, RATINGS, COUPONS) are resolved per role by the server; apps read `GET /config/flags`. SOS defaults OFF in production until a staffed response process exists | LOCKED | staff switch it on |
| D75 | Staff accounts are created by a SUPER_ADMIN by phone + role; a role change ends that person's sessions and sockets; nobody changes their own role | LOCKED | |
| D76 | An SOS never stops the ride. Staff are alerted first (event + push), saved contacts texted second; an alert not acknowledged in 2 minutes is escalated once to super admins; incident views are audited | PROVISIONAL | confirm window and who staffs it |
| D77 | Trip-share links are random tokens (only a hash is stored), show no phone numbers, and stop when the rider stops sharing or the ride ends; at most 5 live links per ride | LOCKED | |
| D78 | Support tickets: internal notes are never shown to users; 24 h without a staff reply = overdue; resolving a ticket records an outcome but refunds/waivers are done with the finance endpoints | PROVISIONAL | link ticket to refund later |
| D79 | Ratings: once per side per ride within 7 days; a driver's average is shown to riders only after 5 ratings; staff may hide a comment but the stars still count | PROVISIONAL | |
| D80 | Coupons: the platform pays the discount (PROMOTIONS account); the driver and commission are worked out on the full fare; a ride never costs less than Rs 1 after a discount; uses are taken atomically at booking and given back for rides that do not happen | PROVISIONAL | confirm who funds promotions |
| D81 | CSV exports: rides for OPS/FINANCE/SUPER_ADMIN, money files for FINANCE/SUPER_ADMIN; at most 50,000 rows; no phone numbers; spreadsheet formulas neutralised; every download audited | LOCKED | |
| D82 | Every signed-in caller is limited to 120 writes a minute across the API (keyed by login token), on top of each endpoint's own limits; quotes carrying a coupon code are limited to 15 per 5 minutes per caller | LOCKED | tune after the load test |
| D83 | API answers are sent with `Cache-Control: no-store` (they carry ride, contact and token data) | LOCKED | |
| D84 | Start-up refuses unsafe settings outside development: a wildcard web origin, and identical access/refresh secrets | LOCKED | |
| D85 | Socket connection attempts are limited per network address (120 a minute) before any login check | LOCKED | |
| D86 | A monitor runs every minute and alerts (log + optional webhook) on: unbalanced ledger, stuck searches, unanswered SOS, push backlog, unfinished webhooks, payments missing from the ledger, dead background jobs. One alert per problem, a reminder every 30 minutes, a message on recovery | PROVISIONAL | choose the alert channel |
| D87 | The release gate is `npm run gate` (11 named properties, see `docs/release-gate.md`); a failure blocks a release | LOCKED | |
| D88 | Metrics and error tracking are built in (per-instance, in memory, no outside account): `GET /admin/system/metrics` for staff and Prometheus text at `GET /metrics` behind `METRICS_TOKEN`. A hosted error tracker can be added later without changing the API | PROVISIONAL | add Sentry/Grafana if wanted |
| D89 | Tips: one per ride, within 24 hours, Rs 10-Rs 2,000, the driver gets all of it (no commission); paid online or from the wallet; cash tips stay between rider and driver (not recorded) | PROVISIONAL | confirm limits and no-commission |
| D90 | Wallet: a closed wallet (top-up by card, spend on rides/fees/tips, refunds can land there, no withdrawal). Balance is the sum of the rider's ledger entries; a short per-rider lock stops two spends using the same money. Limits Rs 50-Rs 5,000 per top-up, Rs 10,000 total | PROVISIONAL | legal check on RBI PPI rules before production |
| D91 | A wallet payment is a Payment (method WALLET) so refunds, receipts and duplicate-payment handling work the same; money from the wallet can only be refunded to the wallet | LOCKED | |
| D92 | Refunds can go to the wallet (`destination: WALLET`): processed at once, the gateway keeps the money, the platform bears the cost as before. The gateway-balance check ignores wallet payments and wallet refunds | LOCKED | |
| D93 | Driver payouts: the full bank/UPI details go to the payout provider only; we keep the last digits and the provider's references. A new or changed account must be verified by finance before any money is sent | LOCKED | |
| D94 | A payout is sent for an APPROVED settlement (by finance, or automatically if `AUTO_PAYOUTS=true`); the provider's webhook completes it. One live payout per settlement; a failed one is retried as a new attempt; manual mark-paid is refused while a payout is live. A payout reversed after payment restores the driver's balance and is flagged | LOCKED | |
| D95 | Settlement approval stays a person's decision even with automatic payouts; automatic mode stops after 3 failed attempts per settlement | PROVISIONAL | |
| D96 | Dispatch never offers a ride to a driver who already holds a live offer, and a driver taking a ride closes their other open offers immediately (found by the load test: riders asking from the same area all waited 20 s behind one driver) | LOCKED | |
| D97 | Rides for later are a booking status `SCHEDULED` (not a flag on REQUESTED), so nothing that works on a live ride can touch one by accident. Placeholders: 30 min to 7 days ahead; max 5 waiting per rider; search starts 20 min before pickup; reminder 60 min before; system cancels 30 min after the time | LOCKED | confirmed by the owner 2026-10-18 |
| D98 | A ride for later is priced when booked (and priced as of the pickup time); the zone's service hours are checked at pickup time. Cancelling is free until the search starts, then the normal cancellation rules apply | LOCKED | confirmed 2026-10-18: the fare stays locked at booking; no automatic repricing |
| D99 | The search for a scheduled ride starts by moving it to REQUESTED and handing it to dispatch, so offers, assignment and the ride lifecycle are exactly the same as an instant ride | LOCKED | |
| D100 | Analytics are read-only, computed live from existing collections, in India time; revenue is finance-only | PROVISIONAL | add a daily rollup if volume grows |
| D101 | A ride for later keeps being searched for until pickup time plus 10 minutes; an instant ride still gives up after 60 seconds (found by review: a search that starts 20 minutes early would otherwise fail in one minute) | LOCKED | confirmed 2026-10-18 |
| D102 | One rider's waiting scheduled rides must be at least 30 minutes apart | LOCKED | confirmed 2026-10-18 |
| D103 | Support/operations can cancel a waiting scheduled ride for the rider (free, reason recorded, rider told) and operations can start its search early; both are audited and only work while the ride is still SCHEDULED | LOCKED | |
| D104 | The five-offer limit per search stays for now; if no driver is found the rider is told (for a scheduled ride in words that fit: not charged, please book again). Review the limit with real dispatch data from the pilot | PROVISIONAL | review after the pilot |
| D105 | Corporate accounts: a company is billed for rides its employees take; the rider pays nothing and cannot pay or hand over cash on such a ride. Owed amounts sit in the ledger as `CORPORATE_RECEIVABLE:<company>`; the driver and the commission are worked out exactly as for any ride | LOCKED | |
| D106 | Placeholders (confirm): credit limit Rs 50,000; terms 15 days; Rs 10,000 per employee per month; optional per-ride cap; no coupons on company rides; a late-cancel or no-show fee is billed to the company; one company per person | PROVISIONAL | confirm with the first real company |
| D107 | Limits are checked at booking (member, company active, per-ride cap, employee monthly limit, company credit limit incl. rides not yet billed). Two bookings at the very same instant can overshoot a limit slightly: it is a guard rail, not an exact meter | PROVISIONAL | |
| D108 | Invoices: finance generates a draft for a period (a ride is on one invoice only), issues it (number `CI-year-sequence` assigned on issue so issued numbers have no gaps), records bank payments (part or full, never more than is left), or voids it (only if unpaid). Tax is NOT calculated (`taxPaise` is 0) until an accountant sets the rules | LOCKED for the flow; tax PENDING | GST rules from an accountant |
| D109 | A credit on a company ride is allowed only before the ride is invoiced (so invoices never change after issue); the platform bears the cost and the driver keeps their share | PROVISIONAL | |
| D110 | Staff sign in with email + password + authenticator code; a phone code alone is refused for staff in production. Sessions are 12 hours. Five wrong attempts lock for 15 minutes. A lost authenticator is reset by a super admin (re-invite) | LOCKED | |
| D111 | Passwords: scrypt hash; authenticator secrets encrypted at rest; recovery codes and links only as keyed hashes; each authenticator code works once; reset needs the emailed link AND an authenticator code | LOCKED | |
| D112 | Account deletion waits 7 days (cancellable), is refused while a ride, debt, wallet balance, company-admin role or driver settlement is open, removes who the person is and keeps money records anonymised. Driver KYC documents are kept for now | PROVISIONAL | decide retention periods and whether KYC documents are deleted after a period |
| D113 | A data export is a JSON file of the person's own data, once every 5 minutes, synchronous and capped (5,000 bookings) | PROVISIONAL | make it a background job if exports grow |
| D114 | Driver documents: the file must really be in storage (1 byte to 10 MB, declared type) before staff can approve; bad files are deleted. Files go straight from the phone to the bucket through a signed link | LOCKED | |

| D115 | Cash tips: a rider can record a tip paid in cash to the driver; it is the driver's own money (no ledger entry, not in earnings or the platform's cash balance) | PROVISIONAL | confirm with finance |
| D116 | Wallet top-up bonus (cashback) is configurable (percent, minimum and maximum top-up) and paid from the PROMOTIONS account; it can be spent, with the same withdrawal ban as the wallet | PLACEHOLDER | choose the real percent |
| D117 | Invoice tax: one rate (`INVOICE_TAX_BP`) added on company invoices, posted to TAX_PAYABLE, reversed if the invoice is voided. Seller name, address and tax number come from `SELLER_*` | PLACEHOLDER | needs the company GST details and an accountant review |
| D118 | Rentals: staff define packages per zone and cab type (hours, included km, price, extra km and extra hour rates). The package is frozen on the booking. Billing uses the server clock and the server GPS trail, never the driver odometer (kept only as evidence; a large mismatch is logged as ODOMETER_MISMATCH) | LOCKED | |
| D119 | Rental grace: 10 minutes over the hours and 2 km over the included distance are free; beyond that extra time (by the minute) and extra km (to the metre) are charged | PLACEHOLDER | confirm numbers |
| D120 | Outstation: staff set per-km rates per zone and cab type. One way is charged on the quoted route distance unless the real distance is more than 20% over it (then the real distance, at most twice the route). Round trip is charged on the larger of real km and 250 km a day, plus a driver night allowance per night | PLACEHOLDER | confirm 20%, 250 km/day, allowance |
| D121 | Outstation limits: at least 80 km and at most 1500 km (per rate); a round trip returns 2 hours to 30 days after pickup; days are calendar days in India time | PLACEHOLDER | confirm |
| D122 | Tolls and parking on rentals and outstation are paid on actuals between rider and driver; no advance payment is taken. Outstation is offered only to drivers who opted in (`acceptsOutstation`); rentals to all drivers unless they opt out | PLACEHOLDER | confirm |
| D123 | Redis is optional: with `REDIS_URL` the rate-limit counts and live-update messages are shared by all server instances; if Redis fails the API keeps working (limits count per instance) | LOCKED | not yet proven against a real Redis |
| D124 | Customer Saved Places: supported types `home`, `work`, `other`; max 20 places per customer (configurable); GeoJSON 2dsphere indexed; strict owner-only access (cross-customer returns 404); integrated with privacy export and account deletion | LOCKED | |
| D125 | Customer Referrals: unique uppercase referral code (`REF-XXXXXX`) and shareable link; referee eligible only once; max 10 successful referrals cap per referrer; reward issued via existing Coupon module (FLAT Rs 50, min fare Rs 100); gated by `REFERRALS` feature flag | LOCKED | |
| D126 | Admin Booking Restrictions: authorized roles OPS and SUPER_ADMIN; mandatory non-empty reason (3-300 chars); enforced in booking creation flow returning 403 `BOOKING_RESTRICTED`; strictly separated from user suspension and unpaid balance overdue blocks | LOCKED | |
| D127 | Admin Test Notification: authorized roles OPS and SUPER_ADMIN; channels `push` and `sms`; rate limited to 10/min per admin; truthfully dispatches through providers; audited as `ADMIN_TEST_NOTIFICATION_SENT` | LOCKED | |
| D128 | Admin Live-Driver Feed: authorized roles OPS, SUPPORT, SUPER_ADMIN; filters by bounding box (max 5 deg span) or `zoneId`; returns driver profile, vehicle details and GeoJSON location; audited as `ADMIN_VIEW_LIVE_DRIVERS`; router mounted before parameterized driver routes to prevent route collision | LOCKED | |
| D129 | Admin Dispatch Queue: authorized roles OPS, SUPPORT, SUPER_ADMIN; lists bookings in `REQUESTED` and `DISPATCHING` status sorted oldest first (`requestedAt: 1`); server-calculated `waitingSeconds`; filters by `zoneId` and `categoryId` | LOCKED | |
| D130 | Manual Driver Assignment: authorized roles OPS and SUPER_ADMIN; atomic conditional update claiming driver `activeRideId`; transitions booking to `DRIVER_ASSIGNED`; safe re-assignment releases previous driver (`activeRideId: null`) and records in `previousDrivers`; creates/updates `Ride` document; audited as `ADMIN_MANUAL_ASSIGN_DRIVER` | LOCKED | |
| D131 | Customer Active Booking Concurrency: each customer is restricted to at most ONE concurrent active ride in instant on-demand mode (in status `REQUESTED` through `IN_PROGRESS`). Multiple simultaneous rides are allowed only for scheduled bookings or authorized corporate fleet accounts | PROVISIONAL | prevents accidental duplicate requests & driver hold starvation |
| D132 | Audit Log Immutability: the `auditlogs` collection is write-once, append-only. The database application user has no `update` or `delete` privileges on audit logs, and Mongoose schema prevents mutation hooks | LOCKED | regulatory & legal compliance |
| D133 | Waiting Charges & Dwell Calculation: waiting fees are calculated server-side using GPS geofence arrival and trip start timestamps with a 5-minute free grace window; explicit manual start/stop driver endpoints deferred to Driver App v2 roadmap | PROVISIONAL | prevents driver manual dwell fraud |
| D134 | Tax Reversals & Cloud Hardening: GST credit note sequence `CN-YYYY-XXXX` auto-generated on corporate refunds; S3 presigned uploads enforce clamav/quarantine bucket isolation; MongoDB continuous point-in-time recovery (PITR) enabled on production Atlas | PROVISIONAL | accountant sign-off pending for live launch |

