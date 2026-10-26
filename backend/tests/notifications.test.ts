import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Device } from '../src/modules/notifications/device.model';
import { Notification } from '../src/modules/notifications/notification.model';
import type { NotificationsService } from '../src/modules/notifications/notifications.service';
import {
  assignTo,
  createDriver,
  loginAs,
  nextPhone,
  requestRide,
  rideCall,
  seedWorld,
  startRide,
  startTestEnv,
  type Session,
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
  env.failPush.clear();
  env.pushed.length = 0;
  world = await seedWorld();
});

const api = () => request(env.app);
const services = () => env.app.locals['services'] as { notifications: NotificationsService };
let tokenCounter = 0;
const newToken = (label = 'dev') =>
  `${label}-token-${String(++tokenCounter).padStart(6, '0')}-xxxxxxxxxxxx`;
const register = (who: Session, token: string, extra: object = {}) =>
  api()
    .post('/api/v1/devices')
    .set(who.auth)
    .send({ token, platform: 'android', appVersion: '1.0.0', ...extra });

describe('registering a phone for push', () => {
  it('registers, and registering the same token again changes nothing', async () => {
    const c = await loginAs(env, nextPhone(), 'CUSTOMER');
    const token = newToken();
    const first = await register(c, token, { deviceId: 'phone-1' });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ platform: 'android' });
    const again = await register(c, token, { deviceId: 'phone-1' });
    expect(again.body.data.id).toBe(first.body.data.id);
    expect(await Device.countDocuments()).toBe(1);
  });

  it('a phone that signs in as someone else takes its token with it', async () => {
    const a = await loginAs(env, nextPhone(), 'CUSTOMER');
    const b = await loginAs(env, nextPhone(), 'DRIVER');
    const token = newToken();
    await register(a, token);
    await register(b, token);
    const devices = await Device.find().lean();
    expect(devices).toHaveLength(1);
    expect(devices[0]!.userId.toString()).toBe(b.userId);
  });

  it('a rotated token replaces the old one for the same install', async () => {
    const c = await loginAs(env, nextPhone(), 'CUSTOMER');
    const old = newToken();
    const rotated = newToken();
    await register(c, old, { deviceId: 'phone-1' });
    await register(c, rotated, { deviceId: 'phone-1' });
    expect((await Device.find().lean()).map((d) => d.token)).toEqual([rotated]);
  });

  it('keeps at most 10 devices per user, dropping the stalest', async () => {
    const c = await loginAs(env, nextPhone(), 'CUSTOMER');
    const t0 = Date.now();
    const tokens: string[] = [];
    for (let i = 0; i < 12; i++) {
      env.setNow(new Date(t0 + i * 1000));
      tokens.push(newToken());
      await register(c, tokens[i]!);
    }
    const left = (await Device.find({ userId: c.userId }).lean()).map((d) => d.token);
    expect(left).toHaveLength(10);
    expect(left).not.toContain(tokens[0]);
    expect(left).toContain(tokens[11]);
  });

  it('removes only your own device', async () => {
    const a = await loginAs(env, nextPhone(), 'CUSTOMER');
    const b = await loginAs(env, nextPhone(), 'CUSTOMER');
    const mine = (await register(a, newToken())).body.data.id as string;
    expect((await api().delete(`/api/v1/devices/${mine}`).set(b.auth)).status).toBe(404);
    expect(await Device.countDocuments()).toBe(1);
    expect((await api().delete(`/api/v1/devices/${mine}`).set(a.auth)).status).toBe(200);
    expect(await Device.countDocuments()).toBe(0);
    expect((await api().delete(`/api/v1/devices/${mine}`).set(a.auth)).status).toBe(404);
    expect((await api().delete('/api/v1/devices/not-an-id').set(a.auth)).status).toBe(400);
  });

  it('validates input and needs a login', async () => {
    const c = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await register(c, 'short')).status).toBe(400);
    expect((await register(c, newToken(), { platform: 'windows' })).status).toBe(400);
    expect((await register(c, newToken(), { userId: c.userId })).status).toBe(400);
    expect((await api().post('/api/v1/devices').send({})).status).toBe(401);
  });
});

