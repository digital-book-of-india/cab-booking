import { Schema, model } from 'mongoose';

export const BookingStatuses = [
  'SCHEDULED',
  'REQUESTED',
  'DISPATCHING',
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVING',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_DRIVER_FOUND',
  'NO_SHOW',
  'INCIDENT_REVIEW',
] as const;
export type BookingStatus = (typeof BookingStatuses)[number];

export const PaymentStatuses = [
  'NOT_DUE',
  'DUE',
  'PROCESSING',
  'PAID',
  'FAILED',
  'PARTIALLY_PAID',
  'DISPUTED',
  'REFUND_PENDING',
  'REFUNDED',
  'WRITTEN_OFF',
  // Billed to the rider's company instead of the rider (corporate account).
  'BILLED',
] as const;

const placeSchema = new Schema(
  {
    label: { type: String, maxlength: 200 },
    contactName: { type: String, maxlength: 100 },
    contactPhone: { type: String, maxlength: 20 },
    location: {
      type: { type: String, enum: ['Point'], required: true },
      coordinates: { type: [Number], required: true },
    },
  },
  { _id: false },
);

/** The cancellation rules in force when the booking was made. A later policy never changes them. */
const policySnapshotSchema = new Schema(
  {
    version: { type: Number, default: null },
    freeCancelWindowSeconds: { type: Number, required: true },
    cancelFeePaise: { type: Number, required: true },
    noShowWaitSeconds: { type: Number, required: true },
    noShowFeePaise: { type: Number, required: true },
  },
  { _id: false },
);

/** A fee owed because the booking was cancelled late or the rider did not show up. */
const feeSchema = new Schema(
  {
    type: { type: String, enum: ['CANCELLATION', 'NO_SHOW'], required: true },
    amountPaise: { type: Number, required: true },
    status: { type: String, enum: ['DUE', 'WAIVED'], required: true },
    at: { type: Date, required: true },
    waivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    waivedAt: { type: Date },
    waivedReason: { type: String, maxlength: 300 },
  },
  { _id: false },
);

/** A rider's request to change the drop-off, waiting for the driver (30 s). */
const destinationChangeSchema = new Schema(
  {
    requestId: { type: String, required: true },
    requestedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    drop: { type: placeSchema, required: true },
    distanceMeters: { type: Number, required: true },
    durationSeconds: { type: Number, required: true },
    breakdown: { type: Schema.Types.Mixed, required: true },
    estimatedTotalPaise: { type: Number, required: true },
  },
  { _id: false },
);

const bookingSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    quoteId: { type: String, required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'CabCategory', required: true },
    zoneId: { type: Schema.Types.ObjectId, ref: 'ServiceZone', required: true },
    pickup: { type: placeSchema, required: true },
    drop: { type: placeSchema, required: true },
    // Intermediate stops, in order (max 3), copied from the quote.
    stops: { type: [placeSchema], default: [] },
    rideType: { type: String, enum: ['INSTANT', 'SCHEDULED'], default: 'INSTANT' },
    // CITY (the usual ride), RENTAL (hourly package) or OUTSTATION (intercity). The package or rate is
    // frozen here as it was when booked.
    tripKind: { type: String, enum: ['CITY', 'RENTAL', 'OUTSTATION'], default: 'CITY' },
    rental: { type: Schema.Types.Mixed },
    outstation: { type: Schema.Types.Mixed },
    // Scheduled rides: when the rider wants to be picked up, and whether the reminder went out.
    scheduledFor: { type: Date },
    scheduleReminderSentAt: { type: Date },
    paymentMethod: { type: String, enum: ['CASH', 'ONLINE', 'CORPORATE'], required: true },
    // Corporate rides: which company is billed, through which membership, the rider's cost-centre
    // reference, the invoice it is on, and how much of it was credited back.
    corporateId: { type: Schema.Types.ObjectId, ref: 'Company' },
    corporateMembershipId: { type: Schema.Types.ObjectId, ref: 'Membership' },
    corporateReference: { type: String, maxlength: 60 },
    invoicedIn: { type: String },
    corporateCreditedPaise: { type: Number, default: 0 },
    // Payment state is deliberately separate from booking/ride state.
    paymentStatus: { type: String, enum: PaymentStatuses, default: 'NOT_DUE' },
    status: { type: String, enum: BookingStatuses, default: 'REQUESTED', index: true },
    estimatedFarePaise: { type: Number, required: true },
    // Frozen copy of the quote the customer saw; later pricing changes never alter it.
    fareSnapshot: { type: Schema.Types.Mixed, required: true },
    notes: { type: String, maxlength: 300 },
    // Set when a driver wins the atomic accept. The booking is the single owner of lifecycle status.
    assignedDriverId: { type: Schema.Types.ObjectId, ref: 'DriverProfile', default: null },
    rideId: { type: String },
    assignedAt: { type: Date },
    completedAt: { type: Date },
    finalFarePaise: { type: Number },
    finalFare: { type: Schema.Types.Mixed },
    cancellation: {
      actor: { type: String, enum: ['CUSTOMER', 'DRIVER', 'SYSTEM', 'ADMIN'] },
      reasonCode: { type: String },
      note: { type: String, maxlength: 300 },
      at: { type: Date },
    },
    dispatch: {
      startedAt: { type: Date },
      // Bumped on each admin retry so earlier offers do not block a fresh search.
      round: { type: Number, default: 1 },
      // Short lease so only one worker runs a matching round for a booking at a time.
      lockUntil: { type: Date, default: null },
    },
    policy: { type: policySnapshotSchema },
    fee: { type: feeSchema, default: undefined },
    // Driver cancels before the ride starts put the booking back in the search (up to a limit).
    redispatchCount: { type: Number, default: 0 },
    excludedDriverIds: { type: [Schema.Types.ObjectId], default: [] },
    previousDrivers: {
      type: [
        new Schema(
          {
            driverId: { type: Schema.Types.ObjectId, required: true },
            cancelledAt: { type: Date, required: true },
            reasonCode: { type: String },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    // The platform's cut for this booking, frozen when it was made (basis points, 2000 = 20%).
    commission: {
      type: new Schema(
        { version: { type: Number, default: null }, rateBp: { type: Number, required: true } },
        { _id: false },
      ),
    },
    // Set once the money owed for this ride / fee has been recorded in the ledger.
    accrual: {
      type: new Schema(
        {
          kind: { type: String, enum: ['RIDE', 'FEE'], required: true },
          // What the rider was charged (after any discount)...
          amountPaise: { type: Number, required: true },
          // ...the full fare the driver's share and commission are worked out on, and the discount.
          grossPaise: { type: Number },
          discountPaise: { type: Number },
          commissionPaise: { type: Number, required: true },
          driverSharePaise: { type: Number, required: true },
          // Tax charged to the rider on top of the fare (inside amountPaise/grossPaise), and tax on the
          // commission taken out of the driver's share.
          taxPaise: { type: Number },
          commissionTaxPaise: { type: Number },
          at: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: undefined,
    },
    // Coupon frozen from the quote. `finalFarePaise` is what the rider OWES (after the discount);
    // the full fare and the discount are kept beside it for the driver's pay and the receipt.
    coupon: {
      type: new Schema(
        {
          couponId: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true },
          code: { type: String, required: true },
          type: { type: String, enum: ['PERCENT', 'FLAT'], required: true },
          value: { type: Number, required: true },
          maxDiscountPaise: { type: Number },
          minFarePaise: { type: Number },
          // What the rider was shown at booking time (the real discount is set when the ride ends).
          estimatedDiscountPaise: { type: Number },
          // Set once a use reserved for a ride that never happened has been given back.
          releasedAt: { type: Date },
        },
        { _id: false },
      ),
      default: undefined,
    },
    grossFarePaise: { type: Number },
    // Tax inside the gross fare (added on top of the fare). 0 when tax is off.
    taxPaise: { type: Number },
    discountPaise: { type: Number },
    // What settled the booking: a payment public id (online), "CASH:<driverId>", or a staff action.
    paidBy: { type: String },
    paidAt: { type: Date },
    // Set once a cash collection has been recorded in the ledger.
    cashRecordedAt: { type: Date },
    // What the rider says they handed over (optional acknowledgement; it never moves money).
    customerCashConfirmation: {
      type: new Schema(
        {
          amountPaise: { type: Number, required: true },
          at: { type: Date, required: true },
          // False = the rider's amount differs from the fare: a cash dispute for staff to look at.
          matchesFare: { type: Boolean, required: true },
        },
        { _id: false },
      ),
      default: undefined,
    },
    // Set once a waived fee has been recorded in the ledger.
    feeWaiverRecordedAt: { type: Date },
    destinationChange: { type: destinationChangeSchema, default: undefined },
    // Every accepted change of destination keeps what the fare was before it.
    fareAmendments: { type: [Schema.Types.Mixed], default: [] },
    receipt: {
      number: { type: String },
      issuedAt: { type: Date },
    },
    idempotencyKey: { type: String, required: true },
    requestHash: { type: String, required: true },
    requestedAt: { type: Date, required: true },
  },
  { timestamps: true },
);
// One booking per (customer, idempotency key): the database enforces "no duplicates on retry".
bookingSchema.index({ customerId: 1, idempotencyKey: 1 }, { unique: true });
bookingSchema.index({ customerId: 1, createdAt: -1 });
bookingSchema.index({ status: 1, createdAt: -1 });
bookingSchema.index({ assignedDriverId: 1, createdAt: -1 });
// The admin list and the dispatch sweeper both order/filter on requestedAt.
bookingSchema.index({ requestedAt: -1 });
bookingSchema.index({ status: 1, requestedAt: -1 });
bookingSchema.index({ paymentStatus: 1, requestedAt: -1 });
// Money follow-up: rides not yet recorded in the ledger; a driver's earnings list.
bookingSchema.index({ status: 1, 'accrual.at': 1 });
bookingSchema.index({ assignedDriverId: 1, 'accrual.at': -1 });
// Unpaid-balance rule: a rider's unpaid bookings.
bookingSchema.index({ customerId: 1, paymentStatus: 1 });
// Coupon uses to give back for rides that never happened.
bookingSchema.index({ status: 1, 'coupon.code': 1 });

export const Booking = model('Booking', bookingSchema);
