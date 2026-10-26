import { Schema, model } from 'mongoose';
import { VehicleVerificationStatuses } from '../../common/enums';

const vehicleSchema = new Schema(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'DriverProfile', required: true, index: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'CabCategory', required: true },
    // Uppercase, no spaces/dashes. Unique across the platform.
    registrationNumber: { type: String, required: true },
    // False once the vehicle is rejected, which frees the plate for a genuine registration.
    holdsRegistration: { type: Boolean, default: true },
    make: { type: String, trim: true, maxlength: 40 },
    model: { type: String, trim: true, maxlength: 40 },
    color: { type: String, trim: true, maxlength: 30 },
    seats: { type: Number, required: true, min: 1, max: 20 },
    verificationStatus: { type: String, enum: VehicleVerificationStatuses, default: 'PENDING' },
    rejectionReason: { type: String, maxlength: 500 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// One live registration per plate across the platform (rejected vehicles do not count).
vehicleSchema.index(
  { registrationNumber: 1 },
  { unique: true, partialFilterExpression: { holdsRegistration: true } },
);
// Verification queue / dashboard count.
vehicleSchema.index({ verificationStatus: 1, createdAt: 1 });

export const Vehicle = model('Vehicle', vehicleSchema);
