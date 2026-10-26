import request from 'supertest';
import { io as connectClient } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Session as SessionDoc } from '../src/modules/auth/session.model';
import {
  loginAs,
  loginAsAdmin,
  nextPhone,
  sleep,
  startTestEnv,
  until,
  type TestEnv,
} from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv({}, { socket: { maxSocketsPerUser: 2, revalidateMs: 3_600_000 } });
});
afterAll(() => env.stop());
beforeEach(() => env.reset());

const api = () => request(env.app);

describe('who may connect', () => {
  it('refuses a connection with no token, a junk token or a token signed with another key', async () => {
    const rejected = { message: 'UNAUTHENTICATED', data: { code: 'UNAUTHENTICATED' } };
    await expect(env.connect('', { waitForHello: false })).rejects.toMatchObject(rejected);
    await expect(env.connect('not-a-token')).rejects.toMatchObject(rejected);
    const forged = (await import('jsonwebtoken')).default.sign(
      { sub: '507f1f77bcf86cd799439011', sid: '507f1f77bcf86cd799439012' },
      'x'.repeat(32),
    );
    await expect(env.connect(forged)).rejects.toMatchObject(rejected);
  });

  it('accepts a valid token and says hello with the caller identity', async () => {
    const c = await loginAs(env, nextPhone(), 'CUSTOMER');
    const s = await env.connect(c.accessToken);
    const hello = await s.waitFor('hello');
    expect(hello.data).toMatchObject({ userId: c.userId, role: 'CUSTOMER' });
    expect(hello.id).toBeTruthy();
    s.close();
  });

  it('also accepts the token in an Authorization header', async () => {
    const c = await loginAs(env, nextPhone(), 'CUSTOMER');
    const socket = connectClient(env.url, {
      extraHeaders: { authorization: `Bearer ${c.accessToken}` },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    await new Promise<void>((resolve, reject) => {
      socket.on('hello', () => resolve());
      socket.on('connect_error', reject);
    });
    socket.close();
  });

  it('refuses a token whose session was logged out', async () => {
    const c = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await api().post('/api/v1/auth/logout').set(c.auth)).status).toBe(200);
    await expect(env.connect(c.accessToken)).rejects.toMatchObject({ message: 'UNAUTHENTICATED' });
  });

  it('refuses a suspended account', async () => {
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const c = await loginAs(env, nextPhone(), 'CUSTOMER');
    await api()
      .patch(`/api/v1/admin/users/${c.userId}/status`)
      .set(ops.auth)
      .send({ status: 'SUSPENDED', reason: 'testing' });
    await expect(env.connect(c.accessToken)).rejects.toBeDefined();
  });
});

describe('ending a connection', () => {
  it('a suspension drops the live socket straight away', async () => {
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const c = await loginAs(env, nextPhone(), 'CUSTOMER');
    const s = await env.connect(c.accessToken);
    const res = await api()
      .patch(`/api/v1/admin/users/${c.userId}/status`)
      .set(ops.auth)
      .send({ status: 'SUSPENDED', reason: 'abuse reported' });
    expect(res.status).toBe(200);
    const revoked = await s.waitFor('auth:revoked');
    expect(revoked.data).toMatchObject({ reason: 'SUSPENDED' });
    await until(() => !s.socket.connected, 'the socket is closed');
  });

  it('the periodic check drops sockets whose session has ended (logout, theft)', async () => {
    const c = await loginAs(env, nextPhone(), 'CUSTOMER');
    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    const mine = await env.connect(c.accessToken);
    const bystander = await env.connect(other.accessToken);

    await api().post('/api/v1/auth/logout').set(c.auth);
    expect(await env.sockets.revalidateNow()).toBe(1);
    await mine.waitFor('auth:revoked');
    await until(() => !mine.socket.connected, 'the logged-out socket is closed');
    await sleep(100);
    expect(bystander.socket.connected).toBe(true); // nobody else is touched

    // A session revoked directly in the database (e.g. refresh-token theft handling) is caught too.
    await SessionDoc.updateMany({ userId: other.userId }, { revokedAt: new Date() });
    expect(await env.sockets.revalidateNow()).toBe(1);
    await until(() => !bystander.socket.connected, 'the revoked session socket is closed');
  });

  it('a user can hold only a few connections; the oldest is dropped', async () => {
    const c = await loginAs(env, nextPhone(), 'CUSTOMER');
    const first = await env.connect(c.accessToken);
    await sleep(20);
    const second = await env.connect(c.accessToken);
    await sleep(20);
    const third = await env.connect(c.accessToken);
    await until(() => !first.socket.connected, 'the oldest connection is evicted');
    expect(second.socket.connected).toBe(true);
    expect(third.socket.connected).toBe(true);
  });
});
