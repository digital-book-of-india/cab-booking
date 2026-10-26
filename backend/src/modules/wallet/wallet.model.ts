import { Schema, model } from 'mongoose';

/**
 * Only a short lock per rider, so two spends at the same moment (a ride and a tip) cannot both use
 * the same money. The balance itself is never stored here: it is the sum of the rider's ledger
 * entries, so there is no second number that could disagree.
 */
const walletSchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    lockToken: { type: String },
    lockedUntil: { type: Date },
  },
  { timestamps: true },
);

export const Wallet = model('Wallet', walletSchema);
