import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/auditLog.model';
import { Session as SessionDoc } from '../src/modules/auth/session.model';
import { User } from '../src/modules/users/user.model';
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
  env = await startTestEnv({}, { featureDefaults: { SOS: false } });
});
afterAll(() => env.stop());
beforeEach(() => env.reset());

const api = () => request(env.app);
const setFlag = (who: Session, key: string, body: object) =>
  api().put(`/api/v1/admin/feature-flags/${key}`).set(who.auth).send(body);

describe('feature flags', () => {
  it('apps see every flag resolved for their role; unset ones take the server default', async () => {
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const res = await api().get('/api/v1/config/flags').set(customer.auth);
    expect(res.body.data).toEqual({
      SOS: false, // this server was started with SOS off, as production is
      TRIP_SHARING: true,
      SUPPORT_TICKETS: true,
      RATINGS: true,
      COUPONS: true,
      TIPS: true,
      WALLET: true,
      CORPORATE: true,
    });
    expect((await api().get('/api/v1/config/flags')).status).toBe(401);
  });

  it('staff can switch a feature on, off, or for some roles only, and it is audited', async () => {
    const config = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const driver = await loginAs(env, nextPhone(), 'DRIVER');
    const flags = async (who: Session) =>
      (await api().get('/api/v1/config/flags').set(who.auth)).body.data;

    expect((await setFlag(config, 'SOS', { enabled: true })).status).toBe(200);
    expect((await flags(customer)).SOS).toBe(true);

    // Only for drivers: riders no longer see it.
    await setFlag(config, 'SOS', { enabled: true, roles: ['DRIVER'] });
    expect((await flags(driver)).SOS).toBe(true);
    expect((await flags(customer)).SOS).toBe(false);

    await setFlag(config, 'RATINGS', { enabled: false });
    expect((await flags(customer)).RATINGS).toBe(false);

    const list = (await api().get('/api/v1/admin/feature-flags').set(config.auth)).body.data;
    expect(list.find((f: { key: string }) => f.key === 'SOS')).toMatchObject({
      enabled: true,
      roles: ['DRIVER'],
      source: 'STAFF',
    });
    expect(list.find((f: { key: string }) => f.key === 'COUPONS')).toMatchObject({
      enabled: true,
      source: 'DEFAULT',
    });
    expect(await AuditLog.countDocuments({ action: 'flag.set' })).toBe(3);
  });

  it('refuses unknown keys, stray fields, and everyone but configuration staff', async () => {
    const config = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    expect((await setFlag(config, 'SOSS', { enabled: true })).status).toBe(400);
    expect((await setFlag(config, 'SOS', { enabled: true, extra: 1 })).status).toBe(400);
    expect((await setFlag(config, 'SOS', {})).status).toBe(400);
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    for (const who of [ops, customer]) {
      expect((await setFlag(who, 'SOS', { enabled: true })).status).toBe(403);
      expect((await api().get('/api/v1/admin/feature-flags').set(who.auth)).status).toBe(403);
    }
  });
});

