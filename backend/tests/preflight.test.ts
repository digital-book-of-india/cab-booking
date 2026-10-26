import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { formatFindings, preflight, sosFinding } from '../src/tools/preflight';
import { allRealDrivers } from './liveEnv';

const prod = (extra: Record<string, string> = {}) =>
  loadEnv({ ...allRealDrivers, NODE_ENV: 'production', REDIS_URL: 'redis://r:6379', ...extra });
const blocks = (f: ReturnType<typeof preflight>) =>
  f.filter((x) => x.level === 'BLOCK').map((x) => x.setting);

describe('launch pre-flight', () => {
  it('blocks test keys, local addresses and a missing alert channel', () => {
    const f = preflight(
      prod({
        RAZORPAY_KEY_ID: 'rzp_test_abc',
        RAZORPAYX_KEY_ID: 'rzp_test_def',
        STAFF_PORTAL_URL: 'http://localhost:3000',
        UPLOAD_PUBLIC_URL: 'https://api.example.com',
        CORS_ORIGINS: 'http://localhost:3000',
      }),
    );
    expect(blocks(f)).toEqual(
      expect.arrayContaining([
        'RAZORPAY_KEY_ID',
        'RAZORPAYX_KEY_ID',
        'STAFF_PORTAL_URL',
        'CORS_ORIGINS',
        'ALERT_WEBHOOK_URL',
      ]),
    );
    expect(blocks(f)).not.toContain('UPLOAD_PUBLIC_URL');
  });

  it('passes a correctly configured launch, leaving only decisions', () => {
    const f = preflight(
      prod({
        RAZORPAY_KEY_ID: 'rzp_live_abc',
        RAZORPAYX_KEY_ID: 'rzp_live_def',
        STAFF_PORTAL_URL: 'https://admin.example.com',
        UPLOAD_PUBLIC_URL: 'https://api.example.com',
        TRIP_LINK_BASE: 'https://t.example.com',
        CORS_ORIGINS: 'https://admin.example.com',
        ALERT_WEBHOOK_URL: 'https://hooks.example.com/x',
        SELLER_GSTIN: '07AAAAA0000A1Z5',
        SMS_ALERT_TEMPLATE_ID: '123',
        TAX_RATES_CONFIRMED: '1',
        JWT_ACCESS_SECRET: 'q'.repeat(48),
        JWT_REFRESH_SECRET: 'w'.repeat(48),
      }),
      { TAX_RATES_CONFIRMED: '1' },
    );
    expect(blocks(f)).toEqual([]);
  });

  it('blocks charging tax with no GSTIN, and warns about placeholder rates', () => {
    const f = preflight(prod());
    expect(blocks(f)).toContain('SELLER_GSTIN');
    expect(f.some((x) => x.level === 'WARN' && x.setting.startsWith('RIDE_TAX_BP'))).toBe(true);
  });

  it('blocks SOS being on with nobody to answer it', () => {
    expect(sosFinding(true, false)).toHaveLength(1);
    expect(sosFinding(true, true)).toEqual([]);
    expect(sosFinding(false, false)).toEqual([]);
    expect(formatFindings([])).toMatch(/no findings/);
    expect(formatFindings(sosFinding(true, false))).toMatch(/1 blocking/);
  });
});
