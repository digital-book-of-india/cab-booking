import { Schema, model } from 'mongoose';

export const PayoutStatuses = ['CREATED', 'PROCESSING', 'PAID', 'FAILED', 'REVERSED'] as const;
export const AccountTypes = ['BANK', 'UPI'] as const;
export const AccountReviewStatuses = ['PENDING', 'ACTIVE', 'REJECTED'] as const;

/**
 * Where a driver's money is sent. The full account number or UPI id was handed to the payout
 * provider when the account was saved; here we keep only what is needed to recognise it. A new or
 * changed account must be checked by finance before any money goes to it, so a stolen driver login
 * cannot quietly redirect earnings.
 */
const payoutAccountSchema = new Schema(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'DriverProfile', required: true, unique: true },
    type: { type: String, enum: AccountTypes, required: true },
    holderName: { type: String, required: true, trim: true, maxlength: 100 },
    // Bank: last 4 digits of the account number. UPI: the id with the middle hidden.
    maskedNumber: { type: String, required: true },
    ifsc: { type: String },
    providerContactId: { type: String, required: true },
    providerFundAccountId: { type: String, required: true },
    status: { type: String, enum: AccountReviewStatuses, default: 'PENDING' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    rejectionReason: { type: String, maxlength: 300 },
  },
  { timestamps: true },
);
export const PayoutAccount = model('PayoutAccount', payoutAccountSchema);

/** One attempt to send a settlement's payout. A failed attempt can be followed by another. */
const payoutSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    settlementId: { type: Schema.Types.ObjectId, ref: 'Settlement', required: true },
    settlementPublicId: { type: String, required: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'DriverProfile', required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    attempt: { type: Number, required: true },
    status: { type: String, enum: PayoutStatuses, default: 'CREATED' },
    // The same key on a repeat request means the provider can never pay twice.
    idempotencyKey: { type: String, required: true, unique: true },
    fundAccountId: { type: String, required: true },
    providerPayoutId: { type: String },
    utr: { type: String },
    failureReason: { type: String, maxlength: 200 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    paidAt: { type: Date },
  },
  { timestamps: true },
);
// One live payout per settlement at a time; a failed or reversed one frees the slot.
payoutSchema.index(
  { settlementId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['CREATED', 'PROCESSING', 'PAID'] } },
  },
);
payoutSchema.index({ providerPayoutId: 1 }, { sparse: true });
payoutSchema.index({ status: 1, updatedAt: 1 });
payoutSchema.index({ driverId: 1, createdAt: -1 });

export const Payout = model('Payout', payoutSchema);
