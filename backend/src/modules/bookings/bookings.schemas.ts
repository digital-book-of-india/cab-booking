import { z } from 'zod';
import { paginationSchema } from '../../common/pagination';
import { objectId } from '../../common/zod';
import { BookingStatuses } from './booking.model';

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

export const idempotencyKeySchema = z
  .string({ error: 'Idempotency-Key header is required' })
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/, 'Idempotency-Key may contain letters, digits and _ . : -');

/**
 * Pickup/drop/category may be echoed by the app for convenience, but they are never trusted:
 * they must match the quote or the request is rejected. The quote is the source of truth.
 */
export const createBookingSchema = z
  .object({
    quoteId: z.string().min(1).max(40),
    paymentMethod: z.enum(['CASH', 'ONLINE', 'CORPORATE']),
    // For CORPORATE rides: the company's own reference (cost centre, project, purpose).
    corporateReference: z.string().trim().min(1).max(60).optional(),
    rideType: z.enum(['INSTANT', 'SCHEDULED']).default('INSTANT'),
    // For rideType SCHEDULED: must match the time the quote was made for.
    scheduledFor: z.coerce.date().optional(),
    notes: z.string().trim().max(300).optional(),
    pickup: z
      .object({
        lat,
        lng,
        label: z.string().max(200).optional(),
        contactName: z.string().trim().min(1).max(100).optional(),
        contactPhone: z.string().min(5).max(20).optional(),
      })
      .strict()
      .optional(),
    drop: z
      .object({ lat, lng, label: z.string().max(200).optional() })
      .strict()
      .optional(),
    categoryId: objectId.optional(),
    // Echoed for convenience; must match the quote.
    tripKind: z.enum(['CITY', 'RENTAL', 'OUTSTATION']).optional(),
    // Echoed for convenience; must match the stops on the quote.
    stops: z
      .array(z.object({ lat, lng, label: z.string().max(200).optional() }).strict())
      .max(3)
      .optional(),
  })
  .strict();

export const bookingListQuerySchema = paginationSchema.extend({
  status: z.enum(BookingStatuses).optional(),
});
export type BookingListQuery = z.infer<typeof bookingListQuerySchema>;

export const rescheduleSchema = z.object({ scheduledFor: z.coerce.date() }).strict();

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
