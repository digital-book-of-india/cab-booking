# Frozen enums (provisional until D1 is confirmed)

Enum values are part of the API contract. Changes must be communicated to all app developers immediately.

## Roles
`CUSTOMER`, `DRIVER`, `OPS`, `SUPPORT`, `FINANCE`, `SAFETY_ADMIN`, `CONFIG_ADMIN`, `SUPER_ADMIN`
Self-signup is limited to `CUSTOMER` and `DRIVER`; admin roles are created by seed only.
Phase 1 permissions: driver/vehicle review = `OPS`, `SUPER_ADMIN`; cab categories = `CONFIG_ADMIN`, `SUPER_ADMIN`; audit logs = `SUPER_ADMIN`. The rest arrive in Phase 7.

## Document types / statuses
Types: `DRIVING_LICENCE`, `VEHICLE_RC`, `INSURANCE`, `PERMIT`, `ID_PROOF`, `PROFILE_PHOTO`. Status: `PENDING`, `APPROVED`, `REJECTED`.

## Vehicle verification
`PENDING`, `VERIFIED`, `REJECTED`

## Account status
`ACTIVE`, `SUSPENDED`, `DELETED`

## Driver approval status
`PENDING`, `NEEDS_RESUBMISSION`, `APPROVED`, `REJECTED`, `SUSPENDED`

Admin decisions (`PATCH /admin/drivers/:id/approval`) and allowed source states:
| Decision | Result | Allowed from |
|---|---|---|
| APPROVE | APPROVED | PENDING, NEEDS_RESUBMISSION, SUSPENDED |
| REJECT | REJECTED | PENDING, NEEDS_RESUBMISSION |
| REQUEST_RESUBMISSION | NEEDS_RESUBMISSION | PENDING |
| SUSPEND | SUSPENDED | APPROVED |

A reason is required for every decision except APPROVE.

## Driver online status
`ONLINE`, `OFFLINE`

## Booking / ride status (Spec B)
`REQUESTED` → `DISPATCHING` → `DRIVER_ASSIGNED` → `DRIVER_ARRIVING` → `DRIVER_ARRIVED` → `IN_PROGRESS` → `COMPLETED`

Other: `CANCELLED` (with `cancellationActor` = `CUSTOMER` | `DRIVER` | `SYSTEM` | `ADMIN` and a reason code),
`NO_DRIVER_FOUND`, `NO_SHOW`, `INCIDENT_REVIEW`.

Allowed transitions:
| From | To |
|---|---|
| REQUESTED | DISPATCHING, CANCELLED |
| DISPATCHING | DRIVER_ASSIGNED, NO_DRIVER_FOUND, CANCELLED |
| DRIVER_ASSIGNED | DRIVER_ARRIVING, CANCELLED |
| DRIVER_ARRIVING | DRIVER_ARRIVED, CANCELLED |
| DRIVER_ARRIVED | IN_PROGRESS, CANCELLED, NO_SHOW |
| IN_PROGRESS | COMPLETED, INCIDENT_REVIEW |
| COMPLETED, CANCELLED, NO_DRIVER_FOUND | terminal |

## Payment status (separate from ride status)
`NOT_DUE`, `DUE`, `PROCESSING`, `PAID`, `FAILED`, `PARTIALLY_PAID`, `DISPUTED`, `REFUND_PENDING`, `REFUNDED`, `WRITTEN_OFF`
Cash flow adds `PAID_PENDING_RECONCILIATION` (Spec B §8.4); to be reconciled with the list above in Phase 6.

## Payment method
`CASH`, `ONLINE` (provider `RAZORPAY`)

## Dispatch offer status
`PENDING`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `WITHDRAWN`

## Ride type
`INSTANT`, `SCHEDULED` (ride booked for later; see below). `RENTAL`, `OUTSTATION` later.

## Open conflicts to resolve with the lead
- Spec A: `SEARCHING`, `CANCELLED_BY_CUSTOMER|DRIVER|SYSTEM`. Spec B: `DISPATCHING`, single `CANCELLED`. This file follows B.
- `PAID_PENDING_RECONCILIATION` appears only in a Spec B example, not in its payment-state table.

