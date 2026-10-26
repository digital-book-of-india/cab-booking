import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/auditLog.model';
import { Booking } from '../src/modules/bookings/booking.model';
import { Membership } from '../src/modules/corporate/corporate.models';
import type { LedgerService } from '../src/modules/ledger/ledger.service';
import { Device } from '../src/modules/notifications/device.model';
import { Notification } from '../src/modules/notifications/notification.model';
import type { PrivacyService } from '../src/modules/privacy/privacy.service';
import { EmergencyContact } from '../src/modules/safety/safety.models';
import { Payment } from '../src/modules/payments/payment.model';
import { Session as SessionDoc } from '../src/modules/auth/session.model';
import { User } from '../src/modules/users/user.model';
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
const privacy = () => (env.app.locals['services'] as { privacy: PrivacyService }).privacy;
const ledger = () => (env.app.locals['services'] as { ledger: LedgerService }).ledger;
const DAY = 86_400_000;
let keyN = 0;
const idem = () => `k-${Date.now()}-${++keyN}`;
const ask = (who: Session = rider) =>
  api().post('/api/v1/me/deletion').set(who.auth).send({ confirm: true });

describe('a copy of your data', () => {
  it('contains what we hold about you, once in a while, and only about you', async () => {
    await api()
      .patch('/api/v1/customers/me')
      .set(rider.auth)
      .send({ name: 'Asha Rao', email: 'asha@example.com' });
    const ride = await completedRide(env, world, rider, driver);
    await api()
      .post('/api/v1/me/emergency-contacts')
      .set(rider.auth)
      .send({ name: 'Bala', phone: '+919812300001' });
    await api()
      .post('/api/v1/support/tickets')
      .set(rider.auth)
      .send({ category: 'OTHER', subject: 'Hello there', message: 'A question.' });
    const topup = await api()
      .post('/api/v1/wallet/topups')
      .set(rider.auth)
      .set('Idempotency-Key', idem())
      .send({ amountPaise: 20_000 });
    await env.razorpay.webhook(
      env.razorpay.captured(topup.body.data.orderId, 'pay_priv_1', 20_000),
    );

    const res = await api().get('/api/v1/me/data-export').set(rider.auth);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.account).toMatchObject({ role: 'CUSTOMER', name: 'Asha Rao' });
    expect(d.profile.email).toBe('asha@example.com');
    expect(d.bookings).toHaveLength(1);
    expect(d.bookings[0]).toMatchObject({
      bookingId: ride.booking.bookingId,
      status: 'COMPLETED',
      finalFarePaise: ride.fare,
    });
    expect(d.payments[0]).toMatchObject({ purpose: 'TOPUP', amountPaise: 20_000 });
    expect(d.wallet.balancePaise).toBe(20_000);
    expect(d.emergencyContacts).toEqual([
      { name: 'Bala', phone: '+919812300001', relationship: null },
    ]);
    expect(d.supportTickets[0].subject).toBe('Hello there');
    // Nothing about the driver's phone, and no secrets.
    expect(JSON.stringify(d)).not.toContain(driver.userId);
    expect(await AuditLog.countDocuments({ action: 'privacy.export' })).toBe(1);

    expect((await api().get('/api/v1/me/data-export').set(rider.auth)).status).toBe(429); // too soon
    expect((await api().get('/api/v1/me/data-export')).status).toBe(401);
  });

  it('a driver’s copy includes vehicles and document status', async () => {
    const d = (await api().get('/api/v1/me/data-export').set(driver.auth)).body.data;
    expect(d.driver.approvalStatus).toBe('APPROVED');
    expect(d.driver.vehicles).toHaveLength(1);
    expect(d.driver.documents.length).toBeGreaterThan(0);
    const staff = await loginAsAdmin(env, nextPhone(), 'OPS');
    expect((await api().get('/api/v1/me/data-export').set(staff.auth)).status).toBe(403);
  });
});

