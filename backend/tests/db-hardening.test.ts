import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mongoOptions } from '../src/config/db';
import { allModels } from '../src/db/models';
import { ensureIndexes } from '../src/db/ensureIndexes';
import { startDispatchSweeper } from '../src/jobs/dispatchSweeper';
import { Booking } from '../src/modules/bookings/booking.model';
import { BookingEvent } from '../src/modules/bookings/bookingEvent.model';
import { RideOffer } from '../src/modules/dispatch/rideOffer.model';
import { DriverDocument } from '../src/modules/drivers/driverDocument.model';
import { DriverProfile } from '../src/modules/drivers/driverProfile.model';
import { Ride } from '../src/modules/rides/ride.model';
import { User } from '../src/modules/users/user.model';
import { Vehicle } from '../src/modules/vehicles/vehicle.model';
import { createLogger } from '../src/common/logger';
import {
  assignTo,
  createDriver,
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
/** The test clock, moved forward from the real time the data was written at. */
const after = (ms: number) => env.setNow(new Date(Date.now() + ms));

describe('reconciler: orphaned driver locks', () => {
  it('leaves a healthy active ride alone, however old', async () => {
    const d = await createDriver(env, world);
    await requestRide(env, world, customer);
    await assignTo(env, d);
    after(3 * 3_600_000);
    const r = await env.reconcile();
    expect(r).toEqual({
      bookingsHealed: 0,
      bookingsRolledBack: 0,
      driversReleased: 0,
      driversSetOffline: 0,
    });
    const profile = await DriverProfile.findById(d.driverId).lean();
    expect(profile?.activeRideId).toBeTruthy();
    expect(profile?.onlineStatus).toBe('ONLINE'); // not stale: they are on a ride
  });

  it('frees a driver whose ride was cancelled but whose release never ran (crash)', async () => {
    const d = await createDriver(env, world);
    const booking = await requestRide(env, world, customer);
    await assignTo(env, d);
    // Crash simulation: the cancel reached the booking but not the driver.
    await Booking.updateOne({ publicId: booking.bookingId }, { status: 'CANCELLED' });

    after(5_000); // inside the grace period: could still be mid-request, so hands off
    expect((await env.reconcile()).driversReleased).toBe(0);
    expect((await DriverProfile.findById(d.driverId).lean())?.activeRideId).toBeTruthy();

    after(60_000);
    expect((await env.reconcile()).driversReleased).toBe(1);
    const profile = await DriverProfile.findById(d.driverId).lean();
    expect(profile?.activeRideId).toBeNull();
    expect(profile?.activeRideSince).toBeUndefined();
  });

  it('frees a driver locked by an accept that died before claiming the booking', async () => {
    const d = await createDriver(env, world);
    const booking = await requestRide(env, world, customer);
    const doc = await Booking.findOne({ publicId: booking.bookingId }).lean();
    // Crash simulation: step 2 (driver claimed) happened, step 3 (booking claimed) did not.
    await DriverProfile.updateOne(
      { _id: d.driverId },
      { activeRideId: doc!._id, activeRideSince: new Date() },
    );
    after(60_000);
    expect((await env.reconcile()).driversReleased).toBe(1);
    expect((await DriverProfile.findById(d.driverId).lean())?.activeRideId).toBeNull();
    // The booking itself is untouched and still searching.
    expect((await Booking.findById(doc!._id).lean())?.status).toBe('DISPATCHING');
  });

  it('never frees a lock the booking still backs, and tolerates running in parallel', async () => {
    const d = await createDriver(env, world);
    const booking = await requestRide(env, world, customer);
    await assignTo(env, d);
    await Booking.updateOne({ publicId: booking.bookingId }, { status: 'CANCELLED' });
    after(60_000);
    const results = await Promise.all([env.reconcile(), env.reconcile(), env.reconcile()]);
    expect(results.reduce((n, r) => n + r.driversReleased, 0)).toBe(1);
  });
});

describe('reconciler: assignments without a ride', () => {
  it('rolls back an assignment whose ride was never created, and frees the driver', async () => {
    const d = await createDriver(env, world);
    const booking = await requestRide(env, world, customer);
    const doc = await Booking.findOne({ publicId: booking.bookingId }).lean();
    // Crash simulation: steps 2 and 3 done, then the process died before Ride.create.
    const t = new Date();
    await DriverProfile.updateOne(
      { _id: d.driverId },
      { activeRideId: doc!._id, activeRideSince: t },
    );
    await Booking.updateOne(
      { _id: doc!._id },
      { status: 'DRIVER_ASSIGNED', assignedDriverId: d.driverId, assignedAt: t },
    );

    after(5_000);
    expect((await env.reconcile()).bookingsRolledBack).toBe(0); // too fresh

    after(60_000);
    const r = await env.reconcile();
    expect(r.bookingsRolledBack).toBe(1);
    expect(r.driversReleased).toBe(0); // already released as part of the rollback
    const after1 = await Booking.findById(doc!._id).lean();
    expect(after1?.status).toBe('DISPATCHING');
    expect(after1?.assignedDriverId).toBeNull();
    expect((await DriverProfile.findById(d.driverId).lean())?.activeRideId).toBeNull();
    const event = await BookingEvent.findOne({
      bookingId: doc!._id,
      type: 'ASSIGNMENT_ROLLED_BACK',
    });
    expect(event).toMatchObject({ fromStatus: 'DRIVER_ASSIGNED', toStatus: 'DISPATCHING' });
    expect(await Ride.countDocuments()).toBe(0);
  });

  it('links the ride id when the ride exists but the booking never got it', async () => {
    const d = await createDriver(env, world);
    const booking = await requestRide(env, world, customer);
    const rideId = await assignTo(env, d);
    // Crash simulation: Ride.create succeeded, the follow-up write of rideId did not.
    await Booking.updateOne({ publicId: booking.bookingId }, { $unset: { rideId: 1 } });

    after(60_000);
    const r = await env.reconcile();
    expect(r.bookingsHealed).toBe(1);
    expect(r.bookingsRolledBack).toBe(0);
    const doc = await Booking.findOne({ publicId: booking.bookingId }).lean();
    expect(doc?.rideId).toBe(rideId);
    expect(doc?.status).toBe('DRIVER_ASSIGNED');
    expect(await Ride.countDocuments()).toBe(1);
    expect((await DriverProfile.findById(d.driverId).lean())?.activeRideId).toBeTruthy();
  });
});

describe('reconciler: drivers who went silent', () => {
  it('sets a quiet ONLINE driver OFFLINE and withdraws their offer; keeps a fresh one', async () => {
    const quiet = await createDriver(env, world);
    const fresh = await createDriver(env, world);
    await requestRide(env, world, customer); // one of them holds a PENDING offer
    const later = new Date(Date.now() + 10 * 60_000);
    env.setNow(later);
    await DriverProfile.updateOne({ _id: fresh.driverId }, { locationUpdatedAt: later });

    const r = await env.reconcile();
    expect(r.driversSetOffline).toBe(1);
    const q = await DriverProfile.findById(quiet.driverId).lean();
    expect(q?.onlineStatus).toBe('OFFLINE');
    expect(q?.currentLocation).toBeUndefined(); // an offline driver must have no location
    expect((await DriverProfile.findById(fresh.driverId).lean())?.onlineStatus).toBe('ONLINE');
    expect(await RideOffer.countDocuments({ driverId: quiet.driverId, status: 'PENDING' })).toBe(0);
  });

  it('never sets a driver OFFLINE while they are on a ride', async () => {
    const d = await createDriver(env, world);
    await requestRide(env, world, customer);
    await assignTo(env, d);
    after(60 * 60_000);
    expect((await env.reconcile()).driversSetOffline).toBe(0);
    expect((await DriverProfile.findById(d.driverId).lean())?.onlineStatus).toBe('ONLINE');
  });

  it('the dashboard stops counting them as online', async () => {
    const admin = await loginAsAdmin(env, nextPhone(), 'OPS');
    await createDriver(env, world);
    const count = async () =>
      (await api().get('/api/v1/admin/dashboard').set(admin.auth)).body.data.drivers.onlineNow;
    expect(await count()).toBe(1);
    after(10 * 60_000);
    await env.reconcile();
    expect(await count()).toBe(0);
  });
});

describe('background job wiring', () => {
  it('runs the fast sweep and the slow reconcile on their own timers, and stops', async () => {
    const dispatch = { sweep: vi.fn(async () => {}), reconcile: vi.fn(async () => ({})) };
    const job = startDispatchSweeper(dispatch as never, createLogger('silent'), {
      sweepMs: 10,
      reconcileMs: 25,
    });
    await new Promise((r) => setTimeout(r, 130));
    job.stop();
    expect(dispatch.sweep.mock.calls.length).toBeGreaterThan(dispatch.reconcile.mock.calls.length);
    expect(dispatch.reconcile).toHaveBeenCalled();
    const sweeps = dispatch.sweep.mock.calls.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(dispatch.sweep.mock.calls.length).toBe(sweeps);
  });

  it('a failing pass is logged and the job keeps running', async () => {
    let calls = 0;
    const dispatch = {
      sweep: vi.fn(async () => {
        calls += 1;
        throw new Error('db blip');
      }),
      reconcile: vi.fn(async () => ({})),
    };
    const job = startDispatchSweeper(dispatch as never, createLogger('silent'), { sweepMs: 10 });
    await new Promise((r) => setTimeout(r, 80));
    job.stop();
    expect(calls).toBeGreaterThan(1);
  });
});

describe('index management', () => {
  it('registers every model in the app', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.models?\.ts$/.test(name)) files.push(full);
      }
    };
    walk(join(__dirname, '..', 'src', 'modules'));
    // A file may declare several models (safety, coupons), so count the declarations.
    const declared = files.reduce(
      (n, f) => n + (readFileSync(f, 'utf8').match(/=\s*model(<[^>]*>)?\(\s*'/g)?.length ?? 0),
      0,
    );
    expect(allModels.length).toBe(declared);
  });

  it('recreates a dropped index without touching anything else', async () => {
    await Booking.collection.dropIndex('requestedAt_-1');
    const before = (await Booking.collection.indexes()).map((i) => i.name);
    expect(before).not.toContain('requestedAt_-1');
    const report = await ensureIndexes([Booking]);
    expect(report[0]!.indexes).toContain('requestedAt_-1');
    expect(report[0]!.indexes).toContain('publicId_1');
  });

  it('only drops unknown indexes when asked to prune', async () => {
    await User.collection.createIndex({ name: 1, phone: 1 }, { name: 'stray_idx' });
    expect((await ensureIndexes([User]))[0]!.indexes).toContain('stray_idx');
    const pruned = await ensureIndexes([User], { prune: true });
    expect(pruned[0]!.indexes).not.toContain('stray_idx');
    expect(pruned[0]!.indexes).toContain('phone_1');
    expect(pruned[0]!.indexes).toContain('role_1_createdAt_-1');
  });
});

