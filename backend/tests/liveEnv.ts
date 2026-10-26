import { generateKeyPairSync } from 'node:crypto';

/** A valid live-mode environment: every integration real (dummy values; nothing is called at start-up). */
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

export const liveBase = {
  NODE_ENV: 'staging',
  MONGODB_URI: 'mongodb://localhost/test',
  REDIS_URL: 'redis://localhost',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  PROVIDER_MODE: 'live',
};

export const allRealDrivers = {
  ...liveBase,
  MAPS_DRIVER: 'google',
  GOOGLE_MAPS_API_KEY: 'AIza-test-key',
  PAYMENTS_DRIVER: 'razorpay',
  RAZORPAY_KEY_ID: 'rzp_test_x',
  RAZORPAY_KEY_SECRET: 'secret',
  RAZORPAY_WEBHOOK_SECRET: 'whsec',
  PAYOUTS_DRIVER: 'razorpayx',
  RAZORPAYX_KEY_ID: 'rzpx',
  RAZORPAYX_KEY_SECRET: 'secret',
  RAZORPAYX_ACCOUNT_NUMBER: '1234567890',
  RAZORPAYX_WEBHOOK_SECRET: 'whsec',
  SMS_DRIVER: 'nimbus',
  SMS_API_URL: 'https://sms.example.com/send',
  SMS_USER_ID: 'u',
  SMS_PASSWORD: 'p',
  SMS_SENDER_ID: 'CABAPP',
  SMS_ENTITY_ID: '1',
  SMS_TEMPLATE_ID: '2',
  PUSH_DRIVER: 'fcm',
  FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({
    project_id: 'cab-test',
    client_email: 'push@cab-test.iam.gserviceaccount.com',
    private_key: privateKey,
  }),
  EMAIL_DRIVER: 'smtp',
  SMTP_HOST: 'smtp.example.com',
  SMTP_USER: 'u',
  SMTP_PASS: 'p',
  EMAIL_FROM: 'noreply@example.com',
  STORAGE_DRIVER: 's3',
  S3_ENDPOINT: 'https://s3.example.com',
  S3_BUCKET: 'docs',
  S3_ACCESS_KEY_ID: 'k',
  S3_SECRET_ACCESS_KEY: 's',
};
