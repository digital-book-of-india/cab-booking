import type { RequestHandler } from 'express';
import { actorFrom } from '../../common/actor';
import { ok } from '../../common/response';
import { refreshSchema, requestOtpSchema, verifyOtpSchema } from './auth.schemas';
import type { AuthService } from './auth.service';

export function createAuthController(service: AuthService) {
  const requestOtp: RequestHandler = async (req, res) => {
    ok(res, await service.requestOtp(requestOtpSchema.parse(req.body)), 201);
  };

  const verifyOtp: RequestHandler = async (req, res) => {
    const { tokens, user } = await service.verifyOtp(verifyOtpSchema.parse(req.body));
    ok(res, { ...tokens, user });
  };

  const refresh: RequestHandler = async (req, res) => {
    const body = refreshSchema.parse(req.body);
    ok(res, await service.refresh(body.refreshToken, body.device));
  };

  const logout: RequestHandler = async (req, res) => {
    await service.logout(req.auth!.sessionId);
    ok(res, { loggedOut: true });
  };

  const me: RequestHandler = async (req, res) => {
    ok(res, await service.me(actorFrom(req).userId));
  };

  const listSessions: RequestHandler = async (req, res) => {
    ok(res, await service.listSessions(req.auth!.userId, req.auth!.sessionId));
  };

  const revokeSession: RequestHandler = async (req, res) => {
    await service.revokeSession(req.auth!.userId, String(req.params['sessionId']));
    ok(res, { revoked: true });
  };

  return { requestOtp, verifyOtp, refresh, logout, me, listSessions, revokeSession };
}
