import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/auditLog.model';
import { Session } from '../src/modules/auth/session.model';
import { User } from '../src/modules/users/user.model';
import {
  assignTo,
  createDriver,
  loginAs,
  loginAsAdmin,
  nextPhone,
  requestRide,
  seedWorld,
  startTestEnv,
  type Session as TestSession,
  type TestEnv,
} from './helpers';

let env: TestEnv;
let world: Awaited<ReturnType<typeof seedWorld>>;
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(() => env.stop());
beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
});

const api = () => request(env.app);
const base = '/api/v1/admin';

describe('who can use the admin views', () => {
  it('customers and drivers are refused everywhere', async () => {
    const c = await loginAs(env, nextPhone(), 'CUSTOMER');
    const d = await loginAs(env, nextPhone(), 'DRIVER');
    const id = '507f1f77bcf86cd799439011';
    for (const who of [c, d]) {
      for (const path of ['/dashboard', '/users', `/users/${id}`, '/bookings', '/bookings/bk_x']) {
        expect(
          (
            await api()
              .get(base + path)
              .set(who.auth)
          ).status,
          path,
        ).toBe(403);
      }
      const patch = await api()
        .patch(`${base}/users/${id}/status`)
        .set(who.auth)
        .send({ status: 'SUSPENDED', reason: 'testing' });
      expect(patch.status).toBe(403);
    }
  });

  it('needs a login', async () => {
    expect((await api().get(`${base}/dashboard`)).status).toBe(401);
  });

  it('support can look but not suspend; finance and config admins cannot look', async () => {
    const support = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    const finance = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    const config = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await api().get(`${base}/users`).set(support.auth)).status).toBe(200);
    expect(
      (
        await api()
          .patch(`${base}/users/${customer.userId}/status`)
          .set(support.auth)
          .send({ status: 'SUSPENDED', reason: 'because' })
      ).status,
    ).toBe(403);
    expect((await api().get(`${base}/users`).set(finance.auth)).status).toBe(403);
    expect((await api().get(`${base}/bookings`).set(config.auth)).status).toBe(403);
  });
});

describe('user search and detail', () => {
  it('filters by role, status and a phone/name search, with paging', async () => {
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const c1 = await loginAs(env, nextPhone(), 'CUSTOMER');
    await loginAs(env, nextPhone(), 'CUSTOMER');
    await loginAs(env, nextPhone(), 'DRIVER');
    await User.updateOne({ _id: c1.userId }, { name: 'Asha Verma' });

    const customers = await api().get(`${base}/users?role=CUSTOMER`).set(ops.auth);
    expect(customers.status).toBe(200);
    expect(customers.body.data).toHaveLength(2);
    expect(customers.body.meta.total).toBe(2);

    const byName = await api().get(`${base}/users?q=asha`).set(ops.auth);
    expect(byName.body.data.map((u: { userId: string }) => u.userId)).toEqual([c1.userId]);

    const paged = await api().get(`${base}/users?limit=2&page=2`).set(ops.auth);
    expect(paged.body.meta).toMatchObject({ page: 2, limit: 2, total: 4 });
    expect(paged.body.data).toHaveLength(2);

    // A search containing regex characters is treated as plain text, not a pattern.
    const weird = await api()
      .get(`${base}/users?q=${encodeURIComponent('.*')}`)
      .set(ops.auth);
    expect(weird.status).toBe(200);
    expect(weird.body.data).toHaveLength(0);
  });

  it('shows a driver summary and a customer booking count', async () => {
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const driver = await createDriver(env, world);
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    await requestRide(env, world, customer);

    const d = await api().get(`${base}/users/${driver.userId}`).set(ops.auth);
    expect(d.body.data.driver).toMatchObject({
      driverId: driver.driverId,
      approvalStatus: 'APPROVED',
      onlineStatus: 'ONLINE',
    });
    const c = await api().get(`${base}/users/${customer.userId}`).set(ops.auth);
    expect(c.body.data).toMatchObject({ bookingCount: 1, driver: null });
    expect(c.body.data.liveSessions).toBeGreaterThanOrEqual(1);

    expect((await api().get(`${base}/users/507f1f77bcf86cd799439011`).set(ops.auth)).status).toBe(
      404,
    );
    expect((await api().get(`${base}/users/not-an-id`).set(ops.auth)).status).toBe(400);
  });
});

