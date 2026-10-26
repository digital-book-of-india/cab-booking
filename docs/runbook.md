# Runbook: what to do when something goes wrong

Written for the person on call. Health view: `GET /api/v1/admin/system/health` (OPS or SUPER_ADMIN login). Alerts arrive in the channel set in `ALERT_WEBHOOK_URL` as `ALERT <name>: <what is wrong>` and `RECOVERED <name>`. The same lines are in the server log with `"alert": true`.

## Alerts and what to do

### `corporate_invoices_overdue`
A company invoice is past its due date and unpaid.
1. `GET /admin/corporate-invoices?overdue=true` lists them. Contact the company's billing email (`GET /admin/corporate/{id}`).
2. If they say they paid, find the transfer and record it: `POST /admin/corporate-invoices/{id}/payments` with the bank reference (use a new `Idempotency-Key` per payment).
3. If they will not pay, stop new rides: `PATCH /admin/corporate/{id}` `{ "status": "SUSPENDED" }` (takes effect on the next booking). Rides already booked continue.
4. Never void an invoice that has a payment on it; credit the rides before invoicing, or settle the difference with the company.

### `scheduled_rides_overdue`
A ride booked for later is past its pickup time and the search never started.
1. Check the background jobs (`jobs_alive` in the same report). If the `scheduled rides` job is not running, restart the server.
2. Look at the waiting rides: `GET /admin/bookings?status=SCHEDULED`. Start the search for one by hand with `POST /admin/bookings/{id}/scheduled/start-now` (OPS). If it is too late to help the rider, cancel it for them with `POST /admin/bookings/{id}/scheduled/cancel` (support or OPS, a reason is required; free for the rider).
3. Rides more than 30 minutes late are cancelled by the system automatically and the rider is told. Make sure the rider is looked after (support ticket, a coupon).

### `sos_unacknowledged` (most urgent)
An SOS has been OPEN for 5+ minutes, escalation did not get it picked up.
1. Open `GET /admin/incidents?status=OPEN`, take it (`POST /admin/incidents/{id}/acknowledge`).
2. Open the incident (`GET /admin/incidents/{id}`): rider and driver phone numbers, vehicle, last position. Call the rider, then the driver.
3. Poll `GET /admin/incidents/{id}/location` while it is open. Contact police/ambulance if the person cannot be reached or asks for help.
4. Add notes as you go; close with `resolve` and the outcome.
5. Afterwards: why did it take 5 minutes? (nobody staffed, push not delivered, wrong role?) Fix the cause.

### `ledger_balanced`
Money records do not add up. **Do not run payouts or settlements until fixed.**
1. `GET /admin/finance/consistency` shows what is off (unbalanced transaction, ride without money recorded).
2. A ride without money recorded is repaired by the finance job within a minute; if it stays, look for errors in the log containing "accrual".
3. An unbalanced transaction should be impossible: stop and get a developer. Keep the transaction id from the report.

### `payments_not_in_ledger` / `webhooks_unfinished`
A customer paid (or Razorpay called us) and our books do not show it.
1. Check the Razorpay dashboard for the payment. If captured, the repair job re-checks it every minute; wait 2 minutes.
2. Still wrong: Razorpay dashboard -> webhooks -> re-send the event. Replays are safe.
3. Customer waiting: tell support the payment is safe; never ask the customer to pay again until finance confirms it did not capture.

### `dispatch_stuck`
Bookings have been searching 10+ minutes (normally a search gives up in a few minutes).
1. Is the background job running? Look at `jobs_alive` in the same report. If a job is dead, restart the server.
2. Are drivers online at all? `GET /admin/dashboard`.
3. Retry a stuck booking: `POST /bookings/{id}/dispatch/retry` (OPS).

### `push_backlog`
Push messages are waiting. Usually Firebase credentials or an outage.
1. Check the log for "push" errors. Invalid credentials: fix `FCM_SERVICE_ACCOUNT_JSON` and restart.
2. Firebase outage: it recovers by itself; the app also works without push (riders see status when they open the app).

### `payouts_need_attention`
A driver payout is stuck, slow or failed and nobody retried.
1. `GET /admin/payouts?status=FAILED` (or `CREATED`, `PROCESSING`) shows the payout and its `failureReason` (for example "Account closed").
2. FAILED: ask the driver to correct the payout account (the change is reviewed again), then `POST /admin/settlements/{id}/payout` to try again. The settlement stays payable meanwhile; no money is lost.
3. CREATED for a long time: the payout service did not answer. The repair job retries by itself; if it keeps failing, check the RazorpayX status page and balance (a payout needs funds in the RazorpayX account).
4. PROCESSING over a day: ask RazorpayX support with the payout id (`providerPayoutId` in the database); do NOT pay by hand until it is FAILED or REVERSED.
5. REVERSED after PAID: the bank sent the money back; the driver's balance is restored automatically. Contact the driver for a correct account, then send a new settlement.

