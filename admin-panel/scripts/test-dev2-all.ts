import { runDev2AcceptanceSuite } from '../src/tests/dev2-acceptance.test';
import { runIdempotencyTests } from '../src/tests/idempotency.test';
import { runDay8VerificationSuite } from '../src/tests/verification-matrix.test';
import { clearIdempotencyKey } from '../src/lib/idempotency';

interface TestReportItem {
  category: string;
  testName: string;
  status: 'PASS' | 'FAIL';
  detail: string;
}

const reports: TestReportItem[] = [];

async function checkRoute(path: string, token: string): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const res = await fetch(`http://localhost:3000${path}`, {
      headers: {
        Cookie: `admin_token=${token}; token=${token}`,
      },
    });
    return { ok: res.status === 200, status: res.status, text: `HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, status: 0, text: err.message };
  }
}

async function runAll() {
  console.log('\n======================================================');
  console.log('🚀 RUNNING COMPLETE DEV 2 ACCEPTANCE & E2E TEST SUITE');
  console.log('======================================================\n');

  // 1. Run Acceptance Suite
  const dev2Res = runDev2AcceptanceSuite();
  for (const r of dev2Res.results) {
    reports.push({
      category: 'DEV 2 Acceptance',
      testName: r.name,
      status: r.status,
      detail: r.message,
    });
  }

  // 2. Run Idempotency Tests
  const idempRes = runIdempotencyTests();
  for (const r of idempRes.results) {
    reports.push({
      category: 'Idempotency Engine',
      testName: r.name,
      status: r.status,
      detail: r.message,
    });
  }

  // 3. Run Day 8 Verification Matrix
  const day8Res = runDay8VerificationSuite();
  for (const r of day8Res.results) {
    reports.push({
      category: 'Verification Matrix',
      testName: r.name,
      status: r.status,
      detail: r.message,
    });
  }

  // 4. Authenticate Staff on Backend to test frontend routes
  let token = '';
  try {
    const loginRes = await fetch('http://localhost:4000/api/v1/auth/staff/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@platform.internal',
        password: 'Admin@123456',
      }),
    });
    const loginJson: any = await loginRes.json();
    const mfaToken = loginJson?.data?.mfaToken || loginJson?.mfaToken;

    if (mfaToken) {
      const mfaRes = await fetch('http://localhost:4000/api/v1/auth/staff/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mfaToken,
          code: '123456',
        }),
      });
      const mfaJson: any = await mfaRes.json();
      token = mfaJson?.data?.token || mfaJson?.token || '';
    }
  } catch (err: any) {
    console.warn('Staff auth warning:', err.message);
  }

  // 5. Test all DEV 2 Routes on Next.js frontend (http://localhost:3000)
  const dev2Routes = [
    { name: 'Finance Payments Ledger', path: '/finance/payments' },
    { name: 'Driver Settlements Batch', path: '/finance/settlements' },
    { name: 'Cash Collection Reconcile', path: '/finance/cash' },
    { name: 'Customer Outstanding Debt', path: '/finance/outstanding' },
    { name: 'Corporate Accounts Registry', path: '/corporate/accounts' },
    { name: 'Corporate Invoices Desk', path: '/corporate/invoices' },
    { name: 'Emergency SOS Command Desk', path: '/safety/sos' },
    { name: 'Customer Support Tickets', path: '/support/tickets' },
    { name: 'Ratings & Review Moderation', path: '/moderation/ratings' },
    { name: 'Marketing & Discount Coupons', path: '/marketing/coupons' },
    { name: 'Dynamic Pricing Configurator', path: '/pricing/configs' },
    { name: 'Ride Performance Reports', path: '/reports/rides' },
    { name: 'Financial Revenue Reports', path: '/reports/revenue' },
    { name: 'Driver Payout Reports', path: '/reports/drivers' },
    { name: 'Active Sessions Monitor', path: '/settings/sessions' },
    { name: 'QA Verification Matrix', path: '/tools/verification-matrix' },
  ];

  for (const r of dev2Routes) {
    const res = await checkRoute(r.path, token);
    reports.push({
      category: 'DEV 2 Frontend Routes',
      testName: `${r.name} (${r.path})`,
      status: res.ok ? 'PASS' : 'FAIL',
      detail: res.text,
    });
  }

  // 6. Automated Teardown & Idempotency Cache Cleanup
  clearIdempotencyKey('refund', 'bk_123');
  clearIdempotencyKey('refund', 'booking_999');
  clearIdempotencyKey('cash_deposit', 'booking_999');

  // 7. Print Summary Table
  console.table(reports);

  const passedCount = reports.filter((r) => r.status === 'PASS').length;
  const failedCount = reports.filter((r) => r.status === 'FAIL').length;

  console.log(`\n======================================================`);
  console.log(`TOTAL DEV 2 TESTS: ${reports.length} | PASSED: ${passedCount} | FAILED: ${failedCount}`);
  if (failedCount === 0) {
    console.log(`🎉 ALL DEV 2 MODULES ARE 100% OPERATIONAL AND ACCEPTANCE VERIFIED!`);
  } else {
    console.log(`⚠️ ${failedCount} TESTS FAILED. PLEASE REVIEW TABLE ABOVE.`);
  }
  console.log(`======================================================\n`);
}

runAll().catch(console.error);
