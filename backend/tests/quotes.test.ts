import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { calculateFare } from '../src/modules/pricing/fare';
import { createMockProviders } from '../src/providers/mock';
import { CabCategory } from '../src/modules/categories/cabCategory.model';
import { DEFAULT_RATES } from '../src/seed/seed';
import {
  CP,
  IGI,
  MUMBAI,
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
const quoteBody = (extra: object = {}) => ({
  pickup: CP,
  drop: IGI,
  categoryId: world.cats['MINI'],
  ...extra,
});
const createQuote = (s: Session = customer, body: object = quoteBody()) =>
  api().post('/api/v1/fare-quotes').set(s.auth).send(body);

describe('creating a quote', () => {
  it('prices the trip on the server using the active config and the maps route', async () => {
    const res = await createQuote();
    expect(res.status).toBe(201);
    const d = res.body.data;

    const route = await createMockProviders().maps.route(CP, IGI);
    const r = DEFAULT_RATES['MINI']!;
    const expected = calculateFare(
      {
        baseFarePaise: r.base,
        perKmPaise: r.perKm,
        perMinutePaise: r.perMin,
        minimumFarePaise: r.min,
        roundingMode: 'NEAREST_RUPEE',
      },
      route.distanceMeters,
      route.durationSeconds,
    );
    expect(d.breakdown).toEqual(expected);
    expect(d).toMatchObject({
      status: 'ACTIVE',
      currency: 'INR',
      configVersion: 1,
      estimatedDistanceMeters: route.distanceMeters,
      estimatedDurationSeconds: route.durationSeconds,
    });
    expect(d.breakdown.estimatedTotalPaise % 100).toBe(0);
    expect(d.quoteId).toMatch(/^fq_[0-9a-f]{12}$/);
  });

  it('expires 10 minutes after creation', async () => {
    const start = new Date('2026-11-02T07:00:00Z');
    env.setNow(start);
    const res = await createQuote();
    expect(new Date(res.body.data.expiresAt).getTime()).toBe(start.getTime() + 10 * 60_000);
  });

  it('never accepts client-supplied fare, distance or duration', async () => {
    for (const extra of [
      { estimatedTotalPaise: 1 },
      { distanceMeters: 1 },
      { durationSeconds: 1 },
      { breakdown: { baseFarePaise: 0 } },
      { configVersion: 99 },
    ]) {
      expect((await createQuote(customer, quoteBody(extra))).status).toBe(400);
    }
    expect(
      (await createQuote(customer, quoteBody({ pickup: { ...CP, distanceMeters: 5 } }))).status,
    ).toBe(400);
  });

  it('rejects trips outside the service area', async () => {
    for (const body of [quoteBody({ pickup: MUMBAI }), quoteBody({ drop: MUMBAI })]) {
      const res = await createQuote(customer, body);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('NOT_SERVICEABLE');
    }
  });

  it('rejects identical pickup and drop, invalid coordinates, stops and unknown categories', async () => {
    expect((await createQuote(customer, quoteBody({ drop: CP }))).status).toBe(422);
    expect((await createQuote(customer, quoteBody({ pickup: { lat: 91, lng: 77 } }))).status).toBe(
      400,
    );
    expect(
      (
        await createQuote(
          customer,
          quoteBody({ stops: Array.from({ length: 4 }, () => ({ lat: 28.6, lng: 77.2 })) }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await createQuote(customer, quoteBody({ categoryId: '507f1f77bcf86cd799439011' }))).status,
    ).toBe(422);
    expect((await createQuote(customer, quoteBody({ categoryId: 'nope' }))).status).toBe(400);
  });

  it('rejects inactive categories and categories with no fare config in the zone', async () => {
    await CabCategory.updateOne({ code: 'SUV' }, { active: false });
    expect((await createQuote(customer, quoteBody({ categoryId: world.cats['SUV'] }))).status).toBe(
      422,
    );

    const unpriced = await CabCategory.create({ code: 'LUXURY', name: 'Luxury', capacity: 4 });
    const res = await createQuote(customer, quoteBody({ categoryId: unpriced.id }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NOT_SERVICEABLE');
  });

  it('is limited to customers', async () => {
    const driver = await loginAs(env, nextPhone(), 'DRIVER');
    const admin = await loginAsAdmin(env, nextPhone(), 'SUPER_ADMIN');
    expect((await createQuote(driver)).status).toBe(403);
    expect((await createQuote(admin)).status).toBe(403);
    expect((await api().post('/api/v1/fare-quotes').send(quoteBody())).status).toBe(401);
  });

  it('uses the fare config in force at quote time, and old quotes keep their version', async () => {
    const admin = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    const first = await createQuote();

    await api().post('/api/v1/admin/pricing/configs').set(admin.auth).send({
      zoneId: world.zoneId,
      categoryId: world.cats['MINI'],
      baseFarePaise: 9000,
      perKmPaise: 1200,
      perMinutePaise: 150,
      minimumFarePaise: 10000,
      changeReason: 'Price rise',
    });
    const second = await createQuote();
    expect(second.body.data.configVersion).toBe(2);
    expect(second.body.data.breakdown.baseFarePaise).toBe(9000);

    const reread = await api()
      .get(`/api/v1/fare-quotes/${first.body.data.quoteId}`)
      .set(customer.auth);
    expect(reread.body.data.configVersion).toBe(1);
    expect(reread.body.data.breakdown).toEqual(first.body.data.breakdown);
  });
});

describe('reading and refreshing quotes', () => {
  it("another customer can't see your quote", async () => {
    const q = await createQuote();
    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect(
      (await api().get(`/api/v1/fare-quotes/${q.body.data.quoteId}`).set(other.auth)).status,
    ).toBe(404);
    expect(
      (await api().post(`/api/v1/fare-quotes/${q.body.data.quoteId}/refresh`).set(other.auth))
        .status,
    ).toBe(404);
    expect((await api().get('/api/v1/fare-quotes/fq_000000000000').set(customer.auth)).status).toBe(
      404,
    );
  });

  it('reports EXPIRED after the validity window and refresh issues a fresh quote', async () => {
    env.setNow(new Date('2026-11-02T07:00:00Z'));
    const q = await createQuote();
    env.setNow(new Date('2026-11-02T07:11:00Z'));

    const read = await api().get(`/api/v1/fare-quotes/${q.body.data.quoteId}`).set(customer.auth);
    expect(read.body.data.status).toBe('EXPIRED');

    const refreshed = await api()
      .post(`/api/v1/fare-quotes/${q.body.data.quoteId}/refresh`)
      .set(customer.auth);
    expect(refreshed.status).toBe(201);
    expect(refreshed.body.data.quoteId).not.toBe(q.body.data.quoteId);
    expect(refreshed.body.data.status).toBe('ACTIVE');
    expect(refreshed.body.data.pickup).toMatchObject({ lat: CP.lat, lng: CP.lng });
  });
});