### A staff member is locked out, lost their phone, or forgot the password
- Locked (too many wrong tries): wait 15 minutes. Nothing to do; it clears itself.
- Forgot the password: they use "Forgot password" (needs their authenticator code).
- Lost phone / authenticator, or both: a super admin gives them a fresh setup link: `POST /admin/staff/{userId}/credentials` `{ "email": ... }`. This ends their old logins and resets the password and authenticator. Check it is really them first (call back on a known number).
- The ONLY super admin is locked out: on the server run `SEED_ADMIN_PHONE=... SEED_ADMIN_EMAIL=... npm run seed` and use the printed setup link.

### A deletion or export request
- People delete or export from the app. A legal request by email: a super admin runs `POST /admin/users/{id}/delete` with a reason (refused while money or a ride is unresolved; sort that out first). Keep the request email.

### `error_rate`
At least 5 server errors (5xx) in the last 5 minutes and 5% or more of all requests.
1. `GET /admin/system/metrics` shows which routes are failing (status classes per route) and the server's memory and event-loop lag.
2. The log lines `unhandled error` carry the request id and the cause. Database unreachable? See "Database down or slow". Started right after a release? Roll back.
3. Remember it counts one server instance only; with several instances check each.

### `jobs_alive`
A background job stopped succeeding (named in the alert).
1. Read the error lines just before (`dispatch <job> failed`). Database down? See below.
2. Restart the server; if the same job fails again, switch off what depends on it (see "Switching things off") and get a developer.

## Other situations

**Payment gateway down.** Riders can still book with cash. Online payments fail with an error; the app should offer cash. Nothing to repair: unfinished payments expire and the repair job reconciles when Razorpay returns.

**Database down or slow.** `GET /health/ready` fails; the load balancer stops sending traffic. Atlas status page and metrics first. Do not restart repeatedly. When it returns, background jobs resume and repair half-finished work on their own.

**A bad release.** Roll back to the previous build (indexes are only ever added, so older code still works). Then run `npm run gate` on the build you intend to ship next.

**Switching things off without a deploy** (`PUT /admin/feature-flags/{key}` `{ "enabled": false }`, CONFIG_ADMIN or SUPER_ADMIN): `SOS`, `TRIP_SHARING`, `SUPPORT_TICKETS`, `RATINGS`, `COUPONS`. A bad coupon: `PATCH /admin/coupons/{id}` `{ "active": false }`.

**A person must lose access now.** Customer: `PATCH /admin/users/{id}/status` `{ "status": "SUSPENDED", "reason": "..." }` (OPS). Driver: the driver approval decision SUSPEND. Staff: SUPER_ADMIN only. Suspending ends their login and live connection immediately.

**Leaked secret.** Replace it (JWT secrets, Razorpay, SMS, Firebase, database password), redeploy. Replacing a JWT secret signs everyone out, which is fine. Razorpay and database passwords are changed in their dashboards first, then in the server settings.

## Backups and restore

Two things must be saved: the **database** and the **uploads folder** (driver documents, while storage is the server disk). Neither is saved by the other.

### Database
- Best: Atlas continuous cloud backup (needs a paid cluster, M10 or larger; the free M0 has none).
- Until then, or as a second copy: the built-in tool, which needs nothing installed except the app.
  - Back up: `npm run backup -- dump /backups/db-$(date +%F)` (in the container: `docker compose --env-file .env.staging run --rm -v $HOME/backups:/backups api node dist/tools/backupRun.js dump /backups/db-$(date +%F)`; the folder must be writable by the container user, `chmod 777` it or run as the same user). It prints how many collections and documents it saved and verifies its own checksums.
  - Prove an old backup is intact (no database needed): `npm run backup -- verify <folder>`. Do this on a schedule; a backup nobody has verified is a hope.
  - It is a copy of the data as the dump reads it, not a frozen instant: take it when the app is quiet (early morning), and expect the last minute of activity to be missing in a restore.
  - It does **not** save indexes. After a restore run `npm run indexes:prod`.
