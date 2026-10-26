import { Schema, model } from 'mongoose';

const pointSchema = new Schema(
  {
    label: { type: String, maxlength: 200 },
    location: {
      type: { type: String, enum: ['Point'], required: true },
      coordinates: { type: [Number], required: true },
    },
  },
  { _id: false },
);

/** A priced, expiring, single-use estimate. The server computed every number in it. */
const fareQuoteSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    zoneId: { type: Schema.Types.ObjectId, ref: 'ServiceZone', required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'CabCategory', required: true },
    // City rides are priced from a fare config; rentals and outstation trips from their own rates.
    configId: { type: Schema.Types.ObjectId, ref: 'FareConfig' },
    configVersion: { type: Number, default: 0 },
    tripKind: { type: String, enum: ['CITY', 'RENTAL', 'OUTSTATION'], default: 'CITY' },
    // The rental package or outstation rate as it was when the rider saw the price.
    rental: { type: Schema.Types.Mixed },
    outstation: { type: Schema.Types.Mixed },
    pickup: { type: pointSchema, required: true },
    drop: { type: pointSchema, required: true },
    stops: { type: [pointSchema], default: [] },
    // The coupon the rider asked for, frozen as it was when they saw the price.
    coupon: {
      type: new Schema(
        {
          couponId: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true },
          code: { type: String, required: true },
          type: { type: String, enum: ['PERCENT', 'FLAT'], required: true },
          value: { type: Number, required: true },
          maxDiscountPaise: { type: Number },
          minFarePaise: { type: Number },
        },
        { _id: false },
      ),
      default: undefined,
    },
    discountPaise: { type: Number, default: 0 },
    // Set when the rider is pricing a ride for later.
    scheduledFor: { type: Date },
    distanceMeters: { type: Number, required: true },
    durationSeconds: { type: Number, required: true },
    breakdown: { type: Schema.Types.Mixed, required: true },
    estimatedTotalPaise: { type: Number, required: true },
    // Tax rate (basis points) used for this quote, frozen so the booking and final fare use the same one.
    taxBp: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    bookingId: { type: String },
    usedByKey: { type: String },
  },
  { timestamps: true },
);
// Quotes are snapshotted into bookings, so old ones can be purged a week after expiry.
fareQuoteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 86400 });

export const FareQuote = model('FareQuote', fareQuoteSchema);