## Booking transitions added in Phase 3
Retry of a failed search: `NO_DRIVER_FOUND -> DISPATCHING` (OPS/SUPER_ADMIN, `POST /bookings/:id/dispatch/retry`).
Cancel is allowed from REQUESTED, DISPATCHING, DRIVER_ASSIGNED, DRIVER_ARRIVING, DRIVER_ARRIVED only (never IN_PROGRESS).
Cancellation reason codes: customer `CHANGED_MIND | BOOKED_BY_MISTAKE | WAIT_TOO_LONG | DRIVER_ASKED_TO_CANCEL | OTHER`; driver `CUSTOMER_NOT_REACHABLE | WRONG_PICKUP | VEHICLE_ISSUE | PERSONAL_EMERGENCY | OTHER`.
The source of truth is `backend/src/modules/bookings/stateMachine.ts`.

## Offer status
`PENDING`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `WITHDRAWN`

## Phase 5 additions
- Booking `DRIVER_ASSIGNED | DRIVER_ARRIVING | DRIVER_ARRIVED -> DISPATCHING` (a driver cancelled and the rider is re-offered; max 2 times), `DRIVER_ARRIVED -> NO_SHOW` (driver, after the policy wait, at the pickup).
- Fee: `type` CANCELLATION | NO_SHOW; `status` DUE | WAIVED. A booking with a DUE fee has `paymentStatus: DUE` and no fare; Phase 6 collects it.
- Driver document statuses: `PENDING | APPROVED | REJECTED | EXPIRED | SUPERSEDED`. Required types: `DRIVING_LICENCE`, `VEHICLE_RC`, `INSURANCE`, `ID_PROOF`.
- Presence eligibility issue code `DOCUMENTS_INVALID`.
- Realtime `ride:update` kinds: `STOP_ARRIVED | STOP_DEPARTED | DESTINATION_REQUESTED | DESTINATION_ACCEPTED | DESTINATION_DECLINED | FEE_WAIVED`.
- Push types added: `ride.no_show`, `ride.driver_cancelled`, `ride.destination_requested|accepted|declined`, `booking.fee_waived`, `document.expiring`, `document.expired`.

## Phase 6 additions
- Booking `paymentStatus` in use: `NOT_DUE` -> `DUE` (ride completed / fee created) -> `PROCESSING` (online payment under way) -> `PAID`; `FAILED` (payment failed, payable again), `DISPUTED`, `WRITTEN_OFF`, `REFUND_PENDING`, `REFUNDED`. `PARTIALLY_PAID` is not used yet.
- Payment attempt status: `CREATED | PAID | FAILED | EXPIRED`. Refund status: `REQUESTED | PROCESSED | FAILED`.
- Settlement status: `DRAFT | APPROVED | PAID | CANCELLED`.
- Ledger kinds: `RIDE_ACCRUAL, FEE_ACCRUAL, ONLINE_PAYMENT, CASH_COLLECTED, CASH_DEPOSIT, SETTLEMENT_NET, SETTLEMENT_PAYOUT, REFUND, WRITE_OFF, FEE_WAIVER`.
- Ledger accounts: `GATEWAY, PLATFORM_BANK, COMMISSION, REFUNDS, WRITE_OFFS, WAIVED_FEES, RIDER_RECEIVABLE:<userId>, DRIVER_PAYABLE:<driverId>, DRIVER_CASH:<driverId>`. Debit positive, credit negative; every transaction sums to zero.
- Presence eligibility issue `CASH_LIMIT_EXCEEDED`.

