import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Booking } from '../src/modules/bookings/booking.model';
import { BookingEvent } from '../src/modules/bookings/bookingEvent.model';
import { FareQuote } from '../src/modules/quotes/fareQuote.model';
import {
  CP,
  IGI,
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
let keyCounter = 0;
const newKey = () => `test-key-${Date.now()}-${++keyCounter}`;

async function quote(s: Session = customer) {
  const res = await api()
    .post('/api/v1/fare-quotes')
    .set(s.auth)
    .send({ pickup: CP, drop: IGI, categoryId: world.cats['MINI'] });
  expect(res.status).toBe(201);
  return res.body.data as { quoteId: string; breakdown: { estimatedTotalPaise: number } };
}

function book(quoteId: string, opts: { s?: Session; key?: string | null; body?: object } = {}) {
  const s = opts.s ?? customer;
  const key = opts.key === undefined ? newKey() : opts.key;
  const r = api().post('/api/v1/bookings').set(s.auth);
  if (key !== null) r.set('Idempotency-Key', key);
  return r.send({ quoteId, paymentMethod: 'CASH', ...opts.body });
}

describe('creating a booking', () => {
  it('creates a booking from a quote and starts dispatch, using the quoted fare', async () => {
    const q = await quote();
    const res = await book(q.quoteId, {
      body: {
        notes: 'Near main gate',
        pickup: { ...CP, contactName: 'Asha', contactPhone: '98765 43210' },
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'DISPATCHING',
      paymentStatus: 'NOT_DUE',
      paymentMethod: 'CASH',
      rideType: 'INSTANT',
      estimatedFarePaise: q.breakdown.estimatedTotalPaise,
      currency: 'INR',
      notes: 'Near main gate',
    });
    expect(res.body.data.bookingId).toMatch(/^bk_[0-9a-f]{12}$/);
    expect(res.body.data.pickup).toMatchObject({
      contactName: 'Asha',
      contactPhone: '+919876543210',
    });
    expect(res.body.data.fare.breakdown).toEqual(q.breakdown);
    expect(res.body.data.fare.configVersion).toBe(1);

    const used = await api().get(`/api/v1/fare-quotes/${q.quoteId}`).set(customer.auth);
    expect(used.body.data.status).toBe('USED');
  });

  it('records a timeline event', async () => {
    const q = await quote();
    const res = await book(q.quoteId);
    const events = await api()
      .get(`/api/v1/bookings/${res.body.data.bookingId}/events`)
      .set(customer.auth);
    expect(events.body.data).toEqual([
      expect.objectContaining({
        type: 'BOOKING_CREATED',
        toStatus: 'REQUESTED',
        actorType: 'CUSTOMER',
      }),
      expect.objectContaining({
        type: 'DISPATCH_STARTED',
        fromStatus: 'REQUESTED',
        toStatus: 'DISPATCHING',
        actorType: 'SYSTEM',
      }),
    ]);
  });

  it('never trusts client-supplied fare, status or payment state', async () => {
    const q = await quote();
    for (const extra of [
      { estimatedFarePaise: 1 },
      { fare: { estimatedTotalPaise: 1 } },
      { status: 'COMPLETED' },
      { paymentStatus: 'PAID' },
      { customerId: '507f1f77bcf86cd799439011' },
    ]) {
      expect((await book(q.quoteId, { body: extra })).status, JSON.stringify(extra)).toBe(400);
    }
    // None of those attempts consumed the quote.
    expect((await book(q.quoteId)).status).toBe(201);
  });

  it('rejects echoed pickup, drop or category that disagree with the quote, without consuming it', async () => {
    const q = await quote();
    for (const body of [
      { pickup: { lat: CP.lat + 0.01, lng: CP.lng } },
      { drop: { lat: IGI.lat, lng: IGI.lng + 0.01 } },
      { categoryId: world.cats['SUV'] },
    ]) {
      const res = await book(q.quoteId, { body });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('QUOTE_MISMATCH');
    }
    expect(
      (await book(q.quoteId, { body: { pickup: CP, drop: IGI, categoryId: world.cats['MINI'] } }))
        .status,
    ).toBe(201);
  });

  it('validates payment method, ride type, phone and notes', async () => {
    const q = await quote();
    for (const body of [
      { paymentMethod: 'BITCOIN' },
      { rideType: 'RENTAL' },
      { pickup: { ...CP, contactPhone: '123' } },
      { notes: 'x'.repeat(301) },
      // More than 3 stops is never valid.
      { stops: Array.from({ length: 4 }, () => ({ lat: 28.6, lng: 77.2 })) },
    ]) {
      expect((await book(q.quoteId, { body })).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('is limited to customers and requires authentication', async () => {
    const q = await quote();
    const driver = await loginAs(env, nextPhone(), 'DRIVER');
    expect((await book(q.quoteId, { s: driver })).status).toBe(403);
    expect(
      (
        await api()
          .post('/api/v1/bookings')
          .set('Idempotency-Key', newKey())
          .send({ quoteId: q.quoteId, paymentMethod: 'CASH' })
      ).status,
    ).toBe(401);
  });
});

describe('quote rules', () => {
  it('rejects an expired quote', async () => {
    env.setNow(new Date('2026-11-02T07:00:00Z'));
    const q = await quote();
    env.setNow(new Date('2026-11-02T07:10:01Z'));
    const res = await book(q.quoteId);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('QUOTE_EXPIRED');
    expect(await Booking.countDocuments()).toBe(0);
  });

  it("rejects another customer's quote as not found", async () => {
    const q = await quote();
    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await book(q.quoteId, { s: other })).status).toBe(404);
    expect(await Booking.countDocuments()).toBe(0);
  });

  it('rejects an unknown quote', async () => {
    expect((await book('fq_doesnotexist')).status).toBe(404);
  });

  it('a quote can back only one booking', async () => {
    const q = await quote();
    expect((await book(q.quoteId)).status).toBe(201);
    const second = await book(q.quoteId);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('QUOTE_ALREADY_USED');
    expect(await Booking.countDocuments()).toBe(1);
  });

  it('two different keys racing for one quote: exactly one booking', async () => {
    const q = await quote();
    const results = await Promise.all([book(q.quoteId), book(q.quoteId), book(q.quoteId)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await Booking.countDocuments()).toBe(1);
  });

  it('later price changes never alter an existing booking', async () => {
    const q = await quote();
    const created = await book(q.quoteId);
    const admin = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    await api().post('/api/v1/admin/pricing/configs').set(admin.auth).send({
      zoneId: world.zoneId,
      categoryId: world.cats['MINI'],
      baseFarePaise: 99_000,
      perKmPaise: 5000,
      perMinutePaise: 500,
      minimumFarePaise: 99_000,
      changeReason: 'Surge test',
    });
    const read = await api()
      .get(`/api/v1/bookings/${created.body.data.bookingId}`)
      .set(customer.auth);
    expect(read.body.data.estimatedFarePaise).toBe(q.breakdown.estimatedTotalPaise);
    expect(read.body.data.fare.configVersion).toBe(1);
  });
});

describe('idempotency', () => {
  it('requires a well-formed Idempotency-Key header', async () => {
    const q = await quote();
    const missing = await book(q.quoteId, { key: null });
    expect(missing.status).toBe(400);
    expect(missing.body.error.fieldErrors[0].field).toBe('Idempotency-Key');
    expect((await book(q.quoteId, { key: 'short' })).status).toBe(400);
    expect((await book(q.quoteId, { key: 'has spaces in it!' })).status).toBe(400);
    expect(await Booking.countDocuments()).toBe(0);
  });

  it('replays the same booking for the same key and body', async () => {
    const q = await quote();
    const key = newKey();
    const first = await book(q.quoteId, { key });
    const second = await book(q.quoteId, { key });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body.data.bookingId).toBe(first.body.data.bookingId);
    expect(await Booking.countDocuments()).toBe(1);
    expect(await BookingEvent.countDocuments()).toBe(2); // created + dispatch started, once
  });

  it('rejects the same key with a different request', async () => {
    const q = await quote();
    const key = newKey();
    expect((await book(q.quoteId, { key })).status).toBe(201);
    const different = await book(q.quoteId, { key, body: { paymentMethod: 'ONLINE' } });
    expect(different.status).toBe(422);
    expect(different.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('five concurrent retries with one key create exactly one booking', async () => {
    const q = await quote();
    const key = newKey();
    const results = await Promise.all(Array.from({ length: 5 }, () => book(q.quoteId, { key })));
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.data.bookingId)).size).toBe(1);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await Booking.countDocuments()).toBe(1);
    expect(await FareQuote.countDocuments({ usedAt: { $ne: null } })).toBe(1);
  });

  it('keys are scoped per customer', async () => {
    const key = newKey();
    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    const a = await book((await quote()).quoteId, { key });
    const b = await book((await quote(other)).quoteId, { key, s: other });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.data.bookingId).not.toBe(b.body.data.bookingId);
  });
});

describe('reading bookings', () => {
  it('owner and support staff can read; other customers cannot', async () => {
    const created = await book((await quote()).quoteId);
    const id = created.body.data.bookingId;

    expect((await api().get(`/api/v1/bookings/${id}`).set(customer.auth)).status).toBe(200);
    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await api().get(`/api/v1/bookings/${id}`).set(other.auth)).status).toBe(404);
    expect((await api().get(`/api/v1/bookings/${id}/events`).set(other.auth)).status).toBe(404);

    for (const role of ['OPS', 'SUPPORT', 'SUPER_ADMIN'] as const) {
      const staff = await loginAsAdmin(env, nextPhone(), role);
      expect((await api().get(`/api/v1/bookings/${id}`).set(staff.auth)).status, role).toBe(200);
    }
    const finance = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    expect((await api().get(`/api/v1/bookings/${id}`).set(finance.auth)).status).toBe(403);
    const driver = await loginAs(env, nextPhone(), 'DRIVER');
    expect((await api().get(`/api/v1/bookings/${id}`).set(driver.auth)).status).toBe(403);
    expect((await api().get(`/api/v1/bookings/${id}`)).status).toBe(401);
    expect((await api().get('/api/v1/bookings/bk_000000000000').set(customer.auth)).status).toBe(
      404,
    );
  });
});
