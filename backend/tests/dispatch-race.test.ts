import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Booking } from '../src/modules/bookings/booking.model';
import { RideOffer } from '../src/modules/dispatch/rideOffer.model';
import { DriverProfile } from '../src/modules/drivers/driverProfile.model';
import { Ride } from '../src/modules/rides/ride.model';
import {
  NEARISH_CP,
  NEAR_CP,
  acceptOffer,
  createDriver,
  currentOffer,
  loginAs,
  nextPhone,
  requestRide,
  seedWorld,
  startTestEnv,
  type Session,
  type TestEnv,
} from './helpers';

// batchSize 2: the offer goes to two drivers at once, so they can genuinely race.
let env: TestEnv;
let world: Awaited<ReturnType<typeof seedWorld>>;
let customer: Session;
beforeAll(async () => {
  env = await startTestEnv({}, { dispatchConfig: { batchSize: 2 } });
});
afterAll(() => env.stop());
beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
  customer = await loginAs(env, nextPhone(), 'CUSTOMER');
});

const api = () => request(env.app);

describe('two drivers accepting the same ride', () => {
  it('offers to both, and exactly one wins when they accept at the same moment', async () => {
    const a = await createDriver(env, world, { at: NEAR_CP });
    const b = await createDriver(env, world, { at: NEARISH_CP });
    const booking = await requestRide(env, world, customer);
    const [offerA, offerB] = [(await currentOffer(env, a))!, (await currentOffer(env, b))!];
    expect(offerA).not.toBeNull();
    expect(offerB).not.toBeNull();

    const [ra, rb] = await Promise.all([
      acceptOffer(env, a, offerA.offerId),
      acceptOffer(env, b, offerB.offerId),
    ]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = ra.status === 409 ? ra : rb;
    expect(loser.body.error.code).toBe('RIDE_ALREADY_ASSIGNED');

    // Exactly one ride, one assigned driver, one locked driver.
    expect(await Ride.countDocuments()).toBe(1);
    const doc = await Booking.findOne({ publicId: booking.bookingId }).lean();
    expect(doc?.status).toBe('DRIVER_ASSIGNED');
    const winnerDriverId = (ra.status === 200 ? a : b).driverId;
    expect(doc?.assignedDriverId?.toString()).toBe(winnerDriverId);
    const locked = await DriverProfile.find({ activeRideId: doc!._id }).lean();
    expect(locked.map((d) => d._id.toString())).toEqual([winnerDriverId]);

    // The loser's offer is withdrawn and they are free to take another ride.
    const loserDriver = ra.status === 409 ? a : b;
    expect((await DriverProfile.findById(loserDriver.driverId).lean())?.activeRideId).toBeNull();
    expect(await RideOffer.countDocuments({ status: 'PENDING' })).toBe(0);
  });

  it('holds up over repeated races', async () => {
    for (let i = 0; i < 8; i++) {
      await env.reset();
      world = await seedWorld();
      customer = await loginAs(env, nextPhone(), 'CUSTOMER');
      const a = await createDriver(env, world, { at: NEAR_CP });
      const b = await createDriver(env, world, { at: NEARISH_CP });
      await requestRide(env, world, customer);
      // Fetch BOTH offers before either accept starts, or the first accept would withdraw the second.
      const [offerA, offerB] = [(await currentOffer(env, a))!, (await currentOffer(env, b))!];
      const results = await Promise.all([
        acceptOffer(env, a, offerA.offerId),
        acceptOffer(env, b, offerB.offerId),
      ]);
      expect(results.map((r) => r.status).sort(), `iteration ${i}`).toEqual([200, 409]);
      expect(await Ride.countDocuments()).toBe(1);
    }
  });

  it('a late accept after the ride is taken is refused cleanly', async () => {
    const a = await createDriver(env, world, { at: NEAR_CP });
    const b = await createDriver(env, world, { at: NEARISH_CP });
    await requestRide(env, world, customer);
    const [offerA, offerB] = [(await currentOffer(env, a))!, (await currentOffer(env, b))!];
    expect((await acceptOffer(env, a, offerA.offerId)).status).toBe(200);
    const late = await acceptOffer(env, b, offerB.offerId);
    expect(late.status).toBe(409);
    expect(['OFFER_UNAVAILABLE', 'RIDE_ALREADY_ASSIGNED']).toContain(late.body.error.code);
  });
});

describe('one driver, two rides', () => {
  it('cannot be assigned both when accepting at the same moment', async () => {
    const d = await createDriver(env, world, { at: NEAR_CP });
    const c2 = await loginAs(env, nextPhone(), 'CUSTOMER');
    await requestRide(env, world, customer);
    const second = await requestRide(env, world, c2);
    // Dispatch no longer offers a busy-with-an-offer driver a second ride, but a race between two
    // searches still can; simulate that, because the driver must never end up with both rides.
    const secondBooking = (await Booking.findOne({ publicId: second.bookingId }))!;
    await RideOffer.create({
      publicId: 'ofr_0a0a0a0a0a02',
      bookingId: secondBooking._id,
      driverId: d.driverId,
      vehicleId: d.vehicleId,
      round: 1,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 20_000),
      rank: 1,
    });
    const offers = (await api().get('/api/v1/drivers/me/offers').set(d.auth)).body.data as {
      offerId: string;
    }[];
    expect(offers).toHaveLength(2);

    const results = await Promise.all(offers.map((o) => acceptOffer(env, d, o.offerId)));
    // One wins. The other is refused: either the winner already closed it (409) or the driver is busy (403).
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(200);
    expect([403, 409]).toContain(statuses[1]);
    expect(await Ride.countDocuments()).toBe(1);
    expect(await Booking.countDocuments({ status: 'DRIVER_ASSIGNED' })).toBe(1);
    expect(await Booking.countDocuments({ status: 'DISPATCHING' })).toBe(1);
  });
});

describe('accepting while the customer cancels', () => {
  it('always ends in a consistent state, whoever wins', async () => {
    for (let i = 0; i < 8; i++) {
      await env.reset();
      world = await seedWorld();
      customer = await loginAs(env, nextPhone(), 'CUSTOMER');
      const d = await createDriver(env, world, { at: NEAR_CP });
      const booking = await requestRide(env, world, customer);
      const offer = (await currentOffer(env, d))!;

      const [accept, cancel] = await Promise.all([
        acceptOffer(env, d, offer.offerId),
        api()
          .post(`/api/v1/bookings/${booking.bookingId}/cancel`)
          .set(customer.auth)
          .send({ reasonCode: 'CHANGED_MIND' }),
      ]);

      const doc = await Booking.findOne({ publicId: booking.bookingId }).lean();
      const profile = await DriverProfile.findById(d.driverId).lean();
      if (doc?.status === 'CANCELLED') {
        // Cancel won (or ran right after the accept): the driver must not stay locked.
        expect(profile?.activeRideId, `iteration ${i}`).toBeNull();
        expect(cancel.status).toBe(200);
      } else {
        // Accept won and nobody cancelled it: the cancel request must have been refused.
        expect(doc?.status).toBe('DRIVER_ASSIGNED');
        expect(accept.status).toBe(200);
        expect(profile?.activeRideId?.toString()).toBe(doc?._id.toString());
      }
      expect(await RideOffer.countDocuments({ status: 'PENDING' })).toBe(0);
    }
  });
});
