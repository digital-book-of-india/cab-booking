import { z } from 'zod';
import { BookingStatuses } from '../bookings/booking.model';
import { paginationSchema } from '../../common/pagination';

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const point = z.object({ lat, lng }).strict();

export const rideIdSchema = z.string().regex(/^ride_[0-9a-f]{12}$/, 'Invalid ride id');
export const bookingIdSchema = z.string().regex(/^bk_[0-9a-f]{12}$/, 'Invalid booking id');

export const CustomerCancelReasons = [
  'CHANGED_MIND',
  'BOOKED_BY_MISTAKE',
  'WAIT_TOO_LONG',
  'DRIVER_ASKED_TO_CANCEL',
  'OTHER',
] as const;
export const DriverCancelReasons = [
  'CUSTOMER_NOT_REACHABLE',
  'WRONG_PICKUP',
  'VEHICLE_ISSUE',
  'PERSONAL_EMERGENCY',
  'OTHER',
] as const;

export const customerCancelSchema = z
  .object({
    reasonCode: z.enum(CustomerCancelReasons),
    note: z.string().trim().max(300).optional(),
  })
  .strict();

export const driverCancelSchema = z
  .object({ reasonCode: z.enum(DriverCancelReasons), note: z.string().trim().max(300).optional() })
  .strict();

export const arrivedSchema = z.object({ location: point.optional() }).strict();

// odometer/location are accepted as evidence only; billing never uses client-reported numbers.
export const startSchema = z
  .object({
    pickupOtp: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
    location: point.optional(),
    odometerStartMeters: z.number().int().min(0).max(10_000_000).optional(),
  })
  .strict();

export const completeSchema = z
  .object({
    endLocation: point.optional(),
    odometerEndMeters: z.number().int().min(0).max(10_000_000).optional(),
    driverNote: z.string().trim().max(300).nullable().optional(),
  })
  .strict();

export const stopIndexSchema = z.coerce.number().int().min(0).max(9);

export const destinationRequestSchema = z
  .object({ drop: z.object({ lat, lng, label: z.string().trim().max(200).optional() }).strict() })
  .strict();

export const destinationRespondSchema = z.object({ accept: z.boolean() }).strict();

export const historyQuerySchema = paginationSchema.extend({
  status: z.enum(BookingStatuses).optional(),
});

export type CustomerCancelInput = z.infer<typeof customerCancelSchema>;
export type DriverCancelInput = z.infer<typeof driverCancelSchema>;
export type ArrivedInput = z.infer<typeof arrivedSchema>;
export type StartInput = z.infer<typeof startSchema>;
export type DestinationRequestInput = z.infer<typeof destinationRequestSchema>;
export type CompleteInput = z.infer<typeof completeSchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
