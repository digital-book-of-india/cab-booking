import { z } from 'zod';
import { objectId } from '../../common/zod';

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

export const presenceSchema = z
  .object({
    status: z.enum(['ONLINE', 'OFFLINE']),
    vehicleId: objectId.optional(),
    location: z.object({ lat, lng }).strict().optional(),
    headingDegrees: z.number().min(0).max(360).optional(),
  })
  .strict()
  .refine((v) => v.status === 'OFFLINE' || !!v.location, {
    message: 'location is required to go online',
    path: ['location'],
  });

export const locationUpdateSchema = z
  .object({
    lat,
    lng,
    accuracyMeters: z.number().min(0).max(10_000).optional(),
    headingDegrees: z.number().min(0).max(360).optional(),
    speedMetersPerSecond: z.number().min(0).max(200).optional(),
    recordedAt: z.coerce.date().optional(),
  })
  .strict();

export type PresenceInput = z.infer<typeof presenceSchema>;
export type LocationUpdateInput = z.infer<typeof locationUpdateSchema>;