describe('queries use an index, not a full scan', () => {
  const plan = async (q: { explain: (v: 'queryPlanner') => Promise<unknown> }) => {
    const text = JSON.stringify(await q.explain('queryPlanner'));
    return { ixscan: text.includes('IXSCAN'), collscan: text.includes('COLLSCAN') };
  };
  const expectIndexed = async (q: { explain: (v: 'queryPlanner') => Promise<unknown> }) => {
    expect(await plan(q)).toEqual({ ixscan: true, collscan: false });
  };

  it('admin user search', async () => {
    await expectIndexed(User.find({ role: 'CUSTOMER' }).sort({ createdAt: -1 }));
    await expectIndexed(User.find({ accountStatus: 'SUSPENDED' }).sort({ createdAt: -1 }));
  });

  it('admin booking list, dispatch sweeper and payment filters', async () => {
    await expectIndexed(Booking.find({}).sort({ requestedAt: -1 }));
    await expectIndexed(Booking.find({ status: 'REQUESTED', requestedAt: { $lte: new Date() } }));
    await expectIndexed(Booking.find({ status: 'DISPATCHING' }));
    await expectIndexed(Booking.find({ paymentStatus: 'DUE' }).sort({ requestedAt: -1 }));
  });

  it('review queues and dashboard counters', async () => {
    await expectIndexed(DriverDocument.find({ status: 'PENDING' }).sort({ createdAt: 1 }));
    await expectIndexed(Vehicle.find({ verificationStatus: 'PENDING' }).sort({ createdAt: 1 }));
    await expectIndexed(DriverProfile.find({ approvalStatus: 'PENDING' }).sort({ createdAt: -1 }));
  });

  it('reconciler queries', async () => {
    await expectIndexed(
      DriverProfile.find({ onlineStatus: 'ONLINE', locationUpdatedAt: { $lt: new Date() } }),
    );
    await expectIndexed(DriverProfile.find({ activeRideId: { $type: 'objectId' } }));
    await expectIndexed(Booking.find({ status: 'DRIVER_ASSIGNED', rideId: null }));
  });

  it('ride history for both sides', async () => {
    const id = '507f1f77bcf86cd799439011';
    await expectIndexed(Ride.find({ customerId: id }).sort({ createdAt: -1 }));
    await expectIndexed(Ride.find({ driverId: id }).sort({ createdAt: -1 }));
  });
});

describe('connection settings', () => {
  it('waits for a majority of replicas and the journal', () => {
    const o = mongoOptions({ NODE_ENV: 'staging', MONGO_MAX_POOL_SIZE: 20 });
    expect(o).toMatchObject({ w: 'majority', journal: true, retryWrites: true, maxPoolSize: 20 });
  });

  it('builds indexes automatically everywhere except production', () => {
    for (const NODE_ENV of ['development', 'test', 'staging'] as const) {
      expect(mongoOptions({ NODE_ENV, MONGO_MAX_POOL_SIZE: 20 }).autoIndex).toBe(true);
    }
    expect(mongoOptions({ NODE_ENV: 'production', MONGO_MAX_POOL_SIZE: 20 }).autoIndex).toBe(false);
  });
});
