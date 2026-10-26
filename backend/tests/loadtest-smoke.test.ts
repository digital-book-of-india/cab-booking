import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runLoad } from '../scripts/loadtest';
import { runRideLoad } from '../scripts/loadtest-rides';
import { User } from '../src/modules/users/user.model';
import { nextPhone, seedWorld, startTestEnv, type TestEnv } from './helpers';

/** Proves the load-test scripts themselves work (tiny runs). The real runs need a staging server. */
let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv({ fixedOtp: '123456' });
  await seedWorld();
});
afterAll(() => env.stop());

describe('rider load script', () => {
  it('signs in distinct riders, quotes, books, cancels and holds connections, and reports honestly', async () => {
    const report = await runLoad({
      baseUrl: env.url,
      fixedOtp: '123456',
      riders: 4,
      roundsPerRider: 2,
      concurrency: 2,
      sockets: true,
    });
    expect(report.errors).toBe(0);
    expect(report.sockets).toEqual({ opened: 4, failed: 0 });
    // Four different people, not one account signed in four times.
    expect(await User.countDocuments({ role: 'CUSTOMER' })).toBe(4);
    expect(report.byEndpoint['POST /auth/otp/verify']!.statuses).toEqual({ '200': 4 });
    expect(report.byEndpoint['POST /fare-quotes']!.statuses).toEqual({ '201': 8 });
    expect(report.byEndpoint['POST /bookings']!.count).toBe(8);
    expect(report.byEndpoint['POST /bookings/{id}/cancel']!.statuses).toEqual({ '200': 8 });
    expect(report.byEndpoint['POST /fare-quotes']!.p95).toBeGreaterThan(0);
  });
});

describe('full-ride load script', () => {
  it('sets up approved drivers through the staff API, then drives real rides to completion', async () => {
    await env.reset();
    await seedWorld();
    const adminPhone = nextPhone();
    await User.create({
      phone: adminPhone,
      role: 'OPS',
      name: 'Load Admin',
      phoneVerifiedAt: new Date(),
    });
    // The test server does not run the background sweeper by itself.
    const timer = setInterval(() => void env.sweep().catch(() => undefined), 200);
    try {
      const report = await runRideLoad({
        baseUrl: env.url,
        fixedOtp: '123456',
        adminPhone,
        drivers: 2,
        riders: 2,
        durationSeconds: 15, // headroom: the full suite runs many test files at once
        locationIntervalMs: 500,
        offerPollMs: 200,
      });
      expect(report.drivers).toEqual({ requested: 2, online: 2 });
      expect(report.rides.booked).toBeGreaterThanOrEqual(2);
      expect(report.rides.assigned).toBeGreaterThanOrEqual(2);
      expect(report.rides.completed).toBeGreaterThanOrEqual(2);
      expect(report.secondsToAssign.count).toBe(report.rides.assigned);
      expect(report.locationUpdates).toBeGreaterThan(4);
      expect(report.errors).toBe(0);
    } finally {
      clearInterval(timer);
    }
  }, 60_000);
});
