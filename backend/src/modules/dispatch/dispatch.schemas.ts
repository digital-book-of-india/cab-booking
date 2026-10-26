import { z } from 'zod';

export const rejectOfferSchema = z
  .object({ reason: z.string().trim().min(1).max(200).optional() })
  .strict();

export const offerIdSchema = z.string().regex(/^ofr_[0-9a-f]{12}$/, 'Invalid offer id');
export const bookingIdSchema = z.string().regex(/^bk_[0-9a-f]{12}$/, 'Invalid booking id');
