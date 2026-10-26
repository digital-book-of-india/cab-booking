import { config } from 'dotenv';
config();

import mongoose, { Types } from 'mongoose';
import { User } from '../src/modules/users/user.model';
import { CustomerProfile } from '../src/modules/customers/customerProfile.model';
import { Booking } from '../src/modules/bookings/booking.model';

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing');
  await mongoose.connect(uri);
  console.log('Connected to DB');

  const zoneId = new Types.ObjectId();
  const categoryId = new Types.ObjectId();

  // 1. Rahul Sharma (Clean, Active, 3 bookings)
  let rahul: any = await (User as any).findOne({ phone: '+919876543210' });
  if (!rahul) {
    rahul = await User.create({
      phone: '+919876543210',
      role: 'CUSTOMER',
      name: 'Rahul Sharma',
      accountStatus: 'ACTIVE',
      phoneVerifiedAt: new Date(Date.now() - 30 * 86400000),
      createdAt: new Date(Date.now() - 30 * 86400000),
    });
  }

  await (CustomerProfile as any).findOneAndUpdate(
    { userId: rahul._id },
    {
      $set: {
        email: 'rahul.sharma@example.com',
        ratingCount: 14,
        ratingSum: 68,
        bookingRestricted: false,
        bookingRestrictionReason: null,
      },
    },
    { upsert: true }
  );

  const rahulBookingsCount = await Booking.countDocuments({ customerId: rahul._id });
  if (rahulBookingsCount === 0) {
    await Booking.create([
      {
        publicId: 'bk_delhi_001',
        customerId: rahul._id,
        quoteId: 'qt_101',
        categoryId,
        zoneId,
        idempotencyKey: 'idem_delhi_001',
        requestHash: 'hash_delhi_001',
        pickup: {
          label: 'Indira Gandhi International Airport Terminal 3',
          location: { type: 'Point', coordinates: [77.1000, 28.5562] },
        },
        drop: {
          label: 'Cyber City, DLF Phase 2, Gurugram',
          location: { type: 'Point', coordinates: [77.0895, 28.4950] },
        },
        paymentMethod: 'ONLINE',
        paymentStatus: 'PAID',
        status: 'COMPLETED',
        estimatedFarePaise: 65000,
        finalFarePaise: 68000,
        fareSnapshot: { base: 65000 },
        requestedAt: new Date(Date.now() - 2 * 86400000),
        completedAt: new Date(Date.now() - 2 * 86400000 + 45 * 60000),
      },
      {
        publicId: 'bk_delhi_002',
        customerId: rahul._id,
        quoteId: 'qt_102',
        categoryId,
        zoneId,
        idempotencyKey: 'idem_delhi_002',
        requestHash: 'hash_delhi_002',
        pickup: {
          label: 'Connaught Place, Inner Circle, New Delhi',
          location: { type: 'Point', coordinates: [77.2167, 28.6315] },
        },
        drop: {
          label: 'Hauz Khas Social, Hauz Khas Village',
          location: { type: 'Point', coordinates: [77.2001, 28.5494] },
        },
        paymentMethod: 'CASH',
        paymentStatus: 'PAID',
        status: 'COMPLETED',
        estimatedFarePaise: 32000,
        finalFarePaise: 32000,
        fareSnapshot: { base: 32000 },
        requestedAt: new Date(Date.now() - 5 * 86400000),
        completedAt: new Date(Date.now() - 5 * 86400000 + 30 * 60000),
      },
      {
        publicId: 'bk_delhi_003',
        customerId: rahul._id,
        quoteId: 'qt_103',
        categoryId,
        zoneId,
        idempotencyKey: 'idem_delhi_003',
        requestHash: 'hash_delhi_003',
        pickup: {
          label: 'Saket Metro Station, Gate 2',
          location: { type: 'Point', coordinates: [77.2014, 28.5204] },
        },
        drop: {
          label: 'Select CITYWALK Mall, Saket',
          location: { type: 'Point', coordinates: [77.2193, 28.5284] },
        },
        paymentMethod: 'ONLINE',
        paymentStatus: 'PAID',
        status: 'CANCELLED',
        cancellation: { actor: 'CUSTOMER', reasonCode: 'PLAN_CHANGED', note: 'Customer changed plans' },
        estimatedFarePaise: 15000,
        finalFarePaise: 0,
        fareSnapshot: { base: 15000 },
        requestedAt: new Date(Date.now() - 7 * 86400000),
      },
    ]);
    console.log('Seeded bookings for Rahul Sharma');
  }

  // 2. Priya Patel (Restricted rider)
  let priya: any = await (User as any).findOne({ phone: '+919812345678' });
  if (!priya) {
    priya = await User.create({
      phone: '+919812345678',
      role: 'CUSTOMER',
      name: 'Priya Patel',
      accountStatus: 'ACTIVE',
      phoneVerifiedAt: new Date(Date.now() - 60 * 86400000),
      createdAt: new Date(Date.now() - 60 * 86400000),
    });
  }

  await (CustomerProfile as any).findOneAndUpdate(
    { userId: priya._id },
    {
      $set: {
        email: 'priya.patel@example.com',
        ratingCount: 5,
        ratingSum: 18,
        bookingRestricted: true,
        bookingRestrictionReason: 'Repeated rider no-shows & cancellation abuse',
        bookingRestrictedAt: new Date(Date.now() - 3 * 86400000),
      },
    },
    { upsert: true }
  );

  const priyaBookingsCount = await Booking.countDocuments({ customerId: priya._id });
  if (priyaBookingsCount === 0) {
    await Booking.create([
      {
        publicId: 'bk_blr_001',
        customerId: priya._id,
        quoteId: 'qt_201',
        categoryId,
        zoneId,
        idempotencyKey: 'idem_blr_001',
        requestHash: 'hash_blr_001',
        pickup: {
          label: 'Indiranagar 100ft Road, Bengaluru',
          location: { type: 'Point', coordinates: [77.6412, 12.9716] },
        },
        drop: {
          label: 'Koramangala Sony World Signal',
          location: { type: 'Point', coordinates: [77.6245, 12.9352] },
        },
        paymentMethod: 'ONLINE',
        paymentStatus: 'PAID',
        status: 'COMPLETED',
        estimatedFarePaise: 24000,
        finalFarePaise: 25500,
        fareSnapshot: { base: 24000 },
        requestedAt: new Date(Date.now() - 4 * 86400000),
        completedAt: new Date(Date.now() - 4 * 86400000 + 25 * 60000),
      },
    ]);
    console.log('Seeded bookings for Priya Patel');
  }

  // 3. Amit Verma (Suspended user)
  let amit: any = await (User as any).findOne({ phone: '+919898989898' });
  if (!amit) {
    amit = await User.create({
      phone: '+919898989898',
      role: 'CUSTOMER',
      name: 'Amit Verma',
      accountStatus: 'SUSPENDED',
      phoneVerifiedAt: new Date(Date.now() - 90 * 86400000),
      createdAt: new Date(Date.now() - 90 * 86400000),
    });
  }

  await (CustomerProfile as any).findOneAndUpdate(
    { userId: amit._id },
    {
      $set: {
        email: 'amit.verma@example.com',
        ratingCount: 2,
        ratingSum: 4,
        bookingRestricted: false,
        bookingRestrictionReason: null,
      },
    },
    { upsert: true }
  );

  console.log('✅ Seeded 3 demo customers:');
  console.log('1. Rahul Sharma (Active, Clean):', rahul._id.toString());
  console.log('2. Priya Patel (Active, Restricted):', priya._id.toString());
  console.log('3. Amit Verma (Suspended):', amit._id.toString());

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