describe('deleting your account', () => {
  it('waits a week, can be cancelled, then removes who you are and keeps the money records', async () => {
    await api()
      .patch('/api/v1/customers/me')
      .set(rider.auth)
      .send({ name: 'Asha Rao', email: 'asha@example.com' });
    const ride = await completedRide(env, world, rider, driver);
    await api()
      .post(`/api/v1/rides/${ride.rideId}/cash-collected`)
      .set(driver.auth)
      .send({ amountPaise: ride.fare });
    await api()
      .post('/api/v1/me/emergency-contacts')
      .set(rider.auth)
      .send({ name: 'Bala', phone: '+919812300001' });
    await api().post('/api/v1/devices').set(rider.auth).send({
      platform: 'android',
      deviceId: 'dev-1234',
      appVersion: '1.0.0',
      token: 'tok-12345678901234567890',
    });
    const phone = (await User.findById(rider.userId))!.phone;
    expect((await api().post('/api/v1/me/deletion').set(rider.auth).send({})).status).toBe(400); // must confirm

    const requested = await ask();
    expect(requested.status, JSON.stringify(requested.body)).toBe(201);
    const days = (new Date(requested.body.data.scheduledFor).getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7.01);

    // Cancel it, ask again, and nothing happens early.
    expect((await api().delete('/api/v1/me/deletion').set(rider.auth)).body.data.requested).toBe(
      false,
    );
    await ask();
    await privacy().run();
    expect((await User.findById(rider.userId))!.accountStatus).toBe('ACTIVE');

    env.setNow(new Date(Date.now() + 8 * DAY));
    expect(await privacy().run()).toMatchObject({ deleted: 1 });
    env.setNow(null);

    const gone = (await User.findById(rider.userId))!;
    expect(gone.accountStatus).toBe('DELETED');
    expect(gone.phone).toBe(`deleted:${rider.userId}`);
    expect(gone.name).toBeUndefined();
    expect(gone.anonymizedAt).toBeTruthy();
    expect((await api().get('/api/v1/auth/me').set(rider.auth)).status).toBe(401); // logged out everywhere
    expect(await Device.countDocuments({ userId: rider.userId })).toBe(0);
    expect(await EmergencyContact.countDocuments({ userId: rider.userId })).toBe(0);
    expect(await Notification.countDocuments({ userId: rider.userId })).toBe(0);
    expect(await SessionDoc.countDocuments({ userId: rider.userId, revokedAt: null })).toBe(0);

    // The money record is still there, and the books still balance.
    const b = (await Booking.findOne({ publicId: ride.booking.bookingId }))!;
    expect(b.finalFarePaise).toBe(ride.fare);
    expect(b.pickup.contactPhone ?? null).toBeNull();
    expect(await ledger().checkBalance()).toEqual({
      ledgerTotalPaise: 0,
      unbalancedTransactions: [],
      completedRidesWithoutAccrual: 0,
    });
    expect(await AuditLog.countDocuments({ action: 'privacy.account_deleted' })).toBe(1);

    // The phone number is free again: signing up with it makes a brand-new account.
    const again = await loginAs(env, phone, 'CUSTOMER');
    expect(again.userId).not.toBe(rider.userId);
  });

  it('is refused while a ride, a debt, wallet money or a company admin role is unresolved', async () => {
    // wallet money
    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    const topup = await api()
      .post('/api/v1/wallet/topups')
      .set(other.auth)
      .set('Idempotency-Key', idem())
      .send({ amountPaise: 10_000 });
    await env.razorpay.webhook(
      env.razorpay.captured(topup.body.data.orderId, 'pay_priv_2', 10_000),
    );
    expect((await ask(other)).body.error.fieldErrors[0].message).toMatch(/wallet/);

    // an unpaid ride
    const debtor = await loginAs(env, nextPhone(), 'CUSTOMER');
    await completedRide(env, world, debtor, driver, 'ONLINE');
    expect((await ask(debtor)).body.error.fieldErrors[0].message).toMatch(/unpaid/);

    // the only admin of a company
    const boss = await loginAs(env, nextPhone(), 'CUSTOMER');
    const fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    const company = await api()
      .post('/api/v1/admin/corporate')
      .set(fin.auth)
      .send({
        name: 'Acme',
        billingEmail: 'a@acme.example',
        adminPhone: (await User.findById(boss.userId))!.phone,
      });
    await api()
      .post(`/api/v1/corporate/invitations/${company.body.data.firstAdmin.membershipId}/accept`)
      .set(boss.auth)
      .send({});
    expect((await ask(boss)).body.error.fieldErrors[0].message).toMatch(/only admin/);
    expect(await Membership.countDocuments({ userId: boss.userId, status: 'ACTIVE' })).toBe(1);

    // an unfinished ride (last, so its pending offer does not get in the way of the others)
    await requestRide(env, world, rider);
    const unfinished = await ask();
    expect(unfinished.status).toBe(422);
    expect(unfinished.body.error.fieldErrors[0].message).toMatch(/not finished/);
  });

  it('a driver who is owed money or holds cash must settle first', async () => {
    const r = await loginAs(env, nextPhone(), 'CUSTOMER');
    await completedRide(env, world, r, driver); // a cash ride: the driver holds the fare or is owed a share
    const res = await ask(driver);
    expect(res.status).toBe(422);
    expect(res.body.error.fieldErrors[0].message).toMatch(/Settle with finance/);
  });

  it('stops a deletion if something comes up during the waiting week, and says why', async () => {
    await ask();
    await requestRide(env, world, rider); // a new ride during the week
    env.setNow(new Date(Date.now() + 8 * DAY));
    expect(await privacy().run()).toMatchObject({ deleted: 0, blocked: 1 });
    env.setNow(null);
    const u = (await User.findById(rider.userId))!;
    expect(u.accountStatus).toBe('ACTIVE');
    expect(u.deletionScheduledFor).toBeUndefined();
    expect(u.deletionBlockedReason).toMatch(/not finished/);
    expect(await Notification.countDocuments({ type: 'privacy.deletion_blocked' })).toBe(1);
  });

  it('a deletion cut short is finished by the job', async () => {
    await User.updateOne(
      { _id: rider.userId },
      { accountStatus: 'DELETED', phone: `deleted:${rider.userId}` },
    );
    await Device.create({
      userId: rider.userId,
      platform: 'android',
      deviceId: 'dev-9999',
      token: 'tok-99999999999999999999',
      lastSeenAt: new Date(),
    });
    expect(await privacy().run()).toMatchObject({ finished: 1 });
    expect(await Device.countDocuments({ userId: rider.userId })).toBe(0);
    expect((await User.findById(rider.userId))!.anonymizedAt).toBeTruthy();
    expect(await privacy().run()).toMatchObject({ finished: 0 });
  });
});

