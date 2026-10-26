import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/auditLog.model';
import { FareConfig } from '../src/modules/pricing/fareConfig.model';
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
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(() => env.stop());
beforeEach(() => env.reset());

const api = () => request(env.app);

const square = (lng0: number, lat0: number, size = 0.1) => ({
  type: 'Polygon',
  coordinates: [
    [
      [lng0, lat0],
      [lng0 + size, lat0],
      [lng0 + size, lat0 + size],
      [lng0, lat0 + size],
      [lng0, lat0],
    ],
  ],
});

describe('zones admin', () => {
  let admin: Session;
  beforeEach(async () => {
    admin = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
  });

  it('creates, lists and updates a zone (code immutable)', async () => {
    const created = await api()
      .post('/api/v1/admin/zones')
      .set(admin.auth)
      .send({ code: 'gurgaon', name: 'Gurgaon', cityCode: 'ggn', polygon: square(77.0, 28.4) });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ code: 'GURGAON', cityCode: 'GGN', active: true });

    const id = created.body.data.id;
    const patched = await api()
      .patch(`/api/v1/admin/zones/${id}`)
      .set(admin.auth)
      .send({ name: 'Gurugram', operatingHours: { start: '05:00', end: '23:30' } });
    expect(patched.body.data).toMatchObject({
      name: 'Gurugram',
      operatingHours: { start: '05:00', end: '23:30' },
    });
    const cleared = await api()
      .patch(`/api/v1/admin/zones/${id}`)
      .set(admin.auth)
      .send({ operatingHours: null });
    expect(cleared.body.data.operatingHours).toBeNull();
    expect(
      (await api().patch(`/api/v1/admin/zones/${id}`).set(admin.auth).send({ code: 'X1' })).status,
    ).toBe(400);

    expect((await api().get('/api/v1/admin/zones').set(admin.auth)).body.data).toHaveLength(1);
    expect(await AuditLog.countDocuments({ action: { $in: ['zone.create', 'zone.update'] } })).toBe(
      3,
    );
  });

  it('rejects duplicate codes, open rings, bad coordinates and self-intersecting shapes', async () => {
    const post = (body: object) => api().post('/api/v1/admin/zones').set(admin.auth).send(body);
    const base = { code: 'Z1', name: 'Z', cityCode: 'DEL', polygon: square(77.0, 28.4) };
    expect((await post(base)).status).toBe(201);
    expect((await post(base)).status).toBe(409);

    const open = {
      ...base,
      code: 'Z2',
      polygon: {
        type: 'Polygon',
        coordinates: [
          [
            [77, 28],
            [77.1, 28],
            [77.1, 28.1],
            [77, 28.1],
          ],
        ],
      },
    };
    expect((await post(open)).status).toBe(400);

    const outOfRange = { ...base, code: 'Z3', polygon: square(200, 28.4) };
    expect((await post(outOfRange)).status).toBe(400);

    const bowtie = {
      ...base,
      code: 'Z4',
      polygon: {
        type: 'Polygon',
        coordinates: [
          [
            [77, 28],
            [77.1, 28.1],
            [77.1, 28],
            [77, 28.1],
            [77, 28],
          ],
        ],
      },
    };
    expect((await post(bowtie)).status).toBe(422);
    expect(
      (await post({ ...base, code: 'Z5', operatingHours: { start: '25:00', end: '10:00' } }))
        .status,
    ).toBe(400);
  });

  it('is restricted to config roles', async () => {
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    for (const s of [customer, ops]) {
      expect((await api().get('/api/v1/admin/zones').set(s.auth)).status).toBe(403);
    }
  });
});

describe('serviceability', () => {
  const query = (p: { lat: number; lng: number }, d: { lat: number; lng: number }) =>
    `/api/v1/serviceability?pickupLat=${p.lat}&pickupLng=${p.lng}&dropLat=${d.lat}&dropLng=${d.lng}`;

  it('is public and reports zone and available categories', async () => {
    await seedWorld();
    const res = await api().get(query(CP, IGI));
    expect(res.status).toBe(200);
    expect(res.body.data.serviceable).toBe(true);
    expect(res.body.data.pickup).toMatchObject({ serviceable: true, zoneName: 'Delhi NCR' });
    expect(res.body.data.categories.map((c: { code: string }) => c.code)).toEqual([
      'MINI',
      'SEDAN',
      'SUV',
    ]);
    expect(res.body.data.categories.every((c: { available: boolean }) => c.available)).toBe(true);
  });

  it('flags points outside every zone', async () => {
    await seedWorld();
    const res = await api().get(query(CP, MUMBAI));
    expect(res.body.data.serviceable).toBe(false);
    expect(res.body.data.drop).toMatchObject({
      serviceable: false,
      reason: 'OUTSIDE_SERVICE_AREA',
    });
    const both = await api().get(query(MUMBAI, MUMBAI));
    expect(both.body.data.categories).toEqual([]);
  });

  it('treats a point just outside the boundary as unserviceable and just inside as serviceable', async () => {
    await seedWorld();
    const inside = { lat: 28.5, lng: 76.85 };
    const outside = { lat: 28.5, lng: 76.83 };
    expect((await api().get(query(inside, inside))).body.data.pickup.serviceable).toBe(true);
    expect((await api().get(query(outside, outside))).body.data.pickup.serviceable).toBe(false);
  });

  it('respects deactivation and operating hours (Asia/Kolkata)', async () => {
    const { zoneId } = await seedWorld();
    const admin = await loginAsAdmin(env, nextPhone(), 'SUPER_ADMIN');
    await api()
      .patch(`/api/v1/admin/zones/${zoneId}`)
      .set(admin.auth)
      .send({ operatingHours: { start: '05:00', end: '23:30' } });

    env.setNow(new Date('2026-11-02T06:30:00Z')); // 12:00 IST
    expect((await api().get(query(CP, IGI))).body.data.serviceable).toBe(true);
    env.setNow(new Date('2026-11-02T20:30:00Z')); // 02:00 IST next day
    const closed = await api().get(query(CP, IGI));
    expect(closed.body.data.pickup).toMatchObject({
      serviceable: false,
      reason: 'OUTSIDE_OPERATING_HOURS',
    });

    env.setNow(null);
    await api()
      .patch(`/api/v1/admin/zones/${zoneId}`)
      .set(admin.auth)
      .send({ operatingHours: null, active: false });
    expect((await api().get(query(CP, IGI))).body.data.serviceable).toBe(false);
  });

  it('validates the query', async () => {
    expect((await api().get('/api/v1/serviceability?pickupLat=abc')).status).toBe(400);
    expect((await api().get(query({ lat: 120, lng: 77 }, IGI))).status).toBe(400);
  });
});