describe('pushes during a ride', () => {
  async function scene() {
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const driver = await createDriver(env, world);
    const riderToken = newToken('rider');
    const driverToken = newToken('driver');
    await register(customer, riderToken);
    await register(driver, driverToken);
    return { customer, driver, riderToken, driverToken };
  }
  const titles = (token: string) =>
    env.pushed.filter((p) => p.token === token).map((p) => p.payload.title);

  it('the driver is pushed the offer: high priority, and only worth sending while it is open', async () => {
    const { customer, driverToken } = await scene();
    const booking = await requestRide(env, world, customer);
    const stored = await Notification.findOne({ type: 'offer.new' }).lean();
    expect(stored).toMatchObject({ priority: 'high', status: 'PENDING' });
    expect(stored?.expiresAt).toBeTruthy();

    expect(await env.deliverPush()).toMatchObject({ sent: 1 });
    const push = env.pushed.find((p) => p.token === driverToken)!;
    expect(push.payload).toMatchObject({ title: 'New ride request', priority: 'high' });
    expect(push.payload.ttlSeconds).toBeGreaterThan(0);
    expect(push.payload.ttlSeconds).toBeLessThanOrEqual(20);
    expect(push.payload.data).toMatchObject({ bookingId: booking.bookingId, type: 'offer.new' });
  });

  it('an offer that expired before it could be sent is dropped, not delivered late', async () => {
    const { customer } = await scene();
    await requestRide(env, world, customer);
    env.setNow(new Date(Date.now() + 30_000));
    expect(await env.deliverPush()).toMatchObject({ expired: 1, sent: 0 });
    expect(env.pushed).toHaveLength(0);
    expect((await Notification.findOne().lean())?.status).toBe('EXPIRED');
  });

  it('an offer push that has not gone out yet is cancelled when the rider cancels', async () => {
    const { customer, driverToken } = await scene();
    const booking = await requestRide(env, world, customer);
    await api()
      .post(`/api/v1/bookings/${booking.bookingId}/cancel`)
      .set(customer.auth)
      .send({ reasonCode: 'CHANGED_MIND' });
    await env.deliverPush();
    // The driver was never assigned, so there is nothing to tell them, and no stale offer either.
    expect(titles(driverToken)).toEqual([]);
    expect(await Notification.countDocuments({ type: 'offer.new', status: 'EXPIRED' })).toBe(1);
  });

  it('an offer push is cancelled when the driver declines it', async () => {
    const { customer, driver, driverToken } = await scene();
    await requestRide(env, world, customer);
    const offer = await api().get('/api/v1/drivers/me/offers').set(driver.auth);
    await api().post(`/api/v1/ride-offers/${offer.body.data[0].offerId}/reject`).set(driver.auth);
    await env.deliverPush();
    expect(titles(driverToken)).toEqual([]);
  });

  it('both sides get the right message at every step', async () => {
    const { customer, driver, riderToken, driverToken } = await scene();
    await requestRide(env, world, customer);
    const rideId = await assignTo(env, driver);
    await startRide(env, customer, driver, rideId);
    await rideCall(env, driver, rideId, 'complete');
    await env.deliverPush();

    expect(titles(riderToken)).toEqual([
      'Driver assigned',
      'Driver is on the way',
      'Your driver has arrived',
      'Ride started',
      'Ride completed',
    ]);
    // The offer closed once accepted, so by the time the worker ran it was too late to send.
    expect(titles(driverToken)).toEqual(['Ride completed']);
    const done = env.pushed.find((p) => p.token === driverToken)!;
    expect(done.payload.body).toMatch(/^Collect ₹[\d.]+ in cash\.$/);
  });

  it('a cancelling driver pushes the rider; a cancelling rider pushes the driver', async () => {
    const { customer, driver, riderToken, driverToken } = await scene();
    await requestRide(env, world, customer);
    const rideId = await assignTo(env, driver);
    await rideCall(env, driver, rideId, 'cancel', { reasonCode: 'VEHICLE_ISSUE' });
    await env.deliverPush();
    expect(titles(riderToken)).toContain('Your driver cancelled');

    const booking = await requestRide(env, world, customer);
    await assignTo(env, driver);
    await api()
      .post(`/api/v1/bookings/${booking.bookingId}/cancel`)
      .set(customer.auth)
      .send({ reasonCode: 'CHANGED_MIND' });
    await env.deliverPush();
    expect(titles(driverToken)).toContain('Ride cancelled');
  });

  it('the rider is pushed when no driver could be found', async () => {
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const token = newToken('rider');
    await register(customer, token);
    await requestRide(env, world, customer);
    env.setNow(new Date(Date.now() + 61_000));
    await env.sweep();
    await env.deliverPush();
    expect(titles(token)).toEqual(['No drivers available']);
  });

  it('no push ever carries a phone number or a pickup code, and every data value is text', async () => {
    const { customer, driver } = await scene();
    await requestRide(env, world, customer);
    const rideId = await assignTo(env, driver);
    await startRide(env, customer, driver, rideId);
    await rideCall(env, driver, rideId, 'complete');
    await env.deliverPush();
    expect(env.pushed.length).toBeGreaterThan(4);
    const text = JSON.stringify(env.pushed);
    expect(text).not.toMatch(/\+91\d{6,}/);
    expect(text).not.toMatch(/otp/i);
    for (const p of env.pushed) {
      for (const v of Object.values(p.payload.data ?? {})) expect(typeof v).toBe('string');
    }
  });
});

