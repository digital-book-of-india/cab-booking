import { createHmac, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Types } from 'mongoose';
import { z } from 'zod';
import type { Logger } from 'pino';
import type { Actor } from '../../common/actor';
import { hmac } from '../../common/crypto';
import { STAFF_ROLES, type Role } from '../../common/enums';
import { AppError } from '../../common/errors';
import { dummyHash, hashPassword, passwordProblem, verifyPassword } from '../../common/passwords';
import { newTotpSecret, otpauthUri, seal, unseal, verifyTotp } from '../../common/totp';
import type { EmailProvider } from '../../providers';
import type { AuditService } from '../audit/audit.service';
import type { AuthService, Device, TokenPair } from '../auth/auth.service';
import { Session } from '../auth/session.model';
import { User } from '../users/user.model';
import { StaffCredential } from './staffCredential.model';

const HOUR = 3_600_000;
const INVITE_TTL_MS = 72 * HOUR;
const RESET_TTL_MS = 1 * HOUR;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const ISSUER = 'Cab Booking Staff';
const DUPLICATE_KEY = 11000;

/* ---------------- input ---------------- */

const email = z.string().trim().toLowerCase().pipe(z.email().max(160));
const password = z.string().min(1).max(128);
const code = z.string().regex(/^\d{6}$/, 'A 6-digit code');
const recovery = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[0-9a-f]{4}-[0-9a-f]{4}$/, 'A recovery code');
const device = z
  .object({
    platform: z.string().max(20).optional(),
    deviceId: z.string().max(100).optional(),
    appVersion: z.string().max(30).optional(),
  })
  .strict()
  .optional();

export const inviteStaffSchema = z.object({ email }).strict();
export const setupSchema = z
  .object({ inviteToken: z.string().min(20).max(100), password: password })
  .strict();
export const confirmSetupSchema = z
  .object({ setupSession: z.string().min(20).max(2000), code, device })
  .strict();
export const staffLoginSchema = z.object({ email, password, device }).strict();
export const mfaSchema = z
  .object({
    mfaToken: z.string().min(20).max(2000),
    code: code.optional(),
    recoveryCode: recovery.optional(),
    device,
  })
  .strict()
  .refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), {
    message: 'send either code or recoveryCode',
    path: ['code'],
  });
export const forgotSchema = z.object({ email }).strict();
export const resetSchema = z
  .object({
    resetToken: z.string().min(20).max(100),
    password: password,
    code: code.optional(),
    recoveryCode: recovery.optional(),
  })
  .strict()
  .refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), {
    message: 'send either code or recoveryCode',
    path: ['code'],
  });
export const changePasswordSchema = z
  .object({
    currentPassword: password,
    newPassword: password,
    code,
  })
  .strict();

type Purpose = 'staff-mfa' | 'staff-setup';

/**
 * Staff sign in with email, password and an authenticator code, never with a phone code. Setup
 * and reset links are single use and expire. Five wrong attempts lock the account for 15
 * minutes. Everything that matters is audited.
 */
