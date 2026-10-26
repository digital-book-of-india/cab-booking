import { z } from 'zod';
import { objectId } from '../../common/zod';

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

/** Hard ceiling on stops. (The per-deployment limit lives in the dispatch config.) */
export const MAX_STOPS = 3;

export const quotePointSchema = z
  .object({ lat, lng, label: z.string().trim().max(200).optional() })
  .strict();

export const createQuoteSchema = z
  .object({
    pickup: quotePointSchema,
    // Not needed for a rental (the car stays with the rider and comes back to the pickup).
    drop: quotePointSchema.optional(),
    // Up to 3 intermediate stops, visited in this order.
    stops: z.array(quotePointSchema).max(MAX_STOPS).optional(),
    categoryId: objectId,
    paymentPreference: z.enum(['CASH', 'ONLINE']).optional(),
    couponCode: z.string().trim().min(3).max(30).nullable().optional(),
    // Price a ride for later (pickup time). Leave out for a ride now.
    scheduledFor: z.coerce.date().optional(),
    // A rental: the package to price (see GET /rental-packages).
    rentalPackageId: objectId.optional(),
    // An outstation trip: one way, or a round trip with the date of return.
    outstation: z
      .object({
        tripType: z.enum(['ONE_WAY', 'ROUND_TRIP']),
        returnAt: z.coerce.date().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (v.rentalPackageId && v.outstation)
      fail('outstation', 'Choose a rental or an outstation trip, not both.');
    if (v.rentalPackageId && v.stops && v.stops.length > 0) fail('stops', 'A rental has no stops.');
    if (v.outstation && v.stops && v.stops.length > 0)
      fail('stops', 'An outstation trip has no stops.');
    if (!v.rentalPackageId && !v.drop) fail('drop', 'Where are you going?');
    if (v.outstation?.tripType === 'ROUND_TRIP' && !v.outstation.returnAt) {
      fail('outstation', 'A round trip needs the date and time you want to return.');
    }
    if (v.outstation?.tripType === 'ONE_WAY' && v.outstation.returnAt) {
      fail('outstation', 'A one-way trip has no return time.');
    }
  });

export const serviceabilityQuerySchema = z.object({
  pickupLat: z.coerce.number().min(-90).max(90),
  pickupLng: z.coerce.number().min(-180).max(180),
  dropLat: z.coerce.number().min(-90).max(90),
  dropLng: z.coerce.number().min(-180).max(180),
});

export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;
export type ServiceabilityQuery = z.infer<typeof serviceabilityQuerySchema>;
