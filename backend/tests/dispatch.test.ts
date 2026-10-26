import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Booking } from '../src/modules/bookings/booking.model';
import { RideOffer } from '../src/modules/dispatch/rideOffer.model';
import { DriverProfile } from '../src/modules/drivers/driverProfile.model';
import { Vehicle } from '../src/modules/vehicles/vehicle.model';
import {
  FAR_FROM_CP,
  NEARISH_CP,
  NEAR_CP,
  acceptOffer,
  createDriver,
  currentOffer,
  loginAs,
  loginAsAdmin,
  nextPhone,
  requestRide,
  seedWorld,
  startTestEnv,
  type Session,
  type TestEnv,
} from './helpers';

let env: TestEnv;
let world: Awaited<ReturnType<typeof seedWorld>>;
let customer: Session;
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(() => env.stop());
beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
  customer = await loginAs(env, nextPhone(), 'CUSTOMER');
});

const api = () => request(env.app);
const statusOf = async (bookingId: string) =>
  (await Booking.findOne({ publicId: bookingId }).lean())!.status;

describe('who gets offered a ride', () => {
  it('offers the nearest eligible driver first, and only that driver', async () => {
    const near = await createDriver(env, world, { at: NEAR_CP });
    const nearish = await createDriver(env, world, { at: NEARISH_CP });
    await requestRide(env, world, customer);

    const first = await currentOffer(env, near);
    expect(first).not.toBeNull();
    expect(await currentOffer(env, nearish)).toBeNull();
  });

  it('shows the driver the trip but not the rider’s identity', async () => {
    const d = await createDriver(env, world);
    await requestRide(env, world, customer, {
      category: 'MINI',
    });
    const res = await api().get('/api/v1/drivers/me/offers').set(d.auth);
    const offer = res.body.data[0];
    expect(offer).toMatchObject({ currency: 'INR', paymentMethod: 'CASH' });
    expect(offer.pickup.lat).toBeCloseTo(28.6315);
    expect(offer.pickupDistanceMeters).toBeGreaterThan(0);
    expect(JSON.stringify(offer)).not.toMatch(/contact|phone|customer/i);
  });

  it('skips drivers who are offline, unapproved, suspended, busy, stale, far, or in the wrong category', async () => {
    const eligible = await createDriver(env, world, { at: NEARISH_CP });

    const offline = await createDriver(env, world, { at: NEAR_CP });
    await api().post('/api/v1/drivers/me/presence').set(offline.auth).send({ status: 'OFFLINE' });

    const unapproved = await createDriver(env, world, { at: NEAR_CP });
    await DriverProfile.updateOne({ userId: unapproved.userId }, { approvalStatus: 'SUSPENDED' });

    const busy = await createDriver(env, world, { at: NEAR_CP });
    await DriverProfile.updateOne(
      { userId: busy.userId },
      { activeRideId: (await Booking.findOne().lean())?._id ?? '507f1f77bcf86cd799439011' },
    );

    const stale = await createDriver(env, world, { at: NEAR_CP });
    await DriverProfile.updateOne(
      { userId: stale.userId },
      { locationUpdatedAt: new Date(Date.now() - 120_000) },
    );

    const far = await createDriver(env, world, { at: FAR_FROM_CP });
    const wrongCategory = await createDriver(env, world, { at: NEAR_CP, category: 'SUV' });

    const unverified = await createDriver(env, world, { at: NEAR_CP });
    await Vehicle.updateOne({ _id: unverified.vehicleId }, { verificationStatus: 'REJECTED' });

    await requestRide(env, world, customer);
    for (const [name, d] of Object.entries({
      offline,
      unapproved,
      busy,
      stale,
      far,
      wrongCategory,
      unverified,
    })) {
      expect(await currentOffer(env, d), name).toBeNull();
    }
    expect(await currentOffer(env, eligible)).not.toBeNull();
  });

  it('keeps searching and offers a driver who comes online later', async () => {
    const booking = await requestRide(env, world, customer);
    expect(booking.status).toBe('DISPATCHING');
    const late = await createDriver(env, world, { at: NEAR_CP });
    expect(await currentOffer(env, late)).toBeNull(); // nobody has run a round since
    await env.sweep();
    expect(await currentOffer(env, late)).not.toBeNull();
  });
});

