# Mobile and admin integration guide (API v1.0)

For the customer app, driver app and admin panel developers. Reference material:

- Every endpoint, body and role: `GET /api/v1/openapi.json`, or import `postman/cab-booking.postman_collection.json` with `postman/local.postman_environment.json`.
- Cross-cutting rules (envelopes, error codes, money, coordinates): `docs/api-contract.md`.
- Live updates and push notifications (sockets, events, devices, inbox): `docs/realtime-contract.md`. **Read it after this guide.**
- Status and enum values: `docs/enums.md`.

**Status:** the shape below is frozen for Phases 0 to 3.5 (see "Change policy" in `docs/api-contract.md`). Business numbers behind it (fares, zone, dispatch timings, cancellation rules) are placeholders until the lead confirms them. Those change values, not the API shape.

**Staging:** no shared URL exists yet. Until one does, run the backend locally (`backend/README` or `npm run dev`). The base path is `/api/v1`.

## 1. Rules every client must follow

1. Send `Authorization: Bearer <accessToken>` on everything except the public endpoints (health, OTP request/verify, refresh, cab categories, openapi).
2. Every response uses one envelope. Success is `{ success: true, data, meta }`. Failure is `{ success: false, error: { code, message, fieldErrors, requestId } }`. **Switch on `error.code`, never on `message`.** Show `requestId` on a "contact support" screen.
3. Money is an integer in **paise** (`25360` = Rs 253.60). Never use floats for money.
4. Coordinates are `{ lat, lng }`. Times are ISO-8601 UTC.
5. **Never send fares, ride status, role or user ids.** The server computes them and rejects unknown fields on sensitive calls (400 `VALIDATION_ERROR`).
6. `POST /bookings` needs an `Idempotency-Key` header. Generate one UUID per booking attempt and **reuse it on retries** (timeouts, flaky network). The same key with the same body returns the same booking (HTTP 200 and `Idempotent-Replayed: true`). The same key with a different body returns 422 `IDEMPOTENCY_KEY_REUSED`.
7. Lists use `?page=1&limit=20` (limit 100 max) and return `meta: { page, limit, total, totalPages }`.
8. Rate limits return 429 `RATE_LIMITED` (or an OTP-specific 429). Back off; do not retry in a tight loop.

## 2. Login (both apps)

1. `POST /auth/otp/request` `{ phone }` returns `{ challengeId, expiresInSeconds, resendAfterSeconds }`.
2. `POST /auth/otp/verify` `{ challengeId, phone, otp, role, device }`. `role` (`CUSTOMER` or `DRIVER`) is only used the first time a phone logs in. Returns `{ accessToken, refreshToken, user }`.
3. Access tokens last 15 minutes. On a 401 `UNAUTHENTICATED`, call `POST /auth/refresh` `{ refreshToken, device }` once, store **both** new tokens, and replay the request. Refresh tokens **rotate**: using an old one revokes the whole session, so never refresh from two places at once. If refresh fails, send the user to login.
4. `POST /auth/logout` ends the session. `GET /auth/sessions` lists devices.
5. A suspended account gets 403 or 401 on its next call. Show "account not active" and log out.

OTP errors: `OTP_INVALID` (wrong or already used), `OTP_EXPIRED`, `OTP_ATTEMPTS_EXCEEDED` (ask for a new OTP).

**Staging login without SMS:** when the server runs with `STAGING_FIXED_OTP=<6 digits>` every OTP is that code. It is refused in production.

## 3. Customer app flow

