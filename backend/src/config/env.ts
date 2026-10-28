import { z } from 'zod';
import { parseServiceAccount } from '../providers/fcm';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim().replace(/\/+$/, ''))
        .filter(Boolean),
    ),
  MONGODB_URI: z.string().min(1),
  MONGO_MAX_POOL_SIZE: z.coerce.number().int().min(5).max(200).default(20),
  // Shared rate-limit counts and Socket.IO fan-out across instances. Optional outside production; the API works without it.
  REDIS_URL: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  OTP_TTL_SECONDS: z.coerce.number().int().min(30).default(300),
  OTP_RESEND_SECONDS: z.coerce.number().int().min(0).default(30),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  OTP_MAX_PER_HOUR: z.coerce.number().int().min(1).default(5),
  PROVIDER_MODE: z.enum(['mock', 'live']).default('mock'),
  // mock = log only; fcm = real Firebase push (needs FCM_SERVICE_ACCOUNT_JSON).
  PUSH_DRIVER: z.enum(['mock', 'fcm']).default('mock'),
  FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),
  // May staff sign in with a phone code like riders? Defaults to yes outside production and is
  // refused in production, where staff must use email + password + an authenticator.
  STAFF_OTP_LOGIN: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  STAFF_REFRESH_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  // Where the admin panel lives, for the links in staff emails.
  STAFF_PORTAL_URL: z.string().url().default('http://localhost:3000'),
  // Tax on company invoices, in basis points (1800 = 18%). 0 = none. Decide with an accountant.
  INVOICE_TAX_BP: z.coerce.number().int().min(0).max(5000).default(0),
  INVOICE_TAX_LABEL: z.string().default('GST'),
  // GST added ON TOP of every ride fare, in basis points (500 = 5%), and GST on the platform's commission
  // (1800 = 18%), borne by the driver. PLACEHOLDERS: confirm both rates and who is liable with an accountant.
  // 0 turns a tax off. Keep INVOICE_TAX_BP at 0 while RIDE_TAX_BP is on, or company invoices tax twice.
  RIDE_TAX_BP: z.coerce.number().int().min(0).max(5000).default(500),
  COMMISSION_TAX_BP: z.coerce.number().int().min(0).max(5000).default(1800),
  SELLER_NAME: z.string().default('Cab Booking Platform'),
  SELLER_GSTIN: z.string().optional(),
  SELLER_ADDRESS: z.string().optional(),
  SELLER_SAC_CODE: z.string().optional(),
  // mock = files are not really stored; local = the server's own upload folder (one instance only);
  // s3 = any S3-compatible storage (AWS S3, Cloudflare R2, MinIO).
  STORAGE_DRIVER: z.enum(['mock', 'local', 's3']).default('mock'),
  UPLOAD_DIR: z.string().optional(),
  // Public address of this API with no path (https://api.example.com): upload/download links are built on it.
  UPLOAD_PUBLIC_URL: z.string().url().optional(),
  UPLOAD_SIGNING_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
  UPLOAD_MAX_BYTES: z.coerce.number().int().min(1024).max(52_428_800).default(10_485_760),
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PATH_STYLE: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  // mock = straight-line distance x1.3 (development only); google = Google Maps Platform (needs GOOGLE_MAPS_API_KEY).
  MAPS_DRIVER: z.enum(['mock', 'google']).default('mock'),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  // mock = emails are only recorded; smtp = real email (needs the SMTP_* values and EMAIL_FROM).
  EMAIL_DRIVER: z.enum(['mock', 'smtp']).default('mock'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  // mock = no money is sent; razorpayx = real bank/UPI payouts to drivers (needs the RAZORPAYX_* values).
  PAYOUTS_DRIVER: z.enum(['mock', 'razorpayx']).default('mock'),
  RAZORPAYX_KEY_ID: z.string().optional(),
  RAZORPAYX_KEY_SECRET: z.string().optional(),
  RAZORPAYX_ACCOUNT_NUMBER: z.string().optional(),
  RAZORPAYX_WEBHOOK_SECRET: z.string().optional(),
  // true = an approved settlement is paid out automatically; false = finance presses "pay".
  AUTO_PAYOUTS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Lifts every rate limit so a load test measures the server, not the limits. Refused in production.
  LOAD_TEST_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Lets a metrics tool read GET /api/v1/metrics (Prometheus text) with `Authorization: Bearer <token>`. Empty = endpoint off.
  METRICS_TOKEN: z.string().min(16).optional(),
  // Where alerts go (a Slack/Discord-style incoming webhook that accepts { text }). Empty = log only.
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  // mock = OTPs are only logged; nimbus = real SMS through the DLT gateway (needs the SMS_* values).
  SMS_DRIVER: z.enum(['mock', 'nimbus']).default('mock'),
  SMS_API_URL: z.string().url().optional(),
  SMS_USER_ID: z.string().optional(),
  SMS_PASSWORD: z.string().optional(),
  SMS_SENDER_ID: z.string().optional(),
  SMS_ENTITY_ID: z.string().optional(),
  SMS_TEMPLATE_ID: z.string().optional(),
  // The login-OTP wording registered with DLT; {otp} is replaced by the code.
  SMS_OTP_MESSAGE: z.string().optional(),
  // DLT template for emergency texts to saved contacts. Without it those texts are not sent.
  SMS_ALERT_TEMPLATE_ID: z.string().optional(),
  // Web address the emergency text links to (the page that shows a shared trip), no trailing slash.
  TRIP_LINK_BASE: z.string().url().optional(),
  // mock = no real money moves; razorpay = real Razorpay (use TEST keys outside production).
  PAYMENTS_DRIVER: z.enum(['mock', 'razorpay']).default('mock'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  // Staging/QA only: every login OTP is this code, so testers need no SMS. Refused in production.
  STAGING_FIXED_OTP: z
    .string()
    .regex(/^\d{6}$/, 'must be exactly 6 digits')
    .optional(),
});

