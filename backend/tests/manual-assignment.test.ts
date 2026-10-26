import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CP, IGI, loginAs, loginAsAdmin, nextPhone, seedWorld, startTestEnv, type Session, type TestEnv } from './helpers';
import { DriverProfile } from '../src/modules/drivers/driverProfile.model';
import { Vehicle } from '../src/modules/vehicles/vehicle.model';
import { Booking } from '../src/modules/bookings/booking.model';
import { Ride } from '../src/modules/rides/ride.model';
import { AuditLog } from '../src/modules/audit/auditLog.model';

let env: TestEnv;
let opsAdmin: Session;
let customer: Session;
let driver1Session: Session;
let driver2Session: Session;
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
  driver1Session = await loginAs(env, nextPhone(), 'DRIVER');
  driver2Session = await loginAs(env, nextPhone(), 'DRIVER');
});

const api = () => request(env.app);

async function setupDriver(session: Session) {
  const profile = await DriverProfile.findOne({ userId: session.userId });
  const vehicle = await Vehicle.create({
    driverId: profile!._id,
    categoryId: world.cats['MINI'],
    make: 'Hyundai',
    model: 'i10',
    registrationNumber: `DL${Math.floor(1000 + Math.random() * 9000)}`,
    seats: 4,
    holdsRegistration: true,
    verificationStatus: 'VERIFIED',
    active: true,
  });

  await DriverProfile.updateOne(
    { _id: profile!._id },
    {
      $set: {
        approvalStatus: 'APPROVED',
        onlineStatus: 'ONLINE',
        currentVehicleId: vehicle._id,
        currentLocation: { type: 'Point', coordinates: [CP.lng, CP.lat] },
      },
    },
  );

  return { profile: (await DriverProfile.findById(profile!._id))!, vehicle };
}

async function createBooking(idempotencyKey = 'manual-assign-bk-1') {
  const quoteRes = await api()
    .post('/api/v1/fare-quotes')
    .set(customer.auth)
    .send({ pickup: CP, drop: IGI, categoryId: world.cats['MINI'] });
  expect(quoteRes.status).toBe(201);
  const quoteId = quoteRes.body.data.quoteId;

  const bookRes = await api()
    .post('/api/v1/bookings')
    .set(customer.auth)
    .set('Idempotency-Key', idempotencyKey)
    .send({
      quoteId,
      paymentMethod: 'CASH',
      rideType: 'INSTANT',
    });
  expect(bookRes.status).toBe(201);
  return bookRes.body.data.bookingId as string;
}

