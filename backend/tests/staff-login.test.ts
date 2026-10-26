import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, passwordProblem, verifyPassword } from '../src/common/passwords';
import { base32Encode, totpCode, verifyTotp } from '../src/common/totp';
import { Session } from '../src/modules/auth/session.model';
import { AuditLog } from '../src/modules/audit/auditLog.model';
import { StaffCredential } from '../src/modules/staffauth/staffCredential.model';
import { User } from '../src/modules/users/user.model';
import { createSmtpEmail } from '../src/providers/smtp';
import {
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
let n = 0;
const nextEmail = () => `staff${++n}.${Date.now()}@example.com`;
const tokenIn = (text: string) => /token=([\w-]+)/.exec(text)![1]!;
const nowMs = () => Date.now();

/** Create a staff member with an email and finish their setup. Returns what a test needs to sign in. */
async function onboard(role = 'SUPPORT') {
  const email = nextEmail();
  const created = await api()
    .post('/api/v1/admin/staff')
    .set(root.auth)
    .send({ phone: nextPhone(), name: 'Meera Nair', role, email });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const mail = env.emails.at(-1)!;
  expect(mail.to).toBe(email);
  const setup = await api()
    .post('/api/v1/auth/staff/setup')
    .send({ inviteToken: tokenIn(mail.text), password: PASSWORD });
  expect(setup.status, JSON.stringify(setup.body)).toBe(200);
  const secret = setup.body.data.totp.secret as string;
  const confirm = await api()
    .post('/api/v1/auth/staff/setup/confirm')
    .send({ setupSession: setup.body.data.setupSession, code: totpCode(secret, nowMs()) });
  expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);
  return {
    email,
    secret,
    userId: created.body.data.userId as string,
    confirm: confirm.body.data,
    setup: setup.body.data,
  };
}
/** Move the fake clock on a minute, so the next authenticator code is a new one. */
const nextStep = (() => {
  let k = 0;
  return () => {
    k += 1;
    env.setNow(new Date(Date.now() + k * 60_000));
    return Date.now() + k * 60_000;
  };
})();
const login = (email: string, password = PASSWORD) =>
  api().post('/api/v1/auth/staff/login').send({ email, password });
const mfa = (mfaToken: string, body: object) =>
  api()
    .post('/api/v1/auth/staff/mfa')
    .send({ mfaToken, ...body });

