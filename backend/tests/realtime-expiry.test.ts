import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ACCESS_SECRET,
  loginAs,
  nextPhone,
  sleep,
  startTestEnv,
  until,
  type TestEnv,
} from './helpers';

// Tokens live 2 seconds here, so expiry can be observed for real.
let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv({ accessTtlSeconds: 2 }, { socket: { refreshGraceMs: 500 } });
});
afterAll(() => env.stop());
beforeEach(() => env.reset());

/** A long-lived token for an existing session: what the app gets from a REST refresh. */
const freshToken = (userId: string, sessionId: string) =>
  jwt.sign({ sub: userId, sid: sessionId }, ACCESS_SECRET, { algorithm: 'HS256', expiresIn: 900 });

const sessionIdOf = (accessToken: string) => (jwt.decode(accessToken) as { sid: string }).sid;

describe('access token expiry on a live socket', () => {
  it('warns the client, then drops it if no new token arrives', async () => {
    const c = await loginAs(env, nextPhone(), 'CUSTOMER');
    const s = await env.connect(c.accessToken);
    await s.waitFor('auth:expired', 4000);
    await until(() => !s.socket.connected, 'the expired socket is dropped', 3000);
  });

  it('stays connected when the client sends a fresh token in time', async () => {
    const c = await loginAs(env, nextPhone(), 'CUSTOMER');
    const kept = await env.connect(c.accessToken);
    const dropped = await env.connect(c.accessToken); // control: same token, no refresh

    const ack = await new Promise<{ ok: boolean }>((resolve) =>
      kept.socket.emit(
        'auth:refresh',
        { token: freshToken(c.userId, sessionIdOf(c.accessToken)) },
        resolve,
      ),
    );
    expect(ack.ok).toBe(true);

    await until(() => !dropped.socket.connected, 'the control socket is dropped', 4000);
    expect(kept.socket.connected).toBe(true);
    expect(kept.count('auth:expired')).toBe(0);
  });

  it("refuses a token from someone else's session and keeps the old one", async () => {
    const a = await loginAs(env, nextPhone(), 'CUSTOMER');
    const b = await loginAs(env, nextPhone(), 'CUSTOMER');
    const s = await env.connect(a.accessToken);
    const ack = await new Promise<{ ok: boolean; error?: { code: string } }>((resolve) =>
      s.socket.emit(
        'auth:refresh',
        { token: freshToken(b.userId, sessionIdOf(b.accessToken)) },
        resolve,
      ),
    );
    expect(ack).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    await sleep(50);
    expect(s.socket.connected).toBe(true); // still on its own (soon to expire) token
  });

  it('refuses a malformed or junk refresh', async () => {
    const a = await loginAs(env, nextPhone(), 'CUSTOMER');
    const s = await env.connect(a.accessToken);
    for (const payload of [{}, { token: 'short' }, { token: 'x'.repeat(40) }, null]) {
      const ack = await new Promise<{ ok: boolean }>((resolve) =>
        s.socket.emit('auth:refresh', payload, resolve),
      );
      expect(ack.ok).toBe(false);
    }
  });
});
