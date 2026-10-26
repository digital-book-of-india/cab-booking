import type { Env } from '../config/env';

export type Finding = { level: 'BLOCK' | 'WARN'; setting: string; message: string };

const LOCAL = /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])([:/]|$)/i;

/**
 * Settings that are legal for the server to start with but wrong for real customers. `loadEnv` already
 * refuses the dangerous ones (mock providers, wildcard CORS, fixed OTP, load-test mode, staff OTP, no Redis);
 * this adds what only makes sense to check right before launch. BLOCK = do not launch; WARN = decide.
 */
export function preflight(env: Env, raw: NodeJS.ProcessEnv = process.env): Finding[] {
  const out: Finding[] = [];
  const block = (setting: string, message: string) =>
    out.push({ level: 'BLOCK', setting, message });
  const warn = (setting: string, message: string) => out.push({ level: 'WARN', setting, message });

  if (env.NODE_ENV !== 'production') block('NODE_ENV', 'must be production for a launch check');
  if (env.PROVIDER_MODE !== 'live') block('PROVIDER_MODE', 'must be live');

  // Vendor keys that are for testing.
  if (env.RAZORPAY_KEY_ID?.startsWith('rzp_test_'))
    block('RAZORPAY_KEY_ID', 'is a TEST key: no real money would move');
  if (env.RAZORPAYX_KEY_ID?.startsWith('rzp_test_'))
    block('RAZORPAYX_KEY_ID', 'is a TEST key: no real payouts would be made');
  if (
    env.RAZORPAY_KEY_ID &&
    !env.RAZORPAY_KEY_ID.startsWith('rzp_live_') &&
    !out.some((f) => f.setting === 'RAZORPAY_KEY_ID')
  )
    warn('RAZORPAY_KEY_ID', 'does not start with rzp_live_; check it is the live key');

  // Addresses that only work on a developer machine.
  for (const key of ['STAFF_PORTAL_URL', 'UPLOAD_PUBLIC_URL', 'TRIP_LINK_BASE'] as const) {
    const v = env[key];
    if (v && LOCAL.test(v))
      block(key, `points at this machine (${v}); customers and staff cannot reach it`);
    else if (v && v.startsWith('http://')) block(key, 'is not HTTPS');
  }
  if (env.CORS_ORIGINS.length === 0)
    warn(
      'CORS_ORIGINS',
      'is empty: browser apps (the admin panel) will be blocked; mobile apps are unaffected',
    );
  for (const o of env.CORS_ORIGINS) {
    if (LOCAL.test(o)) block('CORS_ORIGINS', `allows a local address (${o})`);
  }

  // Secrets.
  if (
    /change|example|secret|password|test|dev/i.test(env.JWT_ACCESS_SECRET + env.JWT_REFRESH_SECRET)
  )
    warn('JWT_*_SECRET', 'looks like a placeholder; generate with `openssl rand -hex 48`');
  if (env.UPLOAD_SIGNING_SECRET && env.UPLOAD_SIGNING_SECRET === env.JWT_ACCESS_SECRET)
    block('UPLOAD_SIGNING_SECRET', 'must differ from the JWT secrets');

  // Money and tax.
  if (env.RIDE_TAX_BP === 500 && env.COMMISSION_TAX_BP === 1800 && !raw['TAX_RATES_CONFIRMED'])
    warn(
      'RIDE_TAX_BP / COMMISSION_TAX_BP',
      'are the 5% / 18% placeholders; confirm with an accountant, then set TAX_RATES_CONFIRMED=1',
    );
  if ((env.RIDE_TAX_BP > 0 || env.COMMISSION_TAX_BP > 0) && !env.SELLER_GSTIN)
    block('SELLER_GSTIN', 'tax is charged but no GSTIN is set for receipts and invoices');
  if (env.AUTO_PAYOUTS)
    warn('AUTO_PAYOUTS', 'is on: approved settlements pay out without a person pressing pay');

  // Storage.
  if (env.STORAGE_DRIVER === 'local')
    warn(
      'STORAGE_DRIVER',
      'local disk: run ONE api instance only, and back the uploads folder up (or move to s3)',
    );

  // Seeing problems.
  if (!env.ALERT_WEBHOOK_URL)
    block('ALERT_WEBHOOK_URL', 'no alert channel: failures would only be in the logs');
  if (!env.METRICS_TOKEN) warn('METRICS_TOKEN', 'metrics endpoint is off');
  if (env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace')
    warn('LOG_LEVEL', `${env.LOG_LEVEL} is noisy and may log personal data`);

  // Safety desk.
  if (!env.SMS_ALERT_TEMPLATE_ID)
    warn(
      'SMS_ALERT_TEMPLATE_ID',
      'emergency texts to contacts will not be sent (needed before SOS is switched on)',
    );

  return out;
}

/** The database side of the check: an SOS flag that is on without anyone to answer it. */
export function sosFinding(sosEnabled: boolean, safetyDeskStaffed: boolean): Finding[] {
  return sosEnabled && !safetyDeskStaffed
    ? [
        {
          level: 'BLOCK',
          setting: 'flag SOS',
          message:
            'is ON but SAFETY_DESK_STAFFED is not set: riders could press SOS with nobody watching',
        },
      ]
    : [];
}

export function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return 'Pre-flight: no findings.';
  const rows = findings.map((f) => `${f.level.padEnd(5)} ${f.setting}: ${f.message}`);
  const blocks = findings.filter((f) => f.level === 'BLOCK').length;
  return `${rows.join('\n')}\n\n${blocks} blocking, ${findings.length - blocks} to decide.`;
}
