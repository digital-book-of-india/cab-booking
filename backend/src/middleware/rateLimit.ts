import rateLimit from 'express-rate-limit';
import { AppError } from '../common/errors';
import { limiterStore } from './limiterStore';

/** Baseline global limiter. Stricter per-route limiters (OTP, booking) are added in later phases. */
export function globalRateLimiter(max = 300, windowMs = 60_000) {
  return rateLimit({
    ...limiterStore('global'),
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError('RATE_LIMITED')),
  });
}

/** Per-user limiter for authenticated write endpoints (quotes, bookings). Mount after authenticate. */
export function userRateLimiter(max = 30, windowMs = 60_000) {
  return rateLimit({
    ...limiterStore('user'),
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.auth?.userId ?? 'anonymous',
    handler: (_req, _res, next) => next(new AppError('RATE_LIMITED')),
  });
}