describe('suspending and reactivating accounts', () => {
  const suspend = (by: TestSession, userId: string, status = 'SUSPENDED', reason = 'abuse') =>
    api().patch(`${base}/users/${userId}/status`).set(by.auth).send({ status, reason });

  it('suspension locks the customer out at once, ends their sessions, and is audited', async () => {
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await api().get('/api/v1/customers/me').set(customer.auth)).status).toBe(200);

    const res = await suspend(ops, customer.userId);
    expect(res.status).toBe(200);
    expect(res.body.data.accountStatus).toBe('SUSPENDED');

    // The very same access token stops working immediately.
    expect((await api().get('/api/v1/customers/me').set(customer.auth)).status).toBe(401);
    expect(await Session.countDocuments({ userId: customer.userId, revokedAt: null })).toBe(0);
    // And they cannot log back in with the refresh token.
    const refresh = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: customer.refreshToken });
    expect(refresh.status).toBe(401);

    const entry = await AuditLog.findOne({ action: 'USER_SUSPENDED' }).lean();
    expect(entry).toMatchObject({
      actorRole: 'OPS',
      targetType: 'User',
      targetId: customer.userId,
    });
    expect(entry?.metadata).toMatchObject({ reason: 'abuse', from: 'ACTIVE', to: 'SUSPENDED' });
  });

  it('reactivation lets them log in again', async () => {
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const phone = nextPhone();
    const customer = await loginAs(env, phone, 'CUSTOMER');
    await suspend(ops, customer.userId);
    expect((await suspend(ops, customer.userId, 'ACTIVE', 'appeal accepted')).status).toBe(200);
    const again = await loginAs(env, phone);
    expect((await api().get('/api/v1/customers/me').set(again.auth)).status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'USER_REACTIVATED' })).toBe(1);
  });

  it('needs a reason, and rejects repeats, drivers and unknown fields', async () => {
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const driver = await loginAs(env, nextPhone(), 'DRIVER');

    const noReason = await api()
      .patch(`${base}/users/${customer.userId}/status`)
      .set(ops.auth)
      .send({ status: 'SUSPENDED' });
    expect(noReason.status).toBe(400);
    const extra = await api()
      .patch(`${base}/users/${customer.userId}/status`)
      .set(ops.auth)
      .send({ status: 'SUSPENDED', reason: 'abuse', role: 'SUPER_ADMIN' });
    expect(extra.status).toBe(400);
    const bad = await suspend(ops, customer.userId, 'DELETED');
    expect(bad.status).toBe(400);

    // Already active.
    expect((await suspend(ops, customer.userId, 'ACTIVE')).status).toBe(409);
    // Drivers go through the approval workflow.
    const onDriver = await suspend(ops, driver.userId);
    expect(onDriver.status).toBe(422);
    expect(await AuditLog.countDocuments({ action: 'USER_SUSPENDED' })).toBe(0);
  });

  it('protects staff accounts', async () => {
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const other = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    const root = await loginAsAdmin(env, nextPhone(), 'SUPER_ADMIN');

    // Ops cannot touch a staff account; nobody can touch their own.
    expect((await suspend(ops, other.userId)).status).toBe(403);
    expect((await suspend(ops, ops.userId)).status).toBe(422);
    expect((await suspend(root, root.userId)).status).toBe(422);

    // A super admin can suspend staff, which also ends that person's sessions.
    expect((await suspend(root, other.userId)).status).toBe(200);
    expect((await api().get(`${base}/users`).set(other.auth)).status).toBe(401);
  });

  it('two admins suspending at the same moment: one wins, one is told it is already done', async () => {
    const ops1 = await loginAsAdmin(env, nextPhone(), 'OPS');
    const ops2 = await loginAsAdmin(env, nextPhone(), 'OPS');
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const [r1, r2] = await Promise.all([
      suspend(ops1, customer.userId),
      suspend(ops2, customer.userId),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(await AuditLog.countDocuments({ action: 'USER_SUSPENDED' })).toBe(1);
  });
});

