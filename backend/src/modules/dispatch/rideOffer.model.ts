import { Schema, model } from 'mongoose';

export const OfferStatuses = ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN'] as const;
export type OfferStatus = (typeof OfferStatuses)[number];

const rideOfferSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'DriverProfile', required: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    // Matches booking.dispatch.round, so an admin retry can re-offer drivers from earlier rounds.
    round: { type: Number, required: true, default: 1 },
    status: { type: String, enum: OfferStatuses, default: 'PENDING', required: true },
    expiresAt: { type: Date, required: true },
    respondedAt: { type: Date },
    rejectReason: { type: String, maxlength: 200 },
    pickupDistanceMeters: { type: Number },
    pickupEtaSeconds: { type: Number },
    rank: { type: Number },
  },
  { timestamps: true },
);
// A driver is never offered the same booking twice in one round.
rideOfferSchema.index({ bookingId: 1, driverId: 1, round: 1 }, { unique: true });
rideOfferSchema.index({ driverId: 1, status: 1, expiresAt: 1 });
rideOfferSchema.index({ status: 1, expiresAt: 1 });
rideOfferSchema.index({ bookingId: 1, status: 1 });

export const RideOffer = model('RideOffer', rideOfferSchema);