1. `GET /cab-categories` (public) for the vehicle types.
2. `GET /serviceability?pickupLat=&pickupLng=&dropLat=&dropLng=` (public) tells you whether the trip is inside an open service zone and which categories are available.
3. `POST /fare-quotes` `{ pickup, drop, categoryId, paymentPreference }` returns a priced quote that is valid **10 minutes** and **single use**. Show `estimatedTotalPaise` and its `breakdown`. Handle `NOT_SERVICEABLE`. After expiry call `POST /fare-quotes/{id}/refresh` for a new quote.
4. `POST /bookings` `{ quoteId, paymentMethod, pickup contact... }` with `Idempotency-Key`. Returns the booking in `DISPATCHING`. Errors: `QUOTE_EXPIRED`, `QUOTE_ALREADY_USED`, `QUOTE_MISMATCH`.
5. Listen for `booking:status` on the socket and refresh `GET /bookings/{bookingId}` when it fires. Keep a 5-second poll as a fallback while the socket is down. Statuses: `DISPATCHING` then `DRIVER_ASSIGNED`, `DRIVER_ARRIVING`, `DRIVER_ARRIVED`, `IN_PROGRESS`, `COMPLETED`; or `CANCELLED` / `NO_DRIVER_FOUND`. Treat unknown future statuses as "in progress, keep polling".
6. Once assigned: the booking and `GET /rides/{rideId}` include the **driver card** (first name, vehicle, registration; never the phone).
   - The driver's position arrives on the socket as `driver:location` (at most every 2 s). `GET /rides/{rideId}/track` returns the last position and ETA and is the fallback when the socket is down.
   - `GET /rides/{rideId}/pickup-otp` returns the 6-digit code to read to the driver. `POST /rides/{rideId}/otp/resend` issues a new one (30 s cooldown).
7. `POST /bookings/{bookingId}/cancel` `{ reasonCode, note? }` works before the ride starts. Customer reason codes are in `docs/enums.md`.
8. On `COMPLETED`: `finalFarePaise` and `paymentStatus: DUE` (cash is collected by the driver; online payment arrives in Phase 6). History: `GET /customers/me/rides`.

## 4. Driver app flow

1. Login with `role: DRIVER`. Onboarding: `POST /drivers/applications`, `POST /drivers/me/documents` (returns a signed upload URL; upload the file there), `POST /drivers/me/vehicles`. Poll `GET /drivers/me/application` for the decision (`APPROVED`, `REJECTED`, `NEEDS_RESUBMISSION`, `SUSPENDED`) and `GET /drivers/me/vehicles` for `verificationStatus`.
2. Go online: `POST /drivers/me/presence` `{ status: ONLINE, vehicleId, location }`. Needs an approved driver and a verified vehicle, otherwise 403 `DRIVER_NOT_ELIGIBLE` (the message says why). `GET /drivers/me/presence` shows eligibility issues.
3. While online send a GPS fix roughly **every 5 seconds**, by `POST /drivers/me/location` or the socket's `location:update` (same rules) (more than one per second gets 429 `RATE_LIMITED`; an `accuracyMeters` over 100 m, a stale `recordedAt` or an impossible jump returns 422 `LOCATION_REJECTED`; keep going, don't treat it as fatal). A driver whose GPS goes quiet for 60 s stops receiving offers.
4. Offers: the socket sends `offer:new` (and a high-priority push when the app is in the background); fetch details with `GET /drivers/me/offers`. Poll every 2 s only as a fallback while the socket is down. An offer lasts about 20 seconds (`expiresAt`). Show a countdown from `expiresAt`, not from when you fetched it.
   - `POST /ride-offers/{offerId}/accept`: **many drivers can race; exactly one wins.** The winner gets the ride (200). Everyone else gets 409 `RIDE_ALREADY_ASSIGNED` or `OFFER_UNAVAILABLE`; show "ride taken" and carry on. Retrying your own accept is safe.
   - `POST /ride-offers/{offerId}/reject` `{ reason? }`.
5. Ride steps, in order. An out-of-order or repeated call gives 409 `RIDE_INVALID_STATE` (treat as "already done", and re-read the ride):
   1. `POST /rides/{rideId}/en-route`
   2. `POST /rides/{rideId}/arrived` (422 `NOT_AT_PICKUP` if the server-known location is more than 300 m away)
   3. `POST /rides/{rideId}/start` `{ pickupOtp }` (422 `PICKUP_OTP_INVALID`, `PICKUP_OTP_EXPIRED`; 429 `PICKUP_OTP_ATTEMPTS_EXCEEDED` after 5 wrong tries. The rider can then resend a fresh one)
   4. `POST /rides/{rideId}/complete` `{ endLocation, odometerEndMeters? }`. **Do not send a fare.** The response has the server-computed final fare.
6. `POST /rides/{rideId}/cancel` before the ride starts (driver reason codes in `docs/enums.md`). History: `GET /drivers/me/rides`.

## 5. Admin panel

Staff log in with the same OTP flow; their role comes from the server. Role gates per endpoint are in the OpenAPI spec (`auth` shown per route).

