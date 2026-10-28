import { z } from 'zod';
import { AccountStatuses, Roles } from '../../common/enums';
import { paginationSchema } from '../../common/pagination';
import { objectId } from '../../common/zod';
import { BookingStatuses, PaymentStatuses } from '../bookings/booking.model';

export const userListQuerySchema = paginationSchema.extend({
  role: z.enum(Roles).optional(),
  accountStatus: z.enum(AccountStatuses).optional(),
  q: z.string().trim().min(1).max(50).optional(),
});

export const userStatusSchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED']),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export const bookingListQuerySchema = paginationSchema.extend({
  status: z.enum(BookingStatuses).optional(),
  paymentStatus: z.enum(PaymentStatuses).optional(),
  customerId: objectId.optional(),
  driverId: objectId.optional(),
  /** Booking id (`bk_...`), full or the start of it. */
  q: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]{2,40}$/)
    .optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export const rideListQuerySchema = paginationSchema.extend({
  status: z.string().trim().optional(),
  paymentStatus: z.string().trim().optional(),
  customerId: objectId.optional(),
  driverId: objectId.optional(),
  search: z.string().trim().optional(),
  q: z.string().trim().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type RideListQuery = z.infer<typeof rideListQuerySchema>;


export const waiveFeeSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

export const expiringDocumentsQuerySchema = paginationSchema.extend({
  /** Approved documents expiring within this many days, plus everything already expired. */
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export const bookingRestrictionSchema = z
  .object({
    action: z.enum(['RESTRICT', 'LIFT']),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();

export const liveDriversQuerySchema = paginationSchema
  .extend({
    zoneId: objectId.optional(),
    minLat: z.coerce.number().min(-90).max(90).optional(),
    maxLat: z.coerce.number().min(-90).max(90).optional(),
    minLng: z.coerce.number().min(-180).max(180).optional(),
    maxLng: z.coerce.number().min(-180).max(180).optional(),
  })
  .refine(
    (data) => {
      const hasAnyBox =
        data.minLat !== undefined ||
        data.maxLat !== undefined ||
        data.minLng !== undefined ||
        data.maxLng !== undefined;
      if (!hasAnyBox) return true;
      return (
        data.minLat !== undefined &&
        data.maxLat !== undefined &&
        data.minLng !== undefined &&
        data.maxLng !== undefined &&
        data.minLat <= data.maxLat &&
        data.minLng <= data.maxLng &&
        data.maxLat - data.minLat <= 5 &&
        data.maxLng - data.minLng <= 5
      );
    },
    {
      message: 'Bounding box must have valid min/max coords with span <= 5 degrees',
      path: ['minLat'],
    },
  );

export const dispatchQueueQuerySchema = paginationSchema.extend({
  zoneId: objectId.optional(),
  categoryId: objectId.optional(),
  includePhone: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export const manualAssignDriverSchema = z
  .object({
    driverId: objectId,
    vehicleId: objectId.optional(),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();

export type WaiveFeeInput = z.infer<typeof waiveFeeSchema>;
export type ExpiringDocumentsQuery = z.infer<typeof expiringDocumentsQuerySchema>;
export type UserListQuery = z.infer<typeof userListQuerySchema>;
export type UserStatusInput = z.infer<typeof userStatusSchema>;
export type BookingListQuery = z.infer<typeof bookingListQuerySchema>;
export type BookingRestrictionInput = z.infer<typeof bookingRestrictionSchema>;
export type LiveDriversQuery = z.infer<typeof liveDriversQuerySchema>;
export type DispatchQueueQuery = z.infer<typeof dispatchQueueQuerySchema>;
export type ManualAssignDriverInput = z.infer<typeof manualAssignDriverSchema>;
