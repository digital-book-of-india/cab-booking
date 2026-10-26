/**
 * One-shot dev script: creates a SUPER_ADMIN user + StaffCredential so the admin panel login works.
 * Usage: npx tsx scripts/create-admin.ts
 *
 * Email:    admin@platform.internal
 * Password: Admin@123456
 * MFA code: 123456  (dev bypass — only works when NODE_ENV !== 'production')
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { createHmac } from 'node:crypto';

// ── Minimal inline models (avoid importing the full app) ──────────────────────

const userSchema = new mongoose.Schema(
  {
    role: String,
    phone: { type: String, unique: true },
    name: String,
    accountStatus: { type: String, default: 'ACTIVE' },
    phoneVerifiedAt: Date,
  },
  { timestamps: true },
);
const User = mongoose.models['User'] ?? mongoose.model('User', userSchema);

const credSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true },
    email: { type: String, unique: true, lowercase: true, trim: true },
    passwordHash: String,
    totpSecretSealed: String,   // we put a dummy sealed secret so the field is present
    totpEnabledAt: Date,        // set = TOTP is "active" → login will ask for MFA code
    lastTotpStep: { type: Number, default: 0 },
    recoveryHashes: [String],
    failedCount: { type: Number, default: 0 },
    lockedUntil: Date,
    passwordChangedAt: Date,
    lastLoginAt: Date,
  },
  { timestamps: true },
);
const StaffCredential =
  mongoose.models['StaffCredential'] ?? mongoose.model('StaffCredential', credSchema);

import { hashPassword } from '../src/common/passwords';


const EMAIL = 'admin@platform.internal';
const PASSWORD = 'Admin@123456';
// Dummy phone — won't be used for login, just needed for the User doc.
const PHONE = '+919999999999';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set in .env');

  console.log('🔌 Connecting to MongoDB…');
  await mongoose.connect(uri);
  console.log('✅ Connected to:', mongoose.connection.name);

  // 1. Upsert the User document
  let user: any = await (User as any).findOne({ phone: PHONE });
  if (!user) {
    user = await User.create({
      phone: PHONE,
      role: 'SUPER_ADMIN',
      name: 'Super Admin',
      accountStatus: 'ACTIVE',
      phoneVerifiedAt: new Date(),
    });
    console.log('👤 Created User:', user._id.toString());
  } else {
    // Make sure the role is correct in case user already existed
    await User.updateOne({ _id: user._id }, { role: 'SUPER_ADMIN', accountStatus: 'ACTIVE' });
    console.log('👤 User already exists:', user._id.toString(), '— ensured SUPER_ADMIN + ACTIVE');
  }

  // 2. Clear any rate-limit lock on existing credential (if any)
  await (StaffCredential as any).updateOne(
    { email: EMAIL },
    { $set: { failedCount: 0 }, $unset: { lockedUntil: 1 } },
  );

  // 3. Hash the password
  const passwordHash = await hashPassword(PASSWORD);

  // 4. Build a dummy sealed TOTP secret.
  //    The dev-mode bypass (line 186 of staffauth.service.ts) checks:
  //      if (process.env.NODE_ENV !== 'production' && input.code === '123456') return true;
  //    So ANY non-empty sealed value is fine — the actual secret is never decoded in dev.
  const hashSecret = process.env.JWT_ACCESS_SECRET ?? 'dev-secret';
  const sealKey = createHmac('sha256', hashSecret).update('staff-totp-seal').digest();
  // Just a placeholder that looks like a sealed value
  const dummySealedSecret = sealKey.toString('hex').slice(0, 64);

  // 5. Upsert StaffCredential
  const result: any = await (StaffCredential as any).findOneAndUpdate(
    { userId: user._id },
    {
      $set: {
        email: EMAIL,
        passwordHash,
        totpSecretSealed: dummySealedSecret,
        totpEnabledAt: new Date(),   // marks TOTP as set up → login flow proceeds to MFA step
        lastTotpStep: 0,
        failedCount: 0,
        recoveryHashes: [],
        passwordChangedAt: new Date(),
      },
      $unset: { lockedUntil: 1 },
    },
    { upsert: true, new: true },
  );

  console.log('🔑 StaffCredential upserted:', result?._id?.toString());
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅  Admin login is ready!');
  console.log('');
  console.log('   URL:      http://localhost:3000/login');
  console.log('   Email:    admin@platform.internal');
  console.log('   Password: Admin@123456');
  console.log('   MFA Code: 123456  (dev bypass)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .catch((err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
  })
  .finally(() => mongoose.disconnect());
