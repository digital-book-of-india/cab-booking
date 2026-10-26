import { Schema, model } from 'mongoose';

const referralProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    totalReferred: { type: Number, default: 0 },
    rewardedCount: { type: Number, default: 0 },
    rewardEarnedPaise: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const ReferralProfile = model('ReferralProfile', referralProfileSchema);

const referralClaimSchema = new Schema(
  {
    referrerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    refereeId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true }, // One-time per customer
    referralCode: { type: String, required: true, uppercase: true },
    status: { type: String, enum: ['PENDING', 'REWARDED'], default: 'PENDING' },
    rewardCouponCode: { type: String },
    rewardedAt: { type: Date },
  },
  { timestamps: true },
);

export const ReferralClaim = model('ReferralClaim', referralClaimSchema);
