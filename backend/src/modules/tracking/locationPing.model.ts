import { Schema, model } from 'mongoose';

/** Placeholder retention for route trails. */
export const LOCATION_TRAIL_RETENTION_DAYS = 30;

/**
 * A sampled point of the driver's route during an active ride. Kept for disputes and support, and
 * deleted automatically by the TTL index. Only written while a ride is active, never otherwise.
 */
const locationPingSchema = new Schema(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    ridePublicId: { type: String },
    driverId: { type: Schema.Types.ObjectId, ref: 'DriverProfile', required: true },
    location: {
      type: { type: String, enum: ['Point'], required: true },
      coordinates: { type: [Number], required: true },
    },
    accuracyMeters: { type: Number },
    headingDegrees: { type: Number },
    recordedAt: { type: Date, required: true },
    // The booking status when the point was taken, so a trail can be split into pickup/trip legs.
    bookingStatus: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
locationPingSchema.index({ bookingId: 1, recordedAt: 1 });
locationPingSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: LOCATION_TRAIL_RETENTION_DAYS * 86400 },
);

export const LocationPing = model('LocationPing', locationPingSchema);
