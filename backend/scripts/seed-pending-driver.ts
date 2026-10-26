import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function seedPendingKycDriver() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not found');
  await mongoose.connect(uri);

  const phone = '+919876543210';
  let user = await mongoose.connection.collection('users').findOne({ phone });
  if (!user) {
    const userRes = await mongoose.connection.collection('users').insertOne({
      phone,
      name: 'Vikram Singh',
      role: 'DRIVER',
      accountStatus: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    user = { _id: userRes.insertedId, name: 'Vikram Singh', phone };
  }

  let profile = await mongoose.connection.collection('driverprofiles').findOne({ userId: user._id });
  if (!profile) {
    const profRes = await mongoose.connection.collection('driverprofiles').insertOne({
      userId: user._id,
      city: 'Delhi',
      approvalStatus: 'PENDING',
      onlineStatus: 'OFFLINE',
      applicationSubmittedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    profile = { _id: profRes.insertedId };
  } else {
    await mongoose.connection.collection('driverprofiles').updateOne(
      { _id: profile._id },
      { $set: { approvalStatus: 'PENDING', applicationSubmittedAt: new Date() } }
    );
  }

  await mongoose.connection.collection('driverdocuments').deleteMany({ driverId: profile._id });

  await mongoose.connection.collection('driverdocuments').insertMany([
    {
      driverId: profile._id,
      type: 'DRIVING_LICENSE',
      objectKey: 'drivers/' + profile._id.toString() + '/dl_front.jpg',
      documentNumberLast4: '4821',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 86400000 * 450),
      createdAt: new Date(),
    },
    {
      driverId: profile._id,
      type: 'VEHICLE_REGISTRATION',
      objectKey: 'drivers/' + profile._id.toString() + '/rc_book.jpg',
      documentNumberLast4: '9901',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 86400000 * 730),
      createdAt: new Date(),
    },
    {
      driverId: profile._id,
      type: 'VEHICLE_INSURANCE',
      objectKey: 'drivers/' + profile._id.toString() + '/insurance.jpg',
      documentNumberLast4: '1122',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 86400000 * 180),
      createdAt: new Date(),
    },
    {
      driverId: profile._id,
      type: 'AADHAAR_FRONT',
      objectKey: 'drivers/' + profile._id.toString() + '/aadhaar.jpg',
      documentNumberLast4: '3456',
      status: 'PENDING',
      createdAt: new Date(),
    },
  ]);

  const cat = await mongoose.connection.collection('cabcategories').findOne({ code: 'SEDAN' });
  if (cat) {
    await mongoose.connection.collection('vehicles').deleteMany({ driverId: profile._id });
    await mongoose.connection.collection('vehicles').insertOne({
      driverId: profile._id,
      categoryId: cat._id,
      registrationNumber: 'DL01AB9876',
      verificationStatus: 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  console.log('Successfully seeded pending KYC driver: Vikram Singh, ID:', profile._id);
  await mongoose.disconnect();
}

seedPendingKycDriver().catch(console.error);