export type Env = Omit<z.infer<typeof schema>, 'STAFF_OTP_LOGIN'> & { STAFF_OTP_LOGIN: boolean };

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n - ${issues.join('\n - ')}`);
    this.name = 'EnvValidationError';
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new EnvValidationError(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  const env = {
    ...parsed.data,
    STAFF_OTP_LOGIN: parsed.data.STAFF_OTP_LOGIN ?? parsed.data.NODE_ENV !== 'production',
  };
  if (env.NODE_ENV === 'production' && env.PROVIDER_MODE === 'mock') {
    throw new EnvValidationError(['PROVIDER_MODE: mock providers are not allowed in production']);
  }
  if (env.PUSH_DRIVER === 'fcm') {
    try {
      parseServiceAccount(env.FCM_SERVICE_ACCOUNT_JSON ?? '');
    } catch (err) {
      throw new EnvValidationError([
        `PUSH_DRIVER=fcm: ${err instanceof Error ? err.message : 'invalid FCM_SERVICE_ACCOUNT_JSON'}`,
      ]);
    }
  }
  if (env.NODE_ENV === 'production' || env.NODE_ENV === 'staging') {
    if (env.CORS_ORIGINS.includes('*')) {
      throw new EnvValidationError(['CORS_ORIGINS: a wildcard is not allowed outside development']);
    }
  }
  for (const origin of env.CORS_ORIGINS) {
    if (origin !== '*') {
      try {
        new URL(origin);
      } catch {
        throw new EnvValidationError([`CORS_ORIGINS: invalid origin URL (${origin})`]);
      }
    }
  }
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    throw new EnvValidationError([
      'JWT_REFRESH_SECRET: must differ from JWT_ACCESS_SECRET (one leaked secret must not open both)',
    ]);
  }
  if (env.NODE_ENV === 'production' && env.STAFF_OTP_LOGIN) {
    throw new EnvValidationError([
      'STAFF_OTP_LOGIN: not allowed in production (staff sign in with email, password and an authenticator)',
    ]);
  }
  if (env.NODE_ENV === 'production' && env.LOAD_TEST_MODE) {
    throw new EnvValidationError([
      'LOAD_TEST_MODE: not allowed in production (it removes the rate limits)',
    ]);
  }
  if (env.MAPS_DRIVER === 'google' && !env.GOOGLE_MAPS_API_KEY) {
    throw new EnvValidationError(['MAPS_DRIVER=google needs GOOGLE_MAPS_API_KEY']);
  }
  if (env.STORAGE_DRIVER === 'local') {
    const missing = (['UPLOAD_DIR', 'UPLOAD_PUBLIC_URL', 'UPLOAD_SIGNING_SECRET'] as const).filter(
      (k) => !env[k],
    );
    if (missing.length > 0) {
      throw new EnvValidationError([`STORAGE_DRIVER=local needs ${missing.join(', ')}`]);
    }
  }
  if (env.STORAGE_DRIVER === 's3') {
    const missing = (
      ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const
    ).filter((k) => !env[k]);
    if (missing.length > 0) {
      throw new EnvValidationError([`STORAGE_DRIVER=s3 needs ${missing.join(', ')}`]);
    }
  }
  if (env.EMAIL_DRIVER === 'smtp') {
    const missing = (['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM'] as const).filter(
      (k) => !env[k],
    );
    if (missing.length > 0) {
      throw new EnvValidationError([`EMAIL_DRIVER=smtp needs ${missing.join(', ')}`]);
    }
  }
  if (env.PAYOUTS_DRIVER === 'razorpayx') {
    const missing = (
      [
        'RAZORPAYX_KEY_ID',
        'RAZORPAYX_KEY_SECRET',
        'RAZORPAYX_ACCOUNT_NUMBER',
        'RAZORPAYX_WEBHOOK_SECRET',
      ] as const
    ).filter((k) => !env[k]);
    if (missing.length > 0) {
      throw new EnvValidationError([`PAYOUTS_DRIVER=razorpayx needs ${missing.join(', ')}`]);
    }
  }
  if (env.SMS_DRIVER === 'nimbus') {
    const missing = (
      [
        'SMS_API_URL',
        'SMS_USER_ID',
        'SMS_PASSWORD',
        'SMS_SENDER_ID',
        'SMS_ENTITY_ID',
        'SMS_TEMPLATE_ID',
      ] as const
    ).filter((k) => !env[k]);
    if (missing.length > 0) {
      throw new EnvValidationError([`SMS_DRIVER=nimbus needs ${missing.join(', ')}`]);
    }
  }
  if (
    env.PAYMENTS_DRIVER === 'razorpay' &&
    !(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET)
  ) {
    throw new EnvValidationError([
      'PAYMENTS_DRIVER=razorpay needs RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET',
    ]);
  }
  if (env.RIDE_TAX_BP > 0 && env.INVOICE_TAX_BP > 0) {
    throw new EnvValidationError([
      'INVOICE_TAX_BP: must be 0 while RIDE_TAX_BP is on (the tax is already inside each ride, so an invoice would charge it twice)',
    ]);
  }
  if (env.NODE_ENV === 'production' && env.STAGING_FIXED_OTP) {
    throw new EnvValidationError(['STAGING_FIXED_OTP: not allowed in production']);
  }
  if (env.NODE_ENV === 'production' && !env.REDIS_URL) {
    throw new EnvValidationError(['REDIS_URL: required in production']);
  }
  if (env.PROVIDER_MODE === 'live') {
    const problems: string[] = [];
    if (env.PAYMENTS_DRIVER === 'mock')
      problems.push('PAYMENTS_DRIVER: must be razorpay in live mode');
    if (env.PAYOUTS_DRIVER === 'mock')
      problems.push('PAYOUTS_DRIVER: must be razorpayx in live mode');
    if (env.SMS_DRIVER === 'mock') problems.push('SMS_DRIVER: must be nimbus in live mode');
    if (env.PUSH_DRIVER === 'mock') problems.push('PUSH_DRIVER: must be fcm in live mode');
    if (env.EMAIL_DRIVER === 'mock') problems.push('EMAIL_DRIVER: must be smtp in live mode');
    if (env.MAPS_DRIVER === 'mock') problems.push('MAPS_DRIVER: must be google in live mode');
    if (env.STORAGE_DRIVER === 'mock')
      problems.push('STORAGE_DRIVER: must be local or s3 in live mode');
    if (problems.length > 0) throw new EnvValidationError(problems);
  }
  return env;
}