## Phase 7 additions
- Feature flag keys: `SOS | TRIP_SHARING | SUPPORT_TICKETS | RATINGS | COUPONS`. A flag has `enabled` and optional `roles` (empty = everyone). Staff roles that may change flags: `CONFIG_ADMIN`, `SUPER_ADMIN`.
- Staff roles that may be created: `OPS | SUPPORT | FINANCE | SAFETY_ADMIN | CONFIG_ADMIN | SUPER_ADMIN` (never `CUSTOMER` or `DRIVER`).
- Safety incident `status`: `OPEN | ACKNOWLEDGED | RESOLVED`; `outcome`: `FALSE_ALARM | ASSISTED | POLICE_INFORMED | OTHER`. Only one OPEN incident per person per ride.
- Support ticket `category`: `FARE_DISPUTE | PAYMENT_ISSUE | DRIVER_BEHAVIOUR | RIDER_BEHAVIOUR | LOST_ITEM | SAFETY_CONCERN | APP_PROBLEM | OTHER`; `status`: `OPEN | IN_PROGRESS | WAITING_USER | RESOLVED | CLOSED`; `priority`: `LOW | NORMAL | HIGH` (a safety concern starts HIGH); `outcome`: `REFUNDED | FEE_WAIVED | WARNING_ISSUED | NO_ACTION | ESCALATED | OTHER`. `REFUNDED` and `FEE_WAIVED` are accepted only when the ticket is about a ride and that ride really has a refund (REQUESTED or PROCESSED) or a WAIVED fee; otherwise `422` with `fieldErrors[0].field = "outcome"`. Finance / operations do the refund or waiver with their own endpoints first.
- Rating `stars` 1-5. Rider-to-driver tags: `POLITE | CLEAN_CAR | SAFE_DRIVING | GOOD_NAVIGATION | ON_TIME | RUDE | UNSAFE_DRIVING | DIRTY_CAR | LONG_ROUTE`. Driver-to-rider tags: `POLITE | ON_TIME | RUDE | LATE | MESSY`. `GET /rides/{id}/rating` returns the tags allowed for the caller.
- Coupon `type`: `PERCENT` (value in basis points, 1000 = 10%) | `FLAT` (value in paise). Optional `maxDiscountPaise`, `minFarePaise`, `maxRedemptions`, `perUserLimit` (default 1), `zoneIds`, `categoryIds`. Codes are upper-cased.
- Receipt line code `DISCOUNT` (negative amount, `detail` = coupon code). Booking/ride show `grossFarePaise`, `discountPaise`, `finalFarePaise` (= gross - discount; what the rider pays).
- Ledger account `PROMOTIONS` (coupon discounts paid by the platform).
- Export kinds: `rides | payments | settlements | ledger` (`.csv` suffix optional).
- Push types added: `safety.sos`, `safety.sos_escalated` (staff), `support.update`.

