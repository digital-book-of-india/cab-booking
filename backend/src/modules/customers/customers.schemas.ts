import { z } from 'zod';

export const updateCustomerSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    email: z.string().trim().email().max(254).nullable().optional(),
  })
  .strict();

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const savedPlaceTypeSchema = z
  .enum(['home', 'work', 'other', 'HOME', 'WORK', 'OTHER'])
  .transform((v) => v.toLowerCase() as 'home' | 'work' | 'other');

export const createSavedPlaceSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    type: savedPlaceTypeSchema,
    address: z.string().trim().min(3).max(300),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .strict();

export const updateSavedPlaceSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    type: savedPlaceTypeSchema.optional(),
    address: z.string().trim().min(3).max(300).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .strict()
  .refine(
    (data) =>
      (data.lat === undefined && data.lng === undefined) ||
      (data.lat !== undefined && data.lng !== undefined),
    { message: 'lat and lng must both be provided if updating coordinates', path: ['lat'] },
  );

export type CreateSavedPlaceInput = z.infer<typeof createSavedPlaceSchema>;
export type UpdateSavedPlaceInput = z.infer<typeof updateSavedPlaceSchema>;
