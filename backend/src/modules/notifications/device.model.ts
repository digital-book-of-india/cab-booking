import { Schema, model } from 'mongoose';

/** A phone that can receive push. One push token belongs to exactly one user at a time. */
const deviceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    token: { type: String, required: true, unique: true, maxlength: 4096 },
    platform: { type: String, enum: ['android', 'ios'], required: true },
    // The app's own stable id for the install, used to replace a rotated token.
    deviceId: { type: String, maxlength: 100 },
    appVersion: { type: String, maxlength: 30 },
    lastSeenAt: { type: Date, required: true },
  },
  { timestamps: true },
);

export const Device = model('Device', deviceSchema);
