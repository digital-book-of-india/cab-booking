import request from 'supertest';
import { io as connectClient } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CP,
  IGI,
  loginAs,
  nextPhone,
  seedWorld,
  startTestEnv,
  type Session,
  type TestEnv,
} from './helpers';

let limited: TestEnv;
let a: Session;
let b: Session;
let c: Session;
beforeAll(async () => {
  limited = await startTestEnv(
    {},
    { callerWriteLimitPerMinute: 8, couponGuessLimit: 3, socket: { handshakesPerMinute: 3 } },
  );
  // Logging in counts against the address (2 writes each), so everyone signs in once, up front.
  a = await loginAs(limited, nextPhone(), 'CUSTOMER');
  b = await loginAs(limited, nextPhone(), 'CUSTOMER');
  c = await loginAs(limited, nextPhone(), 'CUSTOMER');
});
afterAll(() => limited.stop());

describe('abuse limits', () => {
  it('one caller cannot make unlimited writes; reads and other callers are unaffected', async () => {
    const write = (who: Session) =>
      request(limited.app).post('/api/v1/support/tickets').set(who.auth).send({});
    const results: number[] = [];
    for (let i = 0; i < 10; i += 1) results.push((await write(a)).status);
    expect(results.slice(0, 8).every((s) => s === 400)).toBe(true); // reached validation
    expect(results.slice(8)).toEqual([429, 429]);
    expect((await write(b)).status).toBe(400);
    expect((await request(limited.app).get('/api/v1/auth/me').set(a.auth)).status).toBe(200);
  });

  it('stops coupon-code guessing but leaves normal quotes alone', async () => {
    const world = await seedWorld();
    const who = c;
    const quote = (body: object) =>
      request(limited.app)
        .post('/api/v1/fare-quotes')
        .set(who.auth)
        .send({ pickup: CP, drop: IGI, categoryId: world.cats['MINI'], ...body });
    const codes: number[] = [];
    for (let i = 0; i < 5; i += 1) codes.push((await quote({ couponCode: `GUESS${i}` })).status);
    expect(codes).toEqual([422, 422, 422, 429, 429]);
    expect((await quote({})).status).toBe(201);
  });

  it('turns away a flood of socket connection attempts before checking any login', async () => {
    const codes: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const client = connectClient(limited.url, {
        auth: { token: 'not-a-token' },
        reconnection: false,
        transports: ['websocket'],
      });
      const err = await new Promise<{ data?: { code?: string } }>((resolve) =>
        client.once('connect_error', resolve),
      );
      codes.push(err.data?.code ?? '?');
      client.close();
    }
    expect(codes).toEqual([
      'UNAUTHENTICATED',
      'UNAUTHENTICATED',
      'UNAUTHENTICATED',
      'RATE_LIMITED',
      'RATE_LIMITED',
    ]);
  });
});
