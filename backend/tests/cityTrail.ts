import { BookingEvent } from '../src/modules/bookings/bookingEvent.model';
import { Ride } from '../src/modules/rides/ride.model';
import { LocationPing } from '../src/modules/tracking/locationPing.model';
import { toPoint } from '../src/common/geo';
import {
  assignTo,
  createDriver,
  loginAs,
  nextPhone,
  requestRide,
  rideCall,
  seedWorld,
  startRide,
  type TestDriver,
  type TestEnv,
} from './helpers';

/** A trail that runs far longer than any city quote: ~2 km every minute, `count` times. */
async function longTrail(driver: TestDriver, rideId: string, count: number) {
  const ride = (await Ride.findOne({ publicId: rideId }).lean())!;
  for (let i = 1; i <= count; i++) {
    await LocationPing.create({
      bookingId: ride.bookingId,
      ridePublicId: rideId,
      driverId: driver.driverId,
      location: toPoint(28.6335 + i * 0.018, 77.2167),
      accuracyMeters: 10,
      recordedAt: new Date(ride.startedAt!.getTime() + i * 60_000),
      bookingStatus: 'IN_PROGRESS',
    });
  }
}

/** Runs one cash city ride whose server trail has `pings` points, and returns the final fare and any mismatch events. */
export async function rideWithTrail(env: TestEnv, pings: number) {
  await env.reset();
  const world = await seedWorld();
  const rider = await loginAs(env, nextPhone(), 'CUSTOMER');
  const driver = await createDriver(env, world);
  await requestRide(env, world, rider, { paymentMethod: 'CASH' });
  const rideId = await assignTo(env, driver);
  await startRide(env, rider, driver, rideId);
  if (pings > 0) await longTrail(driver, rideId, pings);
  const done = await rideCall(env, driver, rideId, 'complete');
  if (done.status !== 200) throw new Error(`complete failed: ${JSON.stringify(done.body)}`);
  const doc = (await Ride.findOne({ publicId: rideId }).lean())!;
  const events = await BookingEvent.find({
    bookingId: doc.bookingId,
    type: 'DISTANCE_MISMATCH',
  }).lean();
  return { fare: done.body.data.fare, total: done.body.data.finalFarePaise as number, events };
}
