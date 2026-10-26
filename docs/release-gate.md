# Release gate and go/no-go checklist

**Rule (from the project plan):** no public launch if payment, authorization, ride-assignment or location-privacy tests fail.

## 1. The gate: `npm run gate` (in `backend/`)
Runs these suites together. All must pass before any release or pilot.

| # | What must always be true | Where it is tested |
|---|---|---|
| 1 | Nobody can read another person's ride, receipt, booking or rating | `gate.test.ts`, `authz.test.ts` |
| 2 | Phone numbers and the pickup code never reach the other side; a driver loses access after the ride | `gate.test.ts`, `rides.test.ts` |
| 3 | Every route refuses every role it is not documented for (all 150 routes x 8 roles) | `rbac-matrix.test.ts`, `contract.test.ts` |
| 4 | Two drivers accepting the same offer: exactly one wins | `dispatch-race.test.ts` |
| 5 | The pickup code cannot be guessed (attempt limit) | `rides.test.ts` |
| 6 | A payment cannot be faked: bad webhook signatures refused, replayed webhooks do nothing, amounts are set by the server | `finance-payments.test.ts` |
| 7 | The books always balance: cash, coupons, online payments, refunds, settlements | `gate.test.ts`, `finance-ledger.test.ts`, `finance-cash.test.ts` |
| 8 | An unpaid ride blocks the next booking; paying or a write-off lifts it | `finance-payments.test.ts` |
| 9 | A cancelled ride leaves nothing stuck: driver freed, offers closed, coupon use returned | `gate.test.ts` |
| 10 | An SOS reaches the safety desk and is escalated if nobody takes it | `safety.test.ts` |
| 11 | Location data expires (30 days) and the public trip link shows no phone numbers | `gate.test.ts`, `safety.test.ts` |
| + | Security: headers, CORS, hostile input, token tampering, rate limits, unsafe settings refused | `security.test.ts`, `security-limits.test.ts` |
| + | Monitoring: eight checks, alerts, metrics and error-rate alert work | `monitor.test.ts` |

Also run the whole suite (`npm test`), `npm run lint`, `npm run typecheck`, `npm run build` before a release.

## 2. Go/no-go checklist for the pilot
Mark each line YES with a date and a name. Any NO on a **MUST** line = no launch.

**Code and data**
- [ ] MUST: `npm run gate` and `npm test` pass on the exact build being deployed
- [ ] MUST: `npm run indexes:prod` run against the production database after the deploy
- [ ] MUST: `npm audit --omit=dev` shows no high or critical findings
- [ ] MUST: production settings: `NODE_ENV=production`, real providers, no `STAGING_FIXED_OTP`, `CORS_ORIGINS` lists only the real web addresses, the two JWT secrets are different and random
- [ ] MUST: passwords and keys that were ever pasted into chat or committed have been replaced

**Money**
- [ ] MUST: Razorpay LIVE keys set; one real small payment and one real refund done and seen in the ledger
- [ ] MUST: the webhook address is set in Razorpay and one real delivery was received
- [ ] MUST: policy numbers decided and entered (commission, unpaid grace, cash limit, who bears refunds and write-offs, coupon budget)
- [ ] GST / tax treatment decided with an accountant
- [ ] MUST (if the wallet is on): a lawyer/accountant has confirmed the wallet is allowed as designed (closed wallet, no bank withdrawal)
- [ ] MUST (if payouts are on): RazorpayX account active and funded; one real small payout to an account you control, seen as PAID with a bank reference; one failed payout (wrong account) seen as FAILED and retried
- [ ] MUST: the payout webhook (`/api/v1/webhooks/razorpayx`) is set and one real delivery was received

**Safety and people**
- [ ] MUST: a named, staffed safety desk (who answers `ops:sos`, hours, phone numbers, police/ambulance procedure) before SOS is switched on
- [ ] MUST: real push works (Firebase) and a real SMS arrives (OTP and emergency text templates registered)
- [ ] KYC / document review process and legal review done; location retention policy accepted

**Operations**
- [ ] MUST: alerts reach a real person (`ALERT_WEBHOOK_URL` set; test by breaking a check on staging)
- [ ] MUST: backups on and one restore tested (see the runbook)
- [ ] MUST: both load tests (`npm run loadtest` and `npm run loadtest:rides`) run on staging; limits understood (see the reports)
- [ ] MUST: two or more people have read the runbook and can switch features off (`PUT /admin/feature-flags/{key}`)
- [ ] Redis in place if more than one server instance will run (otherwise run exactly one)

## 3. Pilot limits (recommended)
One city, a small group of known drivers, daytime hours first, a named person watching `GET /admin/system/health` and the alert channel, and a daily look at the money consistency report (`GET /admin/finance/consistency`).

## Added in the backend completion pass
- [ ] Rentals and outstation: staff have created packages and rates for the pilot zone; the placeholder numbers in D119 to D122 are confirmed.
- [ ] One real rental and one real outstation test ride on staging (GPS trail recorded, receipt reads correctly).
- [ ] Invoice tax rate and seller details confirmed by an accountant (D117).
- [ ] Redis tested with two instances (D123), or the single-instance decision recorded.
- [ ] SMTP, S3/R2, RazorpayX, NimbusIT and Firebase each tested once live.
