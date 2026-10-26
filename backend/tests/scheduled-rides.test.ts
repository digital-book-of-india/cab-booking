import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/auditLog.model';
import { Booking } from '../src/modules/bookings/booking.model';
import { BookingEvent } from '../src/modules/bookings/bookingEvent.model';
import type { ScheduledService } from '../src/modules/bookings/scheduled.service';
import { RideOffer } from '../src/modules/dispatch/rideOffer.model';
import type { MonitorService } from '../src/modules/monitoring/monitor.service';
import { Notification } from '../src/modules/notifications/notification.model';
import { ServiceZone } from '../src/modules/zones/serviceZone.model';
import {
  CP,
  IGI,
  NEAR_CP,
  acceptOffer,
  createDriver,
  currentOffer,
  loginAs,
  loginAsAdmin,
  nextPhone,
  rideCall,
  seedWorld,
  startRide,
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
const jobs = () => (env.app.locals['services'] as { scheduled: ScheduledService }).scheduled;
const HOUR = 3_600_000;
const MIN = 60_000;
let keyN = 0;
const idem = () => `k-${Date.now()}-${++keyN}`;
const at = (msFromNow: number) => new Date(Date.now() + msFromNow);

const quoteFor = (who: Session, scheduledFor?: Date, extra: object = {}) =>
  api()
    .post('/api/v1/fare-quotes')
    .set(who.auth)
    .send({
      pickup: CP,
      drop: IGI,
      categoryId: world.cats['MINI'],
      ...(scheduledFor ? { scheduledFor: scheduledFor.toISOString() } : {}),
      ...extra,
    });

/** Quote and book a ride for later. */
async function schedule(who: Session, when: Date, body: object = {}, key = idem()) {
  const q = await quoteFor(who, when);
  expect(q.status, JSON.stringify(q.body)).toBe(201);
  return api()
    .post('/api/v1/bookings')
    .set(who.auth)
    .set('Idempotency-Key', key)
    .send({
      quoteId: q.body.data.quoteId,
      paymentMethod: 'CASH',
      rideType: 'SCHEDULED',
      scheduledFor: when.toISOString(),
      ...body,
    });
}
const statusOf = async (bookingId: string) =>
  (await Booking.findOne({ publicId: bookingId }))!.status;
/** The driver's position is only "fresh" if it is reported after the clock moves. */
async function ping() {
  await api().post('/api/v1/drivers/me/location').set(driver.auth).send(NEAR_CP);
}

describe('booking a ride for later', () => {
  it('waits as SCHEDULED, is not offered to anyone, and shows the time', async () => {
    const when = at(3 * HOUR);
    const q = await quoteFor(rider, when);
    expect(q.body.data.scheduledFor).toBe(when.toISOString());
    const res = await schedule(rider, when);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'SCHEDULED',
      rideType: 'SCHEDULED',
      scheduledFor: when.toISOString(),
    });
    await env.sweep(); // the dispatch sweeper leaves it alone
    expect(await statusOf(res.body.data.bookingId)).toBe('SCHEDULED');
    expect(await RideOffer.countDocuments({})).toBe(0);
    expect(await currentOffer(env, driver)).toBeNull();

    // The same request again returns the same booking.
    const key = idem();
    const first = await schedule(rider, at(4 * HOUR), {}, key);
    const again = await api()
      .post('/api/v1/bookings')
      .set(rider.auth)
      .set('Idempotency-Key', key)
      .send({
        quoteId: first.body.data.quoteId,
        paymentMethod: 'CASH',
        rideType: 'SCHEDULED',
        scheduledFor: first.body.data.scheduledFor,
      });
    expect(again.status).toBe(200);
    expect(again.body.data.bookingId).toBe(first.body.data.bookingId);
  });

  it('refuses times that are too soon or too far, and a quote and booking that disagree', async () => {
    for (const bad of [at(10 * MIN), at(8 * 24 * HOUR), at(-HOUR)]) {
      const res = await quoteFor(rider, bad);
      expect(res.status).toBe(422);
      expect(res.body.error.fieldErrors[0].field).toBe('scheduledFor');
    }
    const when = at(3 * HOUR);
    const later = await quoteFor(rider, when);
    const instant = await api()
      .post('/api/v1/bookings')
      .set(rider.auth)
      .set('Idempotency-Key', idem())
      .send({
        quoteId: later.body.data.quoteId,
        paymentMethod: 'CASH',
      });
    expect(instant.body.error.code).toBe('QUOTE_MISMATCH'); // a quote for later cannot book a ride now
    const other = await quoteFor(rider, when);
    const wrongTime = await api()
      .post('/api/v1/bookings')
      .set(rider.auth)
      .set('Idempotency-Key', idem())
      .send({
        quoteId: other.body.data.quoteId,
        paymentMethod: 'CASH',
        rideType: 'SCHEDULED',
        scheduledFor: at(5 * HOUR).toISOString(),
      });
    expect(wrongTime.body.error.code).toBe('QUOTE_MISMATCH');
    const now = await quoteFor(rider);
    const asLater = await api()
      .post('/api/v1/bookings')
      .set(rider.auth)
      .set('Idempotency-Key', idem())
      .send({
        quoteId: now.body.data.quoteId,
        paymentMethod: 'CASH',
        rideType: 'SCHEDULED',
        scheduledFor: when.toISOString(),
      });
    expect(asLater.body.error.code).toBe('QUOTE_MISMATCH');
  });

  it('checks the zone is open at pickup time, not now', async () => {
    await ServiceZone.updateOne(
      { code: 'DELHI_NCR' },
      { operatingHours: { start: '06:00', end: '22:00' } },
    );
    const base = new Date(Date.now() + 2 * 24 * HOUR);
    const threeAmIst = new Date(
      Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 21, 30),
    );
    const tenAmIst = new Date(
      Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 4, 30),
    );
    const closed = await quoteFor(rider, threeAmIst);
    expect(closed.status).toBe(422);
    expect(closed.body.error.code).toBe('NOT_SERVICEABLE');
    expect((await quoteFor(rider, tenAmIst)).status).toBe(201);
  });

  it('limits how many rides a rider can have waiting', async () => {
    for (let i = 0; i < 5; i += 1)
      expect((await schedule(rider, at((3 + i) * HOUR))).status).toBe(201);
    const sixth = await schedule(rider, at(9 * HOUR));
    expect(sixth.status).toBe(422);
    expect(sixth.body.error.message).toMatch(/at most 5/);
    const someoneElse = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await schedule(someoneElse, at(3 * HOUR))).status).toBe(201);
  });
});

