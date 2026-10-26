import { Schema, model } from 'mongoose';

const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true },
  },
  { _id: false },
);

/**
 * Ride-specific data for an assigned booking. The booking owns the lifecycle STATUS (single source
 * of truth); this document holds the OTP state, timestamps and evidence for the trip itself.
 */
const rideSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
    bookingPublicId: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'DriverProfile', required: true },
    driverUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    // The OTP itself is never stored: it is derived from nonce + a server secret.
    otp: {
      nonce: { type: String, required: true },
      attempts: { type: Number, default: 0 },
      issuedAt: { type: Date },
      expiresAt: { type: Date },
      verifiedAt: { type: Date, default: null },
    },
    assignedAt: { type: Date },
    enRouteAt: { type: Date },
    arrivedAt: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date },
    cancelledAt: { type: Date },
    // Server-observed positions at key moments (evidence), never client-trusted fare inputs.
    arrivalLocation: { type: pointSchema, default: undefined },
    startLocation: { type: pointSchema, default: undefined },
    endLocation: { type: pointSchema, default: undefined },
    // Client-reported values kept only as evidence for disputes; they are NOT used for billing.
    reportedOdometerStartMeters: { type: Number },
    reportedOdometerEndMeters: { type: Number },
    driverNote: { type: String, maxlength: 300 },
    finalFare: { type: Schema.Types.Mixed },
    // Server-held record of intermediate stops: when the driver reached and left each one.
    stopLog: {
      type: [
        new Schema(
          {
            index: { type: Number, required: true },
            arrivedAt: { type: Date, required: true },
            departedAt: { type: Date, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    noShowAt: { type: Date },
  },
  { timestamps: true },
);
rideSchema.index({ driverId: 1, createdAt: -1 });
rideSchema.index({ customerId: 1, createdAt: -1 });

export const Ride = model('Ride', rideSchema);
