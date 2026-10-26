import { config } from 'dotenv';
config();

import mongoose from 'mongoose';
import { User } from '../src/modules/users/user.model';
import { DriverProfile } from '../src/modules/drivers/driverProfile.model';
import { Vehicle } from '../src/modules/vehicles/vehicle.model';
import { CabCategory } from '../src/modules/categories/cabCategory.model';

async function seed() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing');
  await mongoose.connect(uri);
  console.log('Connected to DB');

  // 1. Create or Find Cab Categories
  let sedan: any = await CabCategory.findOne({ code: 'SEDAN' });
  if (!sedan) {
    sedan = await CabCategory.create({
      code: 'SEDAN',
      name: 'Prime Sedan',
      capacity: 4,
      active: true,
      displayOrder: 1,
    });
  }

  let suv: any = await CabCategory.findOne({ code: 'SUV' });
  if (!suv) {
    suv = await CabCategory.create({
      code: 'SUV',
      name: 'Prime SUV',
      capacity: 6,
      active: true,
      displayOrder: 2,
    });
  }

  let hatch: any = await CabCategory.findOne({ code: 'HATCHBACK' });
  if (!hatch) {
    hatch = await CabCategory.create({
      code: 'HATCHBACK',
      name: 'Mini Hatchback',
      capacity: 4,
      active: true,
      displayOrder: 3,
    });
  }

  console.log('Cab categories ready');

  // 2. Demo Drivers Config
  const demoDrivers = [
    {
      name: 'Vikram Singh',
      phone: '+919811122233',
      city: 'Delhi',
      make: 'Maruti Suzuki',
      model: 'Dzire',
      color: 'White',
      reg: 'DL01AB1234',
      categoryId: sedan._id,
      seats: 4,
      lat: 28.6315,
      lng: 77.2167, // Connaught Place
      heading: 45,
    },
    {
      name: 'Rajesh Kumar',
      phone: '+919822233344',
      city: 'Gurugram',
      make: 'Toyota',
      model: 'Innova Crysta',
      color: 'Silver',
      reg: 'HR26EF5678',
      categoryId: suv._id,
      seats: 6,
      lat: 28.4950,
      lng: 77.0895, // Cyber City
      heading: 135,
    },
    {
      name: 'Manish Tyagi',
      phone: '+919833344455',
      city: 'Delhi',
      make: 'Hyundai',
      model: 'Aura',
      color: 'Silver',
      reg: 'DL04CD9012',
      categoryId: sedan._id,
      seats: 4,
      lat: 28.5562,
      lng: 77.1000, // IGI Airport T3
      heading: 270,
    },
    {
      name: 'Suresh Yadav',
      phone: '+919844455566',
      city: 'Noida',
      make: 'Tata',
      model: 'Tigor EV',
      color: 'Teal Blue',
      reg: 'UP16GH3456',
      categoryId: hatch._id,
      seats: 4,
      lat: 28.5284,
      lng: 77.2193, // Saket
      heading: 190,
    },
  ];

  for (const d of demoDrivers) {
    // Upsert User
    let u: any = await (User as any).findOne({ phone: d.phone });
    if (!u) {
      u = await User.create({
        phone: d.phone,
        role: 'DRIVER',
        name: d.name,
        accountStatus: 'ACTIVE',
        phoneVerifiedAt: new Date(),
      });
    }

    // Upsert DriverProfile
    let dp: any = await (DriverProfile as any).findOne({ userId: u._id });
    if (!dp) {
      dp = await DriverProfile.create({
        userId: u._id,
        approvalStatus: 'APPROVED',
        onlineStatus: 'ONLINE',
        city: d.city,
        currentLocation: { type: 'Point', coordinates: [d.lng, d.lat] },
        locationUpdatedAt: new Date(),
        headingDegrees: d.heading,
        ratingCount: 28,
        ratingSum: 136,
      });
    } else {
      await DriverProfile.updateOne(
        { _id: dp._id },
        {
          approvalStatus: 'APPROVED',
          onlineStatus: 'ONLINE',
          currentLocation: { type: 'Point', coordinates: [d.lng, d.lat] },
          locationUpdatedAt: new Date(),
          headingDegrees: d.heading,
        }
      );
    }

    // Upsert Vehicle
    let veh: any = await (Vehicle as any).findOne({ registrationNumber: d.reg });
    if (!veh) {
      veh = await Vehicle.create({
        driverId: dp._id,
        categoryId: d.categoryId,
        registrationNumber: d.reg,
        make: d.make,
        model: d.model,
        color: d.color,
        seats: d.seats,
        verificationStatus: 'VERIFIED',
        active: true,
      });
    }

    // Link vehicle to driver
    await DriverProfile.updateOne({ _id: dp._id }, { currentVehicleId: veh._id });
    console.log(`Driver ready: ${d.name} (${d.reg}) @ [${d.lat}, ${d.lng}]`);
  }

  console.log('✅ Demo drivers seeded successfully!');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