describe('staff accounts', () => {
  const create = (who: Session, body: object) =>
    api().post('/api/v1/admin/staff').set(who.auth).send(body);
  const changeRole = (who: Session, userId: string, body: object) =>
    api().patch(`/api/v1/admin/staff/${userId}/role`).set(who.auth).send(body);

  it('a super admin creates staff by phone, they sign in with OTP, and it is audited', async () => {
    const root = await loginAsAdmin(env, nextPhone(), 'SUPER_ADMIN');
    const phone = nextPhone();
    const made = await create(root, { phone, name: 'Meera Nair', role: 'SUPPORT' });
    expect(made.status).toBe(201);
    expect(made.body.data).toMatchObject({
      role: 'SUPPORT',
      name: 'Meera Nair',
      accountStatus: 'ACTIVE',
    });
    const session = await loginAs(env, phone); // the usual OTP login
    expect((await api().get('/api/v1/admin/support/tickets').set(session.auth)).status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'staff.create' })).toBe(1);

    const list = await api().get('/api/v1/admin/staff').set(root.auth);
    expect(list.body.data.map((u: { role: string }) => u.role).sort()).toEqual([
      'SUPER_ADMIN',
      'SUPPORT',
    ]);
    expect(
      (await api().get('/api/v1/admin/staff?role=SUPPORT').set(root.auth)).body.data,
    ).toHaveLength(1);
  });

  it('cannot make customers or drivers, duplicates, or junk', async () => {
    const root = await loginAsAdmin(env, nextPhone(), 'SUPER_ADMIN');
    const phone = nextPhone();
    expect((await create(root, { phone, name: 'A B', role: 'CUSTOMER' })).status).toBe(400);
    expect((await create(root, { phone, name: 'A B', role: 'GOD' })).status).toBe(400);
    expect((await create(root, { phone: '123', name: 'A B', role: 'OPS' })).status).toBe(400);
    expect((await create(root, { phone, name: 'A B', role: 'OPS', admin: true })).status).toBe(400);
    expect((await create(root, { phone, name: 'A B', role: 'OPS' })).status).toBe(201);
    expect((await create(root, { phone, name: 'A B', role: 'FINANCE' })).status).toBe(409);
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect(
      (
        await create(root, {
          phone: (await User.findById(customer.userId))!.phone,
          name: 'A B',
          role: 'OPS',
        })
      ).status,
    ).toBe(409);
  });

  it('changes a role, ends that person’s sessions, and never lets anyone change their own', async () => {
    const root = await loginAsAdmin(env, nextPhone(), 'SUPER_ADMIN');
    const other = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    const socket = await env.connect(other.accessToken);

    const res = await changeRole(root, other.userId, {
      role: 'FINANCE',
      reason: 'Moved to finance',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('FINANCE');
    // The old login stops working and the live connection is dropped.
    expect((await api().get('/api/v1/admin/support/tickets').set(other.auth)).status).toBe(401);
    expect(await SessionDoc.countDocuments({ userId: other.userId, revokedAt: null })).toBe(0);
    await socket.waitFor('auth:revoked');
    expect(await AuditLog.countDocuments({ action: 'staff.role_change' })).toBe(1);

    expect(
      (await changeRole(root, root.userId, { role: 'OPS', reason: 'Demote myself' })).status,
    ).toBe(422);
    expect(
      (await changeRole(root, other.userId, { role: 'FINANCE', reason: 'Again' })).status,
    ).toBe(409);
    expect((await changeRole(root, other.userId, { role: 'OPS' })).status).toBe(400); // reason required
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect(
      (await changeRole(root, customer.userId, { role: 'OPS', reason: 'Promote a rider' })).status,
    ).toBe(422);
  });

  it('is for super admins only', async () => {
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const config = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    for (const who of [ops, config, customer]) {
      expect((await api().get('/api/v1/admin/staff').set(who.auth)).status).toBe(403);
      expect((await create(who, { phone: nextPhone(), name: 'A B', role: 'OPS' })).status).toBe(
        403,
      );
      expect((await changeRole(who, ops.userId, { role: 'OPS', reason: 'abc' })).status).toBe(403);
    }
  });
});

describe('suspending and reactivating staff', () => {
  const setStatus = (who: Session, userId: string, status: string) =>
    api()
      .patch(`/api/v1/admin/users/${userId}/status`)
      .set(who.auth)
      .send({ status, reason: 'Review pending' });

  it('only a super admin may, it ends their login at once, and they can return when reactivated', async () => {
    const root = await loginAsAdmin(env, nextPhone(), 'SUPER_ADMIN');
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const phone = nextPhone();
    const agent = await loginAsAdmin(env, phone, 'SUPPORT');
    const socket = await env.connect(agent.accessToken);

    expect((await setStatus(ops, agent.userId, 'SUSPENDED')).status).toBe(403); // not even OPS
    expect((await setStatus(root, root.userId, 'SUSPENDED')).status).toBe(422); // not yourself
    const res = await setStatus(root, agent.userId, 'SUSPENDED');
    expect(res.status).toBe(200);
    expect(res.body.data.accountStatus).toBe('SUSPENDED');

    expect((await api().get('/api/v1/admin/support/tickets').set(agent.auth)).status).toBe(401);
    await socket.waitFor('auth:revoked');
    expect(await SessionDoc.countDocuments({ userId: agent.userId, revokedAt: null })).toBe(0);
    // They cannot sign back in while suspended.
    const req = await api().post('/api/v1/auth/otp/request').send({ phone });
    const verify = await api()
      .post('/api/v1/auth/otp/verify')
      .send({
        challengeId: req.body.data?.challengeId,
        phone,
        otp: env.otps.get(phone),
      });
    expect(verify.status).toBe(403);

    expect((await setStatus(root, agent.userId, 'ACTIVE')).body.data.accountStatus).toBe('ACTIVE');
    const back = await loginAs(env, phone);
    expect((await api().get('/api/v1/admin/support/tickets').set(back.auth)).status).toBe(200);
    expect(
      await AuditLog.countDocuments({ action: { $in: ['USER_SUSPENDED', 'USER_REACTIVATED'] } }),
    ).toBe(2);
  });
});
