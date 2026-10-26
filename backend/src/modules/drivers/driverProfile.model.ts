import { Schema, model } from 'mongoose';

// Declared as a sub-schema with default undefined so offline drivers have NO currentLocation
// (an empty GeoJSON object would break the 2dsphere index).
const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true },
  },
  { _id: false },
);
import { DriverApprovalStatuses, OnlineStatuses } from '../../common/enums';

const driverProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    approvalStatus: { type: String, enum: DriverApprovalStatuses, default: 'PENDING', index: true },
    onlineStatus: { type: String, enum: OnlineStatuses, default: 'OFFLINE' },
    city: { type: String, trim: true, maxlength: 80 },
    // Presence / live position (only meaningful while ONLINE)
    currentVehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
    currentLocation: { type: pointSchema, default: undefined },
    locationUpdatedAt: { type: Date },
    locationAccuracyMeters: { type: Number },
    headingDegrees: { type: Number },
    // Booking _id of the ride this driver is on. Set atomically on accept: a driver can hold only one.
    activeRideId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
    // When that lock was taken. The reconciler only frees locks older than a grace period, so it
    // can never undo an accept that is still in progress.
    activeRideSince: { type: Date },
    // Running totals of the stars riders gave, so the average is cheap to show.
    ratingCount: { type: Number, default: 0 },
    ratingSum: { type: Number, default: 0 },
    // Which long trips this driver is willing to be offered. Rentals are on by default; outstation is opt-in.
    acceptsRentals: { type: Boolean, default: true },
    acceptsOutstation: { type: Boolean, default: false },
    applicationSubmittedAt: { type: Date },
    reviewedAt: { type: Date },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    // Reason shown to the driver after reject / resubmission / suspension.
    decisionReason: { type: String, maxlength: 500 },
  },
  { timestamps: true },
);
driverProfileSchema.index({ approvalStatus: 1, onlineStatus: 1 });
driverProfileSchema.index({ currentLocation: '2dsphere' });
// Admin review queue (filter by status, newest first).
driverProfileSchema.index({ approvalStatus: 1, createdAt: -1 });
// Stale-presence sweep: ONLINE drivers whose GPS went quiet.
driverProfileSchema.index({ onlineStatus: 1, locationUpdatedAt: 1 });
// Reconciler: only drivers that currently hold a ride lock (a handful), not every profile.
driverProfileSchema.index(
  { activeRideId: 1 },
  { partialFilterExpression: { activeRideId: { $type: 'objectId' } } },
);

export const DriverProfile = model('DriverProfile', driverProfileSchema);
