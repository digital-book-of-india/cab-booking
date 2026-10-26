import { Router, type RequestHandler } from 'express';
import { createAuthController } from './auth.controller';
import type { AuthService } from './auth.service';

export function authRouter(
  service: AuthService,
  authenticate: RequestHandler,
  otpLimiter: RequestHandler,
): Router {
  const r = Router();
  const c = createAuthController(service);

  r.post('/auth/otp/request', otpLimiter, c.requestOtp);
  r.post('/auth/otp/verify', otpLimiter, c.verifyOtp);
  r.post('/auth/refresh', otpLimiter, c.refresh);
  r.post('/auth/logout', authenticate, c.logout);
  r.get('/auth/me', authenticate, c.me);
  r.get('/auth/sessions', authenticate, c.listSessions);
  r.delete('/auth/sessions/:sessionId', authenticate, c.revokeSession);

  return r;
}
