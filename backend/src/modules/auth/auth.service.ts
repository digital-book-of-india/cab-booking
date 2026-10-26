import { randomBytes, randomInt } from 'node:crypto';
import { Types, isValidObjectId } from 'mongoose';
import jwt from 'jsonwebtoken';
import type { Logger } from 'pino';
import { AppError } from '../../common/errors';
import { hmac, safeEqual } from '../../common/crypto';
import { normalizePhone } from '../../common/phone';
import { STAFF_ROLES, type SignupRole } from '../../common/enums';
import type { Providers } from '../../providers';
import { User } from '../users/user.model';
import { CustomerProfile } from '../customers/customerProfile.model';
import { DriverProfile } from '../drivers/driverProfile.model';
import { OtpChallenge } from './otp.model';
import { Session } from './session.model';
import type { AuthConfig } from './auth.config';

export type Device = { platform?: string; deviceId?: string; appVersion?: string };

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
};

export type AuthUserView = {
  id: string;
  role: string;
  status: string;
  profileComplete: boolean;
  isNewUser?: boolean;
};

const DUPLICATE_KEY = 11000;

export function createAuthService(cfg: AuthConfig, providers: Providers, logger: Logger) {
  const hash = (v: string) => hmac(cfg.hashSecret, v);

  function signAccess(userId: string, sessionId: string): string {
    return jwt.sign({ sid: sessionId }, cfg.accessSecret, {
      algorithm: 'HS256',
      subject: userId,
      expiresIn: cfg.accessTtlSeconds,
    });
  }

  function newRefreshToken(sessionId: string): string {
    return `${sessionId}.${randomBytes(32).toString('base64url')}`;
  }

  async function requireActiveUser(userId: string | Types.ObjectId) {
    const user = await User.findById(userId);
    if (!user) throw new AppError('UNAUTHENTICATED');
    if (user.accountStatus !== 'ACTIVE') {
      throw new AppError('FORBIDDEN', 'Account is not active.');
    }
    return user;
  }

  async function ensureProfile(userId: Types.ObjectId, role: string): Promise<void> {
    if (role === 'CUSTOMER') {
      await CustomerProfile.updateOne({ userId }, { $setOnInsert: { userId } }, { upsert: true });
    } else if (role === 'DRIVER') {
      await DriverProfile.updateOne({ userId }, { $setOnInsert: { userId } }, { upsert: true });
    }
  }

  async function createSession(
    userId: Types.ObjectId,
    device: Device | undefined,
    refreshTtlMs: number = cfg.refreshTtlDays * 86_400_000,
  ): Promise<TokenPair> {
    const sessionId = new Types.ObjectId();
    const refreshToken = newRefreshToken(sessionId.toString());
    await Session.create({
      _id: sessionId,
      userId,
      refreshTokenHash: hash(refreshToken),
      device,
      expiresAt: new Date(Date.now() + refreshTtlMs),
      lastUsedAt: new Date(),
    });
    return {
      accessToken: signAccess(userId.toString(), sessionId.toString()),
      refreshToken,
      expiresInSeconds: cfg.accessTtlSeconds,
    };
  }

  return {
    /** Start a login session for someone who has already proved who they are (staff, after their code). */
    issueSession(userId: Types.ObjectId, role: string, device?: Device): Promise<TokenPair> {
      const staff = (STAFF_ROLES as readonly string[]).includes(role);
      return createSession(
        userId,
        device,
        staff ? cfg.staffRefreshTtlHours * 3_600_000 : cfg.refreshTtlDays * 86_400_000,
      );
    },

    async requestOtp(input: { phone: string }) {
      const phone = normalizePhone(input.phone);
      if (!phone) {
        throw new AppError('VALIDATION_ERROR', undefined, [
          { field: 'phone', message: 'Invalid phone number' },
        ]);
      }
      const now = Date.now();

      const latest = await OtpChallenge.findOne({ phone }).sort({ createdAt: -1 }).lean();
      if (latest && now - latest.createdAt.getTime() < cfg.otpResendSeconds * 1000) {
        throw new AppError('RATE_LIMITED', 'Please wait before requesting another OTP.');
      }
      const lastHour = await OtpChallenge.countDocuments({
        phone,
        createdAt: { $gte: new Date(now - 3_600_000) },
      });
      if (lastHour >= cfg.otpMaxPerHour) {
        throw new AppError('RATE_LIMITED', 'OTP request limit reached. Try again later.');
      }

      const id = new Types.ObjectId();
      const otp = cfg.fixedOtp ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
      await OtpChallenge.create({
        _id: id,
        phone,
        otpHash: hash(`${id}:${otp}`),
        expiresAt: new Date(now + cfg.otpTtlSeconds * 1000),
      });

      try {
        await providers.sms.sendOtp(phone, otp);
      } catch (err) {
        await OtpChallenge.deleteOne({ _id: id });
        logger.error({ err }, 'sms provider failed');
        throw new AppError('PROVIDER_ERROR', 'Could not send OTP. Please try again.');
      }

      return {
        challengeId: id.toString(),
        expiresInSeconds: cfg.otpTtlSeconds,
        resendAfterSeconds: cfg.otpResendSeconds,
      };
    },

    async verifyOtp(input: {
      challengeId: string;
      phone: string;
      otp: string;
      role?: SignupRole;
      device?: Device;
    }): Promise<{ tokens: TokenPair; user: AuthUserView }> {
      const phone = normalizePhone(input.phone);
      if (!phone || !isValidObjectId(input.challengeId)) throw new AppError('OTP_INVALID');

      const challenge = await OtpChallenge.findOne({ _id: input.challengeId, phone });
      if (!challenge || challenge.consumedAt) throw new AppError('OTP_INVALID');
      if (challenge.expiresAt.getTime() < Date.now()) throw new AppError('OTP_EXPIRED');

      // Atomically count the attempt; refuse once the cap is reached.
      const counted = await OtpChallenge.findOneAndUpdate(
        { _id: challenge._id, consumedAt: null, attempts: { $lt: cfg.otpMaxAttempts } },
        { $inc: { attempts: 1 } },
        { returnDocument: 'after' },
      );
      if (!counted) {
        // Either the cap was hit, or a concurrent request consumed the code a moment ago.
        const now = await OtpChallenge.findById(challenge._id).select('consumedAt').lean();
        throw new AppError(now?.consumedAt ? 'OTP_INVALID' : 'OTP_ATTEMPTS_EXCEEDED');
      }

      if (!safeEqual(counted.otpHash, hash(`${counted._id}:${input.otp}`))) {
        throw new AppError('OTP_INVALID');
      }
      // Single-use: only one concurrent verification can consume the challenge.
      const consumed = await OtpChallenge.updateOne(
        { _id: counted._id, consumedAt: null },
        { consumedAt: new Date() },
      );
      if (consumed.modifiedCount !== 1) throw new AppError('OTP_INVALID');

      let user = await User.findOne({ phone });
      let isNewUser = false;
      if (user) {
        if (input.role && input.role !== user.role) {
          throw new AppError(
            'FORBIDDEN',
            'This phone number is registered under a different role.',
          );
        }
        if (user.accountStatus !== 'ACTIVE')
          throw new AppError('FORBIDDEN', 'Account is not active.');
        // Staff hold powerful accounts: a phone code alone is not enough for them in production.
        if (!cfg.staffOtpLogin && (STAFF_ROLES as readonly string[]).includes(user.role)) {
          throw new AppError(
            'FORBIDDEN',
            'Staff sign in with email, password and an authenticator app.',
          );
        }
      } else {
        try {
          user = await User.create({
            phone,
            role: input.role ?? 'CUSTOMER',
            phoneVerifiedAt: new Date(),
          });
          isNewUser = true;
        } catch (err) {
          if ((err as { code?: number }).code !== DUPLICATE_KEY) throw err;
          user = await User.findOne({ phone });
          if (!user) throw err;
        }
      }
      await ensureProfile(user._id, user.role);
      if (!user.phoneVerifiedAt) {
        user.phoneVerifiedAt = new Date();
        await user.save();
      }

      const tokens = await createSession(user._id, input.device);
      return {
        tokens,
        user: {
          id: user._id.toString(),
          role: user.role,
          status: user.accountStatus,
          profileComplete: Boolean(user.name),
          isNewUser,
        },
      };
    },

    async refresh(refreshToken: string, device?: Device): Promise<TokenPair> {
      const [sessionId] = refreshToken.split('.');
      if (!sessionId || !isValidObjectId(sessionId)) throw new AppError('UNAUTHENTICATED');
      const presented = hash(refreshToken);
      const next = newRefreshToken(sessionId);

      // Atomic rotation: only the holder of the current token can rotate it.
      const rotated = await Session.findOneAndUpdate(
        {
          _id: sessionId,
          refreshTokenHash: presented,
          revokedAt: null,
          expiresAt: { $gt: new Date() },
        },
        {
          $set: {
            prevRefreshTokenHash: presented,
            refreshTokenHash: hash(next),
            lastUsedAt: new Date(),
            ...(device ? { device } : {}),
          },
        },
        { returnDocument: 'after' },
      );

      if (!rotated) {
        // A previously rotated token being replayed means it was likely stolen: kill the session.
        await Session.updateOne(
          { _id: sessionId, prevRefreshTokenHash: presented, revokedAt: null },
          { revokedAt: new Date() },
        );
        throw new AppError('UNAUTHENTICATED', 'Invalid refresh token.');
      }

      try {
        await requireActiveUser(rotated.userId);
      } catch (err) {
        await Session.updateOne({ _id: rotated._id }, { revokedAt: new Date() });
        throw err;
      }
      return {
        accessToken: signAccess(rotated.userId.toString(), sessionId),
        refreshToken: next,
        expiresInSeconds: cfg.accessTtlSeconds,
      };
    },

    async logout(sessionId: string): Promise<void> {
      await Session.updateOne({ _id: sessionId, revokedAt: null }, { revokedAt: new Date() });
    },

    async me(userId: string): Promise<AuthUserView & { phone: string; name?: string | null }> {
      const user = await User.findById(userId);
      if (!user) throw new AppError('UNAUTHENTICATED');
      return {
        id: user._id.toString(),
        role: user.role,
        status: user.accountStatus,
        profileComplete: Boolean(user.name),
        phone: user.phone,
        name: user.name ?? null,
      };
    },

    async listSessions(userId: string, currentSessionId: string) {
      const sessions = await Session.find({
        userId,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      })
        .sort({ lastUsedAt: -1 })
        .lean();
      return sessions.map((s) => ({
        id: s._id.toString(),
        device: s.device ?? null,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt ?? null,
        current: s._id.toString() === currentSessionId,
      }));
    },

    async revokeSession(userId: string, sessionId: string): Promise<void> {
      if (!isValidObjectId(sessionId)) throw new AppError('NOT_FOUND');
      // Scoped by userId so one user can never revoke another user's session.
      const res = await Session.updateOne(
        { _id: sessionId, userId, revokedAt: null },
        { revokedAt: new Date() },
      );
      if (res.matchedCount !== 1) throw new AppError('NOT_FOUND');
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;

export function verifyAccessToken(
  token: string,
  secret: string,
): { userId: string; sessionId: string; expiresAtMs: number } {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || !payload.sub || typeof payload['sid'] !== 'string') {
      throw new Error('bad payload');
    }
    return {
      userId: payload.sub,
      sessionId: payload['sid'],
      expiresAtMs: (payload.exp ?? 0) * 1000,
    };
  } catch {
    throw new AppError('UNAUTHENTICATED');
  }
}
