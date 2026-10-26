# CAB BOOKING PLATFORM
## Backend Developer Specification
### 2-Day Core API Target + Full Module Blueprint
*Prepared for backend developer handoff*

**Scope note:** This document defines the full backend blueprint and a deliberately smaller 2-day core milestone. Do not claim every production feature is complete after the core milestone.

---

### 1. Project objective
Build the backend for an Uber/Ola-style cab-booking platform. The backend must support a customer app, a driver app, and a Next.js admin panel. The immediate delivery target is a stable core API on Day 2 so app developers can integrate from Day 3. This is an MVP milestone, not a claim that every production feature will be complete in two days.

Core technology: Node.js + Express + TypeScript (recommended), MongoDB + Mongoose, Socket.IO for realtime updates, Redis + BullMQ for queues/expiry jobs, Razorpay for online payments, Google Maps Platform for route/distance/geocoding, Firebase Cloud Messaging (FCM) for push notifications. Use the team's existing standards if the repository already has a stable setup; do not rewrite a working project just to match this document.

• Deliverables: running backend, environment template, database models/indexes, documented REST APIs, Postman collection, seeded local/staging data, automated tests for critical flows, and setup/deployment instructions.

---

### 2. Priority and delivery rules
P0 = required for Day 1–2 core. P1 = integrate during Days 3–4. P2 = later release unless required by launch scope.

Day 1 (P0): project setup, config, health endpoint, MongoDB, logging/error handling, auth/JWT, roles, customer/driver profiles, vehicle/cab category basics, driver online/offline and location update. Publish API contracts and a Postman collection by end of day.

Day 2 (P0): fare estimate (basic), create ride, eligible nearby driver search, driver offer/accept/reject, atomic assignment, ride status transitions, pickup OTP, ride start/completion, ride history, critical tests, staging URL. The core booking flow must be demonstrable end-to-end.

• Days 3–4 (P1): Socket.IO live tracking, Google Maps route/distance integration, Razorpay orders/webhooks/payment verification, FCM notifications, admin management APIs, cancellation rules, reports, queue-backed expiry and retries.

Day 5: regression, security and permission checks, race-condition tests, failure handling, logs, deployment verification and release checklist. Do not launch publicly if payment, authorization, ride assignment or location privacy tests fail.

---

### 3. Backend module catalogue
• M01 Platform foundation [P0]: Express app, config validation, CORS, rate limits, request IDs, structured logs, centralized errors, health/readiness endpoints, graceful shutdown.  
• M02 Authentication & authorization [P0]: customer/driver/admin roles; OTP or agreed login mechanism; access token and refresh/session strategy; password/OTP rate limits; account status checks; admin routes protected separately. Never trust role/user IDs supplied by the client.  
• M03 Customer profiles [P0]: profile read/update, verified contact, saved places optional, account status, ride history.  
• M04 Driver profiles & onboarding [P0/P1]: driver profile, approval status, documents/KYC metadata, vehicle association, rejection reasons, online status. Store document files in object storage (e.g. R2), not as huge MongoDB blobs.  
• M05 Vehicles & cab categories [P0]: vehicle registration/details, category (mini/sedan/SUV etc.), capacity, active status, admin-managed category and base fare configuration.  
• M06 Driver availability & location [P0]: online/offline, last-seen timestamp, current coordinates, location freshness, active ride guard. Do not expose a driver's precise location to arbitrary users.  
• M07 Fare/pricing engine [P0 basic, P1 advanced]: base fare, included distance, per-km, per-minute, waiting, toll/parking adjustments, discounts, cancellation/no-show, surge only if enabled with transparent rules. Money stored as integer paise; persist estimate and final fare breakdown with pricing version.  
• M08 Ride booking & lifecycle [P0]: quote, create ride, assign driver, driver en-route/arrived, pickup OTP, start, complete, cancel, ride history/detail. Enforce valid state transitions server-side.  
• M09 Dispatch/matching [P0 basic, P1 robust]: find eligible online/approved drivers near pickup, sort by ETA/distance, send timed offers, reject/timeout/retry next candidate. Use atomic conditional updates/transactions or equivalent locking so only one driver wins a ride.  
• M10 Realtime events [P1]: Socket.IO authenticated rooms per user/ride, location updates, driver offer, accepted, ride status and completion. Validate membership before joining rooms; throttle location events.  
• M11 Payments [P1]: cash and Razorpay; create order, verify signature server-side, process webhooks idempotently, reconcile payment status, receipt. Never mark paid based only on client success redirect.  
• M12 Driver earnings & settlements [P1/P2]: ride earning ledger, commission, payout status, payout exports. Do not claim Razorpay automatically guarantees driver payouts; payout/settlement process needs explicit design and provider configuration.  
• M13 Cancellation/refunds/outstanding balance [P1]: actor, reason, timing, fee policy, payment refund state; record unpaid completed rides and define customer restrictions/reminders before enforcing them.  
• M14 Notifications [P1]: FCM push, in-app events, template/versioning, retry strategy; SMS/OTP provider only if chosen and credentials are available.  
• M15 Admin APIs [P1]: dashboard summaries, customer/driver search, driver approval/suspension, rides, categories/pricing configuration, payment views, cancellations, audit trail. Admin UI must call APIs; never give admin credentials or secrets to the frontend.  
• M16 Audit/security/operations [P0 baseline, P1 expanded]: admin action audit logs, input validation, rate limits, PII minimization, secrets in environment/secret manager, backup plan, monitoring, health checks and API versioning.  
• M17 Support/disputes/reviews/promo codes/advanced analytics [P2]: defer until core ride journey is stable.

