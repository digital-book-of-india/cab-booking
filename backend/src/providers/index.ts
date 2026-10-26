import type { Env } from '../config/env';
import { createFcmPush, parseServiceAccount } from './fcm';
import { UPLOAD_TYPES } from '../common/enums';
import { createLocalStorage } from './local';
import { createGoogleMaps } from './google';
import { createS3Storage } from './s3';
import { createSmtpEmail } from './smtp';
import { createNimbusSms, DEFAULT_OTP_MESSAGE } from './nimbus';
import { createMockProviders, type MockOptions } from './mock';
import { createRazorpayPayments } from './razorpay';
import { createRazorpayXPayouts } from './razorpayx';
import type { Providers } from './types';

export * from './types';

export function createProviders(
  env: Pick<Env, 'NODE_ENV' | 'PROVIDER_MODE'> &
    Partial<
      Pick<
        Env,
        | 'PUSH_DRIVER'
        | 'SMS_DRIVER'
        | 'EMAIL_DRIVER'
        | 'MAPS_DRIVER'
        | 'GOOGLE_MAPS_API_KEY'
        | 'STORAGE_DRIVER'
        | 'UPLOAD_DIR'
        | 'UPLOAD_PUBLIC_URL'
        | 'UPLOAD_SIGNING_SECRET'
        | 'UPLOAD_MAX_BYTES'
        | 'S3_ENDPOINT'
        | 'S3_BUCKET'
        | 'S3_REGION'
        | 'S3_ACCESS_KEY_ID'
        | 'S3_SECRET_ACCESS_KEY'
        | 'S3_PATH_STYLE'
        | 'SMTP_HOST'
        | 'SMTP_PORT'
        | 'SMTP_SECURE'
        | 'SMTP_USER'
        | 'SMTP_PASS'
        | 'EMAIL_FROM'
        | 'SMS_API_URL'
        | 'SMS_USER_ID'
        | 'SMS_PASSWORD'
        | 'SMS_SENDER_ID'
        | 'SMS_ENTITY_ID'
        | 'SMS_TEMPLATE_ID'
        | 'SMS_OTP_MESSAGE'
        | 'SMS_ALERT_TEMPLATE_ID'
        | 'FCM_SERVICE_ACCOUNT_JSON'
        | 'PAYMENTS_DRIVER'
        | 'RAZORPAY_KEY_ID'
        | 'RAZORPAY_KEY_SECRET'
        | 'RAZORPAY_WEBHOOK_SECRET'
        | 'PAYOUTS_DRIVER'
        | 'RAZORPAYX_KEY_ID'
        | 'RAZORPAYX_KEY_SECRET'
        | 'RAZORPAYX_ACCOUNT_NUMBER'
        | 'RAZORPAYX_WEBHOOK_SECRET'
      >
    >,
  mockOptions: MockOptions = {},
): Providers {
  const isLive = env.PROVIDER_MODE === 'live';
  if (!isLive && env.NODE_ENV === 'production') {
    throw new Error('Mock providers are not allowed in production');
  }

  // Each real adapter is built only when its driver is selected. In mock mode the rest stay mocks
  // (so one integration can be switched on alone on staging); in live mode none may be left over.
  const real: Partial<Providers> = {};
  if (env.PAYMENTS_DRIVER === 'razorpay') {
    real.payments = createRazorpayPayments({
      keyId: env.RAZORPAY_KEY_ID ?? '',
      keySecret: env.RAZORPAY_KEY_SECRET ?? '',
      webhookSecret: env.RAZORPAY_WEBHOOK_SECRET ?? '',
    });
  }
  if (env.MAPS_DRIVER === 'google') {
    real.maps = createGoogleMaps({ apiKey: env.GOOGLE_MAPS_API_KEY ?? '' });
  }
  if (env.STORAGE_DRIVER === 'local') {
    real.storage = createLocalStorage({
      dir: env.UPLOAD_DIR ?? '',
      publicUrl: env.UPLOAD_PUBLIC_URL ?? '',
      secret: env.UPLOAD_SIGNING_SECRET ?? '',
      maxBytes: env.UPLOAD_MAX_BYTES ?? 10_485_760,
      allowedTypes: UPLOAD_TYPES,
    });
  }
  if (env.STORAGE_DRIVER === 's3') {
    real.storage = createS3Storage({
      endpoint: env.S3_ENDPOINT ?? '',
      bucket: env.S3_BUCKET ?? '',
      region: env.S3_REGION ?? 'auto',
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
      pathStyle: env.S3_PATH_STYLE ?? true,
    });
  }
  if (env.EMAIL_DRIVER === 'smtp') {
    real.email = createSmtpEmail({
      host: env.SMTP_HOST ?? '',
      port: env.SMTP_PORT ?? 587,
      secure: env.SMTP_SECURE ?? false,
      user: env.SMTP_USER ?? '',
      pass: env.SMTP_PASS ?? '',
      from: env.EMAIL_FROM ?? '',
    });
  }
  // Use a RazorpayX TEST account first.
  if (env.PAYOUTS_DRIVER === 'razorpayx') {
    real.payouts = createRazorpayXPayouts({
      keyId: env.RAZORPAYX_KEY_ID ?? '',
      keySecret: env.RAZORPAYX_KEY_SECRET ?? '',
      accountNumber: env.RAZORPAYX_ACCOUNT_NUMBER ?? '',
      webhookSecret: env.RAZORPAYX_WEBHOOK_SECRET ?? '',
    });
  }
  if (env.SMS_DRIVER === 'nimbus') {
    real.sms = createNimbusSms({
      apiUrl: env.SMS_API_URL ?? '',
      userId: env.SMS_USER_ID ?? '',
      password: env.SMS_PASSWORD ?? '',
      senderId: env.SMS_SENDER_ID ?? '',
      entityId: env.SMS_ENTITY_ID ?? '',
      otp: {
        templateId: env.SMS_TEMPLATE_ID ?? '',
        message: env.SMS_OTP_MESSAGE ?? DEFAULT_OTP_MESSAGE,
      },
      alert: env.SMS_ALERT_TEMPLATE_ID ? { templateId: env.SMS_ALERT_TEMPLATE_ID } : undefined,
    });
  }
  if (env.PUSH_DRIVER === 'fcm') {
    real.push = createFcmPush({
      serviceAccount: parseServiceAccount(env.FCM_SERVICE_ACCOUNT_JSON ?? ''),
    });
  }

  const mocks = createMockProviders(mockOptions);
  if (!isLive) return { ...mocks, ...real };

  // Live mode: every integration must be a real adapter.
  const notReal = (Object.keys(mocks) as (keyof Providers)[]).filter((k) => !real[k]);
  if (notReal.length > 0) {
    throw new Error(`Live mode needs a real adapter for: ${notReal.join(', ')}`);
  }
  return { ...mocks, ...real };
}
