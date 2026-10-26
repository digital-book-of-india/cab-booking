import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { Booking } from '../src/modules/bookings/booking.model';
import { Refund } from '../src/modules/payments/refund.model';
import { AuditLog } from '../src/modules/audit/auditLog.model';
import { Notification } from '../src/modules/notifications/notification.model';
import {
  NEAR_CP,
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
afterAll(() => env?.stop());
beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
  rider = await loginAs(env, nextPhone(), 'CUSTOMER');
});

const api = () => request(env.app);
const open = (who: Session, body: Record<string, unknown> = {}) =>
  api()
    .post('/api/v1/support/tickets')
    .set(who.auth)
    .send({
      category: 'FARE_DISPUTE',
      subject: 'Charged more than quoted',
      message: 'The fare was higher than the estimate.',
      ...body,
    });

describe('support tickets: the user side', () => {
  it('opens a ticket, lists it, replies, and closes it; others cannot see it', async () => {
    const t = await open(rider);
    expect(t.status).toBe(201);
    expect(t.body.data).toMatchObject({
      status: 'OPEN',
      priority: 'NORMAL',
      category: 'FARE_DISPUTE',
    });
    const id = t.body.data.ticketId as string;

    expect((await api().get('/api/v1/support/tickets').set(rider.auth)).body.data).toHaveLength(1);
    const reply = await api()
      .post(`/api/v1/support/tickets/${id}/messages`)
      .set(rider.auth)
      .send({ text: 'Here is more detail.' });
    expect(reply.body.data.messages).toHaveLength(2);

    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await api().get(`/api/v1/support/tickets/${id}`).set(other.auth)).status).toBe(404);
    expect((await api().get('/api/v1/support/tickets').set(other.auth)).body.data).toHaveLength(0);

    expect((await api().post(`/api/v1/support/tickets/${id}/close`).set(rider.auth)).status).toBe(
      200,
    );
    expect((await api().post(`/api/v1/support/tickets/${id}/close`).set(rider.auth)).status).toBe(
      409,
    );
    const late = await api()
      .post(`/api/v1/support/tickets/${id}/messages`)
      .set(rider.auth)
      .send({ text: 'hello again' });
    expect(late.status).toBe(409);
  });

  it('only lets you attach a ride you were part of; a safety concern is high priority', async () => {
    const driver = await createDriver(env, world, { at: NEAR_CP });
    const { booking } = await completedRide(env, world, rider, driver);
    const own = await open(rider, { bookingId: booking.bookingId });
    expect(own.body.data.bookingId).toBe(booking.bookingId);
    // The driver of that ride may also raise a ticket about it; a stranger may not.
    const byDriver = await open(driver, {
      bookingId: booking.bookingId,
      category: 'RIDER_BEHAVIOUR',
    });
    expect(byDriver.status).toBe(201);
    const stranger = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await open(stranger, { bookingId: booking.bookingId })).status).toBe(404);
    expect((await open(rider, { category: 'SAFETY_CONCERN' })).body.data.priority).toBe('HIGH');
  });

  it('validates input, caps open tickets, and can be switched off', async () => {
    expect((await open(rider, { category: 'WHATEVER' })).status).toBe(400);
    expect((await open(rider, { subject: 'a' })).status).toBe(400);
    expect((await open(rider, { extra: 1 })).status).toBe(400);
    for (let i = 0; i < 10; i += 1) expect((await open(rider)).status).toBe(201);
    expect((await open(rider)).status).toBe(422);

    const config = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    await api()
      .put('/api/v1/admin/feature-flags/SUPPORT_TICKETS')
      .set(config.auth)
      .send({ enabled: false });
    const off = await open(await loginAs(env, nextPhone(), 'CUSTOMER'));
    expect(off.body.error.code).toBe('FEATURE_DISABLED');
  });
});

