import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { actorFrom } from '../../common/actor';
import { h } from '../../common/route';
import { objectId } from '../../common/zod';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import {
  changePasswordSchema,
  confirmSetupSchema,
  forgotSchema,
  inviteStaffSchema,
  mfaSchema,
  resetSchema,
  setupSchema,
  staffLoginSchema,
  type StaffAuthService,
} from './staffauth.service';

/**
 * Staff sign-in: email + password, then a code from an authenticator app. The public steps share
 * the sign-in rate limit; the invite is for super admins.
 */
export function staffAuthRouter(
  ctx: ModuleContext,
  staffAuth: StaffAuthService,
  limiter: RequestHandler,
): Router {
  const r = Router();

  r.post(
    '/auth/staff/setup',
    limiter,
    h(async (req) => ({ data: await staffAuth.setup(setupSchema.parse(req.body)) })),
  );
  r.post(
    '/auth/staff/setup/confirm',
    limiter,
    h(async (req) => ({ data: await staffAuth.confirmSetup(confirmSetupSchema.parse(req.body)) })),
  );
  r.post(
    '/auth/staff/login',
    limiter,
    h(async (req) => ({ data: await staffAuth.login(staffLoginSchema.parse(req.body)) })),
  );
  r.post(
    '/auth/staff/mfa',
    limiter,
    h(async (req) => ({ data: await staffAuth.verifyMfa(mfaSchema.parse(req.body)) })),
  );
  r.post(
    '/auth/staff/password/forgot',
    limiter,
    h(async (req) => ({ data: await staffAuth.forgot(forgotSchema.parse(req.body)) })),
  );
  r.post(
    '/auth/staff/password/reset',
    limiter,
    h(async (req) => ({ data: await staffAuth.reset(resetSchema.parse(req.body)) })),
  );
  r.post(
    '/auth/staff/password/change',
    ctx.authenticate,
    requireRole('OPS', 'SUPPORT', 'FINANCE', 'SAFETY_ADMIN', 'CONFIG_ADMIN', 'SUPER_ADMIN'),
    h(async (req) => ({
      data: await staffAuth.changePassword(
        actorFrom(req),
        changePasswordSchema.parse(req.body),
        req.auth!.sessionId,
      ),
    })),
  );
  r.post(
    '/admin/staff/:userId/credentials',
    ctx.authenticate,
    requireRole('SUPER_ADMIN'),
    h(async (req) => ({
      data: await staffAuth.invite(
        actorFrom(req),
        z.string().pipe(objectId).parse(req.params['userId']),
        inviteStaffSchema.parse(req.body),
      ),
      status: 201,
    })),
  );
  return r;
}
