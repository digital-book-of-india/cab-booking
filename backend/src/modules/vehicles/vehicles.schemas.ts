import { z } from 'zod';
import { objectId } from '../../common/zod';

const registrationSchema = z
  .string()
  .transform((v) => v.toUpperCase().replace(/[^A-Z0-9]/g, ''))
  .pipe(z.string().regex(/^[A-Z0-9]{6,12}$/, 'Invalid registration number'));

export const createVehicleSchema = z
  .object({
    categoryId: objectId,
    registrationNumber: registrationSchema,
    make: z.string().trim().min(1).max(40),
    model: z.string().trim().min(1).max(40),
    color: z.string().trim().min(1).max(30),
    seats: z.number().int().min(1).max(20),
  })
  .strict();

// Registration number and category are deliberately not editable: changing them needs re-verification.
export const updateVehicleSchema = z
  .object({
    make: z.string().trim().min(1).max(40),
    model: z.string().trim().min(1).max(40),
    color: z.string().trim().min(1).max(30),
    seats: z.number().int().min(1).max(20),
  })
  .partial()
  .strict();

export const verificationSchema = z
  .object({
    status: z.enum(['VERIFIED', 'REJECTED']),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict()
  .refine((v) => v.status === 'VERIFIED' || !!v.reason, {
    message: 'reason is required when rejecting',
    path: ['reason'],
  });

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
export type VerificationInput = z.infer<typeof verificationSchema>;
