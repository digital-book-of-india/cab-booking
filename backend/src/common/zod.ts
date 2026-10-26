import { isValidObjectId } from 'mongoose';
import { z } from 'zod';

export const objectId = z.string().refine((v) => isValidObjectId(v) && v.length === 24, {
  message: 'Invalid id',
});

export const geoPoint = z
  .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
  .strict();

/** Escape user input before using it in a RegExp (search filters). */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
