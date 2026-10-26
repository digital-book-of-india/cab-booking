# CAB BOOKING PLATFORM
## Technical Specification • Modules • REST APIs • Payload Schemas • Dispatch • Fare Engine • Payments
### Implementation blueprint for an Ola/Uber-style platform
**Stack:** React Native (Customer + Driver) • Next.js Admin • Node.js/Express • MongoDB • Redis • Socket.IO • Razorpay  
**Version 1.0 | Prepared: 16 October 2026**

---

### 1. Executive Summary
This document describes a multi-role cab booking marketplace with post-ride payment. Customers request rides; the dispatch engine offers a request to eligible drivers; a driver accepts; pickup OTP verifies ride start; the trip is tracked; final fare is calculated; customer pays after completion; the backend reconciles the payment and updates the driver ledger.

#### Product principles
- The server is the source of truth for ride state, fare, payment state, role permissions and driver eligibility.
- A ride can only be assigned to one driver. Assignment must be atomic/idempotent.
- A ride completion does not mean payment succeeded. Keep trip status and payment status as separate state machines.
- All monetary values are integer paise in storage and API payloads; display rupees in the UI.
- Never trust fare totals, payment status, role, driver coordinates or ride status sent by a client without server validation.
- Post-ride payment remains supported; an unpaid balance can restrict future bookings according to a transparent policy.

#### Scope and assumptions
- Currency: INR; timestamps are ISO-8601 UTC in APIs.
- REST base path: /api/v1. IDs are MongoDB ObjectId strings or stable public IDs.
- Authentication: access token + refresh token; OTP provider is abstracted.

---

### 2. Module Inventory — 30 Modules
- **M01 Authentication & Sessions**: OTP login, refresh/logout, device sessions, rate limiting
- **M02 User & Customer Profiles**: Profile, saved places, preferences, trusted contacts
- **M03 Driver Onboarding & KYC**: Application, documents, review, approval, expiry
- **M04 Vehicle & Cab Categories**: Vehicle records, seating, category, service eligibility
- **M05 Service Zones & Cities**: Cities, geofences, serviceability, operating hours
- **M06 Maps & Geocoding Adapter**: Address autocomplete, geocoding, routes, ETA, distance
- **M07 Fare Configuration**: Base, per-km, per-minute, minimum, waiting, stops, caps
- **M08 Fare Quote Engine**: Quote creation, expiry, fare breakdown, versioned rules
- **M09 Booking Management**: Create, view, cancel, schedule, stop management
- **M10 Driver Presence & GPS**: Online status, heartbeat, location updates, stale GPS
- **M11 Dispatch & Matching**: Candidate search, ranking, offer, accept, timeout, re-dispatch
- **M12 Ride Lifecycle & OTP**: Arrived, OTP start, in-progress, completion, state validation
- **M13 Live Trip Tracking**: Location stream, route progress, customer/driver live views
- **M14 Waiting, Stops & Changes**: Waiting timers, approved destination changes, fare recalculation
- **M15 Payment Orchestration**: Payment intent/order, retries, provider verification, webhook
- **M16 Cash Collection**: Cash amount due, driver confirmation, mismatch/dispute
- **M17 Unpaid Balance & Risk**: Outstanding ledger, reminders, restrictions, appeals
- **M18 Driver Earnings Ledger**: Gross fare, commission, adjustments, pending/available balance
- **M19 Settlement & Reconciliation**: Payout batches, transfer status, reports, manual adjustments
- **M20 Ratings & Reviews**: Customer/driver rating, review moderation
- **M21 Notifications**: Push/SMS/email templates, delivery attempts, preferences
- **M22 Support & Disputes**: Tickets, attachments, assignment, SLA, resolution
- **M23 Safety & SOS**: SOS event, trusted contact, incident escalation, audit
- **M24 Coupons & Referrals**: Eligibility, limits, redemption, referral tracking
- **M25 Admin & Operations**: Live map, manual dispatch, cancellation, override workflows
- **M26 RBAC & Audit Logs**: Roles, permissions, admin action history
- **M27 Reports & Analytics**: Bookings, revenue, driver utilisation, cancellation metrics
- **M28 Corporate Accounts**: Company profiles, authorised bookers, cost centres, invoices
- **M29 Scheduled / Rental / Outstation**: Future booking, allocation windows, hourly/one-way/round-trip
- **M30 Platform Configuration & Observability**: Feature flags, secrets references, health, metrics, alerting

---

### 3. Core State Machines

#### Booking / ride states
`REQUESTED` -> `DISPATCHING` -> `DRIVER_ASSIGNED` -> `DRIVER_ARRIVING` -> `DRIVER_ARRIVED` -> `IN_PROGRESS` -> `COMPLETED`  
Terminal states: `CANCELLED`, `NO_DRIVER_FOUND`, `NO_SHOW`

#### Payment states
`NOT_DUE` -> `DUE` -> `PROCESSING` -> `PAID`  
Failure/Edge states: `FAILED`, `PARTIALLY_PAID`, `DISPUTED`, `REFUND_PENDING`, `REFUNDED`, `WRITTEN_OFF`

---

### 4. REST API Catalogue Summary
Includes all core endpoints across M01 to M30 as detailed in the technical specification.
Standard envelope: `{ success: true, data: {}, meta: { requestId } }`  
Error envelope: `{ success: false, error: { code, message, fieldErrors, requestId } }`  
All amounts integer paise. Idempotency-Key on retryable mutations.
