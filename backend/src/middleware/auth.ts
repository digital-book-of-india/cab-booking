import type { RequestHandler } from 'express';
import { isValidObjectId } from 'mongoose';
import { AppError } from '../common/errors';
import type { Role } from '../common/enums';
import { verifyAccessToken } from '../modules/auth/auth.service';
import { Session } from '../modules/auth/session.model';
import { User } from '../modules/users/user.model';

export type AuthInfo = { userId: string; role: Role; sessionId: string; expiresAtMs: number };

/**
 * Verifies an access token, then checks the session is live and the account is ACTIVE. The role
 * comes from the database, not the token, so role/status changes apply immediately. Shared by the
 * REST middleware and the Socket.IO handshake so both enforce exactly the same rules.
 */
export async function resolveAuth(accessSecret: string, token: string): Promise<AuthInfo> {
  const { userId, sessionId, expiresAtMs } = verifyAccessToken(token, accessSecret);
  if (!isValidObjectId(userId) || !isValidObjectId(sessionId)) {
    throw new AppError('UNAUTHENTICATED');
  }
  const [session, user] = await Promise.all([
    Session.exists({ _id: sessionId, userId, revokedAt: null, expiresAt: { $gt: new Date() } }),
    User.findById(userId).select('role accountStatus').lean(),
  ]);
  if (!session || !user) throw new AppError('UNAUTHENTICATED');
  if (user.accountStatus !== 'ACTIVE') throw new AppError('FORBIDDEN', 'Account is not active.');
  return { userId, role: user.role as Role, sessionId, expiresAtMs };
}

export function authenticate(accessSecret: string): RequestHandler {
  return async (req, _res, next) => {
    const header = req.header('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw new AppError('UNAUTHENTICATED');
    const { userId, role, sessionId } = await resolveAuth(accessSecret, token);
    req.auth = { userId, role, sessionId };
    next();
  };
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw new AppError('UNAUTHENTICATED');
    if (!roles.includes(req.auth.role)) throw new AppError('FORBIDDEN');
    next();
  };
}