describe('when the search starts', () => {
  it('begins about 20 minutes before pickup, not before, and the ride then runs like any other', async () => {
    const when = at(3 * HOUR);
    const { body } = await schedule(rider, when);
    const id = body.data.bookingId as string;

    env.setNow(new Date(when.getTime() - 40 * MIN));
    await ping();
    expect(await jobs().run()).toMatchObject({ activated: 0 });
    expect(await statusOf(id)).toBe('SCHEDULED');

    env.setNow(new Date(when.getTime() - 19 * MIN));
    await ping();
    expect(await jobs().run()).toMatchObject({ activated: 1 });
    expect(await statusOf(id)).toBe('DISPATCHING');
    expect(await jobs().run()).toMatchObject({ activated: 0 }); // not twice
    expect(await Notification.countDocuments({ type: 'booking.searching' })).toBe(1);
    expect((await Booking.findOne({ publicId: id }))!.requestedAt.getTime()).toBeGreaterThan(
      Date.now(),
    ); // counts from now on
    expect(await BookingEvent.countDocuments({ type: 'SCHEDULE_ACTIVATED' })).toBe(1);

    // The driver sees when it is for, and the rest of the ride works as usual.
    await env.sweep();
    const offer = (await currentOffer(env, driver))!;
    const listed = (await api().get('/api/v1/drivers/me/offers').set(driver.auth)).body.data[0];
    expect(listed.scheduledFor).toBe(when.toISOString());
    const accepted = await acceptOffer(env, driver, offer.offerId);
    expect(accepted.status).toBe(200);
    await startRide(env, rider, driver, accepted.body.data.rideId);
    const done = await rideCall(env, driver, accepted.body.data.rideId, 'complete');
    expect(done.status).toBe(200);
    expect(await statusOf(id)).toBe('COMPLETED');
    env.setNow(null);
  });

  it('only one server instance starts a given ride when two run the job together', async () => {
    const when = at(3 * HOUR);
    const { body } = await schedule(rider, when);
    env.setNow(new Date(when.getTime() - 10 * MIN));
    await ping();
    const [a, b] = await Promise.all([jobs().run(), jobs().run()]);
    expect(a.activated + b.activated).toBe(1);
    expect(await BookingEvent.countDocuments({ type: 'SCHEDULE_ACTIVATED' })).toBe(1);
    expect(
      await RideOffer.countDocuments({
        bookingId: (await Booking.findOne({ publicId: body.data.bookingId }))!._id,
      }),
    ).toBeLessThanOrEqual(1);
    env.setNow(null);
  });
});

