import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CustomerProfile } from '../src/modules/customers/customerProfile.model';
import { User } from '../src/modules/users/user.model';
import { AuditLog } from '../src/modules/audit/auditLog.model';
import { CP, IGI, loginAs, loginAsAdmin, nextPhone, seedWorld, startTestEnv, type Session, type TestEnv } from './helpers';

let env: TestEnv;
let opsAdmin: Session;
let customer: Session;
let world: Awaited<ReturnType<typeof seedWorld>>;

beforeAll(async () => {
  env = await startTestEnv();
});

afterAll(() => env.stop());

beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
  opsAdmin = await loginAsAdmin(env, nextPhone(), 'OPS');
  customer = await loginAs(env, nextPhone(), 'CUSTOMER');
});

const api = () => request(env.app);

describe('Admin Booking Restrictions Feature', () => {
  it('denies unauthenticated and non-staff requests', async () => {
    // Unauthenticated
    const unauth = await api()
      .post(`/api/v1/admin/customers/${customer.userId}/restrictions`)
      .send({ action: 'RESTRICT', reason: 'Abusive cancellation pattern' });
    expect(unauth.status).toBe(401);

    // Customer trying to call admin endpoint
    const forbidden = await api()
      .post(`/api/v1/admin/customers/${customer.userId}/restrictions`)
      .set(customer.auth)
      .send({ action: 'RESTRICT', reason: 'Abusive cancellation pattern' });
    expect(forbidden.status).toBe(403);
  });

  it('rejects requests with missing, short or invalid reasons', async () => {
    const emptyReason = await api()
      .post(`/api/v1/admin/customers/${customer.userId}/restrictions`)
      .set(opsAdmin.auth)
      .send({ action: 'RESTRICT', reason: ' ' });
    expect(emptyReason.status).toBe(400);

    const shortReason = await api()
      .post(`/api/v1/admin/customers/${customer.userId}/restrictions`)
      .set(opsAdmin.auth)
      .send({ action: 'RESTRICT', reason: 'no' });
    expect(shortReason.status).toBe(400);

    const invalidAction = await api()
      .post(`/api/v1/admin/customers/${customer.userId}/restrictions`)
      .set(opsAdmin.auth)
      .send({ action: 'BAN', reason: 'Invalid action type' });
    expect(invalidAction.status).toBe(400);
  });

  it('returns 404 when target customer does not exist', async () => {
    const fakeId = '507f1f77bcf86cd799439011';
    const res = await api()
      .post(`/api/v1/admin/customers/${fakeId}/restrictions`)
      .set(opsAdmin.auth)
      .send({ action: 'RESTRICT', reason: 'Customer does not exist' });
    expect(res.status).toBe(404);
  });

  it('applies and lifts booking restrictions with audit logging', async () => {
    // 1. Apply restriction
    const restrictRes = await api()
      .post(`/api/v1/admin/customers/${customer.userId}/restrictions`)
      .set(opsAdmin.auth)
      .send({ action: 'RESTRICT', reason: 'Repeated late cancellations' });

    expect(restrictRes.status).toBe(200);
    expect(restrictRes.body.data.bookingRestricted).toBe(true);
    expect(restrictRes.body.data.reason).toBe('Repeated late cancellations');
    expect(restrictRes.body.data.restrictedAt).toBeDefined();

    // Verify persisted in DB
    const profile = await CustomerProfile.findOne({ userId: customer.userId });
    expect(profile?.bookingRestricted).toBe(true);
    expect(profile?.bookingRestrictionReason).toBe('Repeated late cancellations');

    // Verify audit log recorded
    const auditRestricted = await AuditLog.findOne({
      action: 'CUSTOMER_BOOKING_RESTRICTED',
      targetId: customer.userId,
    });
    expect(auditRestricted).toBeDefined();
    expect(auditRestricted?.actorUserId.toString()).toBe(opsAdmin.userId);

    // 2. Lift restriction
    const liftRes = await api()
      .post(`/api/v1/admin/customers/${customer.userId}/restrictions`)
      .set(opsAdmin.auth)
      .send({ action: 'LIFT', reason: 'Review completed by safety operations' });

    expect(liftRes.status).toBe(200);
    expect(liftRes.body.data.bookingRestricted).toBe(false);
    expect(liftRes.body.data.reason).toBeNull();

    const profileAfterLift = await CustomerProfile.findOne({ userId: customer.userId });
    expect(profileAfterLift?.bookingRestricted).toBe(false);

    // Verify audit log recorded for lift
    const auditLifted = await AuditLog.findOne({
      action: 'CUSTOMER_BOOKING_RESTRICTION_LIFTED',
      targetId: customer.userId,
    });
    expect(auditLifted).toBeDefined();
  });

  it('enforces booking restriction in the actual booking creation flow', async () => {
    // Create quote first
    const quoteRes = await api()
      .post('/api/v1/fare-quotes')
      .set(customer.auth)
      .send({
        pickup: CP,
        drop: IGI,
        categoryId: world.cats['MINI'],
      });
    expect(quoteRes.status).toBe(201);
    const quoteId = quoteRes.body.data.quoteId;

    // Apply restriction on customer
    await api()
      .post(`/api/v1/admin/customers/${customer.userId}/restrictions`)
      .set(opsAdmin.auth)
      .send({ action: 'RESTRICT', reason: 'High chargeback risk' });

    // Attempt to book ride -> should be rejected with 403 BOOKING_RESTRICTED
    const bookingRes = await api()
      .post('/api/v1/bookings')
      .set(customer.auth)
      .set('Idempotency-Key', 'test-key-restricted-1')
      .send({
        quoteId,
        paymentMethod: 'CASH',
        rideType: 'INSTANT',
      });

    expect(bookingRes.status).toBe(403);
    expect(bookingRes.body.error.code).toBe('BOOKING_RESTRICTED');
    expect(bookingRes.body.error.message).toContain('High chargeback risk');

    // Lift restriction
    await api()
      .post(`/api/v1/admin/customers/${customer.userId}/restrictions`)
      .set(opsAdmin.auth)
      .send({ action: 'LIFT', reason: 'Risk cleared' });

    // Customer can now book successfully
    const allowedBooking = await api()
      .post('/api/v1/bookings')
      .set(customer.auth)
      .set('Idempotency-Key', 'test-key-restricted-2')
      .send({
        quoteId,
        paymentMethod: 'CASH',
        rideType: 'INSTANT',
      });

    expect(allowedBooking.status).toBe(201);
    expect(allowedBooking.body.data.bookingId).toBeDefined();
  });

  it('keeps booking restrictions strictly independent from account suspension', async () => {
    // 1. Customer is NOT suspended, only booking-restricted
    await api()
      .post(`/api/v1/admin/customers/${customer.userId}/restrictions`)
      .set(opsAdmin.auth)
      .send({ action: 'RESTRICT', reason: 'Booking policy warning' });

    const user = await User.findById(customer.userId);
    expect(user?.accountStatus).toBe('ACTIVE');

    // Customer can still read their own profile and saved places
    const profileRes = await api()
      .get('/api/v1/customers/me/places')
      .set(customer.auth);
    expect(profileRes.status).toBe(200);

    // 2. Suspend customer via admin user status endpoint
    await api()
      .patch(`/api/v1/admin/users/${customer.userId}/status`)
      .set(opsAdmin.auth)
      .send({ status: 'SUSPENDED', reason: 'Violation of terms' });

    // Now all authenticated calls are rejected at auth layer
    const suspendedCall = await api()
      .get('/api/v1/customers/me/places')
      .set(customer.auth);
    expect(suspendedCall.status).toBe(401);

    // Lifting booking restriction does NOT reactivate suspended user
    await api()
      .post(`/api/v1/admin/customers/${customer.userId}/restrictions`)
      .set(opsAdmin.auth)
      .send({ action: 'LIFT', reason: 'Lift restriction while still suspended' });

    const userStillSuspended = await User.findById(customer.userId);
    expect(userStillSuspended?.accountStatus).toBe('SUSPENDED');
  });
});
