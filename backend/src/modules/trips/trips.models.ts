import { Schema, model } from 'mongoose';

export const TripKinds = ['CITY', 'RENTAL', 'OUTSTATION'] as const;
export type TripKind = (typeof TripKinds)[number];
export const OutstationTripTypes = ['ONE_WAY', 'ROUND_TRIP'] as const;

/**
 * An hourly rental package, e.g. "4 hours / 40 km" for a price. Time and distance beyond it are
 * charged at the package's extra rates. Staff define packages per zone and cab category; a booking
 * freezes the package as it was, so a later edit never changes a booked rental.
 */
const rentalPackageSchema = new Schema(
  {
    zoneId: { type: Schema.Types.ObjectId, ref: 'ServiceZone', required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'CabCategory', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    hours: { type: Number, required: true, min: 1, max: 24 },
    includedKm: { type: Number, required: true, min: 1, max: 1000 },
    pricePaise: { type: Number, required: true, min: 1 },
    // Per kilometre beyond the included distance.
    extraKmPaise: { type: Number, required: true, min: 0 },
    // Per hour beyond the included hours (charged by the minute).
    extraHourPaise: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
rentalPackageSchema.index({ zoneId: 1, categoryId: 1, active: 1, hours: 1 });
export const RentalPackage = model('RentalPackage', rentalPackageSchema);

/** Outstation (intercity) rates for one zone and cab category. Tolls and parking are paid by the rider on actuals. */
const outstationRateSchema = new Schema(
  {
    zoneId: { type: Schema.Types.ObjectId, ref: 'ServiceZone', required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'CabCategory', required: true },
    // One way: the driver comes back empty, so the per-km rate is higher.
    oneWayPerKmPaise: { type: Number, required: true, min: 1 },
    roundTripPerKmPaise: { type: Number, required: true, min: 1 },
    // A round trip is charged for at least this many km for every day it lasts.
    minKmPerDay: { type: Number, required: true, min: 0, max: 1000 },
    // For every night away from home.
    driverAllowancePerNightPaise: { type: Number, required: true, min: 0 },
    minimumFarePaise: { type: Number, required: true, min: 0 },
    // Trips shorter than minKm are city rides; longer than maxKm are not served.
    minKm: { type: Number, required: true, min: 1, max: 1000 },
    maxKm: { type: Number, required: true, min: 1, max: 5000 },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
outstationRateSchema.index({ zoneId: 1, categoryId: 1 }, { unique: true });
export const OutstationRate = model('OutstationRate', outstationRateSchema);