describe('delivery that has to survive failures', () => {
  async function pending(token = newToken()) {
    const c = await loginAs(env, nextPhone(), 'CUSTOMER');
    await register(c, token);
    await services().notifications.notify(c.userId, {
      type: 'test',
      title: 'Hello',
      body: 'World',
      dedupeKey: `t-${Math.random()}`,
    });
    return { c, token };
  }
  const row = () => Notification.findOne().lean();

  it('records the same event only once', async () => {
    const c = await loginAs(env, nextPhone(), 'CUSTOMER');
    const input = { type: 'test', title: 'a', body: 'b', dedupeKey: 'same-event' };
    expect(await services().notifications.notify(c.userId, input)).toBe(true);
    expect(await services().notifications.notify(c.userId, input)).toBe(false);
    expect(await Notification.countDocuments()).toBe(1);
  });

  it('retries a failing push with growing waits, then delivers once the service recovers', async () => {
    const { token } = await pending();
    env.failPush.set(token, 'error');
    const t0 = Date.now();

    env.setNow(new Date(t0));
    expect(await env.deliverPush()).toMatchObject({ retried: 1, sent: 0 });
    expect(await row()).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect((await row())!.nextAttemptAt.getTime()).toBeGreaterThan(t0);

    // Not due yet: nothing is attempted.
    expect(await env.deliverPush()).toEqual({
      sent: 0,
      skipped: 0,
      expired: 0,
      retried: 0,
      failed: 0,
    });

    env.setNow(new Date(t0 + 10_000));
    expect(await env.deliverPush()).toMatchObject({ retried: 1 });
    expect((await row())!.attempts).toBe(2);

    env.failPush.clear();
    env.setNow(new Date(t0 + 3_600_000));
    expect(await env.deliverPush()).toMatchObject({ sent: 1 });
    expect(await row()).toMatchObject({ status: 'SENT' });
    expect(env.pushed).toHaveLength(1);
  });

  it('gives up after 5 failed attempts', async () => {
    const { token } = await pending();
    env.failPush.set(token, 'error');
    const t0 = Date.now();
    const reports = [];
    for (let i = 0; i < 6; i++) {
      env.setNow(new Date(t0 + (i + 1) * 3_600_000));
      reports.push(await env.deliverPush());
    }
    expect(reports.map((r) => r.retried)).toEqual([1, 1, 1, 1, 0, 0]);
    expect(reports.map((r) => r.failed)).toEqual([0, 0, 0, 0, 1, 0]);
    expect(await row()).toMatchObject({ status: 'FAILED', attempts: 5 });
  });

  it('a dead token is removed and not retried', async () => {
    const { token } = await pending();
    env.failPush.set(token, 'invalid');
    expect(await env.deliverPush()).toMatchObject({ skipped: 1, retried: 0 });
    expect(await Device.countDocuments()).toBe(0);
    expect(await row()).toMatchObject({ status: 'SKIPPED' });
  });

  it('reaching one of two devices counts as delivered (no duplicate on the good one)', async () => {
    const good = newToken('good');
    const flaky = newToken('flaky');
    const { c } = await pending(good);
    await register(c, flaky);
    env.failPush.set(flaky, 'error');
    expect(await env.deliverPush()).toMatchObject({ sent: 1, retried: 0 });
    expect(env.pushed.map((p) => p.token)).toEqual([good]);
    expect(await row()).toMatchObject({ status: 'SENT' });
  });

  it('a user with no device still has the notification in their inbox', async () => {
    const c = await loginAs(env, nextPhone(), 'CUSTOMER');
    await services().notifications.notify(c.userId, {
      type: 'test',
      title: 'Hello',
      body: 'World',
      dedupeKey: 'no-device',
    });
    expect(await env.deliverPush()).toMatchObject({ skipped: 1 });
    const inbox = await api().get('/api/v1/notifications').set(c.auth);
    expect(inbox.body.data).toHaveLength(1);
    expect(inbox.body.data[0]).toMatchObject({ title: 'Hello', readAt: null });
  });

  it('several workers running together send each push once', async () => {
    await pending();
    const reports = await Promise.all([env.deliverPush(), env.deliverPush(), env.deliverPush()]);
    expect(reports.reduce((n, r) => n + r.sent, 0)).toBe(1);
    expect(env.pushed).toHaveLength(1);
  });

  it('a worker that crashed mid-send does not strand the notification', async () => {
    const { c } = await pending();
    // Crash simulation: claimed (SENDING) and the lease has long run out.
    await Notification.updateOne(
      { userId: c.userId },
      { status: 'SENDING', lockUntil: new Date(Date.now() - 60_000) },
    );
    expect(await env.deliverPush()).toMatchObject({ sent: 1 });
  });
});