describe('fare config versions', () => {
  const body = (zoneId: string, categoryId: string, extra: object = {}) => ({
    zoneId,
    categoryId,
    baseFarePaise: 4500,
    perKmPaise: 1300,
    perMinutePaise: 160,
    minimumFarePaise: 11000,
    changeReason: 'Festival pricing',
    ...extra,
  });

  it('numbers versions per zone+category and leaves old versions untouched', async () => {
    const { zoneId, cats } = await seedWorld();
    const admin = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    const post = (cat: string, extra: object = {}) =>
      api()
        .post('/api/v1/admin/pricing/configs')
        .set(admin.auth)
        .send(body(zoneId, cat, extra));

    const v2 = await post(cats['MINI']!);
    expect(v2.status).toBe(201);
    expect(v2.body.data.version).toBe(2); // seed made v1
    expect((await post(cats['MINI']!)).body.data.version).toBe(3);
    expect((await post(cats['SEDAN']!)).body.data.version).toBe(2);

    const v1 = await FareConfig.findOne({ categoryId: cats['MINI'], version: 1 }).lean();
    expect(v1?.baseFarePaise).toBe(4000);
    expect(await AuditLog.countDocuments({ action: 'pricing.config.create' })).toBe(3);
  });

  it('gives concurrent creators distinct versions', async () => {
    const { zoneId, cats } = await seedWorld();
    const admin = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        api()
          .post('/api/v1/admin/pricing/configs')
          .set(admin.auth)
          .send(body(zoneId, cats['SUV']!)),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const versions = results.map((r) => r.body.data.version).sort();
    expect(versions).toEqual([2, 3, 4]);
  });

  it('only switches to a future-dated version once its time arrives', async () => {
    const { zoneId, cats } = await seedWorld();
    const admin = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await api()
      .post('/api/v1/admin/pricing/configs')
      .set(admin.auth)
      .send(body(zoneId, cats['MINI']!, { effectiveFrom: future, baseFarePaise: 9000 }));

    const active = () =>
      api()
        .get(`/api/v1/admin/pricing/configs/active?zoneId=${zoneId}&categoryId=${cats['MINI']}`)
        .set(admin.auth);
    expect((await active()).body.data.version).toBe(1);
    env.setNow(new Date(Date.now() + 2 * 3_600_000));
    const later = await active();
    expect(later.body.data).toMatchObject({ version: 2, baseFarePaise: 9000 });
  });

  it('validates input and rejects client-controlled version fields', async () => {
    const { zoneId, cats } = await seedWorld();
    const admin = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    const post = (extra: object) =>
      api()
        .post('/api/v1/admin/pricing/configs')
        .set(admin.auth)
        .send(body(zoneId, cats['MINI']!, extra));

    expect((await post({ baseFarePaise: -1 })).status).toBe(400);
    expect((await post({ baseFarePaise: 10.5 })).status).toBe(400);
    expect((await post({ version: 99 })).status).toBe(400);
    expect((await post({ changeReason: '' })).status).toBe(400);
    expect(
      (await post({ effectiveFrom: new Date(Date.now() - 3_600_000).toISOString() })).status,
    ).toBe(422);
    const unknownZone = await api()
      .post('/api/v1/admin/pricing/configs')
      .set(admin.auth)
      .send(body('507f1f77bcf86cd799439011', cats['MINI']!));
    expect(unknownZone.status).toBe(422);
  });

  it('has no edit endpoint and is restricted to config roles', async () => {
    const { zoneId, cats } = await seedWorld();
    const admin = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    const cfg = await FareConfig.findOne({ categoryId: cats['MINI'] }).lean();
    expect(
      (
        await api()
          .patch(`/api/v1/admin/pricing/configs/${cfg!._id}`)
          .set(admin.auth)
          .send({ baseFarePaise: 1 })
      ).status,
    ).toBe(404);

    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    for (const s of [ops, customer]) {
      expect(
        (
          await api()
            .post('/api/v1/admin/pricing/configs')
            .set(s.auth)
            .send(body(zoneId, cats['MINI']!))
        ).status,
      ).toBe(403);
      expect((await api().get('/api/v1/admin/pricing/configs').set(s.auth)).status).toBe(403);
    }
  });

  it('lists with filters and pagination', async () => {
    const { zoneId, cats } = await seedWorld();
    const admin = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    const all = await api().get('/api/v1/admin/pricing/configs?limit=2').set(admin.auth);
    expect(all.body.data).toHaveLength(2);
    expect(all.body.meta).toMatchObject({ total: 3, totalPages: 2 });
    const mini = await api()
      .get(`/api/v1/admin/pricing/configs?zoneId=${zoneId}&categoryId=${cats['MINI']}`)
      .set(admin.auth);
    expect(mini.body.data).toHaveLength(1);
  });
});