describe('deleting on someone’s behalf', () => {
  it('a super admin can, with a reason; nobody else can; staff and yourself are off limits', async () => {
    const root = await loginAsAdmin(env, nextPhone(), 'SUPER_ADMIN');
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const body = { reason: 'Erasure request received by email', confirm: true };
    const del = (who: Session, id: string, b: object = body) =>
      api().post(`/api/v1/admin/users/${id}/delete`).set(who.auth).send(b);
    expect((await del(ops, rider.userId)).status).toBe(403);
    expect((await del(root, rider.userId, { reason: 'x', confirm: true })).status).toBe(400);
    expect((await del(root, root.userId)).status).toBe(422);
    expect((await del(root, ops.userId)).status).toBe(422); // staff are managed another way
    expect((await del(root, rider.userId)).status).toBe(200);
    expect((await User.findById(rider.userId))!.accountStatus).toBe('DELETED');
    expect(await AuditLog.countDocuments({ action: 'privacy.staff_deleted_account' })).toBe(1);
    expect((await del(root, rider.userId)).status).toBe(404);
  });

  it('keeps payments of a deleted rider on file', async () => {
    const ride = await completedRide(env, world, rider, driver, 'ONLINE');
    const started = await api()
      .post(`/api/v1/bookings/${ride.booking.bookingId}/payments`)
      .set(rider.auth)
      .set('Idempotency-Key', idem())
      .send({});
    await env.razorpay.webhook(
      env.razorpay.captured(started.body.data.orderId, 'pay_priv_3', ride.fare),
    );
    const root = await loginAsAdmin(env, nextPhone(), 'SUPER_ADMIN');
    await api()
      .post(`/api/v1/admin/users/${rider.userId}/delete`)
      .set(root.auth)
      .send({ reason: 'Erasure request', confirm: true });
    expect(await Payment.countDocuments({ customerId: rider.userId, status: 'PAID' })).toBe(1);
  });
});