describe('reminders', () => {
  it('sends one reminder about an hour ahead, and none for a ride booked too close to it', async () => {
    const far = at(3 * HOUR);
    await schedule(rider, far);
    const near = at(45 * MIN); // booked less than an hour ahead
    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    await schedule(other, near);

    env.setNow(new Date(far.getTime() - 55 * MIN));
    expect(await jobs().run()).toMatchObject({ reminded: 1 });
    expect(await jobs().run()).toMatchObject({ reminded: 0 });
    expect(await Notification.countDocuments({ type: 'booking.reminder' })).toBe(1);
    env.setNow(null);
  });
});

describe('changing your mind', () => {
  it('cancelling is free and ends the ride', async () => {
    const { body } = await schedule(rider, at(3 * HOUR));
    const id = body.data.bookingId as string;
    const preview = (await api().get(`/api/v1/bookings/${id}/cancel-preview`).set(rider.auth)).body
      .data;
    expect(preview).toMatchObject({ canCancel: true, feePaise: 0 });
    const res = await api()
      .post(`/api/v1/bookings/${id}/cancel`)
      .set(rider.auth)
      .send({ reasonCode: 'CHANGED_MIND' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'CANCELLED', fee: null });
    await jobs().run();
    expect(await statusOf(id)).toBe('CANCELLED');
  });

  it('can be moved to another time while it is still waiting, not after the search starts', async () => {
    const when = at(3 * HOUR);
    const id = (await schedule(rider, when)).body.data.bookingId as string;
    const move = (who: Session, to: Date) =>
      api()
        .patch(`/api/v1/bookings/${id}/schedule`)
        .set(who.auth)
        .send({ scheduledFor: to.toISOString() });

    const later = at(5 * HOUR);
    const moved = await move(rider, later);
    expect(moved.status).toBe(200);
    expect(moved.body.data.scheduledFor).toBe(later.toISOString());
    expect(await BookingEvent.countDocuments({ type: 'RESCHEDULED' })).toBe(1);
    expect((await move(rider, at(5 * MIN))).status).toBe(422);
    expect((await move(rider, at(9 * 24 * HOUR))).status).toBe(422);
    const stranger = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await move(stranger, later)).status).toBe(404);

    env.setNow(new Date(later.getTime() - 10 * MIN));
    await ping();
    await jobs().run();
    const tooLate = await move(rider, at(6 * HOUR));
    expect(tooLate.status).toBe(409);
    expect(tooLate.body.error.code).toBe('RIDE_INVALID_STATE');
    env.setNow(null);
  });
});

