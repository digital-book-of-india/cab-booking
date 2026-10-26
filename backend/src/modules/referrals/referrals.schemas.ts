import { z } from 'zod';

export const claimReferralSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(30)
      .regex(/^[A-Za-z0-9_-]+$/, 'Referral code must be alphanumeric'),
  })
  .strict();

export type ClaimReferralInput = z.infer<typeof claimReferralSchema>;