describe('support tickets: the desk', () => {
  const staffPost = (who: Session, path: string, body: object) =>
    api().post(`/api/v1/admin/support/tickets/${path}`).set(who.auth).send(body);

  it('assigns, replies, keeps internal notes private, resolves, and audits', async () => {
    const agent = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    const id = (await open(rider)).body.data.ticketId as string;

    const queue = await api().get('/api/v1/admin/support/tickets?unassigned=true').set(agent.auth);
    expect(queue.body.data).toHaveLength(1);
    expect(queue.body.data[0].messages).toBeUndefined();

    const assigned = await staffPost(agent, `${id}/assign`, {});
    expect(assigned.body.data.assignedTo).toBe(agent.userId);
    const mineQueue = await api()
      .get('/api/v1/admin/support/tickets?assignedTo=me')
      .set(agent.auth);
    expect(mineQueue.body.data).toHaveLength(1);
    // A rider cannot be an assignee.
    expect((await staffPost(agent, `${id}/assign`, { assigneeId: rider.userId })).status).toBe(422);

    await staffPost(agent, `${id}/messages`, { text: 'Checking the meter log', internal: true });
    const answer = await staffPost(agent, `${id}/messages`, { text: 'We are looking into it.' });
    expect(answer.body.data.firstResponseAt).toBeTruthy();

    // The rider sees only the public reply, never the internal note.
    const seen = (await api().get(`/api/v1/support/tickets/${id}`).set(rider.auth)).body.data;
    expect(seen.messages.map((m: { text: string }) => m.text)).toEqual([
      'The fare was higher than the estimate.',
      'We are looking into it.',
    ]);
    expect(JSON.stringify(seen)).not.toContain('meter log');
    expect(await Notification.countDocuments({ type: 'support.update' })).toBeGreaterThan(0);

    const patch = (body: object) =>
      api().patch(`/api/v1/admin/support/tickets/${id}`).set(agent.auth).send(body);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ priority: 'HIGH' })).body.data.priority).toBe('HIGH');

    expect(
      (await staffPost(agent, `${id}/resolve`, { outcome: 'MAGIC', note: 'done' })).status,
    ).toBe(400);
    const done = await staffPost(agent, `${id}/resolve`, {
      outcome: 'WARNING_ISSUED',
      note: 'We have warned the driver.',
    });
    expect(done.body.data).toMatchObject({ status: 'RESOLVED', outcome: 'WARNING_ISSUED' });
    expect(
      (await staffPost(agent, `${id}/resolve`, { outcome: 'NO_ACTION', note: 'again' })).status,
    ).toBe(409);
    expect(await AuditLog.countDocuments({ action: /^support\./ })).toBeGreaterThanOrEqual(3);

    // The rider writing back to a resolved ticket reopens it.
    const back = await api()
      .post(`/api/v1/support/tickets/${id}/messages`)
      .set(rider.auth)
      .send({ text: 'Still wrong' });
    expect(back.body.data.status).toBe('OPEN');
  });

  it('flags a ticket nobody answered for a day as overdue; support staff only', async () => {
    const agent = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    const id = (await open(rider)).body.data.ticketId as string;
    const overdue = async () =>
      (await api().get(`/api/v1/admin/support/tickets/${id}`).set(agent.auth)).body.data.overdue;
    expect(await overdue()).toBe(false);
    env.setNow(new Date(Date.now() + 25 * 3_600_000));
    expect(await overdue()).toBe(true);
    env.setNow(null);

    const finance = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    for (const who of [finance, rider]) {
      expect((await api().get('/api/v1/admin/support/tickets').set(who.auth)).status).toBe(403);
    }
  });
});

describe('resolving a ticket as refunded or fee waived', () => {
  const resolve = (who: Session, id: string, outcome: string) =>
    api()
      .post(`/api/v1/admin/support/tickets/${id}/resolve`)
      .set(who.auth)
      .send({ outcome, note: 'Sorted out for you.' });

  it('is refused until the refund / waiver really exists', async () => {
    const agent = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    const driver = await createDriver(env, world, { at: NEAR_CP });
    const { booking } = await completedRide(env, world, rider, driver);
    const doc = (await Booking.findOne({ publicId: booking.bookingId }))!;
    const id = (await open(rider, { bookingId: booking.bookingId })).body.data.ticketId as string;

    const noRefund = await resolve(agent, id, 'REFUNDED');
    expect(noRefund.status).toBe(422);
    expect(noRefund.body.error.fieldErrors[0].message).toMatch(/Refund the payment first/);
    const noWaiver = await resolve(agent, id, 'FEE_WAIVED');
    expect(noWaiver.status).toBe(422);
    expect(noWaiver.body.error.fieldErrors[0].message).toMatch(/Waive the fee first/);
    // Still open: nothing was changed by the refused attempts.
    expect(
      (await api().get(`/api/v1/admin/support/tickets/${id}`).set(agent.auth)).body.data.status,
    ).toBe('OPEN');

    await Refund.create({
      publicId: 'rfd_test00000001',
      paymentId: new mongoose.Types.ObjectId(),
      bookingId: doc._id,
      amountPaise: 1000,
      reason: 'Overcharged',
      idempotencyKey: 'refund-key-0001',
    });
    expect((await resolve(agent, id, 'REFUNDED')).body.data.status).toBe('RESOLVED');

    const id2 = (await open(rider, { bookingId: booking.bookingId })).body.data.ticketId as string;
    await Booking.updateOne(
      { _id: doc._id },
      { fee: { type: 'CANCELLATION', amountPaise: 3000, status: 'WAIVED', at: new Date() } },
    );
    expect((await resolve(agent, id2, 'FEE_WAIVED')).body.data.outcome).toBe('FEE_WAIVED');
  });

  it('needs a ticket that is about a ride', async () => {
    const agent = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    const id = (await open(rider)).body.data.ticketId as string;
    expect((await resolve(agent, id, 'REFUNDED')).status).toBe(422);
    expect((await resolve(agent, id, 'NO_ACTION')).status).toBe(200);
  });
});