describe('the in-app inbox', () => {
  async function inboxOf(c: Session, n: number) {
    for (let i = 0; i < n; i++) {
      await services().notifications.notify(c.userId, {
        type: 'test',
        title: `Note ${i}`,
        body: 'x',
        dedupeKey: `n-${c.userId}-${i}`,
      });
    }
  }

  it('lists only your own, newest first, with the unread count for the badge', async () => {
    const a = await loginAs(env, nextPhone(), 'CUSTOMER');
    const b = await loginAs(env, nextPhone(), 'CUSTOMER');
    await inboxOf(a, 3);
    await inboxOf(b, 2);
    const res = await api().get('/api/v1/notifications').set(a.auth);
    expect(res.body.data.map((n: { title: string }) => n.title)).toEqual([
      'Note 2',
      'Note 1',
      'Note 0',
    ]);
    expect(res.body.meta).toMatchObject({ total: 3, unreadCount: 3 });
    expect(
      (await api().get('/api/v1/notifications?limit=2&page=2').set(a.auth)).body.data,
    ).toHaveLength(1);
  });

  it('marks some or all as read, filters by unread, and cannot touch someone else’s', async () => {
    const a = await loginAs(env, nextPhone(), 'CUSTOMER');
    const b = await loginAs(env, nextPhone(), 'CUSTOMER');
    await inboxOf(a, 3);
    await inboxOf(b, 1);
    const list = (await api().get('/api/v1/notifications').set(a.auth)).body.data as {
      id: string;
    }[];
    const theirs = (await api().get('/api/v1/notifications').set(b.auth)).body.data[0].id as string;

    // Someone else's id changes nothing.
    const stray = await api()
      .post('/api/v1/notifications/read')
      .set(a.auth)
      .send({ ids: [theirs] });
    expect(stray.body.data.updated).toBe(0);
    expect((await api().get('/api/v1/notifications').set(b.auth)).body.meta.unreadCount).toBe(1);

    const one = await api()
      .post('/api/v1/notifications/read')
      .set(a.auth)
      .send({ ids: [list[0]!.id] });
    expect(one.body.data.updated).toBe(1);
    const unread = await api().get('/api/v1/notifications?unread=true').set(a.auth);
    expect(unread.body.data).toHaveLength(2);
    expect(unread.body.meta.unreadCount).toBe(2);

    const all = await api().post('/api/v1/notifications/read').set(a.auth).send({ all: true });
    expect(all.body.data.updated).toBe(2);
    expect(
      (await api().get('/api/v1/notifications?unread=true').set(a.auth)).body.data,
    ).toHaveLength(0);
  });

  it('needs exactly one of ids or all, and a login', async () => {
    const a = await loginAs(env, nextPhone(), 'CUSTOMER');
    const post = (body: object) => api().post('/api/v1/notifications/read').set(a.auth).send(body);
    expect((await post({})).status).toBe(400);
    expect((await post({ all: true, ids: ['507f1f77bcf86cd799439011'] })).status).toBe(400);
    expect((await post({ all: false })).status).toBe(400);
    expect((await post({ ids: ['nope'] })).status).toBe(400);
    expect((await api().get('/api/v1/notifications')).status).toBe(401);
  });
});
