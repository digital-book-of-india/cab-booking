import { Schema, model } from 'mongoose';

/** What a rider can say about a driver, and a driver about a rider. */
export const RiderToDriverTags = [
  'POLITE',
  'CLEAN_CAR',
  'SAFE_DRIVING',
  'GOOD_NAVIGATION',
  'ON_TIME',
  'RUDE',
  'UNSAFE_DRIVING',
  'DIRTY_CAR',
  'LONG_ROUTE',
] as const;
export const DriverToRiderTags = ['POLITE', 'ON_TIME', 'RUDE', 'LATE', 'MESSY'] as const;

/** One person's rating of the other for one ride. At most one per side per ride. */
const ratingSchema = new Schema(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    bookingPublicId: { type: String, required: true },
    ridePublicId: { type: String, required: true },
    raterRole: { type: String, enum: ['CUSTOMER', 'DRIVER'], required: true },
    raterUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    rateeUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Set when a rider rates a driver, so a driver's ratings are found by their profile.
    rateeDriverId: { type: Schema.Types.ObjectId, ref: 'DriverProfile' },
    stars: { type: Number, required: true, min: 1, max: 5 },
    tags: { type: [String], default: [] },
    comment: { type: String, maxlength: 300 },
    // Staff can hide an abusive comment; the stars still count.
    hidden: { type: Boolean, default: false },
    hiddenBy: { type: Schema.Types.ObjectId, ref: 'User' },
    hiddenReason: { type: String, maxlength: 300 },
    // The running average on the profile has been updated for this rating.
    counted: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
ratingSchema.index({ bookingId: 1, raterRole: 1 }, { unique: true });
ratingSchema.index({ rateeDriverId: 1, createdAt: -1 }, { sparse: true });
ratingSchema.index({ rateeUserId: 1, raterRole: 1 });
ratingSchema.index({ stars: 1, hidden: 1, createdAt: -1 });
ratingSchema.index({ counted: 1, createdAt: 1 });

export const Rating = model('Rating', ratingSchema);
