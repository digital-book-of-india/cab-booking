import pino, { type Logger } from 'pino';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  '*.password',
  '*.otp',
  '*.pickupOtp',
  '*.accessToken',
  '*.refreshToken',
  '*.razorpay_signature',
  '*.secret',
];

export function createLogger(level: string, pretty = false): Logger {
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    ...(pretty ? { transport: { target: 'pino-pretty' } } : {}),
  });
}
