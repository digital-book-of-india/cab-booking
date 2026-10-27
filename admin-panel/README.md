# Cab Booking Platform — Enterprise Admin Panel

A high-performance, mission-critical operations dashboard and fleet management platform engineered with **Next.js 16 (App Router)**, **React 19**, and **TailwindCSS v4**. Designed for platform administrators, dispatch operations leads, finance managers, safety response teams, and support specialists.

---

## 1. System Overview & Technology Stack

The Admin Panel serves as the central operational cockpit for the cab booking platform. It communicates with the modular monolith backend via authenticated REST APIs and duplex Socket.IO streams.

- **Framework:** Next.js 16.4.2 (App Router with React Server Components and Client Components)
- **Runtime & UI:** React 19.3.0, Vanilla CSS + TailwindCSS v4 with modern, clean-light design system
- **State Management & Data Fetching:** TanStack React Query v5 (server-cache synchronization) and Zustand v5 (client session and modal state)
- **Real-Time Telemetry:** Socket.IO Client v4 with automatic reconnection, heartbeat throttling, and multi-tenant room isolation
- **GIS & Mapping:** Leaflet 1.9 + `@geoman-io/leaflet-geoman-free` 2.20 for interactive geofence polygon drawing, perimeter validation, and driver radar
- **Data Visualization:** Recharts v3 for daily operational trends, revenue margins, and driver fleet leaderboards
- **Export Engine:** SheetJS (`xlsx`) for auditable, PII-scrubbed CSV/XLSX downloads with a strict 50,000-row cap
- **Validation & Form Management:** React Hook Form v7 paired with Zod v4 schemas

---

## 2. Environment Variables Configuration

Create a `.env.local` file in the `admin-panel/` root directory:

```env
# Backend REST API endpoint (Required)
NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1

# Real-time WebSocket Gateway (Required)
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000

# Mock Service Worker (MSW) Isolation Flag
# MUST be set to "false" to connect to real backend database and services
NEXT_PUBLIC_API_MOCKING=false
```

### Environment Variable Matrix

| Variable | Type | Default | Description |
| :--- | :---: | :---: | :--- |
| `NEXT_PUBLIC_API_URL` | String | `http://localhost:4000/api/v1` | Base URL for all authenticated REST calls. |
| `NEXT_PUBLIC_SOCKET_URL` | String | `http://localhost:4000` | Host for driver telemetry, live map pings, and SOS emergency alerts. |
| `NEXT_PUBLIC_API_MOCKING` | Boolean | `false` | When `false`, MSW handlers are isolated and bypassed in favor of live backend endpoints. |

---

## 3. Role-Based Access Control (RBAC) Matrix

Access to routes and state mutations is strictly guarded by Next.js edge middleware (`src/middleware.ts`) and validated against backend session tokens on every request.

| Department & Modules | Routes | `SUPER_ADMIN` | `FINANCE` | `OPS` | `SUPPORT` |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Fleet & Live Radar** | `/dispatch/live-map`, `/dispatch/queue` | ✅ Full | ❌ Blocked | ✅ Full | ❌ Blocked |
| **Driver KYC Inspection** | `/drivers`, `/drivers/[id]`, `/vehicles` | ✅ Full | ❌ Blocked | ✅ Full | 👁️ Read-only |
| **Customer Directory** | `/customers`, `/customers/[id]` | ✅ Full | ❌ Blocked | ✅ Full | ✅ Limited |
| **Pricing & Geoman Zones**| `/pricing/zones`, `/pricing/configs` | ✅ Full | ❌ Blocked | ✅ Full | ❌ Blocked |
| **Finance & Ledger** | `/finance/payments`, `/finance/settlements`, `/finance/cash` | ✅ Full | ✅ Full | ❌ Blocked | ❌ Blocked |
| **Bad Debt Write-off** | `/finance/outstanding` (Write-off action) | ✅ Authorized | ❌ Blocked | ❌ Blocked | ❌ Blocked |
| **Corporate Invoices** | `/corporate/invoices` | ✅ Full | ✅ Full | ❌ Blocked | ❌ Blocked |
| **Emergency Safety Desk** | `/safety/sos` | ✅ Full | ❌ Blocked | ✅ Full | ✅ Dedicated |
| **Support Help Desk** | `/support/tickets`, `/moderation/ratings` | ✅ Full | ❌ Blocked | ❌ Blocked | ✅ Full |
| **Marketing Promotions** | `/marketing/coupons` | ✅ Full | ✅ Limited | ✅ Full | ❌ Blocked |
| **Operational Analytics**| `/reports/rides`, `/reports/revenue`, `/reports/drivers` | ✅ Full | ✅ Finance | ✅ Ops/Drivers| ❌ Blocked |
| **Staff & System Security**| `/settings/roles`, `/settings/sessions`, `/settings/audit-logs`| ✅ Full | ❌ Blocked | ❌ Blocked | ❌ Blocked |

---

## 4. Complete Application Route Directory

