import { Schema, model } from 'mongoose';

const customerProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    email: { type: String, lowercase: true, trim: true, maxlength: 254 },
    // Running totals of the stars drivers gave this rider.
    ratingCount: { type: Number, default: 0 },
    ratingSum: { type: Number, default: 0 },
    // Admin booking restrictions (separate from user suspension and unpaid balance)
    bookingRestricted: { type: Boolean, default: false },
    bookingRestrictionReason: { type: String, maxlength: 300 },
    bookingRestrictedAt: { type: Date },
    bookingRestrictedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const CustomerProfile = model('CustomerProfile', customerProfileSchema);