## Tips, wallet and payouts additions
- Feature flag keys added: `TIPS`, `WALLET`.
- Payment `purpose`: `FARE | FEE | TIP | TOPUP`. Payment `method`: `GATEWAY` (Razorpay) | `WALLET`. A wallet payment is `PAID` at once and has `checkout: null`. A `TOPUP` payment has `bookingId: null`.
- Tip `status`: `PENDING | PAID | FAILED`; `source`: `ONLINE | WALLET`. One live (PENDING or PAID) tip per ride. Amount Rs 10 to Rs 2,000; within 24 hours of completion.
- Refund `destination`: `ORIGINAL` (back through Razorpay) | `WALLET` (credited to the rider's wallet, processed at once). A ride paid from the wallet can only be refunded to the wallet. Tips and top-ups cannot be refunded here.
- Wallet limits (placeholders): top-up Rs 50 to Rs 5,000, balance at most Rs 10,000. The wallet is closed: money out only by paying rides, fees and tips.
- Ledger kinds added: `WALLET_TOPUP`, `WALLET_PAYMENT`, `TIP_PAYMENT`, `PAYOUT_REVERSAL`. Ledger account added: `WALLET:<customerId>` (credit, so negative = the balance we hold for the rider).
- Driver payout account `type`: `BANK | UPI`; `status`: `PENDING | ACTIVE | REJECTED` (only ACTIVE receives money; any change goes back to PENDING).
- Payout `status`: `CREATED | PROCESSING | PAID | FAILED | REVERSED`. One live payout per settlement; a FAILED/REVERSED one can be followed by a new attempt.
- Push types added: `tip.received` (driver), `payout.sent` (driver).

## Scheduled rides additions
- Booking status **`SCHEDULED`**: booked for later and waiting. Transitions: `SCHEDULED -> REQUESTED` (the search starts, done by a job about 20 minutes before pickup) or `SCHEDULED -> CANCELLED` (rider, free; or the system). After `REQUESTED` it is a normal ride.
- Booking `rideType`: `INSTANT | SCHEDULED`; `scheduledFor` is the pickup time (UTC). A quote made for later also carries `scheduledFor`.
- Cancellation reason (system): `SCHEDULE_MISSED` (nobody started the ride within 30 minutes after its time; no charge).
- Booking events: `SCHEDULE_ACTIVATED`, `RESCHEDULED`.
- Push types: `booking.reminder` (about 1 hour before, only if booked earlier than that), `booking.searching` (the search has started), `booking.schedule_missed`.
- Rules (confirmed by the owner 2026-10-18): booked between 30 minutes and 7 days ahead; at most 5 waiting per rider; the search starts 20 minutes before pickup; reminder 1 hour before; the fare is the price at booking time (frozen like any booking); free cancellation until the search starts, then the normal cancellation rules; the search continues until pickup time plus 10 minutes; two waiting rides at least 30 minutes apart; the fare is never repriced automatically.
- Cancellation reason (staff): `STAFF` (actor `ADMIN`), with a note. Push `booking.cancelled_by_staff`.
- A scheduled ride is searched for until its pickup time plus 10 minutes (not 60 seconds like an instant ride). Two scheduled rides of one rider must be 30 minutes apart.

## Corporate accounts additions
- Feature flag key added: `CORPORATE`.
- Booking `paymentMethod`: `CASH | ONLINE | CORPORATE`. A CORPORATE booking also has `billedToCompany: true` and an optional `corporateReference` (the company's cost centre / project / purpose, up to 60 characters).
- Booking `paymentStatus` added: `BILLED` (owed by the company; the rider owes nothing). A late-cancel or no-show fee on a company ride is billed to the company too.
- Company `status`: `ACTIVE | SUSPENDED` (suspended stops new company rides at once). Membership `role`: `ADMIN | EMPLOYEE`; `status`: `INVITED | ACTIVE | REMOVED`. A person is active in one company at a time.
- Invoice `status`: `DRAFT | ISSUED | PAID | VOID`. The number (`CI-<year>-<6 digits>`) is given on issue. `taxPaise` is 0: tax is not calculated by the system.
- Ledger kinds added: `CORPORATE_PAYMENT`, `CORPORATE_CREDIT`. Ledger account added: `CORPORATE_RECEIVABLE:<companyId>` (what the company owes, positive).
- Errors added: `CORPORATE_NOT_ALLOWED` (403: not a member, company not active, not an admin), `CORPORATE_LIMIT_EXCEEDED` (422: per-ride cap, employee monthly limit or company credit limit).
- Push types added: `corporate.invited`.
- Placeholder defaults (confirm): credit limit Rs 50,000; payment terms 15 days; Rs 10,000 per employee per month; optional per-ride cap; no coupons on company rides; monthly limits count calendar months in India time.

## Staff login, privacy and storage additions
- Staff sign in with **email + password + a 6-digit authenticator code** (`/auth/staff/...`). In production a staff phone code is refused (`STAFF_OTP_LOGIN` may not be true). Staff sessions last 12 hours (everyone else 30 days). 5 wrong passwords or codes lock the account for 15 minutes.
- Password rules: 12 to 128 characters, not a common password, not your name or email. Recovery codes (8, shown once) replace the authenticator code once each.
- Account deletion: `User.accountStatus` becomes `DELETED` after a 7-day waiting period; the phone number is replaced by `deleted:<id>` (so it can sign up again as a new person). Money records are kept, anonymised.
- Audit actions added: `staff.credentials.invite`, `staff.setup.complete`, `staff.login`, `staff.login.locked`, `staff.password.reset`, `staff.password.change`, `privacy.export`, `privacy.deletion_requested`, `privacy.account_deleted`, `privacy.staff_deleted_account`.
- Push types added: `privacy.deletion_blocked`.
- Driver document upload: a file is acceptable if it is in storage, between 1 byte and 10 MB, and of the declared type (`image/jpeg`, `image/png`, `application/pdf`). Staff can approve a document only when its file passes this check (otherwise `409`).

## Rentals, outstation and tips additions
- `tripKind`: `CITY` (default), `RENTAL`, `OUTSTATION` (on quotes, bookings, offers).
- Outstation `tripType`: `ONE_WAY`, `ROUND_TRIP`.
- Tip `source`: now also `CASH`.
- Fare `basis` on a finished ride: `RENTAL_PACKAGE_AND_USAGE`, `OUTSTATION_DISTANCE_AND_DAYS` (besides the city values).
- Ledger kinds: `WALLET_BONUS`, `INVOICE_TAX`; account `TAX_PAYABLE`.
- Booking event type: `ODOMETER_MISMATCH`.
- Monitor check: `rides_overrunning`.
