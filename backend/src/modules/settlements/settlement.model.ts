import { Schema, model } from 'mongoose';

export const SettlementStatuses = ['DRAFT', 'APPROVED', 'PAID', 'CANCELLED'] as const;

/**
 * Squares up one driver. Online earnings (what we owe them) are netted against cash they collected
 * (what they owe us); what is left is either a payout to them or a deposit they still owe.
 * The amounts are fixed when the draft is made; approving checks they are still true.
 */
const settlementSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'DriverProfile', required: true },
    status: { type: String, enum: SettlementStatuses, default: 'DRAFT' },
    // What we owed the driver and what cash they held, at the time of the draft.
    payablePaise: { type: Number, required: true },
    cashHeldPaise: { type: Number, required: true },
    // Cancelled against each other.
    nettedPaise: { type: Number, required: true },
    // To pay the driver (payable beyond the cash they hold)...
    payoutPaise: { type: Number, required: true },
    // ...or still owed by the driver (cash beyond what we owed them): to be deposited.
    depositDuePaise: { type: Number, required: true },
    periodTo: { type: Date, required: true },
    payoutReference: { type: String, maxlength: 100 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    paidBy: { type: Schema.Types.ObjectId, ref: 'User' },
    paidAt: { type: Date },
    // True while DRAFT or APPROVED: at most one open settlement per driver.
    open: { type: Boolean, default: true },
    netRecordedAt: { type: Date },
    payoutRecordedAt: { type: Date },
    // The bank sent a paid-out amount back (a payout reversal); finance must follow it up.
    payoutReversedAt: { type: Date },
  },
  { timestamps: true },
);
settlementSchema.index({ driverId: 1 }, { unique: true, partialFilterExpression: { open: true } });
settlementSchema.index({ driverId: 1, createdAt: -1 });
settlementSchema.index({ status: 1, createdAt: -1 });

export const Settlement = model('Settlement', settlementSchema);
