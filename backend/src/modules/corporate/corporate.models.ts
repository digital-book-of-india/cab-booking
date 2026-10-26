import { Schema, model } from 'mongoose';

export const CompanyStatuses = ['ACTIVE', 'SUSPENDED'] as const;
export const MemberRoles = ['ADMIN', 'EMPLOYEE'] as const;
export const MemberStatuses = ['INVITED', 'ACTIVE', 'REMOVED'] as const;
export const InvoiceStatuses = ['DRAFT', 'ISSUED', 'PAID', 'VOID'] as const;

/**
 * A company whose employees ride on the company's account. The company is billed (invoiced) for
 * rides instead of the rider paying. Limits keep the exposure bounded.
 */
const companySchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    legalName: { type: String, trim: true, maxlength: 160 },
    // Stored as given; tax is NOT calculated by us (needs an accountant's rules).
    gstin: { type: String, trim: true, maxlength: 20 },
    billingEmail: { type: String, required: true, trim: true, lowercase: true, maxlength: 160 },
    status: { type: String, enum: CompanyStatuses, default: 'ACTIVE' },
    // The most the company may owe us at once (unpaid rides, invoiced or not, plus rides in progress).
    creditLimitPaise: { type: Number, required: true, min: 0 },
    paymentTermsDays: { type: Number, required: true, min: 0, max: 120 },
    // What each employee may spend per calendar month unless given their own limit.
    defaultEmployeeMonthlyLimitPaise: { type: Number, required: true, min: 0 },
    // No single ride may cost more than this (null = no cap).
    perRideCapPaise: { type: Number, min: 1, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
companySchema.index({ name: 1 });
export const Company = model('Company', companySchema);

/** A person's place in a company: invited by phone, active once they accept, removed later. */
const membershipSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    phone: { type: String, required: true },
    name: { type: String, trim: true, maxlength: 100 },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    role: { type: String, enum: MemberRoles, default: 'EMPLOYEE' },
    status: { type: String, enum: MemberStatuses, default: 'INVITED' },
    // null = the company default.
    monthlyLimitPaise: { type: Number, min: 0, default: null },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    acceptedAt: { type: Date },
    removedAt: { type: Date },
  },
  { timestamps: true },
);
// A person is in one company at a time; a phone is invited once per company at a time.
membershipSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { status: 'ACTIVE' } },
);
membershipSchema.index(
  { companyId: 1, phone: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['INVITED', 'ACTIVE'] } } },
);
membershipSchema.index({ phone: 1, status: 1 });
export const Membership = model('Membership', membershipSchema);

const lineSchema = new Schema(
  {
    bookingId: { type: String, required: true },
    kind: { type: String, enum: ['RIDE', 'FEE'], required: true },
    at: { type: Date, required: true },
    rider: { type: String },
    from: { type: String },
    to: { type: String },
    reference: { type: String },
    amountPaise: { type: Number, required: true },
  },
  { _id: false },
);

/**
 * A bill for a company's rides over a period. Gets its number when issued, so issued numbers
 * have no gaps. Tax is not calculated here (taxPaise stays 0 until the rules are decided).
 */
const invoiceSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    number: { type: String },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    status: { type: String, enum: InvoiceStatuses, default: 'DRAFT' },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    lines: { type: [lineSchema], default: [] },
    subtotalPaise: { type: Number, required: true },
    taxPaise: { type: Number, default: 0 },
    // The rate used (basis points) and what it was called, frozen when the invoice is issued.
    taxBp: { type: Number, default: 0 },
    taxLabel: { type: String, maxlength: 20 },
    // Set once the tax is in the ledger (the repair job posts any that are missing).
    taxLedgerAt: { type: Date },
    // Who issued it, frozen when issued (a later change of address does not alter old invoices).
    seller: {
      name: { type: String },
      gstin: { type: String },
      address: { type: String },
      sacCode: { type: String },
    },
    totalPaise: { type: Number, required: true },
    paidPaise: { type: Number, default: 0 },
    payments: {
      type: [
        new Schema(
          {
            key: { type: String, required: true },
            amountPaise: { type: Number, required: true },
            reference: { type: String, required: true },
            at: { type: Date, required: true },
            by: { type: Schema.Types.ObjectId, ref: 'User' },
            // Set once the payment is in the ledger (the repair job posts any that are missing).
            ledgerAt: { type: Date },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    issuedAt: { type: Date },
    dueAt: { type: Date },
    paidAt: { type: Date },
    voidedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
invoiceSchema.index({ number: 1 }, { unique: true, sparse: true });
invoiceSchema.index({ companyId: 1, createdAt: -1 });
invoiceSchema.index({ status: 1, dueAt: 1 });
export const Invoice = model('Invoice', invoiceSchema);

/** Hands out invoice numbers one at a time (per year), without gaps or repeats. */
const counterSchema = new Schema({ _id: { type: String }, seq: { type: Number, default: 0 } });
export const InvoiceCounter = model('InvoiceCounter', counterSchema);