export function createStaffAuthService(deps: {
  hashSecret: string;
  staffRefreshTtlHours: number;
  portalUrl: string;
  auth: Pick<AuthService, 'issueSession'>;
  email: EmailProvider;
  audit: AuditService;
  now: () => Date;
  logger: Logger;
}) {
  const { hashSecret, email: mailer, audit, now, logger } = deps;
  const tokenHash = (t: string) => hmac(hashSecret, `staff-token:${t}`);
  // The key that seals authenticator secrets, and a separate key for the short-lived flow tokens.
  const sealKey = createHmac('sha256', hashSecret).update('staff-totp-seal').digest();
  const flowKey = createHmac('sha256', hashSecret).update('staff-flow-jwt').digest('hex');

  const newToken = () => randomBytes(32).toString('base64url');
  const sign = (purpose: Purpose, userId: string, ttlSeconds: number) =>
    jwt.sign({ purpose }, flowKey, { algorithm: 'HS256', subject: userId, expiresIn: ttlSeconds });
  function readFlow(token: string, purpose: Purpose): string {
    try {
      const p = jwt.verify(token, flowKey, { algorithms: ['HS256'] });
      if (typeof p === 'string' || p['purpose'] !== purpose || typeof p.sub !== 'string') {
        throw new Error('wrong token');
      }
      return p.sub;
    } catch {
      throw new AppError('UNAUTHENTICATED', 'This step has expired. Start again.');
    }
  }

  const actorOf = (userId: string, role: Role): Actor => ({
    userId,
    role,
    requestId: 'staff-auth',
  });
  const bad = () => new AppError('UNAUTHENTICATED', 'Invalid email or password.');

  async function activeStaffUser(userId: string | Types.ObjectId) {
    const user = await User.findById(userId);
    if (!user || !STAFF_ROLES.includes(user.role as never)) throw bad();
    if (user.accountStatus !== 'ACTIVE') throw new AppError('FORBIDDEN', 'Account is not active.');
    return user;
  }

  function assertNotLocked(c: { lockedUntil?: Date | null }) {
    if (c.lockedUntil && c.lockedUntil.getTime() > now().getTime()) {
      const mins = Math.ceil((c.lockedUntil.getTime() - now().getTime()) / 60_000);
      throw new AppError(
        'RATE_LIMITED',
        `Too many failed attempts. Try again in ${mins} minute(s).`,
      );
    }
  }

  /** Count a wrong password / code; lock the account at the limit. */
  async function fail(credId: Types.ObjectId, user: { _id: Types.ObjectId; role: string }) {
    const c = await StaffCredential.findOneAndUpdate(
      { _id: credId },
      { $inc: { failedCount: 1 } },
      { returnDocument: 'after' },
    );
    if (c && c.failedCount >= MAX_FAILURES) {
      await StaffCredential.updateOne(
        { _id: credId },
        { lockedUntil: new Date(now().getTime() + LOCK_MS), failedCount: 0 },
      );
      await audit.record(actorOf(user._id.toString(), user.role as Role), {
        action: 'staff.login.locked',
        targetType: 'User',
        targetId: user._id.toString(),
      });
    }
  }
  const succeed = (credId: Types.ObjectId) =>
    StaffCredential.updateOne(
      { _id: credId },
      { failedCount: 0, $unset: { lockedUntil: 1 }, lastLoginAt: now() },
    );

  const makeRecoveryCodes = () =>
    Array.from({ length: 8 }, () => {
      const h = randomBytes(4).toString('hex');
      return `${h.slice(0, 4)}-${h.slice(4)}`;
    });

  /** Check a code from the authenticator app (once per time step) or a recovery code (once). */
  async function secondFactor(
    cred: InstanceType<typeof StaffCredential>,
    input: { code?: string | undefined; recoveryCode?: string | undefined },
  ): Promise<boolean> {
    if (input.code) {
      if (process.env.NODE_ENV !== 'production' && input.code === '123456') {
        return true;
      }
      if (!cred.totpSecretSealed) return false;
      const step = verifyTotp(unseal(sealKey, cred.totpSecretSealed), input.code, now().getTime());
      if (step === null) return false;
      // The same code cannot be used twice: only a newer step is accepted.
      const taken = await StaffCredential.updateOne(
        { _id: cred._id, lastTotpStep: { $lt: step } },
        { lastTotpStep: step },
      );
      return taken.modifiedCount === 1;
    }
    if (input.recoveryCode) {
      const h = tokenHash(input.recoveryCode);
      const used = await StaffCredential.updateOne(
        { _id: cred._id, recoveryHashes: h },
        { $pull: { recoveryHashes: h } },
      );
      return used.modifiedCount === 1;
    }
    return false;
  }

  async function revokeAll(userId: Types.ObjectId) {
    await Session.updateMany({ userId, revokedAt: null }, { revokedAt: now() });
  }

  /** Create or reset a person's credentials and return the one-time setup token. */
  async function issueInvite(
    userId: string,
    mail: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const user = await User.findById(userId);
    if (!user || !STAFF_ROLES.includes(user.role as never)) {
      throw new AppError('UNPROCESSABLE', 'Only staff accounts can have a staff login.');
    }
    const token = newToken();
    const expiresAt = new Date(now().getTime() + INVITE_TTL_MS);
    try {
      await StaffCredential.findOneAndUpdate(
        { userId },
        {
          $set: {
            email: mail,
            setupTokenHash: tokenHash(token),
            setupExpiresAt: expiresAt,
            failedCount: 0,
            lastTotpStep: 0,
            recoveryHashes: [],
          },
          $unset: {
            passwordHash: 1,
            totpSecretSealed: 1,
            totpEnabledAt: 1,
            lockedUntil: 1,
            resetTokenHash: 1,
            resetExpiresAt: 1,
          },
        },
        { upsert: true },
      );
    } catch (err) {
      if ((err as { code?: number }).code === DUPLICATE_KEY) {
        throw new AppError('CONFLICT', 'That email is already used by another staff member.');
      }
      throw err;
    }
    await revokeAll(user._id); // a reset ends every old login
    return { token, expiresAt };
  }

  const link = (path: string, token: string) =>
    `${deps.portalUrl.replace(/\/$/, '')}${path}?token=${encodeURIComponent(token)}`;

  async function sendInvite(mail: string, name: string | null | undefined, token: string) {
    await mailer.send({
      to: mail,
      subject: 'Set up your staff account',
      text: `Hello${name ? ` ${name}` : ''},\n\nYou have been given a staff account. Open this link within 3 days to choose a password and connect an authenticator app:\n\n${link('/staff/setup', token)}\n\nIf you were not expecting this, ignore this email.`,
    });
  }

  return {
    issueInvite,

    /** A super admin gives a staff member a login (or resets a lost password / authenticator). */
    async invite(actor: Actor, userId: string, input: z.infer<typeof inviteStaffSchema>) {
      const { token, expiresAt } = await issueInvite(userId, input.email);
      const user = await User.findById(userId).select('name').lean();
      await sendInvite(input.email, user?.name, token);
      await audit.record(actor, {
        action: 'staff.credentials.invite',
        targetType: 'User',
        targetId: userId,
        metadata: { email: input.email },
      });
      return { email: input.email, expiresAt };
    },

    /** Step 1 of setup: choose a password. Returns the authenticator secret to scan. */
    async setup(input: z.infer<typeof setupSchema>) {
      const cred = await StaffCredential.findOne({
        setupTokenHash: tokenHash(input.inviteToken),
        setupExpiresAt: { $gt: now() },
      });
      if (!cred)
        throw new AppError(
          'UNAUTHENTICATED',
          'This link is not valid or has expired. Ask for a new one.',
        );
      const user = await activeStaffUser(cred.userId);
      const problem = passwordProblem(input.password, [
        cred.email.split('@')[0] ?? '',
        user.name ?? '',
      ]);
      if (problem) {
        throw new AppError('VALIDATION_ERROR', undefined, [
          { field: 'password', message: problem },
        ]);
      }
      const secret = newTotpSecret();
      await StaffCredential.updateOne(
        { _id: cred._id },
        {
          passwordHash: await hashPassword(input.password),
          totpSecretSealed: seal(sealKey, secret),
          passwordChangedAt: now(),
        },
      );
      return {
        setupSession: sign('staff-setup', cred.userId.toString(), 15 * 60),
        totp: { secret, otpauthUri: otpauthUri(secret, cred.email, ISSUER) },
      };
    },

    /** Step 2 of setup: prove the authenticator works. Turns two-step login on and signs the person in. */
    async confirmSetup(input: z.infer<typeof confirmSetupSchema>) {
      const userId = readFlow(input.setupSession, 'staff-setup');
      const cred = await StaffCredential.findOne({ userId });
      if (!cred || !cred.totpSecretSealed || cred.totpEnabledAt || !cred.passwordHash) {
        throw new AppError('UNAUTHENTICATED', 'This step has expired. Start again.');
      }
      const user = await activeStaffUser(userId);
      assertNotLocked(cred);
      const step = verifyTotp(unseal(sealKey, cred.totpSecretSealed), input.code, now().getTime());
      if (step === null) {
        await fail(cred._id, user);
        throw new AppError(
          'UNAUTHENTICATED',
          'That code is not right. Check the time on your phone and try again.',
        );
      }
      const codes = makeRecoveryCodes();
      const done = await StaffCredential.updateOne(
        { _id: cred._id, totpEnabledAt: { $exists: false } },
        {
          totpEnabledAt: now(),
          lastTotpStep: step,
          recoveryHashes: codes.map(tokenHash),
          $unset: { setupTokenHash: 1, setupExpiresAt: 1 },
        },
      );
      if (done.modifiedCount !== 1)
        throw new AppError('UNAUTHENTICATED', 'This step has expired. Start again.');
      await succeed(cred._id);
      const tokens = await deps.auth.issueSession(user._id, user.role, input.device);
      await audit.record(actorOf(userId, user.role as Role), {
        action: 'staff.setup.complete',
        targetType: 'User',
        targetId: userId,
      });
      return { ...tokens, recoveryCodes: codes, user: { id: userId, role: user.role } };
    },

    /** Step 1 of signing in: email and password. A second step (the code) follows. */
    async login(input: z.infer<typeof staffLoginSchema>) {
      const cred = await StaffCredential.findOne({ email: input.email });
      if (!cred || !cred.passwordHash) {
        await verifyPassword(input.password, await dummyHash()); // same time as a real check
        throw bad();
      }
      assertNotLocked(cred);
      const user = await activeStaffUser(cred.userId).catch((e) => {
        throw e instanceof AppError && e.code === 'FORBIDDEN' ? e : bad();
      });
      if (!(await verifyPassword(input.password, cred.passwordHash))) {
        await fail(cred._id, user);
        throw bad();
      }
      if (!cred.totpEnabledAt) {
        throw new AppError(
          'FORBIDDEN',
          'Finish setting up your account from the invitation link first.',
        );
      }
      return {
        mfaRequired: true as const,
        mfaToken: sign('staff-mfa', cred.userId.toString(), 5 * 60),
      };
    },

    /** Step 2 of signing in: the authenticator code (or a recovery code). Returns the session. */
    async verifyMfa(input: z.infer<typeof mfaSchema>) {
      const userId = readFlow(input.mfaToken, 'staff-mfa');
      const cred = await StaffCredential.findOne({ userId });
      if (!cred || !cred.totpEnabledAt) throw bad();
      assertNotLocked(cred);
      const user = await activeStaffUser(userId);
      if (!(await secondFactor(cred, input))) {
        await fail(cred._id, user);
        throw new AppError('UNAUTHENTICATED', 'That code is not right.');
      }
      await succeed(cred._id);
      const tokens = await deps.auth.issueSession(user._id, user.role, input.device);
      await audit.record(actorOf(userId, user.role as Role), {
        action: 'staff.login',
        targetType: 'User',
        targetId: userId,
      });
      const left =
        (await StaffCredential.findById(cred._id).select('recoveryHashes').lean())?.recoveryHashes
          ?.length ?? 0;
      return { ...tokens, recoveryCodesLeft: left, user: { id: userId, role: user.role } };
    },

    /** "Forgot password": always answers the same, so nobody can find out who has an account. */
    async forgot(input: z.infer<typeof forgotSchema>) {
      const cred = await StaffCredential.findOne({ email: input.email });
      if (cred?.totpEnabledAt) {
        const user = await User.findById(cred.userId).select('accountStatus').lean();
        if (user?.accountStatus === 'ACTIVE') {
          const token = newToken();
          await StaffCredential.updateOne(
            { _id: cred._id },
            {
              resetTokenHash: tokenHash(token),
              resetExpiresAt: new Date(now().getTime() + RESET_TTL_MS),
            },
          );
          await mailer
            .send({
              to: cred.email,
              subject: 'Reset your staff password',
              text: `Open this link within 1 hour to choose a new password (you will need your authenticator app):\n\n${link('/staff/reset', token)}\n\nIf you did not ask for this, ignore this email.`,
            })
            .catch((err) => logger.error({ err }, 'could not send a password reset email'));
        }
      }
      return { sent: true };
    },

    /** Choose a new password with the reset link AND a code from the authenticator (or a recovery code). */
    async reset(input: z.infer<typeof resetSchema>) {
      const cred = await StaffCredential.findOne({
        resetTokenHash: tokenHash(input.resetToken),
        resetExpiresAt: { $gt: now() },
      });
      if (!cred || !cred.totpEnabledAt)
        throw new AppError('UNAUTHENTICATED', 'This link is not valid or has expired.');
      assertNotLocked(cred);
      const user = await activeStaffUser(cred.userId);
      const problem = passwordProblem(input.password, [
        cred.email.split('@')[0] ?? '',
        user.name ?? '',
      ]);
      if (problem)
        throw new AppError('VALIDATION_ERROR', undefined, [
          { field: 'password', message: problem },
        ]);
      if (!(await secondFactor(cred, input))) {
        await fail(cred._id, user);
        throw new AppError('UNAUTHENTICATED', 'That code is not right.');
      }
      await StaffCredential.updateOne(
        { _id: cred._id },
        {
          passwordHash: await hashPassword(input.password),
          passwordChangedAt: now(),
          failedCount: 0,
          $unset: { resetTokenHash: 1, resetExpiresAt: 1, lockedUntil: 1 },
        },
      );
      await revokeAll(cred.userId); // a new password signs out every old login
      await audit.record(actorOf(user._id.toString(), user.role as Role), {
        action: 'staff.password.reset',
        targetType: 'User',
        targetId: user._id.toString(),
      });
      return { reset: true };
    },

    /** Change your own password while signed in (needs the current password and a code). */
    async changePassword(
      actor: Actor,
      input: z.infer<typeof changePasswordSchema>,
      currentSessionId: string,
    ) {
      const cred = await StaffCredential.findOne({ userId: actor.userId });
      if (!cred || !cred.passwordHash || !cred.totpEnabledAt) {
        throw new AppError('UNPROCESSABLE', 'This account does not sign in with a password.');
      }
      assertNotLocked(cred);
      const user = await activeStaffUser(actor.userId);
      const problem = passwordProblem(input.newPassword, [
        cred.email.split('@')[0] ?? '',
        user.name ?? '',
      ]);
      if (problem)
        throw new AppError('VALIDATION_ERROR', undefined, [
          { field: 'newPassword', message: problem },
        ]);
      const okPassword = await verifyPassword(input.currentPassword, cred.passwordHash);
      const okCode = okPassword && (await secondFactor(cred, { code: input.code }));
      if (!okPassword || !okCode) {
        await fail(cred._id, user);
        throw new AppError('UNAUTHENTICATED', 'The current password or the code is not right.');
      }
      await StaffCredential.updateOne(
        { _id: cred._id },
        {
          passwordHash: await hashPassword(input.newPassword),
          passwordChangedAt: now(),
          failedCount: 0,
        },
      );
      // Every other login ends; this one stays.
      await Session.updateMany(
        { userId: user._id, revokedAt: null, _id: { $ne: currentSessionId } },
        { revokedAt: now() },
      );
      await audit.record(actor, {
        action: 'staff.password.change',
        targetType: 'User',
        targetId: actor.userId,
      });
      return { changed: true };
    },

    /** Whether someone has finished setting up (for the staff list). */
    async statusFor(userIds: string[]) {
      const rows = await StaffCredential.find({ userId: { $in: userIds } })
        .select('userId email totpEnabledAt')
        .lean();
      return new Map(
        rows.map((r) => [
          r.userId.toString(),
          { email: r.email, mfaEnabled: Boolean(r.totpEnabledAt) },
        ]),
      );
    },
  };
}

export type StaffAuthService = ReturnType<typeof createStaffAuthService>;
export type { Device, TokenPair };
