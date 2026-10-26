import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from '../src/config/env';
import { createProviders } from '../src/providers';
import { allRealDrivers, liveBase } from './liveEnv';

const base = liveBase;
const allReal = allRealDrivers;

describe('live provider mode', () => {
  it('names every integration still on a mock, all at once', () => {
    let message = '';
    try {
      loadEnv(base);
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      message = (err as Error).message;
    }
    for (const key of [
      'PAYMENTS_DRIVER',
      'PAYOUTS_DRIVER',
      'SMS_DRIVER',
      'PUSH_DRIVER',
      'EMAIL_DRIVER',
      'STORAGE_DRIVER',
      'MAPS_DRIVER',
    ]) {
      expect(message).toContain(key);
    }
  });

  it('names the missing keys of a chosen integration', () => {
    expect(() => loadEnv({ ...allReal, RAZORPAY_KEY_SECRET: undefined })).toThrow(
      /PAYMENTS_DRIVER=razorpay needs/,
    );
    expect(() => loadEnv({ ...allReal, GOOGLE_MAPS_API_KEY: undefined })).toThrow(
      /MAPS_DRIVER=google needs GOOGLE_MAPS_API_KEY/,
    );
  });

  it('builds a real adapter for every integration', () => {
    const env = loadEnv(allReal);
    const mocks = createProviders({ NODE_ENV: 'test', PROVIDER_MODE: 'mock' });
    const p = createProviders(env);
    for (const k of ['maps', 'payments', 'payouts', 'sms', 'push', 'email', 'storage'] as const) {
      expect(p[k], k).not.toBe(mocks[k]);
    }
    // A real payments adapter does not carry the mock's fixed key.
    expect(p.payments.checkoutKey).toBe('rzp_test_x');
  });

  it('createProviders itself refuses a live config with an integration left on a mock', () => {
    const env = loadEnv(allReal);
    expect(() => createProviders({ ...env, PAYMENTS_DRIVER: 'mock' })).toThrow(/payments/);
    expect(() => createProviders({ ...env, MAPS_DRIVER: 'mock' })).toThrow(/maps/);
    expect(() => createProviders({ ...env, NODE_ENV: 'production' })).not.toThrow();
  });

  it('local file storage needs its folder, public address and signing secret', () => {
    const local = {
      ...base,
      NODE_ENV: 'development',
      PROVIDER_MODE: 'mock',
      STORAGE_DRIVER: 'local',
    };
    expect(() => loadEnv(local)).toThrow(/UPLOAD_DIR, UPLOAD_PUBLIC_URL, UPLOAD_SIGNING_SECRET/);
    expect(() =>
      loadEnv({
        ...local,
        UPLOAD_DIR: '/x',
        UPLOAD_PUBLIC_URL: 'https://a.example.com',
        UPLOAD_SIGNING_SECRET: 'short',
      }),
    ).toThrow(EnvValidationError);
    const ok = loadEnv({
      ...local,
      UPLOAD_DIR: '/x',
      UPLOAD_PUBLIC_URL: 'https://a.example.com',
      UPLOAD_SIGNING_SECRET: 'k'.repeat(32),
    });
    expect(ok.UPLOAD_MAX_BYTES).toBe(10_485_760);
    // Local storage counts as a real adapter in live mode.
    const live = loadEnv({
      ...allReal,
      STORAGE_DRIVER: 'local',
      UPLOAD_DIR: '/x',
      UPLOAD_PUBLIC_URL: 'https://a.example.com',
      UPLOAD_SIGNING_SECRET: 'k'.repeat(32),
    });
    const mocks = createProviders({ NODE_ENV: 'test', PROVIDER_MODE: 'mock' });
    expect(createProviders(live).storage).not.toBe(mocks.storage);
  });
});
