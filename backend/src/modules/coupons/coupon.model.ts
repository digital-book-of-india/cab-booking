import { Schema, model } from 'mongoose';

export const CouponTypes = ['PERCENT', 'FLAT'] as const;

/**
 * A promotion code. The platform funds the discount: the driver is still paid on the full fare.
 * `value` is basis points for PERCENT (1000 = 10%) and paise for FLAT.
 */
const couponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, maxlength: 200 },
    type: { type: String, enum: CouponTypes, required: true },
    value: { type: Number, required: true, min: 1 },
    // Upper limit on one ride's discount (mainly for percent coupons).
    maxDiscountPaise: { type: Number, min: 1 },
    // The fare must be at least this much for the coupon to apply.
    minFarePaise: { type: Number, default: 0, min: 0 },
    validFrom: { type: Date, required: true },
    validTo: { type: Date, required: true },
    active: { type: Boolean, default: true },
    // Total uses across all riders; unset = unlimited.
    maxRedemptions: { type: Number, min: 1 },
    perUserLimit: { type: Number, default: 1, min: 1 },
    // Empty = anywhere / any category.
    zoneIds: { type: [Schema.Types.ObjectId], default: [] },
    categoryIds: { type: [Schema.Types.ObjectId], default: [] },
    // Uses reserved so far (released again if the ride never happens).
    redemptionsCount: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
couponSchema.index({ active: 1, validTo: 1 });

export const Coupon = model('Coupon', couponSchema);

/** How many times each rider has used each coupon. The unique key is what makes the limit safe. */
const couponUsageSchema = new Schema(
  {
    couponId: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    count: { type: Number, default: 0 },
  },
  { timestamps: false },
);
couponUsageSchema.index({ couponId: 1, userId: 1 }, { unique: true });

export const CouponUsage = model('CouponUsage', couponUsageSchema);
