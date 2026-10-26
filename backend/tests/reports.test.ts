import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/auditLog.model';
import { csvCell } from '../src/modules/reports/reports.service';
import {
  NEAR_CP,
  completedRide,
  createDriver,
  loginAs,
  loginAsAdmin,
  nextPhone,
  requestRide,
  seedWorld,
  startTestEnv,
  type Session,
  type TestDriver,
  type TestEnv,
} from './helpers';

let env: TestEnv;
let world: Awaited<ReturnType<typeof seedWorld>>;
let rider: Session;
let driver: TestDriver;
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(() => env.stop());
beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
  rider = await loginAs(env, nextPhone(), 'CUSTOMER');
  driver = await createDriver(env, world, { at: NEAR_CP });
});

const api = () => request(env.app);

describe('CSV safety', () => {
  it('neutralises spreadsheet formulas and quotes awkward text', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+91 98765')).toBe("'+91 98765");
    expect(csvCell('@home')).toBe("'@home");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(-500)).toBe('-500'); // a real negative number is not a formula
    expect(csvCell(null)).toBe('');
    expect(csvCell(new Date('2026-01-02T03:04:05.000Z'))).toBe('2026-01-02T03:04:05.000Z');
  });
});

describe('operations summary', () => {
  it('counts rides, money and dispatch for the period', async () => {
    const done = await completedRide(env, world, rider, driver);
    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    await requestRide(env, world, other).then((b) =>
      api()
        .post(`/api/v1/bookings/${b.bookingId}/cancel`)
        .set(other.auth)
        .send({ reasonCode: 'CHANGED_MIND' }),
    );
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const res = await api().get('/api/v1/admin/reports/summary').set(ops.auth);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.bookings.total).toBe(2);
    expect(d.bookings.byStatus).toMatchObject({ COMPLETED: 1, CANCELLED: 1 });
    expect(d.bookings.completionRate).toBe(0.5);
    expect(d.money.grossFaresPaise).toBe(done.fare);
    expect(d.money.commissionPaise).toBe(Math.round(done.fare * 0.2));
    expect(d.money.driverEarningsPaise).toBe(done.fare - Math.round(done.fare * 0.2));
    expect(d.people.activeDrivers).toBe(1);
    expect(d.byDay).toHaveLength(1);
    expect(d.byDay[0]).toMatchObject({ requested: 2, completed: 1, cancelled: 1 });
  });

  it('rejects silly periods and outsiders', async () => {
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const from = '2026-01-01T00:00:00.000Z';
    const far = await api()
      .get(`/api/v1/admin/reports/summary?from=${from}&to=2026-12-31T00:00:00.000Z`)
      .set(ops.auth);
    expect(far.status).toBe(400); // longer than 92 days
    expect(
      (await api().get(`/api/v1/admin/reports/summary?from=${from}&to=${from}`).set(ops.auth))
        .status,
    ).toBe(400);
    for (const who of [rider, await loginAsAdmin(env, nextPhone(), 'SUPPORT')]) {
      expect((await api().get('/api/v1/admin/reports/summary').set(who.auth)).status).toBe(403);
    }
  });
});

describe('CSV exports', () => {
  it('downloads rides as a file, with ids but no phone numbers, and audits the download', async () => {
    const done = await completedRide(env, world, rider, driver);
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const res = await api().get('/api/v1/admin/exports/rides.csv').set(ops.auth).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="rides_\d{4}-\d\d-\d\d_/,
    );
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toContain('bookingId,status');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(done.booking.bookingId);
    expect(lines[1]).toContain('COMPLETED');
    expect(res.text).not.toMatch(/\+91\d{10}/);
    expect(await AuditLog.countDocuments({ action: 'report.export' })).toBe(1);
    // The same file without the suffix.
    expect((await api().get('/api/v1/admin/exports/rides').set(ops.auth)).status).toBe(200);
  });

  it('money files are for finance only; unknown kinds are refused', async () => {
    await completedRide(env, world, rider, driver);
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    for (const kind of ['payments', 'settlements', 'ledger']) {
      expect((await api().get(`/api/v1/admin/exports/${kind}.csv`).set(ops.auth)).status).toBe(403);
      const ok = await api().get(`/api/v1/admin/exports/${kind}.csv`).set(fin.auth).buffer(true);
      expect(ok.status, kind).toBe(200);
      expect(ok.text.split('\n')[0]!.length).toBeGreaterThan(10);
    }
    const ledger = await api().get('/api/v1/admin/exports/ledger.csv').set(fin.auth).buffer(true);
    expect(ledger.text.trim().split('\n').length).toBeGreaterThan(1); // the ride's entries
    expect((await api().get('/api/v1/admin/exports/people.csv').set(fin.auth)).status).toBe(400);
    expect((await api().get('/api/v1/admin/exports/rides.csv').set(rider.auth)).status).toBe(403);
  });
});