describe('a ride nobody started', () => {
  it('is cancelled by the system long after its time, and the rider is told and not charged', async () => {
    const when = at(3 * HOUR);
    const id = (await schedule(rider, when)).body.data.bookingId as string;
    env.setNow(new Date(when.getTime() + 31 * MIN));
    expect(await jobs().run()).toMatchObject({ missed: 1, activated: 0 });
    const b = (await Booking.findOne({ publicId: id }))!;
    expect(b.status).toBe('CANCELLED');
    expect(b.cancellation).toMatchObject({ actor: 'SYSTEM', reasonCode: 'SCHEDULE_MISSED' });
    expect(b.fee).toBeUndefined();
    expect(await Notification.countDocuments({ type: 'booking.schedule_missed' })).toBe(1);
    env.setNow(null);
  });

  it('is noticed by the monitor while it is overdue', async () => {
    const when = at(3 * HOUR);
    await schedule(rider, when);
    const monitor = (env.app.locals['services'] as { monitor: MonitorService }).monitor;
    const overdue = async () =>
      (await monitor.checks()).find((c) => c.name === 'scheduled_rides_overdue')!;
    expect((await overdue()).ok).toBe(true);
    env.setNow(new Date(when.getTime() + 11 * MIN)); // the job has not run
    expect((await overdue()).ok).toBe(false);
    await jobs().run(); // activated late (within the grace time)
    expect((await overdue()).ok).toBe(true);
    env.setNow(null);
  });
});

describe('the rider list of bookings', () => {
  it('shows only their own, waiting rides soonest first, and pages', async () => {
    const soon = at(3 * HOUR);
    const later = at(6 * HOUR);
    await schedule(rider, later);
    await schedule(rider, soon);
    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    await schedule(other, at(4 * HOUR));

    const waiting = await api().get('/api/v1/bookings?status=SCHEDULED').set(rider.auth);
    expect(waiting.status).toBe(200);
    expect(waiting.body.data.map((b: { scheduledFor: string }) => b.scheduledFor)).toEqual([
      soon.toISOString(),
      later.toISOString(),
    ]);
    expect(waiting.body.meta.total).toBe(2);
    const all = await api().get('/api/v1/bookings?limit=1').set(rider.auth);
    expect(all.body.data).toHaveLength(1);
    expect(all.body.meta.total).toBe(2);
    expect((await api().get('/api/v1/bookings?status=NOPE').set(rider.auth)).status).toBe(400);
    expect((await api().get('/api/v1/bookings').set(driver.auth)).status).toBe(403);
    expect((await api().get('/api/v1/bookings').set(other.auth)).body.meta.total).toBe(1);
  });
});

describe('searching for a driver before pickup', () => {
  it('keeps looking until pickup time instead of giving up after a minute, and uses a driver who comes online', async () => {
    const when = at(3 * HOUR);
    const id = (await schedule(rider, when)).body.data.bookingId as string;

    // The search starts 19 minutes ahead; the driver position is stale, so nobody is found yet.
    env.setNow(new Date(when.getTime() - 19 * MIN));
    await jobs().run();
    await env.sweep();
    expect(await statusOf(id)).toBe('DISPATCHING');
    env.setNow(new Date(when.getTime() - 17 * MIN)); // an instant ride would have given up by now
    await env.sweep();
    expect(await statusOf(id)).toBe('DISPATCHING');

    // A driver comes online a little later and is offered the ride.
    env.setNow(new Date(when.getTime() - 5 * MIN));
    await ping();
    await env.sweep();
    expect(await currentOffer(env, driver)).not.toBeNull();
    env.setNow(null);
  });

  it('gives up only after pickup time has passed by the grace time', async () => {
    const when = at(3 * HOUR);
    const id = (await schedule(rider, when)).body.data.bookingId as string;
    env.setNow(new Date(when.getTime() - 19 * MIN));
    await jobs().run();
    env.setNow(new Date(when.getTime() + 5 * MIN));
    await env.sweep();
    expect(await statusOf(id)).toBe('DISPATCHING');
    env.setNow(new Date(when.getTime() + 11 * MIN));
    await env.sweep();
    expect(await statusOf(id)).toBe('NO_DRIVER_FOUND');
    // The rider is told in words that fit a scheduled ride.
    const note = (await Notification.findOne({ type: 'booking.no_driver' }))!;
    expect(note.title).toBe('We could not find a driver');
    expect(note.body).toMatch(/scheduled for .*not charged/);
    env.setNow(null);
  });
});

