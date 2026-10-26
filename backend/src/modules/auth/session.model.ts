import { Schema, model } from 'mongoose';

const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    refreshTokenHash: { type: String, required: true },
    // Previous hash, kept so reuse of a rotated token can be detected as theft.
    prevRefreshTokenHash: { type: String },
    device: {
      platform: { type: String, maxlength: 20 },
      deviceId: { type: String, maxlength: 100 },
      appVersion: { type: String, maxlength: 30 },
    },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date },
  },
  { timestamps: true },
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = model('Session', sessionSchema);
