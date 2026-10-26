import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/auditLog.model';
import { Booking } from '../src/modules/bookings/booking.model';
import { Ride } from '../src/modules/rides/ride.model';
import { LedgerTransaction } from '../src/modules/ledger/ledgerTransaction.model';
import {
  completedRide,
  createDriver,
  loginAs,
  loginAsAdmin,
  nextPhone,
  seedWorld,
  startTestEnv,
  type Session,
  type TestEnv,
} from './helpers';

let env: TestEnv;
let world: Awaited<ReturnType<typeof seedWorld>>;
let rider: Session;
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(() => env.stop());
beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
  rider = await loginAs(env, nextPhone(), 'CUSTOMER');
});

const api = () => request(env.app);
const confirm = (s: Session, rideId: string, amountPaise: number) =>
  api()
    .post(`/api/v1/rides/${rideId}/cash-collection/customer-confirm`)
    .set(s.auth)
    .send({ amountPaise });

describe('the rider confirms the cash they handed over', () => {
  it('records a matching amount and moves no money', async () => {
    const driver = await createDriver(env, world);
    const ride = await completedRide(env, world, rider, driver, 'CASH');
    const ledgerBefore = await LedgerTransaction.countDocuments();

    const res = await confirm(rider, ride.rideId, ride.fare);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      farePaise: ride.fare,
      confirmedPaise: ride.fare,
      matchesFare: true,
      driverRecordedCash: false,
    });
    expect(await LedgerTransaction.countDocuments()).toBe(ledgerBefore);
    expect(await AuditLog.countDocuments({ action: 'cash.customer_mismatch' })).toBe(0);

    // The driver's confirmation is still what settles the ride, and the rider's note does not get in the way.
    const paid = await api()
      .post(`/api/v1/rides/${ride.rideId}/cash-collected`)
      .set(driver.auth)
      .send({ amountPaise: ride.fare });
    expect(paid.status).toBe(200);
    const again = await confirm(rider, ride.rideId, ride.fare);
    expect(again.body.data.driverRecordedCash).toBe(true);
  });

  it('records a different amount as a cash dispute and audits it once', async () => {
    const driver = await createDriver(env, world);
    const ride = await completedRide(env, world, rider, driver, 'CASH');
    const res = await confirm(rider, ride.rideId, ride.fare - 5000);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ matchesFare: false, confirmedPaise: ride.fare - 5000 });
    const rideDoc = await Ride.findOne({ publicId: ride.rideId }).lean();
    const booking = await Booking.findById(rideDoc!.bookingId).lean();
    expect(booking?.customerCashConfirmation?.matchesFare).toBe(false);

    // Saying the same thing again is fine and is not audited a second time.
    expect((await confirm(rider, ride.rideId, ride.fare - 5000)).status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'cash.customer_mismatch' })).toBe(1);
    // Changing the story is not allowed.
    const changed = await confirm(rider, ride.rideId, ride.fare);
    expect(changed.status).toBe(409);
  });

  it('is only for the rider of that cash ride', async () => {
    const driver = await createDriver(env, world);
    const ride = await completedRide(env, world, rider, driver, 'CASH');
    const stranger = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await confirm(stranger, ride.rideId, ride.fare)).status).toBe(404);
    expect(
      (
        await api()
          .post(`/api/v1/rides/${ride.rideId}/cash-collection/customer-confirm`)
          .set(driver.auth)
          .send({ amountPaise: ride.fare })
      ).status,
    ).toBe(403);
    const staff = await loginAsAdmin(env, nextPhone(), 'OPS');
    expect(
      (
        await api()
          .post(`/api/v1/rides/${ride.rideId}/cash-collection/customer-confirm`)
          .set(staff.auth)
          .send({ amountPaise: ride.fare })
      ).status,
    ).toBe(403);
  });

  it('is refused for a ride paid online', async () => {
    const driver = await createDriver(env, world);
    const ride = await completedRide(env, world, rider, driver, 'ONLINE');
    const res = await confirm(rider, ride.rideId, ride.fare);
    expect(res.status).toBe(409);
  });

  it('refuses bad amounts and extra fields', async () => {
    const driver = await createDriver(env, world);
    const ride = await completedRide(env, world, rider, driver, 'CASH');
    expect((await confirm(rider, ride.rideId, 0)).status).toBe(400);
    expect((await confirm(rider, ride.rideId, 12.5)).status).toBe(400);
    const extra = await api()
      .post(`/api/v1/rides/${ride.rideId}/cash-collection/customer-confirm`)
      .set(rider.auth)
      .send({ amountPaise: ride.fare, status: 'PAID' });
    expect(extra.status).toBe(400);
  });

  it('stops being possible a week after the ride', async () => {
    const driver = await createDriver(env, world);
    const ride = await completedRide(env, world, rider, driver, 'CASH');
    env.setNow(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000));
    try {
      const res = await confirm(rider, ride.rideId, ride.fare);
      expect(res.status).toBe(422);
    } finally {
      env.setNow(null);
    }
  });
});
