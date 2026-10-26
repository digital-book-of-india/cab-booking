import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Booking } from '../src/modules/bookings/booking.model';
import {
  NEAR_CP,
  completedRide,
  createDriver,
  loginAs,
  loginAsAdmin,
  nextPhone,
  requestRide,
  seedWorld,
  startTestEnv,
  type Session,
  type TestDriver,
  type TestEnv,
} from './helpers';

let env: TestEnv;
let world: Awaited<ReturnType<typeof seedWorld>>;
let ops: Session;
let fin: Session;
let driver: TestDriver;
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(() => env.stop());
beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
  ops = await loginAsAdmin(env, nextPhone(), 'OPS');
  fin = await loginAsAdmin(env, nextPhone(), 'FINANCE');
  driver = await createDriver(env, world, { at: NEAR_CP });
});

const api = () => request(env.app);
const get = (path: string, who = ops) => api().get(`/api/v1/admin/analytics/${path}`).set(who.auth);
let keyN = 0;
const idem = () => `k-${Date.now()}-${++keyN}`;

/** Two completed rides (one tipped online) and one cancelled by the rider. */
async function someActivity() {
  const r1 = await loginAs(env, nextPhone(), 'CUSTOMER');
  const r2 = await loginAs(env, nextPhone(), 'CUSTOMER');
  const first = await completedRide(env, world, r1, driver);
  const second = await completedRide(env, world, r2, driver);
  const r3 = await loginAs(env, nextPhone(), 'CUSTOMER');
  const lost = await requestRide(env, world, r3);
  await api()
    .post(`/api/v1/bookings/${lost.bookingId}/cancel`)
    .set(r3.auth)
    .send({ reasonCode: 'CHANGED_MIND' });
  const tip = await api()
    .post(`/api/v1/rides/${first.rideId}/tip`)
    .set(r1.auth)
    .set('Idempotency-Key', idem())
    .send({ amountPaise: 5000, source: 'ONLINE' });
  await env.razorpay.webhook(
    env.razorpay.captured(tip.body.data.payment.orderId, 'pay_tip_an', 5000),
  );
  return { fares: first.fare + second.fare };
}

describe('demand and fulfilment', () => {
  it('shows when people ask: a full week-by-hour grid that adds up, and the zones', async () => {
    await someActivity();
    const res = await get('demand');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.timezone).toBe('Asia/Kolkata');
    expect(d.total).toBe(3);
    expect(d.grid).toHaveLength(168);
    expect(d.grid[0]).toMatchObject({ day: 'Mon', hour: 0 });
    expect(d.grid[167]).toMatchObject({ day: 'Sun', hour: 23 });
    expect(d.grid.reduce((n: number, c: { requests: number }) => n + c.requests, 0)).toBe(3);
    expect(d.grid.reduce((n: number, c: { completed: number }) => n + c.completed, 0)).toBe(2);
    expect(d.byZone).toHaveLength(1);
    expect(d.byZone[0]).toMatchObject({
      code: 'DELHI_NCR',
      requests: 3,
      completed: 2,
      noDriver: 0,
    });
  });

  it('shows how well it is served by hour, including how fast a driver was found', async () => {
    await someActivity();
    const d = (await get('fulfilment')).body.data;
    expect(d.hours).toHaveLength(24);
    const sum = (k: string) =>
      d.hours.reduce((n: number, h: Record<string, number>) => n + (h[k] ?? 0), 0);
    expect(sum('requests')).toBe(3);
    expect(sum('completed')).toBe(2);
    expect(sum('cancelled')).toBe(1);
    const busy = d.hours.filter((h: { requests: number }) => h.requests > 0);
    expect(
      busy.some(
        (h: { averageSecondsToAssign: number | null }) => h.averageSecondsToAssign !== null,
      ),
    ).toBe(true);
    expect(busy[0].completionRate).toBeGreaterThan(0);
  });
});

describe('cancellations', () => {
  it('breaks lost rides down by who cancelled and why', async () => {
    await someActivity();
    const d = (await get('cancellations')).body.data;
    expect(d).toMatchObject({ requests: 3, cancelled: 1, cancelRate: 0.3333 });
    expect(d.byActor).toEqual([{ actor: 'CUSTOMER', count: 1, share: 1 }]);
    expect(d.byReason[0]).toMatchObject({
      actor: 'CUSTOMER',
      reasonCode: 'CHANGED_MIND',
      count: 1,
    });
  });
});