describe('booking search and detail', () => {
  it('lists with filters and gives support the full story of one booking', async () => {
    const support = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    const driver = await createDriver(env, world);
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    const booking = await requestRide(env, world, customer);
    await assignTo(env, driver);
    await requestRide(env, world, other);

    const all = await api().get(`${base}/bookings`).set(support.auth);
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBe(2);

    const mine = await api()
      .get(`${base}/bookings?customerId=${customer.userId}`)
      .set(support.auth);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({
      bookingId: booking.bookingId,
      status: 'DRIVER_ASSIGNED',
      driverId: driver.driverId,
    });
    expect(mine.body.data[0].customer.phone).toBeTruthy();

    const byStatus = await api().get(`${base}/bookings?status=DISPATCHING`).set(support.auth);
    expect(byStatus.body.data).toHaveLength(1);
    const byDriver = await api()
      .get(`${base}/bookings?driverId=${driver.driverId}`)
      .set(support.auth);
    expect(byDriver.body.data).toHaveLength(1);
    const byPrefix = await api()
      .get(`${base}/bookings?q=${booking.bookingId.slice(0, 6)}`)
      .set(support.auth);
    expect(byPrefix.body.data.length).toBeGreaterThanOrEqual(1);
    const future = await api()
      .get(
        `${base}/bookings?from=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}`,
      )
      .set(support.auth);
    expect(future.body.data).toHaveLength(0);
    expect((await api().get(`${base}/bookings?status=NOPE`).set(support.auth)).status).toBe(400);

    const detail = await api().get(`${base}/bookings/${booking.bookingId}`).set(support.auth);
    expect(detail.status).toBe(200);
    const d = detail.body.data;
    expect(d).toMatchObject({ bookingId: booking.bookingId, status: 'DRIVER_ASSIGNED' });
    expect(d.customer.phone).toBeTruthy();
    expect(d.ride.driver.firstName).toBeTruthy();
    expect(d.fareSnapshot).toBeTruthy();
    expect(d.events.map((e: { type: string }) => e.type).length).toBeGreaterThanOrEqual(2);
    expect(d.offers).toHaveLength(1);
    expect(d.offers[0].status).toBe('ACCEPTED');
    // The pickup OTP never appears in any admin view.
    expect(JSON.stringify(d)).not.toMatch(/otp/i);

    // Reading a rider's contact details leaves a trace.
    const entry = await AuditLog.findOne({ action: 'BOOKING_VIEWED' }).lean();
    expect(entry).toMatchObject({ actorRole: 'SUPPORT', targetId: booking.bookingId });

    expect((await api().get(`${base}/bookings/bk_doesnotexist`).set(support.auth)).status).toBe(
      404,
    );
  });
});

describe('dashboard', () => {
  it('counts what is happening right now', async () => {
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const driver = await createDriver(env, world);
    await createDriver(env, world, { approve: false, online: false });
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    await requestRide(env, world, customer);
    await assignTo(env, driver);

    const res = await api().get(`${base}/dashboard`).set(ops.auth);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.bookings.active).toBe(1);
    expect(d.bookings.last24hByStatus).toMatchObject({ DRIVER_ASSIGNED: 1 });
    expect(d.drivers.onlineNow).toBe(1);
    expect(d.drivers.byApprovalStatus).toMatchObject({ APPROVED: 1, PENDING: 1 });
    expect(d.customers.active).toBe(1);
    expect(d.reviewQueue).toMatchObject({ driverApplications: 1 });
  });

  it('is all zeros on an empty system', async () => {
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const d = (await api().get(`${base}/dashboard`).set(ops.auth)).body.data;
    expect(d.bookings.active).toBe(0);
    expect(d.drivers.onlineNow).toBe(0);
    expect(d.reviewQueue).toEqual({
      driverApplications: 0,
      documents: 0,
      vehicles: 0,
      documentsExpiringSoon: 0,
      documentsExpired: 0,
    });
  });
});
