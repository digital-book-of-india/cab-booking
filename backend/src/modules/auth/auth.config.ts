import type { Env } from '../../config/env';

export type AuthConfig = {
  accessSecret: string;
  /** Key for HMAC-hashing OTPs and refresh tokens at rest. */
  hashSecret: string;
  accessTtlSeconds: number;
  refreshTtlDays: number;
  otpTtlSeconds: number;
  otpResendSeconds: number;
  otpMaxAttempts: number;
  otpMaxPerHour: number;
  /** Non-production only: when set, every login OTP is this code (see STAGING_FIXED_OTP). */
  fixedOtp?: string;
  /** May staff sign in with a phone code? Off in production: staff use email, password and an authenticator. */
  staffOtpLogin: boolean;
  /** Staff logins end sooner than everyone else's. */
  staffRefreshTtlHours: number;
};

export function authConfigFromEnv(env: Env): AuthConfig {
  return {
    accessSecret: env.JWT_ACCESS_SECRET,
    hashSecret: env.JWT_REFRESH_SECRET,
    accessTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
    refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    otpTtlSeconds: env.OTP_TTL_SECONDS,
    otpResendSeconds: env.OTP_RESEND_SECONDS,
    otpMaxAttempts: env.OTP_MAX_ATTEMPTS,
    otpMaxPerHour: env.OTP_MAX_PER_HOUR,
    fixedOtp: env.STAGING_FIXED_OTP,
    staffOtpLogin: env.STAFF_OTP_LOGIN,
    staffRefreshTtlHours: env.STAFF_REFRESH_TTL_HOURS,
  };
}
