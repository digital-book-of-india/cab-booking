import { z } from 'zod';
import { SignupRoles } from '../../common/enums';

const deviceSchema = z
  .object({
    platform: z.string().max(20).optional(),
    deviceId: z.string().max(100).optional(),
    appVersion: z.string().max(30).optional(),
  })
  .strict();

export const requestOtpSchema = z
  .object({ phone: z.string().min(5).max(20), purpose: z.literal('login').optional() })
  .strict();

export const verifyOtpSchema = z
  .object({
    challengeId: z.string().min(1).max(40),
    phone: z.string().min(5).max(20),
    otp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
    role: z.enum(SignupRoles).optional(),
    device: deviceSchema.optional(),
  })
  .strict();

export const refreshSchema = z
  .object({ refreshToken: z.string().min(10).max(200), device: deviceSchema.optional() })
  .strict();