---

### 4. Suggested project structure
```
src/
app.ts # Express app + middleware
server.ts # start, Socket.IO, graceful shutdown
config/ # env schema, db, redis, maps, payments
common/ # errors, response, logger, validation, auth guards
middleware/ # auth, roles, rate-limit, request-id
modules/
auth/ # routes, controller, service, validation
customers/
drivers/
vehicles/
categories/
pricing/
rides/
dispatch/
tracking/
payments/
notifications/
admin/
jobs/ # BullMQ jobs/workers, offer expiry, retries
sockets/ # Socket.IO auth, rooms, events
integrations/ # Google Maps, Razorpay, FCM, object storage
tests/ # unit, integration, critical journey
docs/ # OpenAPI, decisions, runbook
```

---

### 5. Data models / collections
• User: _id, role (CUSTOMER|DRIVER|ADMIN), name, phone/email, verification status, accountStatus (ACTIVE|SUSPENDED|DELETED), createdAt, updatedAt. Unique index on normalized phone/email where appropriate.  
• CustomerProfile: userId unique, optional profile fields, preferences, createdAt, updatedAt.  
• DriverProfile: userId unique, approvalStatus (PENDING|APPROVED|REJECTED|SUSPENDED), onlineStatus, currentLocation GeoJSON Point, locationUpdatedAt, vehicleId, rating aggregate optional, createdAt, updatedAt. 2dsphere index on currentLocation.  
• Vehicle: driverId, categoryId, registrationNumber, make/model/color, capacity, verificationStatus, active, createdAt, updatedAt.  
• CabCategory: name, active, capacity, displayOrder, pricingConfig/version, createdAt, updatedAt.  
• Ride: customerId, driverId nullable until assigned, categoryId, pickup/drop GeoJSON + display address, stops optional, status, quoteId, estimatedFarePaise, finalFarePaise, fareBreakdown, pricingVersion, pickupOtpHash/expiry/verifiedAt, requestedAt, acceptedAt, arrivedAt, startedAt, completedAt, cancelledAt, cancellationActor/reason, timestamps, version. Indexes on customerId/createdAt, driverId/status, status/createdAt.  
• RideOffer: rideId, driverId, status (PENDING|ACCEPTED|REJECTED|EXPIRED|WITHDRAWN), expiresAt, createdAt.  
• Payment: rideId, customerId, amountPaise, currency INR, method CASH|RAZORPAY, status PENDING|AUTHORIZED|PAID|FAILED|REFUND_PENDING|REFUNDED, providerOrderId, providerPaymentId, providerSignatureVerifiedAt, idempotencyKey, timestamps.  
• PricingConfig: categoryId, baseFarePaise, includedKm, perKmPaise, perMinutePaise, waitingPerMinutePaise, cancellationFeePaise, tollPolicy, surge settings/cap if enabled, version, activeFrom, activeTo.  
• Notification: userId, channel, type, payload/template, status, attempts, sentAt, createdAt.  
• AuditLog: actorUserId, action, targetType, targetId, safe metadata, requestId, createdAt.

---

### 6. Ride state machine and invariants
Recommended states: REQUESTED -> SEARCHING -> DRIVER_ASSIGNED -> DRIVER_ARRIVING -> DRIVER_ARRIVED -> IN_PROGRESS -> COMPLETED.  
Cancellation states: CANCELLED_BY_CUSTOMER, CANCELLED_BY_DRIVER, CANCELLED_BY_SYSTEM.

Rules:
- Only eligible approved/online drivers can be offered rides.
- One ride can have at most one assigned driver; accept must be atomic.
- Pickup OTP is verified server-side and has expiry/attempt limits.
- Ride cannot start before assignment and OTP verification.
- Completed ride cannot restart.
- Payment state is separate from ride state.
- Dispatch accept pattern: update ride only if status is SEARCHING and driverId is null (conditional atomic update). If update matched zero records, return 409 RIDE_ALREADY_ASSIGNED.
- Idempotency keys for ride creation / payment order creation.

---

### 7. Day-2 acceptance checklist
• [x] Backend runs from documented setup instructions on a clean environment.  
• [x] GET /api/v1/health and readiness endpoint work.  
• [x] Customer and driver can authenticate and receive authorized access.  
• [x] Driver can set online/offline and update location.  
• [x] Customer can request a fare estimate and create a ride.  
• [x] Eligible driver can see/receive offer and accept; second driver cannot also win.  
• [x] Ride can move through arrived -> OTP verified -> started -> completed.  
• [x] Ride detail/history endpoints return consistent status and fare fields.  
• [x] Postman collection and environment template are committed.  
• [x] Critical tests pass.  
• [x] API contracts and enums are frozen for app integration.  
