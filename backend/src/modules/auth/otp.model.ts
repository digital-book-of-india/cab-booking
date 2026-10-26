import { Schema, model } from 'mongoose';

const otpChallengeSchema = new Schema(
  {
    phone: { type: String, required: true },
    // HMAC of "<challengeId>:<otp>". The plaintext OTP is never stored.
    otpHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
otpChallengeSchema.index({ phone: 1, createdAt: -1 });
// Rows are kept 1h past expiry (used for the hourly request cap), then removed.
otpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

export const OtpChallenge = model('OtpChallenge', otpChallengeSchema);