describe('revenue', () => {
  it('adds up fares, commission, driver earnings and tips by day, and what was collected', async () => {
    const { fares } = await someActivity();
    const d = (await get('revenue', fin)).body.data;
    expect(d.totals).toMatchObject({
      rides: 2,
      grossFaresPaise: fares,
      tipsPaise: 5000,
      refundsPaise: 0,
    });
    expect(d.totals.commissionPaise + d.totals.driverEarningsPaise).toBe(fares);
    expect(d.perDay).toHaveLength(1);
    expect(d.collected).toEqual([
      { method: 'GATEWAY', purpose: 'TIP', payments: 1, amountPaise: 5000 },
    ]);
  });

  it('is for finance only', async () => {
    expect((await get('revenue', ops)).status).toBe(403);
  });
});

describe('drivers', () => {
  it('ranks drivers with earnings, tips, how often they accept, and rating', async () => {
    const { fares } = await someActivity();
    const d = (await get('drivers')).body.data;
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({
      driverId: driver.driverId,
      rides: 2,
      tipsPaise: 5000,
      acceptanceRate: 1,
      rating: null,
    });
    expect(d.items[0].earningsPaise).toBeGreaterThan(0);
    expect(d.items[0].earningsPaise).toBeLessThan(fares);
    expect((await get('drivers?limit=0')).status).toBe(400);
  });
});

describe('retention', () => {
  const DAY = 86_400_000;
  /** Monday 00:00 India time of the week containing `d`. */
  const weekStart = (d: number) => {
    const ist = new Date(d + 330 * 60_000);
    const dow = (ist.getUTCDay() + 6) % 7;
    return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - dow) - 330 * 60_000;
  };

  it('counts who is active and how many new riders come back in the weeks after', async () => {
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    const thisWeek = weekStart(Date.now());
    const ride = (customer: mongoose.Types.ObjectId, weeksAgo: number) => {
      const at = new Date(thisWeek - weeksAgo * 7 * DAY + 2 * DAY + 12 * 3_600_000);
      const id = randomBytes(12).toString('hex');
      return {
        publicId: `bk_${id.slice(0, 12)}`,
        idempotencyKey: id,
        status: 'COMPLETED',
        customerId: customer,
        requestedAt: at,
        completedAt: at,
      };
    };
    // A rides in weeks -3, -2, -1; B in weeks -3 and -1.
    await Booking.collection.insertMany([
      ride(a, 3),
      ride(a, 2),
      ride(a, 1),
      ride(b, 3),
      ride(b, 1),
    ]);

    const d = (await get('retention?weeks=6')).body.data;
    const cohort = d.cohorts.find((c: { newRiders: number }) => c.newRiders === 2);
    expect(cohort).toBeTruthy();
    expect(cohort.weekStarting).toBe(new Date(thisWeek - 3 * 7 * DAY).toISOString());
    expect(cohort.returned).toEqual([
      { weeksLater: 1, riders: 1, share: 0.5 }, // only A rode in week -2
      { weeksLater: 2, riders: 2, share: 1 }, // both rode in week -1
      { weeksLater: 3, riders: 0, share: 0 }, // nobody yet this week
    ]);
    expect((await get('retention?weeks=1')).status).toBe(400);
  });

  it('counts people active in the last day, week and month', async () => {
    await someActivity();
    const d = (await get('retention')).body.data;
    expect(d.active.last24Hours).toEqual({ riders: 3, drivers: 1 });
    expect(d.active.last30Days).toEqual({ riders: 3, drivers: 1 });
  });
});

describe('access and input', () => {
  it('keeps riders out, refuses silly periods, and accepts a zone filter', async () => {
    const rider = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await get('demand', rider)).status).toBe(403);
    const support = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    expect((await get('demand', support)).status).toBe(403);
    expect((await get('demand?from=2026-01-01&to=2026-12-31')).status).toBe(400);
    expect((await get(`demand?zoneId=${world.zoneId}`)).status).toBe(200);
    expect((await get('demand?zoneId=not-an-id')).status).toBe(400);
  });
});
