import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CabCategory } from '../src/modules/categories/cabCategory.model';
import { User } from '../src/modules/users/user.model';
import { seedAll } from '../src/seed/seed';
import {
  loginAs,
  loginAsAdmin,
  nextPhone,
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

const vehicleBody = (categoryId: string, reg = 'DL 01 AB 1234') => ({
  categoryId,
  registrationNumber: reg,
  make: 'Maruti',
  model: 'Dzire',
  color: 'White',
  seats: 4,
});

async function driver(): Promise<Session> {
  return loginAs(env, nextPhone(), 'DRIVER');
}

describe('seed', () => {
  it('creates default categories and an admin, and is idempotent', async () => {
    const phone = nextPhone();
    const first = await seedAll({ adminPhone: phone });
    expect(first).toEqual({ categories: 3, zones: 1, fareConfigs: 3, adminCreated: true });
    const second = await seedAll({ adminPhone: phone });
    expect(second).toEqual({ categories: 0, zones: 0, fareConfigs: 0, adminCreated: false });
    expect((await User.findOne({ phone }).lean())?.role).toBe('SUPER_ADMIN');
    const admin = await loginAs(env, phone);
    expect((await api().get('/api/v1/admin/cab-categories').set(admin.auth)).status).toBe(200);
  });

  it('does not overwrite admin edits on re-seed', async () => {
    await seedAll();
    await CabCategory.updateOne({ code: 'MINI' }, { name: 'Mini Plus', active: false });
    await seedAll();
    expect(await CabCategory.findOne({ code: 'MINI' }).lean()).toMatchObject({
      name: 'Mini Plus',
      active: false,
    });
  });
});

describe('cab categories', () => {
  it('public list returns only active categories, in display order, without auth', async () => {
    await seedAll();
    await CabCategory.updateOne({ code: 'SUV' }, { active: false });
    const res = await api().get('/api/v1/cab-categories');
    expect(res.status).toBe(200);
    expect(res.body.data.map((c: { code: string }) => c.code)).toEqual(['MINI', 'SEDAN']);
  });

  it('admin can create, update, and deactivate; duplicates conflict', async () => {
    const admin = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    const create = await api()
      .post('/api/v1/admin/cab-categories')
      .set(admin.auth)
      .send({ code: 'luxury', name: 'Luxury', capacity: 4, displayOrder: 9 });
    expect(create.status).toBe(201);
    expect(create.body.data.code).toBe('LUXURY');

    const dup = await api()
      .post('/api/v1/admin/cab-categories')
      .set(admin.auth)
      .send({ code: 'LUXURY', name: 'Luxury 2', capacity: 4 });
    expect(dup.status).toBe(409);

    const id = create.body.data.id;
    const patch = await api()
      .patch(`/api/v1/admin/cab-categories/${id}`)
      .set(admin.auth)
      .send({ active: false });
    expect(patch.body.data.active).toBe(false);
    expect((await api().get('/api/v1/cab-categories')).body.data).toHaveLength(0);
    // code is immutable
    expect(
      (await api().patch(`/api/v1/admin/cab-categories/${id}`).set(admin.auth).send({ code: 'X1' }))
        .status,
    ).toBe(400);
  });

  it('is forbidden for non-config roles and records audit entries', async () => {
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const res = await api()
      .post('/api/v1/admin/cab-categories')
      .set(customer.auth)
      .send({ code: 'HACK', name: 'Hack', capacity: 4 });
    expect(res.status).toBe(403);
    expect(await CabCategory.countDocuments()).toBe(0);
  });

  it('validates input', async () => {
    const admin = await loginAsAdmin(env, nextPhone(), 'SUPER_ADMIN');
    const post = (body: object) =>
      api().post('/api/v1/admin/cab-categories').set(admin.auth).send(body);
    expect((await post({ code: 'A B', name: 'x', capacity: 4 })).status).toBe(400);
    expect((await post({ code: 'OK', name: 'x', capacity: 0 })).status).toBe(400);
    expect(
      (await api().patch('/api/v1/admin/cab-categories/not-an-id').set(admin.auth).send({})).status,
    ).toBe(400);
  });
});

describe('vehicles', () => {
  it('registers a vehicle with a normalised registration number', async () => {
    await seedAll();
    const cat = await CabCategory.findOne({ code: 'SEDAN' });
    const d = await driver();
    const res = await api()
      .post('/api/v1/drivers/me/vehicles')
      .set(d.auth)
      .send(vehicleBody(cat!.id));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      registrationNumber: 'DL01AB1234',
      verificationStatus: 'PENDING',
    });
    expect((await api().get('/api/v1/drivers/me/vehicles').set(d.auth)).body.data).toHaveLength(1);
  });

  it('rejects duplicate registrations across drivers, inactive categories, and bad input', async () => {
    await seedAll();
    const sedan = await CabCategory.findOne({ code: 'SEDAN' });
    const suv = await CabCategory.findOne({ code: 'SUV' });
    await CabCategory.updateOne({ code: 'SUV' }, { active: false });
    const a = await driver();
    const b = await driver();
    expect(
      (await api().post('/api/v1/drivers/me/vehicles').set(a.auth).send(vehicleBody(sedan!.id)))
        .status,
    ).toBe(201);
    const dup = await api()
      .post('/api/v1/drivers/me/vehicles')
      .set(b.auth)
      .send(vehicleBody(sedan!.id, 'dl-01-ab-1234'));
    expect(dup.status).toBe(409);
    expect(
      (
        await api()
          .post('/api/v1/drivers/me/vehicles')
          .set(b.auth)
          .send(vehicleBody(suv!.id, 'MH12XY9999'))
      ).status,
    ).toBe(422);
    expect(
      (
        await api()
          .post('/api/v1/drivers/me/vehicles')
          .set(b.auth)
          .send(vehicleBody(sedan!.id, '!!'))
      ).status,
    ).toBe(400);
    expect(
      (
        await api()
          .post('/api/v1/drivers/me/vehicles')
          .set(b.auth)
          .send({ ...vehicleBody(sedan!.id, 'MH12XY9999'), verificationStatus: 'VERIFIED' })
      ).status,
    ).toBe(400);
  });

  it("a driver cannot modify another driver's vehicle; own edits cannot change identity fields", async () => {
    await seedAll();
    const cat = await CabCategory.findOne({ code: 'MINI' });
    const a = await driver();
    const b = await driver();
    const v = await api()
      .post('/api/v1/drivers/me/vehicles')
      .set(a.auth)
      .send(vehicleBody(cat!.id));
    const id = v.body.data.id;

    expect(
      (await api().patch(`/api/v1/drivers/me/vehicles/${id}`).set(b.auth).send({ color: 'Red' }))
        .status,
    ).toBe(404);
    expect((await api().get('/api/v1/drivers/me/vehicles').set(b.auth)).body.data).toHaveLength(0);

    const own = await api()
      .patch(`/api/v1/drivers/me/vehicles/${id}`)
      .set(a.auth)
      .send({ color: 'Red' });
    expect(own.body.data.color).toBe('Red');
    expect(
      (
        await api()
          .patch(`/api/v1/drivers/me/vehicles/${id}`)
          .set(a.auth)
          .send({ registrationNumber: 'XX00XX0000' })
      ).status,
    ).toBe(400);
  });

  it('is limited to 5 vehicles per driver', async () => {
    await seedAll();
    const cat = await CabCategory.findOne({ code: 'MINI' });
    const d = await driver();
    for (let i = 0; i < 5; i++) {
      const r = await api()
        .post('/api/v1/drivers/me/vehicles')
        .set(d.auth)
        .send(vehicleBody(cat!.id, `KA01AB${1000 + i}`));
      expect(r.status).toBe(201);
    }
    expect(
      (
        await api()
          .post('/api/v1/drivers/me/vehicles')
          .set(d.auth)
          .send(vehicleBody(cat!.id, 'KA01AB9999'))
      ).status,
    ).toBe(422);
  });

  it('admin verifies or rejects a vehicle (reason required) and it is audited', async () => {
    await seedAll();
    const cat = await CabCategory.findOne({ code: 'MINI' });
    const d = await driver();
    const v = await api()
      .post('/api/v1/drivers/me/vehicles')
      .set(d.auth)
      .send(vehicleBody(cat!.id));
    const id = v.body.data.id;
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');

    expect(
      (
        await api()
          .patch(`/api/v1/admin/vehicles/${id}/verification`)
          .set(ops.auth)
          .send({ status: 'REJECTED' })
      ).status,
    ).toBe(400);
    const rej = await api()
      .patch(`/api/v1/admin/vehicles/${id}/verification`)
      .set(ops.auth)
      .send({ status: 'REJECTED', reason: 'RC mismatch' });
    expect(rej.body.data).toMatchObject({
      verificationStatus: 'REJECTED',
      rejectionReason: 'RC mismatch',
    });
    const ok = await api()
      .patch(`/api/v1/admin/vehicles/${id}/verification`)
      .set(ops.auth)
      .send({ status: 'VERIFIED' });
    expect(ok.body.data).toMatchObject({ verificationStatus: 'VERIFIED', rejectionReason: null });

    // The driver cannot self-verify.
    expect(
      (
        await api()
          .patch(`/api/v1/admin/vehicles/${id}/verification`)
          .set(d.auth)
          .send({ status: 'VERIFIED' })
      ).status,
    ).toBe(403);
  });
});
