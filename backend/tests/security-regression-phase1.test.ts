import { createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { totpCode } from '../src/common/totp';
import { AuditLog } from '../src/modules/audit/auditLog.model';
import { Session } from '../src/modules/auth/session.model';
import { User } from '../src/modules/users/user.model';
import {
  HASH_SECRET,
  loginAsAdmin,
  nextPhone,
  startTestEnv,
  type Session as TestSession,
  type TestEnv,
} from './helpers';

let env: TestEnv;
let root: TestSession;

beforeAll(async () => {
  env = await startTestEnv();
});

afterAll(() => env.stop());

beforeEach(async () => {
  await env.reset();
  root = await loginAsAdmin(env, nextPhone(), 'SUPER_ADMIN');
});

const api = () => request(env.app);
const PASSWORD = 'correct horse battery 7';
let counter = 0;
const nextEmail = () => `sec_reg_${++counter}_${Date.now()}@example.com`;
const tokenIn = (text: string) => /token=([\w-]+)/.exec(text)![1]!;

/**
 * Provision a legitimate staff member through the official super admin invite -> setup -> confirm flow.
 */
async function provisionStaff(role: 'SUPPORT' | 'OPS' | 'SUPER_ADMIN' = 'SUPPORT') {
  const email = nextEmail();
  const created = await api()
    .post('/api/v1/admin/staff')
    .set(root.auth)
    .send({ phone: nextPhone(), name: 'Regression Staff', role, email });
  expect(created.status).toBe(201);

  const mail = env.emails.at(-1)!;
  expect(mail.to).toBe(email);
  const inviteToken = tokenIn(mail.text);

  const setupRes = await api()
    .post('/api/v1/auth/staff/setup')
    .send({ inviteToken, password: PASSWORD });
  expect(setupRes.status).toBe(200);

  const secret = setupRes.body.data.totp.secret as string;
  const confirmRes = await api()
    .post('/api/v1/auth/staff/setup/confirm')
    .send({
      setupSession: setupRes.body.data.setupSession,
      code: totpCode(secret, Date.now()),
    });
  expect(confirmRes.status).toBe(200);

  return {
    email,
    secret,
    userId: created.body.data.userId as string,
    role,
    accessToken: confirmRes.body.data.accessToken as string,
    refreshToken: confirmRes.body.data.refreshToken as string,
  };
}

describe('Phase 1 — Security Regression Tests: Authentication Bypass Fix', () => {
  // 1 & 2: Old bypass endpoints no longer issue sessions
  it('1. Old bypass login endpoint (/admin/auth/login) no longer issues a session', async () => {
    const sessionsBefore = await Session.countDocuments();
    const res = await api().post('/api/v1/admin/auth/login').send({
      email: 'admin@platform.internal',
      password: 'any-password',
    });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeUndefined();
    expect(await Session.countDocuments()).toBe(sessionsBefore);
  });

  it('2. Old bypass MFA endpoint (/admin/auth/mfa/verify) no longer issues a session', async () => {
    const sessionsBefore = await Session.countDocuments();
    const res = await api().post('/api/v1/admin/auth/mfa/verify').send({
      mfaCode: '123456',
    });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.data).toBeUndefined();
    expect(await Session.countDocuments()).toBe(sessionsBefore);
  });

  // 10: Login attempts cannot auto-create a SUPER_ADMIN account
  it('10. Login attempts cannot auto-create a SUPER_ADMIN account', async () => {
    const adminPhone = '+919876543210';
    const superAdminsBefore = await User.countDocuments({ role: 'SUPER_ADMIN' });

    // Attempt through old endpoints
    await api().post('/api/v1/admin/auth/login').send({ email: 'admin@platform.internal' });
    await api().post('/api/v1/admin/auth/mfa/verify').send({});

    // Attempt through legitimate endpoint with unprovisioned identity
    await api()
      .post('/api/v1/auth/staff/login')
      .send({ email: 'attacker@platform.internal', password: 'password123' });

    const superAdminsAfter = await User.countDocuments({ role: 'SUPER_ADMIN' });
    expect(superAdminsAfter).toBe(superAdminsBefore);

    const bypassUser = await User.findOne({ phone: adminPhone });
    expect(bypassUser).toBeNull();
  });

  // 3: Missing credentials are rejected
  it('3. Missing credentials are rejected with validation errors (400)', async () => {
    const emptyBody = await api().post('/api/v1/auth/staff/login').send({});
    expect(emptyBody.status).toBe(400);
    expect(emptyBody.body.success).toBe(false);

    const missingPass = await api()
      .post('/api/v1/auth/staff/login')
      .send({ email: 'staff@example.com' });
    expect(missingPass.status).toBe(400);

    const missingEmail = await api().post('/api/v1/auth/staff/login').send({ password: PASSWORD });
    expect(missingEmail.status).toBe(400);

    const invalidEmail = await api()
      .post('/api/v1/auth/staff/login')
      .send({ email: 'not-an-email', password: PASSWORD });
    expect(invalidEmail.status).toBe(400);
  });

  // 4: Incorrect password is rejected
  it('4. Incorrect password is rejected (401)', async () => {
    const staff = await provisionStaff('SUPPORT');
    const res = await api().post('/api/v1/auth/staff/login').send({
      email: staff.email,
      password: 'WrongPassword!999',
    });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toBe('Invalid email or password.');
    expect(res.body.data).toBeUndefined();
  });

  // 5: Invalid or expired MFA is rejected
  it('5. Invalid or expired MFA is rejected (401)', async () => {
    const staff = await provisionStaff('SUPPORT');
    const loginRes = await api().post('/api/v1/auth/staff/login').send({
      email: staff.email,
      password: PASSWORD,
    });
    expect(loginRes.status).toBe(200);
    const mfaToken = loginRes.body.data.mfaToken as string;

    // Invalid code
    const invalidCode = await api()
      .post('/api/v1/auth/staff/mfa')
      .send({ mfaToken, code: '000000' });
    expect(invalidCode.status).toBe(401);
    expect(invalidCode.body.error.message).toBe('That code is not right.');

    // Malformed/invalid token
    const badToken = await api()
      .post('/api/v1/auth/staff/mfa')
      .send({ mfaToken: 'x'.repeat(40), code: '123456' });
    expect(badToken.status).toBe(401);
    expect(badToken.body.error.message).toMatch(/expired|start again/i);

    // Truly expired flow token
    const flowKey = createHmac('sha256', HASH_SECRET).update('staff-flow-jwt').digest('hex');
    const expiredToken = jwt.sign({ purpose: 'staff-mfa' }, flowKey, {
      algorithm: 'HS256',
      subject: staff.userId,
      expiresIn: -10,
    });
    const expiredRes = await api()
      .post('/api/v1/auth/staff/mfa')
      .send({ mfaToken: expiredToken, code: '123456' });
    expect(expiredRes.status).toBe(401);
    expect(expiredRes.body.error.message).toMatch(/expired|start again/i);
  });

  // 6: Unauthenticated request cannot access protected SUPER_ADMIN endpoints
  it('6. An unauthenticated request cannot access a protected SUPER_ADMIN endpoint (401)', async () => {
    const logs = await api().get('/api/v1/admin/audit-logs');
    expect(logs.status).toBe(401);

    const staffList = await api().get('/api/v1/admin/staff');
    expect(staffList.status).toBe(401);

    const createStaff = await api()
      .post('/api/v1/admin/staff')
      .send({ phone: nextPhone(), name: 'Test', role: 'SUPPORT' });
    expect(createStaff.status).toBe(401);
  });

  // 7: Normal staff account cannot perform SUPER_ADMIN-only actions
  it('7. A normal staff account cannot perform SUPER_ADMIN-only actions (403)', async () => {
    const support = await provisionStaff('SUPPORT');
    const supportAuth = { Authorization: `Bearer ${support.accessToken}` };

    // SUPPORT can read support tickets
    const tickets = await api().get('/api/v1/admin/support/tickets').set(supportAuth);
    expect(tickets.status).toBe(200);

    // SUPPORT is forbidden from reading audit logs (SUPER_ADMIN only)
    const logs = await api().get('/api/v1/admin/audit-logs').set(supportAuth);
    expect(logs.status).toBe(403);

    // SUPPORT is forbidden from creating staff
    const createStaff = await api()
      .post('/api/v1/admin/staff')
      .set(supportAuth)
      .send({ phone: nextPhone(), name: 'Test', role: 'SUPPORT' });
    expect(createStaff.status).toBe(403);
  });

  // 8: Valid, provisioned staff account can authenticate through legitimate flow
  it('8. A valid, provisioned staff account can authenticate through the legitimate flow', async () => {
    const superAdmin = await provisionStaff('SUPER_ADMIN');

    // Step 1: Login with email + password
    const step1 = await api().post('/api/v1/auth/staff/login').send({
      email: superAdmin.email,
      password: PASSWORD,
    });
    expect(step1.status).toBe(200);
    expect(step1.body.data.mfaRequired).toBe(true);
    expect(step1.body.data.mfaToken).toBeTruthy();
    expect(step1.body.data.accessToken).toBeUndefined(); // No access token before MFA

    // Step 2: Verify TOTP MFA
    const code = totpCode(superAdmin.secret, Date.now() + 60_000);
    env.setNow(new Date(Date.now() + 60_000));
    const step2 = await api().post('/api/v1/auth/staff/mfa').send({
      mfaToken: step1.body.data.mfaToken,
      code,
    });
    expect(step2.status).toBe(200);
    expect(step2.body.data.accessToken).toBeTruthy();
    expect(step2.body.data.refreshToken).toBeTruthy();
    expect(step2.body.data.user).toMatchObject({
      id: superAdmin.userId,
      role: 'SUPER_ADMIN',
    });

    // Access privileged SUPER_ADMIN endpoint
    const privilegedRes = await api()
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', `Bearer ${step2.body.data.accessToken}`);
    expect(privilegedRes.status).toBe(200);
    env.setNow(null);
  });

  // 9: Privileged token is issued only after required authentication steps succeed
  it('9. A privileged token is issued only after required authentication steps succeed', async () => {
    const superAdmin = await provisionStaff('SUPER_ADMIN');

    const step1 = await api().post('/api/v1/auth/staff/login').send({
      email: superAdmin.email,
      password: PASSWORD,
    });
    expect(step1.status).toBe(200);
    const flowToken = step1.body.data.mfaToken as string;

    // The intermediate flow token MUST NOT grant access to API endpoints
    const tryAuditWithFlowToken = await api()
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', `Bearer ${flowToken}`);
    expect(tryAuditWithFlowToken.status).toBe(401);

    const tryStaffWithFlowToken = await api()
      .get('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${flowToken}`);
    expect(tryStaffWithFlowToken.status).toBe(401);
  });

  // 11: Account lockout and token refresh protections continue to work
  it('11. Account lockout after 5 failures and token-refresh protections continue to work', async () => {
    const staff = await provisionStaff('SUPER_ADMIN');

    // Lockout: 5 failed login attempts
    for (let i = 0; i < 5; i++) {
      const fail = await api().post('/api/v1/auth/staff/login').send({
        email: staff.email,
        password: 'wrong-password',
      });
      expect(fail.status).toBe(401);
    }

    // 6th attempt with CORRECT password is now rejected with 429
    const lockedRes = await api().post('/api/v1/auth/staff/login').send({
      email: staff.email,
      password: PASSWORD,
    });
    expect(lockedRes.status).toBe(429);
    expect(lockedRes.body.error.message).toMatch(/too many failed attempts/i);
    expect(await AuditLog.countDocuments({ action: 'staff.login.locked' })).toBe(1);

    // Token-refresh: Rotate legitimate refresh token
    const refreshRes = await api().post('/api/v1/auth/refresh').send({
      refreshToken: staff.refreshToken,
    });
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.data.accessToken).toBeTruthy();
    expect(refreshRes.body.data.refreshToken).toBeTruthy();
    const newAccessToken = refreshRes.body.data.accessToken as string;
    
    // Verify new access token works for SUPER_ADMIN actions
    const auditRes = await api()
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', `Bearer ${newAccessToken}`);
    expect(auditRes.status).toBe(200);

    // Refresh token reuse detection: replaying the old token revokes all sessions
    const replayRes = await api().post('/api/v1/auth/refresh').send({
      refreshToken: staff.refreshToken,
    });
    expect(replayRes.status).toBe(401);

    // The entire session is now revoked due to reuse detection
    const postReplayRes = await api()
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', `Bearer ${newAccessToken}`);
    expect(postReplayRes.status).toBe(401);
  });
});
