import { config } from 'dotenv';
config();

import mongoose from 'mongoose';
import { Booking } from '../src/modules/bookings/booking.model';
import { User } from '../src/modules/users/user.model';
import { CabCategory } from '../src/modules/categories/cabCategory.model';
import { ServiceZone } from '../src/modules/zones/serviceZone.model';

interface IServiceZoneDoc {
  _id: mongoose.Types.ObjectId;
  code: string;
  name: string;
  cityCode: string;
  active: boolean;
  polygon: { type: string; coordinates: number[][][] };
  operatingHours: { start: string; end: string };
}
interface ICabCategoryDoc {
  _id: mongoose.Types.ObjectId;
  code: string;
  name: string;
  capacity: number;
  active: boolean;
  displayOrder: number;
}
interface IUserDoc {
  _id: mongoose.Types.ObjectId;
  phone: string;
  role: string;
  name?: string;
  accountStatus: string;
}

const ServiceZoneModel = ServiceZone as unknown as mongoose.Model<IServiceZoneDoc>;
const CabCategoryModel = CabCategory as unknown as mongoose.Model<ICabCategoryDoc>;
const UserModel = User as unknown as mongoose.Model<IUserDoc>;

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing');
  await mongoose.connect(uri);
  console.log('Connected to DB');

  // 1. Ensure Service Zone exists
  let zone = await ServiceZoneModel.findOne({ code: 'DELHI_NCR' });
  if (!zone) {
    zone = await ServiceZoneModel.create({
      code: 'DELHI_NCR',
      name: 'Delhi NCR Central Zone',
      cityCode: 'DELHI',
      active: true,
      polygon: {
        type: 'Polygon',
        coordinates: [
          [
            [76.95, 28.4],
            [77.35, 28.4],
            [77.35, 28.85],
            [76.95, 28.85],
            [76.95, 28.4],
          ],
        ],
      },
      operatingHours: {
        start: '00:00',
        end: '23:59',
      },
    });
    console.log('Created ServiceZone:', zone._id.toString());
  }

  // 2. Fetch Categories & Customers
  const sedan = await CabCategoryModel.findOne({ code: 'SEDAN' });
  const suv = await CabCategoryModel.findOne({ code: 'SUV' });
  const rahul = await UserModel.findOne({ phone: '+919876543210' });
  const priya = await UserModel.findOne({ phone: '+919812345678' });

  if (!sedan || !suv || !rahul || !priya) {
    throw new Error('Categories or customers missing. Run earlier seed scripts first.');
  }

  const nowMs = Date.now();

  // Delete previous test queue bookings if any
  await Booking.deleteMany({ publicId: { $in: ['bk_delhi_q01', 'bk_delhi_q02'] } });

  // 3. Create test queue bookings
  await Booking.create([
    {
      publicId: 'bk_delhi_q01',
      customerId: rahul._id,
      quoteId: 'qt_q01',
      categoryId: sedan._id,
      zoneId: zone._id,
      idempotencyKey: 'idem_q01',
      requestHash: 'hash_q01',
      pickup: {
        label: 'Khan Market, Rabindra Nagar, New Delhi',
        location: { type: 'Point', coordinates: [77.2285, 28.6003] },
      },
      drop: {
        label: 'India Gate, Rajpath, New Delhi',
        location: { type: 'Point', coordinates: [77.2295, 28.6129] },
      },
      paymentMethod: 'ONLINE',
      paymentStatus: 'NOT_DUE',
      status: 'DISPATCHING',
      estimatedFarePaise: 35000,
      fareSnapshot: { base: 35000 },
      requestedAt: new Date(nowMs - 145 * 1000), // ~2m 25s ago
      redispatchCount: 2,
    },
    {
      publicId: 'bk_delhi_q02',
      customerId: priya._id,
      quoteId: 'qt_q02',
      categoryId: suv._id,
      zoneId: zone._id,
      idempotencyKey: 'idem_q02',
      requestHash: 'hash_q02',
      pickup: {
        label: 'Worldmark 1, Aerocity, New Delhi',
        location: { type: 'Point', coordinates: [77.1205, 28.5498] },
      },
      drop: {
        label: 'Cyber Hub, DLF Cyber City, Gurugram',
        location: { type: 'Point', coordinates: [77.0895, 28.4950] },
      },
      paymentMethod: 'CASH',
      paymentStatus: 'NOT_DUE',
      status: 'REQUESTED',
      estimatedFarePaise: 58000,
      fareSnapshot: { base: 58000 },
      requestedAt: new Date(nowMs - 45 * 1000), // 45s ago
      redispatchCount: 1,
    },
  ]);

  console.log('✅ Seeded 2 active dispatch queue bookings:');
  console.log('1. bk_delhi_q01 (DISPATCHING, 145s wait, Sedan) -> Rahul Sharma');
  console.log('2. bk_delhi_q02 (REQUESTED, 45s wait, SUV) -> Priya Patel');

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