- Backups contain phone numbers, token hashes and bank references. Copy them off the server, keep them encrypted, and delete old ones. The tool can encrypt for you: `export BACKUP_ENCRYPTION_KEY=$(openssl rand -hex 32)` once, keep that key in a password manager (not beside the backups; lose it and they cannot be opened), then `npm run backup:prod -- dump --encrypt`. `verify` and `restore` need the same key set.
- Old or orphaned driver-document files: `npm run uploads:sweep:prod` lists them (dry run); add `-- --delete` to remove. Run it monthly.

### Uploads folder
`docker run --rm -v <folder>_uploads:/data -v $HOME/backups:/backup alpine tar czf /backup/uploads-$(date +%F).tar.gz -C /data .` (volume name from `docker volume ls`). Copy it off the server too.

### Restore drill (do it once, then every quarter)
1. Point `MONGODB_URI` at a **new, empty database** (never the live one): same cluster with another database name is fine.
2. `npm run backup -- restore <folder> --into <that database name>`. It refuses a database with data in it, and refuses a backup that fails its checksums.
3. `npm run indexes`, then start a server on it.
4. Check `GET /admin/finance/consistency` says `ok: true` and `GET /admin/system/health` is green; open a few rides.
5. `npm run backup -- compare <live database> <restored database>` should say IDENTICAL (differences are expected only for what changed since the backup).
6. Write the date, how long it took, and who did it here.

Drill done on the developer database, 2026-10-23, by Dev 1: dumped 48 collections / 7 documents, verified, restored into a temporary database, compared IDENTICAL, temporary database deleted. That proves the tool, **not** a restore of a real staging or production database: repeat on staging when it exists. Date/time/owner of the first staging drill: **not done yet**.

## Contacts (fill in)
Safety desk phone: ______  Finance: ______  Developer on call: ______  Razorpay support: ______  Atlas support: ______

## A ride is flagged as overrunning
`GET /admin/system/health` shows `rides_overrunning`: a city ride has been in progress for over 6 hours (rentals and outstation are not counted). Call the driver; if the ride is really over, support can complete or cancel it. Check whether the driver app stopped sending location.

## Rental or outstation fare dispute
Receipt lines come from the stored final fare. The distance is `fare.measuredDistanceMeters` (server GPS trail) and the time is the server clock. A booking event `ODOMETER_MISMATCH` means the driver odometer readings disagreed with the trail by a lot; look at the trail before changing any amount. Corrections go through the normal credit and adjustment process.
### `dispatch_queue_backlog` (Operations Action)
Unassigned bookings are accumulating in the dispatch queue without driver acceptance.
1. Inspect the queue: `GET /admin/dispatch/queue` (sorts oldest first, displays `waitingSeconds`).
2. Check live fleet density around the affected zone: `GET /admin/drivers/live?zoneId=<zoneId>` or query bounding box coordinates.
3. If drivers are nearby but not responding to broadcast offers, perform manual assignment:
   `POST /admin/bookings/{bookingId}/assign-driver` with `{ "driverId": "<id>", "reason": "Dispatch queue timeout rescue" }`.
4. If a driver reports a flat tyre or emergency after assignment, reassign immediately using the same endpoint; the previous driver's active ride lock is automatically released and recorded in previousDrivers.

### `customer_abusive_booking_pattern` (Operations Action)
A rider is repeatedly booking and cancelling, or engaging in fraudulent dispatch patterns.
1. Apply a booking restriction rather than an account ban:
   `POST /admin/customers/{customerId}/restrictions` with `{ "action": "RESTRICT", "reason": "Repeated malicious booking cancellations" }`.
2. This stops new bookings with a 403 `BOOKING_RESTRICTED` error while preserving their account access, wallet balance, and ability to clear any unpaid dues.
3. Once the situation is reviewed by safety operations, lift the restriction:
   `POST /admin/customers/{customerId}/restrictions` with `{ "action": "LIFT", "reason": "Rider safety review completed" }`.
4. Lifting the restriction restores booking privileges without altering independent suspensions or unpaid-balance debt rules.

### `test_notification_diagnostics` (Operations Action)
Diagnosing push notification or SMS deliverability issues reported by drivers or customers.
1. Send an audited test message: `POST /admin/notifications/test` with `{ "channel": "push", "recipientId": "<userId>", "title": "Test Alert", "body": "Diagnostic message" }`.
2. Inspect the returned `outcome` (`delivered`, `queued`, `failed`).
3. If SMS fails, verify whether the phone is on the national DND registry or if the SMS provider quota has been exhausted.
4. Each staff member is rate limited to 10 test notifications per minute to prevent accidental spamming.
