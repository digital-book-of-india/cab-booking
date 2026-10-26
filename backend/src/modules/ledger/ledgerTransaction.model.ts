import { Schema, model } from 'mongoose';

export const LedgerKinds = [
  'RIDE_ACCRUAL',
  'FEE_ACCRUAL',
  'ONLINE_PAYMENT',
  'CASH_COLLECTED',
  'CASH_DEPOSIT',
  'SETTLEMENT_NET',
  'SETTLEMENT_PAYOUT',
  'REFUND',
  'WRITE_OFF',
  'FEE_WAIVER',
  'WALLET_TOPUP',
  'WALLET_PAYMENT',
  'TIP_PAYMENT',
  'PAYOUT_REVERSAL',
  'CORPORATE_PAYMENT',
  'CORPORATE_CREDIT',
  'WALLET_BONUS',
  'INVOICE_TAX',
] as const;
export type LedgerKind = (typeof LedgerKinds)[number];

/**
 * One business event and all its entries in ONE document, so it is written atomically: a crash can
 * never leave half a payment behind. Entries must add up to zero. Transactions are never edited or
 * deleted (see the guards below); a mistake is fixed by posting a new, opposite transaction.
 */
const ledgerTransactionSchema = new Schema(
  {
    txnId: { type: String, required: true, unique: true },
    kind: { type: String, enum: LedgerKinds, required: true },
    // The business event, e.g. "pay:pay_ab12": posting the same event twice is a no-op.
    idempotencyKey: { type: String, required: true, unique: true },
    entries: {
      type: [
        new Schema(
          {
            account: { type: String, required: true },
            amountPaise: { type: Number, required: true },
          },
          { _id: false },
        ),
      ],
      required: true,
    },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
    bookingPublicId: { type: String },
    driverId: { type: Schema.Types.ObjectId, ref: 'DriverProfile' },
    customerId: { type: Schema.Types.ObjectId, ref: 'User' },
    description: { type: String, maxlength: 300 },
    metadata: { type: Schema.Types.Mixed },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

ledgerTransactionSchema.pre('validate', function () {
  const entries = this.entries as { amountPaise: number }[];
  if (entries.length < 2) throw new Error('A ledger transaction needs at least two entries');
  let sum = 0;
  for (const e of entries) {
    if (!Number.isInteger(e.amountPaise) || e.amountPaise === 0) {
      throw new Error('Ledger entries must be non-zero whole paise');
    }
    sum += e.amountPaise;
  }
  if (sum !== 0) throw new Error(`Ledger transaction does not balance (off by ${sum} paise)`);
});

// Append-only: no update or delete is ever allowed through the application.
const FORBIDDEN = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
] as const;
for (const op of FORBIDDEN) {
  ledgerTransactionSchema.pre(op, () => {
    throw new Error('The ledger is append-only');
  });
}

ledgerTransactionSchema.index({ 'entries.account': 1, at: -1 });
ledgerTransactionSchema.index({ bookingId: 1, at: 1 });
ledgerTransactionSchema.index({ driverId: 1, at: -1 });
ledgerTransactionSchema.index({ kind: 1, at: -1 });

export const LedgerTransaction = model('LedgerTransaction', ledgerTransactionSchema);
