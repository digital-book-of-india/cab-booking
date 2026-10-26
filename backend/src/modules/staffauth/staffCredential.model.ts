import { Schema, model } from 'mongoose';

/**
 * How a staff member signs in: email + password + a code from an authenticator app. The password
 * is stored only as a salted scrypt hash, the authenticator secret only encrypted, and the
 * recovery codes and one-time links only as keyed hashes.
 */
const staffCredentialSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String },
    // The authenticator secret, encrypted. `totpEnabledAt` is set once the first code is confirmed.
    totpSecretSealed: { type: String },
    totpEnabledAt: { type: Date },
    // The last time step accepted, so one code cannot be used twice.
    lastTotpStep: { type: Number, default: 0 },
    recoveryHashes: { type: [String], default: [] },
    // The invitation link (set up the account) and the reset link (forgot password).
    setupTokenHash: { type: String },
    setupExpiresAt: { type: Date },
    resetTokenHash: { type: String },
    resetExpiresAt: { type: Date },
    failedCount: { type: Number, default: 0 },
    lockedUntil: { type: Date },
    passwordChangedAt: { type: Date },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);
staffCredentialSchema.index({ setupTokenHash: 1 }, { sparse: true });
staffCredentialSchema.index({ resetTokenHash: 1 }, { sparse: true });

export const StaffCredential = model('StaffCredential', staffCredentialSchema);