describe('two rides at the same time', () => {
  it('are refused when within 30 minutes of each other, for booking and for moving', async () => {
    const base = at(5 * HOUR);
    const first = await schedule(rider, base);
    expect(first.status).toBe(201);
    const clash = await schedule(rider, new Date(base.getTime() + 20 * MIN));
    expect(clash.status).toBe(422);
    expect(clash.body.error.fieldErrors[0].message).toMatch(/within 30 minutes/);
    const fine = await schedule(rider, new Date(base.getTime() + 45 * MIN));
    expect(fine.status).toBe(201);

    const id2 = fine.body.data.bookingId as string;
    const move = (to: Date) =>
      api()
        .patch(`/api/v1/bookings/${id2}/schedule`)
        .set(rider.auth)
        .send({ scheduledFor: to.toISOString() });
    expect((await move(new Date(base.getTime() + 10 * MIN))).status).toBe(422);
    expect((await move(new Date(base.getTime() + 50 * MIN))).status).toBe(200); // near its own old time is fine
    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await schedule(other, base)).status).toBe(201); // someone else is not affected
  });
});

describe('staff and waiting rides', () => {
  const staffPost = (who: Session, id: string, action: string, body: object = {}) =>
    api().post(`/api/v1/admin/bookings/${id}/scheduled/${action}`).set(who.auth).send(body);

  it('support can cancel for the rider, free, with the rider told and the action recorded', async () => {
    const support = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    const id = (await schedule(rider, at(3 * HOUR))).body.data.bookingId as string;
    expect((await staffPost(support, id, 'cancel', { reason: 'x' })).status).toBe(400);
    const res = await staffPost(support, id, 'cancel', { reason: 'Rider asked us by phone' });
    expect(res.status).toBe(200);
    const b = (await Booking.findOne({ publicId: id }))!;
    expect(b.status).toBe('CANCELLED');
    expect(b.cancellation).toMatchObject({ actor: 'ADMIN', reasonCode: 'STAFF' });
    expect(b.fee).toBeUndefined();
    expect(await Notification.countDocuments({ type: 'booking.cancelled_by_staff' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'booking.scheduled.cancel' })).toBe(1);
    expect((await staffPost(support, id, 'cancel', { reason: 'again please' })).status).toBe(409);
  });

  it('operations can start the search now; once started it cannot be started or cancelled this way', async () => {
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const support = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    const id = (await schedule(rider, at(3 * HOUR))).body.data.bookingId as string;
    expect((await staffPost(support, id, 'start-now')).status).toBe(403);
    const res = await staffPost(ops, id, 'start-now');
    expect(res.status).toBe(200);
    expect(await statusOf(id)).toBe('DISPATCHING');
    expect(await AuditLog.countDocuments({ action: 'booking.scheduled.start_now' })).toBe(1);
    expect((await staffPost(ops, id, 'start-now')).status).toBe(409);
    expect((await staffPost(support, id, 'cancel', { reason: 'too late now' })).status).toBe(409);
    expect((await staffPost(ops, 'bk_000000000000', 'start-now')).status).toBe(404);
    expect((await staffPost(rider, id, 'start-now')).status).toBe(403);
  });
});
