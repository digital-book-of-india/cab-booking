require('dotenv').config();
const mongoose = require('mongoose');
const { scrypt, randomBytes } = require('crypto');

function derive(password, salt, n, r, p) {
  const options = { N: n, r, p, maxmem: 64 * 1024 * 1024 };
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, options, (err, key) => (err ? reject(err) : resolve(key)))
  );
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password.normalize('NFKC'), salt, 16384, 8, 1);
  return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
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
    { upsert: true }
  );

  console.log('SEED_STAFF_SUCCESS: admin@platform.internal registered with password admin@123');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
