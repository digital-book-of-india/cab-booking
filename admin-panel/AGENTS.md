<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Antigravity Agent Guidelines: Cab Booking Admin Panel

Welcome, Agent. This document defines the engineering standards, operational invariants, and testing requirements for the `admin-panel` workspace. Adhere strictly to these rules.

---

## 1. Visual Aesthetics & Theme Invariants

- **Clean Light Dashboard Theme:** The platform uses a clean, light color palette with slate-50 backgrounds, crisp white card containers (`bg-white border border-slate-200`), and indigo accent tokens (`indigo-600` / `indigo-700`).
- **NO Unwanted Dark Conversions:** Do NOT convert administrative desks, tables, or navigation shells into dark mode unless explicitly prompted by the user.
- **Micro-Animations:** Use subtle transition classes (`transition duration-200`, `hover:bg-slate-50/80`, `backdrop-blur-xs`) for interactive states and feedback toasts.
- **No Incomplete Placeholders:** Every desk must be fully hydrated with live data and responsive empty/error states.

---

## 2. API Mocking Policy (STRICT ISOLATION)

- **Default Invariant:** `NEXT_PUBLIC_API_MOCKING=false` in `.env.local`.
- **Live Server Integration:** The admin panel connects to the live backend running on `http://localhost:4000/api/v1` and Socket.IO on `http://localhost:4000`.
- **MSW Isolation:** MSW handlers in `src/mocks/` are strictly isolated for unit testing and offline development fallback. Never enable mocking in production or dev server environments without explicit user instruction.

---

## 3. TypeScript & Static Analysis Rules

- **Zero-Lint Policy:** The codebase enforces `0 errors, 0 warnings` under ESLint 9 (`eslint.config.mjs`). All unused variables, duplicate declarations, and missing hook dependencies must be resolved cleanly.
- **Strict Typing:** Never introduce `any`. Use domain models defined in [src/types/index.ts](file:///c:/Users/rajpu/Desktop/cab-booking/admin-panel/src/types/index.ts) (`AdminUser`, `AuditLogEntry`, `CustomerDetail`, `DriverProfileDetail`, etc.).
- **Safe Catch Blocks:** Type catch blocks as `err: unknown` and extract user-friendly error messages using `getErrorMessage(err)` or typed axios response checks.

---

## 4. High-Risk Action & Security Protocols

- **Step-Up MFA Authorization:** All destructive actions (e.g. changing staff administrator roles, approving bad-debt write-offs, issuing refunds >= ₹10,000) require step-up authorization with identity verification and mandatory audit reasons.
- **Direct Audit Trail Linking:** When a critical administrative change succeeds (driver KYC, vehicle verification, debt write-off, customer restriction), the success notification must include a direct clickable link to the audit log: `[View Audit Trail →](/settings/audit-logs)`.
- **PII Scrubbing:** Phone numbers displayed or exported in reports must adhere to masked format: `+91 ••••• •XXXX`. Document identifiers must only reveal the terminal 4 digits.
- **Export Row Caps:** All report export routines (CSV / XLSX) must enforce a hard slice cap of `50,000` rows.

---

## 5. Testing & Verification Requirements

Before reporting any task or phase as complete, you MUST execute and pass all verification gates:

```bash
# 1. Run Vitest Unit & Integration Suites
npm test

# 2. Run Dev 1 Route & Backend Integration Suite
npm run test:dev1

# 3. Run Dev 2 End-to-End Acceptance Suite
npm run test:dev2

# 4. Run Master Suite (All 124 tests)
npm run test:all

# 5. Run Static Code Analysis & Linting
npm run lint

# 6. Run Strict TypeScript Compilation Check
npx tsc --noEmit
```

All 6 commands must finish with exit code 0.
