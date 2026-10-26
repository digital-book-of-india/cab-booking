import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Booking } from '../src/modules/bookings/booking.model';
import { RideOffer } from '../src/modules/dispatch/rideOffer.model';
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

const pendingFor = (driverId: string) => RideOffer.find({ driverId, status: 'PENDING' }).lean();

describe('one offer at a time per driver', () => {
  it('riders asking from the same spot are offered to different drivers, not all to the nearest', async () => {
    const near = await createDriver(env, world, { at: NEAR_CP });
    const far = await createDriver(env, world, { at: NEARISH_CP });
    const first = await requestRide(env, world, await loginAs(env, nextPhone(), 'CUSTOMER'));
    const second = await requestRide(env, world, await loginAs(env, nextPhone(), 'CUSTOMER'));
    await env.sweep();

    const a = await pendingFor(near.driverId);
    const b = await pendingFor(far.driverId);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    const booking = async (id: string) => (await Booking.findOne({ publicId: id }))!._id.toString();
    expect(a[0]!.bookingId.toString()).toBe(await booking(first.bookingId));
    expect(b[0]!.bookingId.toString()).toBe(await booking(second.bookingId));
  });

  it('a third rider waits for a free driver instead of being offered to one who already has an offer', async () => {
    const near = await createDriver(env, world, { at: NEAR_CP });
    await requestRide(env, world, await loginAs(env, nextPhone(), 'CUSTOMER'));
    const waiting = await requestRide(env, world, await loginAs(env, nextPhone(), 'CUSTOMER'));
    await env.sweep();
    expect(await pendingFor(near.driverId)).toHaveLength(1);
    const booking = (await Booking.findOne({ publicId: waiting.bookingId }))!;
    expect(await RideOffer.countDocuments({ bookingId: booking._id })).toBe(0); // no offer wasted
    expect(booking.status).toBe('DISPATCHING'); // still searching, not given up
  });

  it('taking a ride closes the driver’s other open offers at once', async () => {
    const driver = await createDriver(env, world, { at: NEAR_CP });
    await requestRide(env, world, await loginAs(env, nextPhone(), 'CUSTOMER'));
    const other = await requestRide(env, world, await loginAs(env, nextPhone(), 'CUSTOMER'));
    // A race can still leave a driver with two offers; simulate it.
    const otherBooking = (await Booking.findOne({ publicId: other.bookingId }))!;
    await RideOffer.create({
      publicId: 'ofr_0a0a0a0a0a01',
      bookingId: otherBooking._id,
      driverId: driver.driverId,
      vehicleId: driver.vehicleId,
      round: 1,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 20_000),
      rank: 1,
    });
    expect(await pendingFor(driver.driverId)).toHaveLength(2);

    const offer = (await currentOffer(env, driver))!;
    const res = await acceptOffer(env, driver, offer.offerId);
    expect(res.status).toBe(200);
    expect(await pendingFor(driver.driverId)).toHaveLength(0);
    expect(await RideOffer.findOne({ publicId: 'ofr_0a0a0a0a0a01' })).toMatchObject({
      status: 'WITHDRAWN',
    });
  });
});
