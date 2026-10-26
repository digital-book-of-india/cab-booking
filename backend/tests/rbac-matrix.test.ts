import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Roles, type Role } from '../src/common/enums';
import { routes } from '../src/docs/routes';
import {
  loginAs,
  loginAsAdmin,
  nextPhone,
  startTestEnv,
  type Session,
  type TestEnv,
} from './helpers';

/**
 * Every documented route against every role. The documentation says who may call each endpoint;
 * this proves the code agrees: a role that is not listed gets 403 (never anything else), and a role
 * that is listed is never turned away for its role (it may still get 400/404/409 for the empty
 * request this test sends, which is fine).
 */
let env: TestEnv;
const sessions = new Map<Role, Session>();

beforeAll(async () => {
  env = await startTestEnv({}, { devPayments: true });
  for (const role of Roles) {
    sessions.set(
      role,
      role === 'CUSTOMER' || role === 'DRIVER'
        ? await loginAs(env, nextPhone(), role)
        : await loginAsAdmin(env, nextPhone(), role),
    );
  }
});
afterAll(() => env.stop());

const ANY = 'ANY AUTHENTICATED';
const fill = (path: string) =>
  `/api/v1${path.replace(/\{kind\}/g, 'rides').replace(/\{\w+\}/g, '507f1f77bcf86cd799439011')}`;

describe('who may call what', () => {
  // Logging out would end the very sessions this test is using.
  const guarded = routes.filter((r) => r.auth !== 'public' && r.path !== '/auth/logout');

  it('documents a real role list for every guarded route', () => {
    for (const r of guarded) {
      const roles = r.auth as string[];
      expect(roles.length, `${r.method} ${r.path}`).toBeGreaterThan(0);
      for (const role of roles) expect([...Roles, ANY], `${r.method} ${r.path}`).toContain(role);
    }
  });

  it('refuses every role that is not listed (403) and admits every role that is', async () => {
    const wrong: string[] = [];
    for (const r of guarded) {
      const listed = r.auth as string[];
      for (const role of Roles) {
        const allowed = listed.includes(ANY) || listed.includes(role);
        const res = await (
          request(env.app) as unknown as Record<string, (p: string) => request.Test>
        )[r.method]!(fill(r.path))
          .set(sessions.get(role)!.auth)
          .send(r.method === 'get' || r.method === 'delete' ? undefined : {});
        // A rider-role route may refine access by membership (a company admin): that refusal is
        // CORPORATE_NOT_ALLOWED, not a role failure.
        const membershipCheck =
          res.status === 403 && res.body?.error?.code === 'CORPORATE_NOT_ALLOWED';
        const denied = (res.status === 403 || res.status === 401) && !membershipCheck;
        if (allowed && denied) {
          wrong.push(
            `${role} should reach ${r.method.toUpperCase()} ${r.path} but got ${res.status} ${res.body?.error?.code ?? ''}`,
          );
        }
        if (!allowed && res.status !== 403) {
          wrong.push(
            `${role} should be refused ${r.method.toUpperCase()} ${r.path} but got ${res.status}`,
          );
        }
      }
    }
    expect(wrong).toEqual([]);
  }, 240_000);
});
