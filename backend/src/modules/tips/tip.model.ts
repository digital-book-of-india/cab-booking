import { Schema, model } from 'mongoose';

export const TipStatuses = ['PENDING', 'PAID', 'FAILED'] as const;
// CASH: the rider says they handed the driver cash. It is only recorded; no money moves through us.
export const TipSources = ['ONLINE', 'WALLET', 'CASH'] as const;

/**
 * A rider's tip for a driver after a completed ride. The driver gets all of it: it is recorded in
 * the ledger as money we owe the driver, with no commission. One tip per ride; a failed or abandoned
 * attempt does not count, so the rider can try again.
 */
const tipSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    bookingPublicId: { type: String, required: true },
    ridePublicId: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'DriverProfile', required: true },
    driverUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    source: { type: String, enum: TipSources, required: true },
    status: { type: String, enum: TipStatuses, default: 'PENDING' },
    paymentPublicId: { type: String },
    idempotencyKey: { type: String, required: true },
    paidAt: { type: Date },
  },
  { timestamps: true },
);
tipSchema.index({ customerId: 1, idempotencyKey: 1 }, { unique: true });
// At most one live tip per ride; a FAILED attempt frees the slot.
tipSchema.index(
  { bookingId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['PENDING', 'PAID'] } } },
);
tipSchema.index({ driverId: 1, status: 1, paidAt: -1 });

export const Tip = model('Tip', tipSchema);
