import { Schema, model } from 'mongoose';

export const PaymentStatuses = ['CREATED', 'PAID', 'FAILED', 'EXPIRED'] as const;
export type PaymentStatus = (typeof PaymentStatuses)[number];

/**
 * One attempt to pay a booking online. The amount is fixed by the server when the attempt is
 * created, from what the booking owes; nothing the app sends can change it.
 */
const paymentSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    // Not set for a wallet top-up, which is not about any ride.
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
    bookingPublicId: { type: String },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    purpose: { type: String, enum: ['FARE', 'FEE', 'TIP', 'TOPUP'], required: true },
    // GATEWAY = paid through Razorpay; WALLET = paid from the rider's wallet balance.
    method: { type: String, enum: ['GATEWAY', 'WALLET'], default: 'GATEWAY' },
    // A tip: who receives it, and which tip this payment is for.
    payeeDriverId: { type: Schema.Types.ObjectId, ref: 'DriverProfile' },
    refPublicId: { type: String },
    status: { type: String, enum: PaymentStatuses, default: 'CREATED' },
    providerOrderId: { type: String, required: true, unique: true },
    providerPaymentId: { type: String },
    // The app's own key for this attempt, so a retried request returns the same order.
    idempotencyKey: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    paidAt: { type: Date },
    failureReason: { type: String, maxlength: 200 },
    // Total of refunds asked for or done. Never allowed to exceed amountPaise.
    refundedPaise: { type: Number, default: 0 },
    // Set once the payment is in the ledger.
    ledgerRecordedAt: { type: Date },
  },
  { timestamps: true },
);
paymentSchema.index({ customerId: 1, idempotencyKey: 1 }, { unique: true });
paymentSchema.index({ bookingId: 1, status: 1 });
paymentSchema.index({ status: 1, expiresAt: 1 });
paymentSchema.index({ status: 1, ledgerRecordedAt: 1, paidAt: 1 });
paymentSchema.index({ createdAt: -1 });

export const Payment = model('Payment', paymentSchema);
