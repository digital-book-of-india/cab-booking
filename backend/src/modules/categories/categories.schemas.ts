import { z } from 'zod';

export const createCategorySchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(20)
      .regex(/^[A-Za-z0-9_]+$/),
    name: z.string().trim().min(1).max(60),
    capacity: z.number().int().min(1).max(20),
    displayOrder: z.number().int().min(0).max(1000).default(0),
    active: z.boolean().default(true),
  })
  .strict();

// The code is immutable once created.
export const updateCategorySchema = createCategorySchema.omit({ code: true }).partial().strict();

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