describe('the building blocks', () => {
  it('computes authenticator codes the standard way (RFC 6238 test vector)', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(totpCode(secret, 59_000)).toBe('287082');
    expect(totpCode(secret, 1_111_111_109_000)).toBe('081804');
    expect(verifyTotp(secret, '287082', 59_000)).not.toBeNull();
    expect(verifyTotp(secret, '287082', 59_000 + 29_000)).not.toBeNull(); // one step of clock drift is fine
    expect(verifyTotp(secret, '287082', 59_000 + 91_000)).toBeNull();
    expect(verifyTotp(secret, '000000', 59_000)).toBeNull();
  });

  it('hashes passwords with a salt, rejects weak ones, and checks without leaking', async () => {
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    expect(a).not.toBe(b); // salted
    expect(await verifyPassword(PASSWORD, a)).toBe(true);
    expect(await verifyPassword(`${PASSWORD}!`, a)).toBe(false);
    expect(await verifyPassword(PASSWORD, 'not-a-hash')).toBe(false);
    expect(passwordProblem('short')).toMatch(/12/);
    expect(passwordProblem('password1234')).toMatch(/common/);
    expect(passwordProblem('aaaaaaaaaaaaaaaa')).toMatch(/variety/);
    expect(passwordProblem('meera-nair-2026-x', ['meera'])).toMatch(/name or email/);
    expect(passwordProblem(PASSWORD, ['meera'])).toBeNull();
  });

  it('sends email over SMTP safely: no header injection, no leaked errors', async () => {
    const sent: Record<string, unknown>[] = [];
    const ok = createSmtpEmail({
      host: 'h',
      port: 587,
      secure: false,
      user: 'u',
      pass: 'p',
      from: 'Cab <no-reply@x.example>',
      transport: { sendMail: async (m) => (sent.push(m), { messageId: 'id-1' }) },
    });
    expect(await ok.send({ to: 'a@b.co', subject: 'Hi', text: 'Body' })).toEqual({
      providerMessageId: 'id-1',
    });
    expect(sent[0]).toMatchObject({ from: 'Cab <no-reply@x.example>', to: 'a@b.co' });
    await expect(
      ok.send({ to: 'a@b.co\r\nBcc: x@y.co', subject: 'Hi', text: 'B' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const down = createSmtpEmail({
      host: 'h',
      port: 587,
      secure: false,
      user: 'u',
      pass: 'secret-pass',
      from: 'f',
      transport: {
        sendMail: async () => {
          throw new Error('auth failed for secret-pass');
        },
      },
    });
    const err = await down.send({ to: 'a@b.co', subject: 'Hi', text: 'B' }).catch((e) => e);
    expect(err.code).toBe('PROVIDER_ERROR');
    expect(err.message).not.toContain('secret-pass');
  });
});

describe('setting up a staff account', () => {
  it('a super admin invites by email; the person chooses a password and an authenticator; they are signed in', async () => {
    const { email, userId, confirm, setup } = await onboard();
    expect(setup.totp.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(confirm.recoveryCodes).toHaveLength(8);
    expect(confirm.user).toMatchObject({ id: userId, role: 'SUPPORT' });
    // The new session works for staff routes, and nothing secret is stored in the clear.
    const queue = await api()
      .get('/api/v1/admin/support/tickets')
      .set('Authorization', `Bearer ${confirm.accessToken}`);
    expect(queue.status).toBe(200);
    const stored = JSON.stringify(await StaffCredential.findOne({ userId }).lean());
    expect(stored).not.toContain(PASSWORD);
    expect(stored).not.toContain(setup.totp.secret);
    expect(stored).not.toContain(confirm.recoveryCodes[0]);
    // The staff list shows who has finished.
    const list = (await api().get('/api/v1/admin/staff').set(root.auth)).body.data;
    expect(list.find((s: { userId: string }) => s.userId === userId).login).toEqual({
      email,
      mfaEnabled: true,
    });
    expect(await AuditLog.countDocuments({ action: 'staff.credentials.invite' })).toBe(1);
  });

  it('refuses weak passwords, early sign-in, wrong first codes, and a link used twice', async () => {
    const email = nextEmail();
    await api()
      .post('/api/v1/admin/staff')
      .set(root.auth)
      .send({ phone: nextPhone(), name: 'Meera Nair', role: 'OPS', email });
    const token = tokenIn(env.emails.at(-1)!.text);
    const weak = await api()
      .post('/api/v1/auth/staff/setup')
      .send({ inviteToken: token, password: 'short' });
    expect(weak.status).toBe(400);
    expect(
      (
        await api()
          .post('/api/v1/auth/staff/setup')
          .send({ inviteToken: 'x'.repeat(40), password: PASSWORD })
      ).status,
    ).toBe(401);
    const setup = await api()
      .post('/api/v1/auth/staff/setup')
      .send({ inviteToken: token, password: PASSWORD });
    // The password is set but two-step sign-in is not on yet: no sign-in.
    expect((await login(email)).status).toBe(403);
    const wrong = await api()
      .post('/api/v1/auth/staff/setup/confirm')
      .send({ setupSession: setup.body.data.setupSession, code: '000000' });
    expect(wrong.status).toBe(401);
    const ok = await api()
      .post('/api/v1/auth/staff/setup/confirm')
      .send({
        setupSession: setup.body.data.setupSession,
        code: totpCode(setup.body.data.totp.secret, nowMs()),
      });
    expect(ok.status).toBe(200);
    expect(
      (
        await api()
          .post('/api/v1/auth/staff/setup')
          .send({ inviteToken: token, password: PASSWORD })
      ).status,
    ).toBe(401); // used up
    // A flow token is not a login: it is useless as an access token.
    expect(
      (
        await api()
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${setup.body.data.setupSession}`)
      ).status,
    ).toBe(401);
  });

  it('only a super admin can invite; only staff can have a login; an email belongs to one person', async () => {
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const target = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    expect(
      (
        await api()
          .post(`/api/v1/admin/staff/${target.userId}/credentials`)
          .set(ops.auth)
          .send({ email: nextEmail() })
      ).status,
    ).toBe(403);
    const email = nextEmail();
    expect(
      (
        await api()
          .post(`/api/v1/admin/staff/${target.userId}/credentials`)
          .set(root.auth)
          .send({ email })
      ).status,
    ).toBe(201);
    const other = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    expect(
      (
        await api()
          .post(`/api/v1/admin/staff/${other.userId}/credentials`)
          .set(root.auth)
          .send({ email })
      ).status,
    ).toBe(409);
    const customer = (
      await User.create({ phone: nextPhone(), role: 'CUSTOMER', phoneVerifiedAt: new Date() })
    ).id;
    expect(
      (
        await api()
          .post(`/api/v1/admin/staff/${customer}/credentials`)
          .set(root.auth)
          .send({ email: nextEmail() })
      ).status,
    ).toBe(422);
  });
});

describe('signing in', () => {
  it('needs the password and then a code; codes work once; a recovery code works once', async () => {
    const { email, secret, confirm } = await onboard();
    const first = await login(email);
    expect(first.body.data.mfaRequired).toBe(true);
    const t1 = nextStep();
    const code = totpCode(secret, t1);
    const ok = await mfa(first.body.data.mfaToken, { code });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.recoveryCodesLeft).toBe(8);
    expect(
      (
        await api()
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${ok.body.data.accessToken}`)
      ).body.data.role,
    ).toBe('SUPPORT');

    // The same code again is refused, even with a fresh first step.
    const again = await login(email);
    expect((await mfa(again.body.data.mfaToken, { code })).status).toBe(401);

    // A recovery code signs in once.
    const rc = confirm.recoveryCodes[0] as string;
    const viaRecovery = await mfa((await login(email)).body.data.mfaToken, { recoveryCode: rc });
    expect(viaRecovery.status).toBe(200);
    expect(viaRecovery.body.data.recoveryCodesLeft).toBe(7);
    expect((await mfa((await login(email)).body.data.mfaToken, { recoveryCode: rc })).status).toBe(
      401,
    );
    env.setNow(null);
  });

  it('says the same thing for a wrong password and an unknown email, and locks after five failures', async () => {
    const { email, secret } = await onboard();
    const unknown = await login('nobody@example.com');
    const wrong = await login(email, 'wrong password here 1');
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
    for (let i = 0; i < 4; i += 1) await login(email, 'wrong password here 1');
    const locked = await login(email); // even the right password is refused now
    expect(locked.status).toBe(429);
    expect(locked.body.error.message).toMatch(/minute/);
    expect(await AuditLog.countDocuments({ action: 'staff.login.locked' })).toBe(1);

    env.setNow(new Date(Date.now() + 16 * 60_000));
    const after = await login(email);
    expect(after.status).toBe(200);
    const t = Date.now() + 16 * 60_000 + 60_000;
    env.setNow(new Date(t));
    expect((await mfa(after.body.data.mfaToken, { code: totpCode(secret, t) })).status).toBe(200);
    env.setNow(null);
  });

  it('wrong authenticator codes count toward the lock too', async () => {
    const { email } = await onboard();
    const token = (await login(email)).body.data.mfaToken as string;
    for (let i = 0; i < 5; i += 1) expect((await mfa(token, { code: '000000' })).status).toBe(401);
    expect((await login(email)).status).toBe(429);
  });

  it('a suspended person cannot sign in, and staff sessions are short', async () => {
    const { email, secret, userId, confirm } = await onboard();
    const session = await Session.findOne({ userId });
    const hours = (session!.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(11);
    expect(hours).toBeLessThanOrEqual(12.01);
    expect(confirm.accessToken).toBeTruthy();

    await api()
      .patch(`/api/v1/admin/users/${userId}/status`)
      .set(root.auth)
      .send({ status: 'SUSPENDED', reason: 'Review pending' });
    const res = await login(email);
    expect(res.status).toBe(403);
    void secret;
  });
});

describe('forgotten and changed passwords', () => {
  it('a reset needs the emailed link and an authenticator code, ends old logins, and works once', async () => {
    const { email, secret, confirm } = await onboard();
    const quiet = await api()
      .post('/api/v1/auth/staff/password/forgot')
      .send({ email: 'nobody@example.com' });
    const real = await api().post('/api/v1/auth/staff/password/forgot').send({ email });
    expect(quiet.body).toEqual(expect.objectContaining({ success: true }));
    expect(quiet.body.data).toEqual(real.body.data); // nobody can tell who has an account
    expect(env.emails.filter((m) => m.to === 'nobody@example.com')).toHaveLength(0);
    const token = tokenIn(env.emails.at(-1)!.text);

    const weak = await api()
      .post('/api/v1/auth/staff/password/reset')
      .send({ resetToken: token, password: 'short', code: '123456' });
    expect(weak.status).toBe(400);
    const t = nextStep();
    const noCode = await api()
      .post('/api/v1/auth/staff/password/reset')
      .send({ resetToken: token, password: 'a brand new long password 9', code: '000000' });
    expect(noCode.status).toBe(401);
    const done = await api()
      .post('/api/v1/auth/staff/password/reset')
      .send({
        resetToken: token,
        password: 'a brand new long password 9',
        code: totpCode(secret, t),
      });
    expect(done.status, JSON.stringify(done.body)).toBe(200);

    // The old login is over, the old password is wrong, the new one works, the link is used up.
    expect(
      (await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${confirm.accessToken}`))
        .status,
    ).toBe(401);
    expect((await login(email)).status).toBe(401);
    expect((await login(email, 'a brand new long password 9')).status).toBe(200);
    expect(
      (
        await api()
          .post('/api/v1/auth/staff/password/reset')
          .send({ resetToken: token, password: 'yet another long password 3', code: '123456' })
      ).status,
    ).toBe(401);
    env.setNow(null);
  });

  it('changing your own password needs the current one and a fresh code, and keeps this login only', async () => {
    const { email, secret, confirm } = await onboard();
    // A second login that should end.
    const otherLogin = await login(email);
    const t2 = nextStep();
    const second = await mfa(otherLogin.body.data.mfaToken, { code: totpCode(secret, t2) });
    expect(second.status).toBe(200);
    const mine = confirm.accessToken as string;

    const t3 = nextStep();
    const change = await api()
      .post('/api/v1/auth/staff/password/change')
      .set('Authorization', `Bearer ${mine}`)
      .send({
        currentPassword: 'not my password 123',
        newPassword: 'my new long password 42',
        code: totpCode(secret, t3),
      });
    expect(change.status).toBe(401);
    const ok = await api()
      .post('/api/v1/auth/staff/password/change')
      .set('Authorization', `Bearer ${mine}`)
      .send({
        currentPassword: PASSWORD,
        newPassword: 'my new long password 42',
        code: totpCode(secret, t3),
      });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${mine}`)).status).toBe(
      200,
    ); // this one stays
    expect(
      (
        await api()
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${second.body.data.accessToken}`)
      ).status,
    ).toBe(401); // the other ended
    env.setNow(null);
  });

  it('inviting again resets a lost password and authenticator and ends old logins', async () => {
    const { email, userId, confirm } = await onboard();
    await api().post(`/api/v1/admin/staff/${userId}/credentials`).set(root.auth).send({ email });
    expect(
      (await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${confirm.accessToken}`))
        .status,
    ).toBe(401);
    expect((await login(email)).status).toBe(401); // no password until they set one again
    const link = tokenIn(env.emails.at(-1)!.text);
    expect(
      (await api().post('/api/v1/auth/staff/setup').send({ inviteToken: link, password: PASSWORD }))
        .status,
    ).toBe(200);
  });
});