| Area | Endpoints |
|---|---|
| Overview | `GET /admin/dashboard` |
| Driver review | `GET /admin/drivers`, `GET /admin/drivers/{id}`, `PATCH /admin/drivers/{id}/approval`, `PATCH /admin/drivers/{id}/documents/{docId}`, `PATCH /admin/vehicles/{id}/verification` |
| Users | `GET /admin/users`, `GET /admin/users/{id}`, `PATCH /admin/users/{id}/status` (suspend or reactivate; reason required) |
| Bookings | `GET /admin/bookings` (filters), `GET /admin/bookings/{id}` (fare, ride, timeline, dispatch offers), `POST /bookings/{id}/dispatch/retry` |
| Catalogue | `/admin/cab-categories`, `/admin/zones`, `/admin/pricing/configs` (fare configs are versioned and immutable; create a new version to change prices) |
| Audit | `GET /admin/audit-logs` (SUPER_ADMIN) |

Every change an admin makes is written to the audit log. Opening a booking (which shows a rider's phone) is audited too.

## 6. Error codes worth special screens

| Code | What the app should do |
|---|---|
| `UNAUTHENTICATED` | Refresh once, then login |
| `FORBIDDEN` | Wrong role or suspended account. Don't retry |
| `VALIDATION_ERROR` | Show `fieldErrors[].message` against `fieldErrors[].field` |
| `NOT_SERVICEABLE` | "We don't operate here / at this hour" |
| `QUOTE_EXPIRED` | Get a fresh quote and show the (possibly new) price again before booking |
| `RIDE_ALREADY_ASSIGNED` / `OFFER_UNAVAILABLE` | Driver: "ride taken", return to the offers screen |
| `RIDE_INVALID_STATE` | Re-read the ride and show its real state |
| `RATE_LIMITED` | Wait and retry later |
| `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`, `PROVIDER_ERROR` | Retry with backoff; keep the same `Idempotency-Key` for bookings |

## 7. Not available yet

- Redis-backed scaling across several server instances (live events currently work on one instance).
- Real Firebase delivery has not been tested yet (no Firebase project); everything else in `docs/realtime-contract.md` is.
- Waiting time, stops, ride receipts, ratings, cancellation fees (Phase 5); payments, wallet, payouts (Phase 6); support, SOS, ratings and coupons are now available (section 10).
- Real maps: routes and ETAs on any non-live server come from an estimator, so treat them as approximate.

## 8. Ride extras (Phase 5)

**Rider**
- **Stops:** send up to 3 `stops` (`{ lat, lng, label? }`) in `POST /fare-quotes`; the price is for the route through them in order. If you echo `stops` in `POST /bookings` they must match the quote. Stops come back on the booking and ride.
- **Cancelling:** call `GET /bookings/{id}/cancel-preview` first and show `feePaise` (and `freeUntil`) before the user confirms. `POST /bookings/{id}/cancel` returns the same `fee` (`null` when free). A fee appears on the booking as `fee { type, amountPaise, status }`, and `paymentStatus: DUE`.
- **Change destination:** `POST /rides/{id}/destination` `{ drop }` returns the new estimate and a 30-second window. Nothing changes until the driver accepts: listen for `ride:update` (`DESTINATION_ACCEPTED` / `DESTINATION_DECLINED`) and re-read the booking. Up to 3 accepted changes.
- **Driver cancelled:** you now get `booking:status` `DISPATCHING` again (not `CANCELLED`) and the `driver` is `null` until the next driver accepts; the ride id stays the same. Show "finding you another driver". After 2 re-offers the booking ends as `CANCELLED` by the driver.
- **No-show:** if the driver closes the ride as a no-show the booking is `NO_SHOW` with a `fee`.
- **Receipt:** `GET /rides/{id}/receipt` once the ride is `COMPLETED` (or ended with a fee). Show `lines` and `totalPaise`; `receiptNumber` never changes.

**Driver**
- **Stops:** during the trip call `POST /rides/{id}/stops/{index}/arrived` when you reach stop `index` (0 is the first) and `/departed` when you leave. Stops must be done in order, near the stop (`NOT_AT_STOP` otherwise). Waiting at a stop is billed after 3 free minutes.
- **Destination change:** you get `ride:update` `DESTINATION_REQUESTED` (and a high-priority push). Answer within 30 s with `POST /rides/{id}/destination/respond` `{ accept: true | false }`.
- **Cancel:** `POST /rides/{id}/cancel` now returns `bookingContinues: true` when the rider is being re-offered to another driver. After it the ride is no longer visible to you (404). It never charges the rider.
- **Rider contact:** `customer { name, phone }` on the ride is present only while the ride is live; after it ends it is `null`. Save anything you need before then.
- **No-show:** `POST /rides/{id}/no-show` only after the policy wait at the pickup (`NO_SHOW_TOO_EARLY`) and only at the pickup (`NOT_AT_PICKUP`).
- **Documents:** you cannot be approved or go online without a current approved licence, RC, insurance and ID proof (`DOCUMENTS_INVALID` in `GET /drivers/me/presence`). You get reminders at 30, 7 and 1 days before expiry; an expired document takes you offline (not mid-ride) until a new one is approved. Re-upload with `POST /drivers/me/documents`.

**Waiting time** is measured by the server. It is billed after 3 free minutes at the pickup and at each stop, at most 30 minutes in total; it appears as its own fare line.

## 9. Payments (Phase 6)

All money is in paise. The server decides every amount; the apps never send one (except the driver confirming the cash they received, which must equal the fare).

**Rider: online payment**
1. After a ride is `COMPLETED` (or a late-cancel / no-show fee is created) the booking has `paymentStatus: DUE` and `amountDuePaise` > 0. `GET /customers/me/balance` lists everything owed.
2. `POST /bookings/{id}/payments` with an `Idempotency-Key` returns `{ paymentId, checkout: { key, orderId, amountPaise } }`. Retrying with the same key (or while a payment is open) returns the same order. Open the Razorpay checkout with `key` and `orderId`.
3. When checkout succeeds, send `POST /payments/verify` `{ orderId, paymentId, signature }` (the three values Razorpay returns). Only a valid signature marks the booking paid (`PAYMENT_SIGNATURE_INVALID` otherwise). Our server also receives Razorpay's webhook, so a payment still completes if the app is closed; **re-read the booking** (`paymentStatus: PAID`) rather than trusting the checkout screen.
4. A failed or abandoned payment leaves the booking payable; an unfinished attempt is closed after 30 minutes.
5. **Unpaid rides:** a ride unpaid for more than 24 hours blocks new bookings (`402 UNPAID_BALANCE`). Show `GET /customers/me/balance` and send the user to pay.
6. During development with mock payments, `POST /dev/payments/{paymentId}/complete` pretends the payment succeeded (not available when real payments are on).

**Driver: cash**
- For `CASH` bookings call `POST /rides/{id}/cash-collected` `{ amountPaise }` with exactly the fare once the rider has paid. A repeat of the same call is harmless; a ride paid online (or with an online payment in progress) returns 409.
- `GET /drivers/me/balance`: cash held, what the platform owes you, the net (positive = you owe the platform) and the cash limit. Over the limit you are taken offline (`CASH_LIMIT_EXCEEDED`) until finance records your deposit.
- `GET /drivers/me/earnings`: per ride, what was charged, the platform commission and your earnings; `GET /drivers/me/settlements`: your payouts.

**Staff:** payments, refunds, write-offs, disputes, the ledger, driver balances, cash deposits, settlements and commission rates are under `/admin/...` (see the OpenAPI document; finance roles).

## 10. Safety, support, ratings, coupons (Phase 7)

**At start-up and after login:** `GET /config/flags` and hide every feature that is `false`. Do not hard-code SOS on: it is off in production until staff are available.

**Rider and driver: SOS**
- Show the SOS button only during a live ride and only if `SOS` is on. `POST /rides/{rideId}/sos` `{ note? }` (pressing it twice returns the same alert with `replayed: true`; never show an error for that). Then show "help has been alerted"; `GET /rides/{rideId}/sos` gives its status.
- Emergency contacts (max 3): `GET/POST /me/emergency-contacts`, `DELETE /me/emergency-contacts/{contactId}`. They are texted automatically when you raise an SOS. Ask the user to add them before the first ride.

**Rider: share my trip** (`TRIP_SHARING`): `POST /rides/{rideId}/share` returns a `token` and `path`; build the link from your own web address. `DELETE /rides/{rideId}/share` stops all links. The link shows the driver's first name, vehicle and live position, never phone numbers, and stops working when the ride ends.

**Rider and driver: help** (`SUPPORT_TICKETS`): `POST /support/tickets` `{ category, subject, message, bookingId? }`, `GET /support/tickets`, `GET /support/tickets/{id}` (conversation), `POST .../messages`, `POST .../close`. Replying to a resolved ticket reopens it. A push `support.update` arrives when staff answer. Max 10 open tickets per person.

**Ratings** (`RATINGS`): after `COMPLETED`, `GET /rides/{rideId}/rating` says whether the user can still rate (within 7 days) and which tags to offer; `POST /rides/{rideId}/rating` `{ stars 1-5, tags?, comment? }`. One rating per side per ride. A driver sees their own summary at `GET /drivers/me/ratings`; riders see a driver's average on the ride's driver card only after 5 ratings (`driver.rating` is `null` before that).

**Rider: coupon** (`COUPONS`): add an optional code box next to the price. Send `couponCode` with `POST /fare-quotes`; show `estimatedPayablePaise` (the price after the coupon) and show the `fieldErrors[0].message` if the code is refused. The receipt has a `DISCOUNT` line, and `finalFarePaise` is what the rider pays. The driver is paid on the full fare.

**Admin panel screens needed (API ready, no screens yet):** feature flags; staff list/create/change role (super admin); safety desk (open alerts, acknowledge, notes, live location, resolve; subscribe to `ops:sos`); support queue (filters, assign, reply, internal note, resolve); low-rating review and hide; reports summary and CSV downloads; coupons (create, list, switch off). Show nothing a role may not call: the allowed roles are in the OpenAPI document.

## 11. Tips, wallet, payouts (added after Phase 8)

**Rider: tip** (`TIPS`): after the ride is `COMPLETED`, show "Add a tip" (within 24 hours). `POST /rides/{rideId}/tip` `{ amountPaise 1000-200000, source: "ONLINE" | "WALLET" }` with an `Idempotency-Key`. ONLINE returns `payment.checkout`: open the Razorpay checkout, then `POST /payments/verify` (same as a ride payment). WALLET is instant. `GET /rides/{rideId}/tip` shows whether one exists. One tip per ride; the driver gets all of it and is told by push.

**Rider: wallet** (`WALLET`): `GET /wallet` for the balance, the limits and the latest entries. "Add money": `POST /wallet/topups` `{ amountPaise }` then the normal checkout; the balance updates when the payment is confirmed (refresh after verify). On a ride that is due, offer "Pay from wallet": `POST /bookings/{id}/pay-from-wallet`; on `402 INSUFFICIENT_WALLET_BALANCE` offer top-up or card. Refunds may arrive as wallet credit (`destination: WALLET`): they appear in `entries`. The wallet cannot be withdrawn to a bank.

**Driver: payout account**: `GET/PUT /drivers/me/payout-account`. Bank (`accountNumber` 9-18 digits, `ifsc`) or UPI (`vpa`). Show the status: `PENDING` ("being checked"), `ACTIVE`, `REJECTED` (show `rejectionReason`). Changing the account restarts the check, so warn the driver before they edit it. The full number is never shown again (only the last digits). Payout results arrive as push `payout.sent`; the driver's `GET /drivers/me/settlements` shows each payout's reference once PAID. `GET /drivers/me/earnings` now has `totals.tipsPaise` and `totals.tipCount`.

**Admin panel screens needed:** payout accounts to review (verify the holder name matches the driver), a "Pay" button on approved settlements and the payout history (`/admin/payouts`), a rider's wallet view for support (`/admin/wallets/{customerId}`), refund with a destination choice.

## 12. Scheduled rides (added after Phase 8)

**Rider app**
1. A "Schedule" option beside "Ride now": choose a pickup date and time (between 30 minutes and 7 days ahead; show the allowed range, and the service hours if the zone has them).
2. Price it: `POST /fare-quotes` with `scheduledFor` (ISO, UTC). Show the fare as an estimate for that time.
3. Book it: `POST /bookings` with `rideType: "SCHEDULED"` and the same `scheduledFor`, plus the usual `Idempotency-Key`. The booking comes back `SCHEDULED`.
4. A "Scheduled rides" list: `GET /bookings?status=SCHEDULED` (soonest first, paged). The same `GET /bookings` without a status is the rider's booking history, newest first. Actions: cancel (free, `POST /bookings/{id}/cancel`), change time (`PATCH /bookings/{id}/schedule`). Two scheduled rides must be at least 30 minutes apart (`422` on `scheduledFor` otherwise).
5. Pushes: `booking.reminder` (about an hour before), `booking.searching` (we are finding your driver), `booking.schedule_missed` (nobody could be arranged; you were not charged). After the search starts the ride behaves like a normal ride (`booking:status` events, driver card, pickup OTP...).
6. Errors to handle: `422 scheduledFor` (too soon/too far), `NOT_SERVICEABLE` (closed at that time), `QUOTE_MISMATCH` (quote was for a different time: re-quote), `422` "at most 5 scheduled rides".

**Driver app:** an offer may carry `scheduledFor` (the pickup time); show "Pickup at 9:30 AM" instead of "now". The driver goes to the pickup now: offers for a scheduled ride arrive only about 20 minutes before pickup, and the search for a driver continues until pickup time (plus 10 minutes) instead of giving up after a minute.

**Admin panel:** filter bookings by `SCHEDULED`; on a waiting ride, support can cancel it for the rider (`POST /admin/bookings/{id}/scheduled/cancel`, reason required) and operations can start the search early (`POST /admin/bookings/{id}/scheduled/start-now`); the dashboard counts them as active. Analytics screens: demand heatmap (`/admin/analytics/demand`), fulfilment by hour, cancellations, drivers, retention, revenue (finance only).

## 13. Corporate accounts (added after scheduled rides)

**Rider app**
1. At start-up (and after login) call `GET /corporate/me`. If `current` is set, show a "Company" payment option with the remaining monthly allowance (`remainingThisMonthPaise`). If `invitations` is not empty, show "You were invited to <company>" with an Accept button (`POST /corporate/invitations/{id}/accept`). Hide the option when the `CORPORATE` flag is off or the rider has no company.
2. Book with `paymentMethod: "CORPORATE"` and, if the company wants it, a reference (cost centre / project) in `corporateReference`. No payment screen afterwards: the booking is `BILLED` to the company. Coupons cannot be combined.
3. Errors: `CORPORATE_NOT_ALLOWED` (hide the option, offer cash/online), `CORPORATE_LIMIT_EXCEEDED` (show the message: it says whether it is the per-ride cap, the rider's monthly limit or the company's credit limit; offer another payment method).
4. "Leave company": `POST /corporate/me/leave`.

**Company admin screens (in the same rider app, shown only when `membership.role` is ADMIN)**
- Employees: `GET /corporate/employees` (with what each used this month), invite by phone (`POST /corporate/employees`), change a limit or role, remove (`PATCH /corporate/employees/{id}`).
- Rides: `GET /corporate/rides` (filter by dates). Invoices: `GET /corporate/invoices`, `GET /corporate/invoices/{id}` (issued and paid only).

**Admin panel:** companies list and detail (credit used, owed, unbilled rides, available credit), create and edit limits / suspend (finance); an invoices screen: generate for a period, review the draft lines, issue, record bank payments, void; a credit action on a ride; an overdue-invoices list (`/admin/corporate-invoices?overdue=true`).

## 14. Staff login, privacy and uploads (added later)

**Admin panel sign-in (replaces the phone code for staff):** email + password, then the authenticator code. First time: open the emailed link -> choose a password -> scan the QR (`totp.otpauthUri`) with an authenticator app -> enter the first code -> show the 8 recovery codes once and make the person confirm they saved them. Show a lockout message from the `429`. Offer "Forgot password" and, for a lost phone, tell the person to ask a super admin to reset them. A staff session ends after 12 hours: send the person to sign in again when refresh fails.

**Rider and driver apps**
- **Settings > Privacy:** "Download my data" (`GET /me/data-export`, save the JSON) and "Delete my account" (`GET /me/deletion` first: if `blockers` is not empty, show them and stop; otherwise explain the 7 days and what is kept, then `POST /me/deletion` with `confirm: true`). While `requested` is true show "Your account will be deleted on <date>" with a Cancel button (`DELETE /me/deletion`).
- **Driver documents:** after `POST /drivers/me/documents`, PUT the file to `upload.url` with the same `Content-Type`, then call `POST /drivers/me/documents/{id}/uploaded`; show the `422` message if the file is rejected so the driver can pick another.

## Rentals, outstation, cash tips, wallet bonus
**Rider app**
- Add a Rental tab: call `GET /rental-packages` for the pickup, show each package (hours, km, price, extra rates), then `POST /fare-quotes` with `rentalPackageId` and no drop. Say clearly that time or distance beyond the package is charged, and tolls and parking are paid on actuals.
- Add an Outstation tab: `GET /outstation/options`, choose one way or round trip (a round trip needs a return date and time), then `POST /fare-quotes` with `outstation`. Show the price as an estimate: a round trip is charged on actual km (with a minimum per day) and the days used.
- Receipts for these trips come from the server; render the lines as given.
- Tip screen: an "I tipped in cash" option (`source: CASH`). Wallet top-up screen: show the bonus when the server returns one.

**Driver app**
- Settings: toggles for Accept rentals and Accept outstation (`/drivers/me/preferences`). Outstation is off until the driver turns it on.
- Offers carry `tripKind`, `rental`, `outstation`: show the package, or the distance and days, before the driver accepts. The app must keep sending location during the trip: the fare is based on the server recorded trail.
## 7. Customer Saved Places, Referrals & Operations (DEV 2 Additions)

### Customer Saved Places (CRUD)
Riders can manage frequently visited locations for fast booking:
- `GET /api/v1/customers/me/places`: List saved places (ordered newest first, up to 20).
- `POST /api/v1/customers/me/places`: Create a saved place. Body:
  ```json
  {
    "name": "Home",
    "type": "home",
    "address": "B-12 Connaught Place, New Delhi",
    "lat": 28.6315,
    "lng": 77.2167
  }
  ```
  Allowed types: `home`, `work`, `other`. Maximum 20 saved places per account.
- `PATCH /api/v1/customers/me/places/{placeId}`: Update address, name, or coordinates.
- `DELETE /api/v1/customers/me/places/{placeId}`: Delete a saved place.
Foreign place IDs return 404 (ownership strictly enforced). Integrated with GDPR account deletion/export.

### Customer Referrals
- `GET /api/v1/customers/me/referrals`: Returns unique referral code (`REF-XXXXXX`), shareable link, referral stats, and reward history.
- `POST /api/v1/customers/me/referrals/claim`: Apply a friend's referral code. Body:
  ```json
  { "code": "REF-ABC123" }
  ```
  Returns issued coupon reward details. Self-referrals rejected with 422; duplicate claims rejected with 409; max cap of 10 referrals per user enforced. Disabled if `REFERRALS` flag is false (403 `FEATURE_DISABLED`).

### Handling Booking Restrictions
When a rider's booking ability has been restricted by staff for policy violations, `POST /api/v1/bookings` returns 403 `BOOKING_RESTRICTED` with the restriction reason in `error.message`. The customer app should display this message and prompt the rider to contact support. The rider can still browse places, view history, and access their wallet.

### Admin Operations Endpoints (Admin Panel)
- `GET /api/v1/admin/drivers/live`: Live fleet map feed. Supports query params: `minLat`, `maxLat`, `minLng`, `maxLng` (span <= 5 degrees) or `zoneId`. Returns driver profile, GeoJSON location, heading, active ride ID, and verified vehicle details. Audited.
- `GET /api/v1/admin/dispatch/queue`: Real-time queue of unassigned bookings (`REQUESTED` and `DISPATCHING`) ordered oldest first with server-calculated `waitingSeconds`. Supports filtering by `zoneId` and `categoryId`.
- `POST /api/v1/admin/bookings/{bookingId}/assign-driver`: Manually assign or reassign an eligible driver to a booking with atomic locking. Body:
  ```json
  {
    "driverId": "507f1f77bcf86cd799439011",
    "reason": "VIP customer request / long dispatch wait rescue"
  }
  ```
- `POST /api/v1/admin/customers/{customerId}/restrictions`: Restrict or lift booking restrictions. Body: `{ "action": "RESTRICT" | "LIFT", "reason": "Non-empty explanation" }`.
- `POST /api/v1/admin/notifications/test`: Send an audited test push or SMS notification. Body: `{ "channel": "push" | "sms", "recipientId": "<userId>", "title": "Test", "body": "Message" }`. Rate limited to 10/min.