### Authentication & Sessions
- `/login` — Administrator and staff multi-factor login challenge desk.
- `/settings/sessions` — Active staff session monitor with remote termination.

### Operations & Dispatch
- `/dispatch/live-map` — Real-time Socket.IO radar tracking active vehicles on interactive Leaflet maps.
- `/dispatch/queue` — Unassigned booking queue with manual driver override dispatching.

### Drivers & Vehicles Desk
- `/drivers` — Driver partner directory with approval, online state, and rating filters.
- `/drivers/[driverId]` — KYC Inspection Desk with presigned document sign-off and vehicle verification.
- `/vehicles` — Fleet verification desk for vehicle registration plates, insurance, and fitness.
- `/vehicles/categories` — Vehicle service class management (Mini, Sedan, SUV, EV).

### Customers & Booking Governance
- `/customers` — Customer accounts directory with search, ride count, and balance status.
- `/customers/[customerId]` — Deep customer profile, wallet ledger history, suspension modal, and restriction drawer.

### Pricing & Geofencing
- `/pricing/zones` — Leaflet-Geoman interactive polygon geofence builder with operating hours.
- `/pricing/configs` — Tariff engine with versioned base fares, per-km rates, and waiting fees.

### Financial Operations & Ledger
- `/finance/payments` — Real-time transaction ledger with Razorpay webhook synchronization and step-up refund modal.
- `/finance/settlements` — Driver partner payout batching with automatic cash netting and bank references.
- `/finance/cash` — Driver cash held collection desk with deposit reconciliation and limit clearance.
- `/finance/outstanding` — Delinquent trip debts desk with super-admin bad debt write-off authorization.
- `/corporate/invoices` — Corporate client invoicing desk with tax calculation and payment recording.

### Safety & Incident Management
- `/safety/sos` — Real-time emergency desk with audio alarms, deduplicated socket events, and audit logs.

### Customer Support & Moderation
- `/support/tickets` — Tiered ticket queue with agent assignment, internal notes, and resolution outcomes.
- `/moderation/ratings` — Low-star review moderation desk with PII hiding and abusive review suppression.

### Marketing & Growth
- `/marketing/coupons` — Promotional discount engine with basis-point percent and flat-paise limits.

### Operational Reports & Analytics
- `/reports/rides` — Volume, trip completion rates, cancellations, and dispatch response times.
- `/reports/revenue` — Financial revenue breakdown, commission margins, and partner payout pools.
- `/reports/drivers` — Fleet leaderboard with earnings, tip totals, acceptance ratios, and masked PII.

### System Tools & Governance
- `/settings/roles` — Staff directory with Step-Up MFA privilege elevation modal.
- `/settings/audit-logs` — Immutable platform audit trail with actor tracing and before/after diffs.
- `/tools/verification-matrix` — Automated in-browser QA acceptance verification matrix.

---

## 5. Getting Started & Local Development

### Prerequisites
- Node.js >= 20.0.0
- Backend running on `http://localhost:4000`

### Installation
```bash
# Navigate to admin panel directory
cd admin-panel

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 6. Testing & Quality Assurance

The admin panel is tested with unit, integration, and end-to-end acceptance test suites.

```bash
# 1. Run Vitest Unit & Integration Suites (38 tests)
npm test

# 2. Run Dev 1 Route & Backend Integration Suite with Automated Teardown (30 tests)
npm run test:dev1

# 3. Run Dev 2 End-to-End Acceptance Suite with Idempotency Cleanup (56 tests)
npm run test:dev2

# 4. Run Master Test Suite (All 124 tests in sequence)
npm run test:all

# 5. Run Static Code Analysis & Linting (0 errors, 0 warnings)
npm run lint

# 6. Run Strict TypeScript Compilation Check (0 errors)
npx tsc --noEmit
```

---

## 7. Operational Runbooks

### Step-Up MFA Authorization for High-Risk Actions
When changing administrator roles or issuing refunds >= ₹10,000:
1. Target account identity must be confirmed by typing the exact administrator email.
2. Enter the current 6-digit Authenticator / MFA step-up passcode.
3. Provide a mandatory auditable justification note (minimum 5 characters).
4. Direct audit trail links (`/settings/audit-logs`) are generated in the success toast for audit compliance.

### Bad Debt Write-off Runbook
1. Only `SUPER_ADMIN` accounts are permitted by backend policy to absorb uncollectible rider debt.
2. Navigate to `/finance/outstanding`.
3. Select delinquent ride and specify write-off reason code.
4. Loss is permanently posted against platform platform bad-debt ledger, immediately unlocking rider app restrictions if appropriate.

### Report Export Hard Limits & PII Scrubbing
1. All client-side CSV and XLSX exports enforce a strict `50,000` row slice ceiling.
2. Customer and driver contact numbers are masked adhering to `+91 ••••• •XXXX`.
3. Server-side exports exceeding limit return HTTP 422 with actionable date-filter guidance.
