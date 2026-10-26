import { Schema, model } from 'mongoose';

export const RefundStatuses = ['REQUESTED', 'PROCESSED', 'FAILED'] as const;

const refundSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true, maxlength: 300 },
    status: { type: String, enum: RefundStatuses, default: 'REQUESTED' },
    // ORIGINAL = back through the payment gateway; WALLET = credited to the rider's wallet.
    destination: { type: String, enum: ['ORIGINAL', 'WALLET'], default: 'ORIGINAL' },
    providerRefundId: { type: String },
    // Asking twice with the same key returns the same refund.
    idempotencyKey: { type: String, required: true, unique: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    processedAt: { type: Date },
    // Ride GST handed back with this refund (a credit note). Fixed once, so a retry posts the same amount.
    taxReversedPaise: { type: Number, min: 0 },
  },
  { timestamps: true },
);
refundSchema.index({ providerRefundId: 1 }, { sparse: true });
refundSchema.index({ paymentId: 1, status: 1 });

export const Refund = model('Refund', refundSchema);
