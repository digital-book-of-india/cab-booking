import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { User } from '../src/modules/users/user.model';
import { loginAs, loginAsAdmin, nextPhone, startTestEnv, type TestEnv } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(() => env.stop());
beforeEach(() => env.reset());

const api = () => request(env.app);

describe('role boundaries', () => {
  it('customers cannot reach driver or admin routes', async () => {
    const c = await loginAs(env, nextPhone(), 'CUSTOMER');
    const probes: [string, string][] = [
      ['get', '/drivers/me/application'],
      ['get', '/drivers/me/vehicles'],
      ['get', '/admin/drivers'],
      ['get', '/admin/cab-categories'],
      ['get', '/admin/audit-logs'],
    ];
    for (const [method, path] of probes) {
      const res = await (api() as unknown as Record<string, (p: string) => request.Test>)[method]!(
        `/api/v1${path}`,
      ).set(c.auth);
      expect(res.status, path).toBe(403);
    }
  });

  it('drivers cannot reach customer or admin routes', async () => {
    const d = await loginAs(env, nextPhone(), 'DRIVER');
    expect((await api().get('/api/v1/customers/me').set(d.auth)).status).toBe(403);
    expect((await api().get('/api/v1/admin/drivers').set(d.auth)).status).toBe(403);
    expect(
      (
        await api()
          .patch('/api/v1/admin/drivers/507f1f77bcf86cd799439011/approval')
          .set(d.auth)
          .send({ decision: 'APPROVE' })
      ).status,
    ).toBe(403);
  });

  it('a driver cannot approve themselves', async () => {
    const d = await loginAs(env, nextPhone(), 'DRIVER');
    const app = await api()
      .post('/api/v1/drivers/applications')
      .set(d.auth)
      .send({ fullName: 'Self Approver', city: 'Delhi' });
    const res = await api()
      .patch(`/api/v1/admin/drivers/${app.body.data.driverId}/approval`)
      .set(d.auth)
      .send({ decision: 'APPROVE' });
    expect(res.status).toBe(403);
  });

  it('admin sub-roles only reach what they are allowed to', async () => {
    const config = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    expect((await api().get('/api/v1/admin/cab-categories').set(config.auth)).status).toBe(200);
    expect((await api().get('/api/v1/admin/drivers').set(config.auth)).status).toBe(403);

    const support = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    expect((await api().get('/api/v1/admin/drivers').set(support.auth)).status).toBe(403);
    expect((await api().get('/api/v1/admin/audit-logs').set(support.auth)).status).toBe(403);
  });
});

describe('client-supplied identity is never trusted', () => {
  it('ignores or rejects role / status / id fields in profile updates', async () => {
    const c = await loginAs(env, nextPhone(), 'CUSTOMER');
    for (const extra of [
      { role: 'SUPER_ADMIN' },
      { accountStatus: 'ACTIVE' },
      { userId: '507f1f77bcf86cd799439011' },
    ]) {
      const res = await api()
        .patch('/api/v1/customers/me')
        .set(c.auth)
        .send({ name: 'X', ...extra });
      expect(res.status).toBe(400);
    }
    expect((await User.findById(c.userId).lean())?.role).toBe('CUSTOMER');
  });

  it('role changes in the database apply to existing tokens immediately', async () => {
    const c = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await api().get('/api/v1/customers/me').set(c.auth)).status).toBe(200);
    await User.updateOne({ _id: c.userId }, { role: 'DRIVER' });
    expect((await api().get('/api/v1/customers/me').set(c.auth)).status).toBe(403);
  });
});

describe('customer profile', () => {
  it('reads and updates own profile', async () => {
    const phone = nextPhone();
    const c = await loginAs(env, phone, 'CUSTOMER');
    const res = await api()
      .patch('/api/v1/customers/me')
      .set(c.auth)
      .send({ name: 'Asha Verma', email: 'ASHA@Example.com' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Asha Verma', email: 'asha@example.com', phone });
    const me = await api().get('/api/v1/auth/me').set(c.auth);
    expect(me.body.data.profileComplete).toBe(true);
  });

  it('validates input', async () => {
    const c = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect(
      (await api().patch('/api/v1/customers/me').set(c.auth).send({ email: 'not-an-email' }))
        .status,
    ).toBe(400);
    expect((await api().patch('/api/v1/customers/me').set(c.auth).send({ name: '' })).status).toBe(
      400,
    );
  });

  it('two customers see only their own data', async () => {
    const a = await loginAs(env, nextPhone(), 'CUSTOMER');
    const b = await loginAs(env, nextPhone(), 'CUSTOMER');
    await api().patch('/api/v1/customers/me').set(a.auth).send({ name: 'Alice' });
    await api().patch('/api/v1/customers/me').set(b.auth).send({ name: 'Bob' });
    expect((await api().get('/api/v1/customers/me').set(a.auth)).body.data.name).toBe('Alice');
    expect((await api().get('/api/v1/customers/me').set(b.auth)).body.data.name).toBe('Bob');
  });
});