describe('Manual Driver Assignment Feature', () => {
  it('denies unauthenticated and unauthorized callers', async () => {
    const bookingId = await createBooking('auth-check-bk');
    const { profile } = await setupDriver(driver1Session);

    const unauth = await api()
      .post(`/api/v1/admin/bookings/${bookingId}/assign-driver`)
      .send({ driverId: profile._id.toString(), reason: 'Customer VIP request' });
    expect(unauth.status).toBe(401);

    const forbidden = await api()
      .post(`/api/v1/admin/bookings/${bookingId}/assign-driver`)
      .set(customer.auth)
      .send({ driverId: profile._id.toString(), reason: 'Customer VIP request' });
    expect(forbidden.status).toBe(403);
  });

  it('rejects invalid inputs: missing reason, non-existent booking or non-existent driver', async () => {
    const bookingId = await createBooking('invalid-inputs-bk');
    const { profile } = await setupDriver(driver1Session);

    // Missing reason
    const noReason = await api()
      .post(`/api/v1/admin/bookings/${bookingId}/assign-driver`)
      .set(opsAdmin.auth)
      .send({ driverId: profile._id.toString() });
    expect(noReason.status).toBe(400);

    // Non-existent booking
    const fakeBooking = await api()
      .post('/api/v1/admin/bookings/bk_nonexistent00/assign-driver')
      .set(opsAdmin.auth)
      .send({ driverId: profile._id.toString(), reason: 'Rescue' });
    expect(fakeBooking.status).toBe(404);

    // Non-existent driver
    const fakeDriver = await api()
      .post(`/api/v1/admin/bookings/${bookingId}/assign-driver`)
      .set(opsAdmin.auth)
      .send({ driverId: '507f1f77bcf86cd799439011', reason: 'Rescue' });
    expect(fakeDriver.status).toBe(404);
  });

  it('successfully assigns an eligible driver to a booking with atomic locking and audit trail', async () => {
    const bookingId = await createBooking('valid-assign-bk');
    const { profile, vehicle } = await setupDriver(driver1Session);

    const res = await api()
      .post(`/api/v1/admin/bookings/${bookingId}/assign-driver`)
      .set(opsAdmin.auth)
      .send({
        driverId: profile._id.toString(),
        vehicleId: vehicle._id.toString(),
        reason: 'Operations dispatch rescue for high waiting time',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.bookingId).toBe(bookingId);
    expect(res.body.data.status).toBe('DRIVER_ASSIGNED');
    expect(res.body.data.driverId).toBe(profile._id.toString());
    expect(res.body.data.rideId).toBeDefined();

    // Verify driver lock claimed in DB
    const updatedDriver = await DriverProfile.findById(profile._id);
    const booking = await Booking.findOne({ publicId: bookingId });
    expect(updatedDriver?.activeRideId?.toString()).toBe(booking?._id.toString());
    expect(booking?.status).toBe('DRIVER_ASSIGNED');
    expect(booking?.assignedDriverId?.toString()).toBe(profile._id.toString());

    // Verify Ride document created
    const ride = await Ride.findOne({ bookingId: booking?._id });
    expect(ride).toBeDefined();
    expect(ride?.driverId.toString()).toBe(profile._id.toString());

    // Verify audit log
    const audit = await AuditLog.findOne({
      action: 'ADMIN_MANUAL_ASSIGN_DRIVER',
      targetId: bookingId,
    });
    expect(audit).toBeDefined();
    expect(audit?.actorUserId.toString()).toBe(opsAdmin.userId);
  });

  it('safely re-assigns a booking from one driver to another and frees the previous driver', async () => {
    const bookingId = await createBooking('reassign-bk');
    const { profile: driver1 } = await setupDriver(driver1Session);
    const { profile: driver2 } = await setupDriver(driver2Session);

    // 1. Assign driver 1
    const firstAssign = await api()
      .post(`/api/v1/admin/bookings/${bookingId}/assign-driver`)
      .set(opsAdmin.auth)
      .send({ driverId: driver1._id.toString(), reason: 'Initial dispatch' });
    expect(firstAssign.status).toBe(200);

    const driver1Locked = await DriverProfile.findById(driver1._id);
    expect(driver1Locked?.activeRideId).not.toBeNull();

    // 2. Re-assign to driver 2
    const reassign = await api()
      .post(`/api/v1/admin/bookings/${bookingId}/assign-driver`)
      .set(opsAdmin.auth)
      .send({ driverId: driver2._id.toString(), reason: 'Driver 1 flat tyre report' });
    expect(reassign.status).toBe(200);
    expect(reassign.body.data.driverId).toBe(driver2._id.toString());

    // Verify previous driver 1 lock is freed
    const driver1Freed = await DriverProfile.findById(driver1._id);
    expect(driver1Freed?.activeRideId).toBeNull();

    // Verify driver 2 holds the lock
    const booking = await Booking.findOne({ publicId: bookingId });
    const driver2Locked = await DriverProfile.findById(driver2._id);
    expect(driver2Locked?.activeRideId?.toString()).toBe(booking?._id.toString());
    expect(booking?.assignedDriverId?.toString()).toBe(driver2._id.toString());

    // Verify previousDrivers list has driver 1 recorded
    expect(booking?.previousDrivers.length).toBe(1);
    expect(booking?.previousDrivers[0]?.driverId.toString()).toBe(driver1._id.toString());
  });

  it('rejects assigning a busy driver who already holds an active ride (409 Conflict)', async () => {
    const booking1Id = await createBooking('busy-bk-1');
    const booking2Id = await createBooking('busy-bk-2');
    const { profile } = await setupDriver(driver1Session);

    // Assign driver to booking 1
    const assign1 = await api()
      .post(`/api/v1/admin/bookings/${booking1Id}/assign-driver`)
      .set(opsAdmin.auth)
      .send({ driverId: profile._id.toString(), reason: 'First ride' });
    expect(assign1.status).toBe(200);

    // Attempt to assign the same busy driver to booking 2 -> must fail with 409
    const assign2 = await api()
      .post(`/api/v1/admin/bookings/${booking2Id}/assign-driver`)
      .set(opsAdmin.auth)
      .send({ driverId: profile._id.toString(), reason: 'Double booking attempt' });
    expect(assign2.status).toBe(409);
    expect(assign2.body.error.code).toBe('CONFLICT');
  });

  it('rejects unapproved or offline drivers with 403 DRIVER_NOT_ELIGIBLE', async () => {
    const bookingId = await createBooking('ineligible-driver-bk');
    const profile = await DriverProfile.findOne({ userId: driver1Session.userId });

    // Set offline
    await DriverProfile.updateOne(
      { _id: profile!._id },
      { $set: { approvalStatus: 'APPROVED', onlineStatus: 'OFFLINE' } },
    );

    const offlineRes = await api()
      .post(`/api/v1/admin/bookings/${bookingId}/assign-driver`)
      .set(opsAdmin.auth)
      .send({ driverId: profile!._id.toString(), reason: 'Assign offline driver' });
    expect(offlineRes.status).toBe(403);
    expect(offlineRes.body.error.code).toBe('DRIVER_NOT_ELIGIBLE');
  });
});
