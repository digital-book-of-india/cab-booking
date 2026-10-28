import 'dotenv/config';
import mongoose from 'mongoose';
import { scrypt, randomBytes } from 'node:crypto';

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  const options = { N: n, r, p, maxmem: 64 * 1024 * 1024 };
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, options, (err, key) => (err ? reject(err) : resolve(key as Buffer))),
  );
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password.normalize('NFKC'), salt, 16384, 8, 1);
  return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing');
  await mongoose.connect(uri);
  const userColl = mongoose.connection.collection('users');
  const credColl = mongoose.connection.collection('staffcredentials');

  let adminUser = await userColl.findOne({ role: 'SUPER_ADMIN' });
  if (!adminUser) {
    const res = await userColl.insertOne({
      phone: '+919999999999',
      name: 'Super Admin',
      role: 'SUPER_ADMIN',
      accountStatus: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    adminUser = await userColl.findOne({ _id: res.insertedId });
  }

  if (!adminUser) {
    throw new Error('Failed to find or create SUPER_ADMIN user');
  }

  const passwordHash = await hashPassword('admin@123');

  await credColl.updateOne(
    { email: 'admin@platform.internal' },
    {
      $set: {
        userId: adminUser._id,
        email: 'admin@platform.internal',
        passwordHash,
        totpSecretSealed: 'sealed_dummy_dev_secret',
        totpEnabledAt: new Date(),
        recoveryHashes: [],
        failedCount: 0,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );

  console.log('SEED_STAFF_SUCCESS: admin@platform.internal registered with password admin@123');
  await mongoose.disconnect();
}

main().catch((err: Error) => {
  console.error('Error:', err.message);
  process.exit(1);
});