describe('offer lifecycle', () => {
  it('moves to the next driver when the first rejects', async () => {
    const a = await createDriver(env, world, { at: NEAR_CP });
    const b = await createDriver(env, world, { at: NEARISH_CP });
    await requestRide(env, world, customer);

    const offerA = (await currentOffer(env, a))!;
    const rej = await api()
      .post(`/api/v1/ride-offers/${offerA.offerId}/reject`)
      .set(a.auth)
      .send({ reason: 'Too far' });
    expect(rej.status).toBe(200);
    expect(await currentOffer(env, a)).toBeNull();
    expect(await currentOffer(env, b)).not.toBeNull();
  });

  it('moves on when an offer expires, and the expired offer can no longer be accepted', async () => {
    const a = await createDriver(env, world, { at: NEAR_CP });
    const b = await createDriver(env, world, { at: NEARISH_CP });
    await requestRide(env, world, customer);
    const offerA = (await currentOffer(env, a))!;

    env.setNow(new Date(Date.now() + 21_000));
    await env.sweep();

    expect((await RideOffer.findOne({ publicId: offerA.offerId }).lean())?.status).toBe('EXPIRED');
    expect(await currentOffer(env, b)).not.toBeNull();
    const late = await acceptOffer(env, a, offerA.offerId);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('OFFER_UNAVAILABLE');
  });

  it('refuses an accept that arrives after expiry even before the sweeper runs', async () => {
    const a = await createDriver(env, world);
    await requestRide(env, world, customer);
    const offer = (await currentOffer(env, a))!;
    env.setNow(new Date(Date.now() + 25_000));
    const res = await acceptOffer(env, a, offer.offerId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OFFER_UNAVAILABLE');
  });

  it('reports NO_DRIVER_FOUND once the search window closes with nobody available', async () => {
    const booking = await requestRide(env, world, customer);
    await env.sweep();
    expect(await statusOf(booking.bookingId)).toBe('DISPATCHING');
    env.setNow(new Date(Date.now() + 61_000));
    await env.sweep();
    expect(await statusOf(booking.bookingId)).toBe('NO_DRIVER_FOUND');
    const events = await api()
      .get(`/api/v1/bookings/${booking.bookingId}/events`)
      .set(customer.auth);
    expect(events.body.data.at(-1)).toMatchObject({ type: 'NO_DRIVER_FOUND', actorType: 'SYSTEM' });
  });

  it('gives up after every nearby driver has declined', async () => {
    const drivers = [
      await createDriver(env, world, { at: NEAR_CP }),
      await createDriver(env, world, { at: NEARISH_CP }),
    ];
    const booking = await requestRide(env, world, customer);
    for (let i = 0; i < drivers.length; i++) {
      const d = (
        await Promise.all(drivers.map((x) => currentOffer(env, x).then((o) => ({ x, o }))))
      ).find((p) => p.o)!;
      await api().post(`/api/v1/ride-offers/${d.o!.offerId}/reject`).set(d.x.auth).send({});
    }
    env.setNow(new Date(Date.now() + 61_000));
    await env.sweep();
    expect(await statusOf(booking.bookingId)).toBe('NO_DRIVER_FOUND');
  });

  it('an admin can retry a failed search, and earlier decliners are asked again', async () => {
    const a = await createDriver(env, world);
    const booking = await requestRide(env, world, customer);
    const first = (await currentOffer(env, a))!;
    await api().post(`/api/v1/ride-offers/${first.offerId}/reject`).set(a.auth).send({});
    env.setNow(new Date(Date.now() + 61_000));
    await env.sweep();
    expect(await statusOf(booking.bookingId)).toBe('NO_DRIVER_FOUND');

    env.setNow(null);
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const retry = await api()
      .post(`/api/v1/bookings/${booking.bookingId}/dispatch/retry`)
      .set(ops.auth);
    expect(retry.status).toBe(202);
    const again = await currentOffer(env, a);
    expect(again).not.toBeNull();
    expect(again!.offerId).not.toBe(first.offerId);

    // Only a failed search can be retried, and only by ops.
    expect(
      (await api().post(`/api/v1/bookings/${booking.bookingId}/dispatch/retry`).set(ops.auth))
        .status,
    ).toBe(409);
    expect(
      (await api().post(`/api/v1/bookings/${booking.bookingId}/dispatch/retry`).set(customer.auth))
        .status,
    ).toBe(403);
  });
});

describe('accepting', () => {
  it('assigns the driver, creates the ride, and locks the driver to it', async () => {
    const a = await createDriver(env, world);
    const booking = await requestRide(env, world, customer);
    const offer = (await currentOffer(env, a))!;

    const res = await acceptOffer(env, a, offer.offerId);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      bookingId: booking.bookingId,
      status: 'DRIVER_ASSIGNED',
    });
    expect(res.body.data.rideId).toMatch(/^ride_[0-9a-f]{12}$/);

    const doc = await Booking.findOne({ publicId: booking.bookingId }).lean();
    expect(doc?.status).toBe('DRIVER_ASSIGNED');
    expect(doc?.rideId).toBe(res.body.data.rideId);
    const profile = await DriverProfile.findById(a.driverId).lean();
    expect(profile?.activeRideId?.toString()).toBe(doc?._id.toString());
    expect(await currentOffer(env, a)).toBeNull();
  });

  it('accepting twice returns the same ride instead of an error', async () => {
    const a = await createDriver(env, world);
    await requestRide(env, world, customer);
    const offer = (await currentOffer(env, a))!;
    const first = await acceptOffer(env, a, offer.offerId);
    const second = await acceptOffer(env, a, offer.offerId);
    expect(second.status).toBe(200);
    expect(second.body.data.rideId).toBe(first.body.data.rideId);
  });

  it('another driver cannot accept or reject someone else’s offer', async () => {
    const a = await createDriver(env, world, { at: NEAR_CP });
    const b = await createDriver(env, world, { at: NEARISH_CP });
    await requestRide(env, world, customer);
    const offer = (await currentOffer(env, a))!;
    expect((await acceptOffer(env, b, offer.offerId)).status).toBe(404);
    expect(
      (await api().post(`/api/v1/ride-offers/${offer.offerId}/reject`).set(b.auth).send({})).status,
    ).toBe(404);
    expect(await statusOf((await Booking.findOne().lean())!.publicId)).toBe('DISPATCHING');
  });

  it('refuses a driver who went offline, was suspended, or lost their vehicle verification', async () => {
    for (const breakIt of [
      (d: { userId: string; vehicleId: string }) =>
        DriverProfile.updateOne({ userId: d.userId }, { onlineStatus: 'OFFLINE' }),
      (d: { userId: string; vehicleId: string }) =>
        DriverProfile.updateOne({ userId: d.userId }, { approvalStatus: 'SUSPENDED' }),
      (d: { userId: string; vehicleId: string }) =>
        Vehicle.updateOne({ _id: d.vehicleId }, { verificationStatus: 'REJECTED' }),
    ]) {
      await env.reset();
      world = await seedWorld();
      customer = await loginAs(env, nextPhone(), 'CUSTOMER');
      const a = await createDriver(env, world);
      const booking = await requestRide(env, world, customer);
      const offer = (await currentOffer(env, a))!;
      await breakIt(a);
      const res = await acceptOffer(env, a, offer.offerId);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('DRIVER_NOT_ELIGIBLE');
      expect(await statusOf(booking.bookingId)).toBe('DISPATCHING');
    }
  });

  it('rejects ids that are not offer ids', async () => {
    const a = await createDriver(env, world);
    expect((await acceptOffer(env, a, 'nope')).status).toBe(400);
    expect((await acceptOffer(env, a, 'ofr_000000000000')).status).toBe(404);
  });

  it('is for drivers only', async () => {
    expect(
      (await api().post('/api/v1/ride-offers/ofr_000000000000/accept').set(customer.auth)).status,
    ).toBe(403);
    expect((await api().get('/api/v1/drivers/me/offers').set(customer.auth)).status).toBe(403);
  });
});
