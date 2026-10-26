import { z } from 'zod';

const lng = z.number().min(-180).max(180);
const lat = z.number().min(-90).max(90);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (24h)');

export const polygonSchema = z
  .object({
    type: z.literal('Polygon'),
    coordinates: z
      .array(
        z
          .array(z.tuple([lng, lat]))
          .min(4)
          .max(500),
      )
      .length(1, 'Exactly one outer ring is supported'),
  })
  .strict()
  .refine(
    (p) => {
      const ring = p.coordinates[0]!;
      const first = ring[0]!;
      const last = ring[ring.length - 1]!;
      return first[0] === last[0] && first[1] === last[1];
    },
    {
      message: 'Polygon ring must be closed (first point equals last point)',
      path: ['coordinates'],
    },
  );

const operatingHoursSchema = z.object({ start: hhmm, end: hhmm }).strict();

export const createZoneSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(30)
      .regex(/^[A-Za-z0-9_]+$/),
    name: z.string().trim().min(1).max(80),
    cityCode: z
      .string()
      .trim()
      .min(2)
      .max(20)
      .regex(/^[A-Za-z0-9_]+$/),
    polygon: polygonSchema,
    active: z.boolean().default(true),
    operatingHours: operatingHoursSchema.optional(),
  })
  .strict();

// code is immutable; operatingHours: null clears the window (open 24h).
export const updateZoneSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    polygon: polygonSchema,
    active: z.boolean(),
    operatingHours: operatingHoursSchema.nullable(),
  })
  .partial()
  .strict();

export type CreateZoneInput = z.infer<typeof createZoneSchema>;
export type UpdateZoneInput = z.infer<typeof updateZoneSchema>;
