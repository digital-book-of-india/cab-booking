import { Schema, model } from 'mongoose';

export const TicketCategories = [
  'FARE_DISPUTE',
  'PAYMENT_ISSUE',
  'DRIVER_BEHAVIOUR',
  'RIDER_BEHAVIOUR',
  'LOST_ITEM',
  'SAFETY_CONCERN',
  'APP_PROBLEM',
  'OTHER',
] as const;
export const TicketStatuses = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_USER',
  'RESOLVED',
  'CLOSED',
] as const;
export const TicketPriorities = ['LOW', 'NORMAL', 'HIGH'] as const;
export const TicketOutcomes = [
  'REFUNDED',
  'FEE_WAIVED',
  'WARNING_ISSUED',
  'NO_ACTION',
  'ESCALATED',
  'OTHER',
] as const;

/** A rider's or driver's request for help, with the conversation kept on the ticket. */
const supportTicketSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userRole: { type: String, enum: ['CUSTOMER', 'DRIVER'], required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
    bookingPublicId: { type: String },
    category: { type: String, enum: TicketCategories, required: true },
    subject: { type: String, required: true, trim: true, maxlength: 120 },
    status: { type: String, enum: TicketStatuses, default: 'OPEN' },
    priority: { type: String, enum: TicketPriorities, default: 'NORMAL' },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
    messages: {
      type: [
        new Schema(
          {
            id: { type: String, required: true },
            by: { type: String, enum: ['USER', 'STAFF'], required: true },
            authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
            text: { type: String, required: true, maxlength: 2000 },
            // Staff-only notes are never shown to the person who raised the ticket.
            internal: { type: Boolean, default: false },
            at: { type: Date, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    outcome: { type: String, enum: TicketOutcomes },
    resolutionNote: { type: String, maxlength: 1000 },
    firstResponseAt: { type: Date },
    resolvedAt: { type: Date },
    closedAt: { type: Date },
    lastActivityAt: { type: Date, required: true },
  },
  { timestamps: true },
);
supportTicketSchema.index({ userId: 1, createdAt: -1 });
supportTicketSchema.index({ status: 1, priority: -1, createdAt: 1 });
supportTicketSchema.index({ assignedTo: 1, status: 1 });
supportTicketSchema.index({ bookingPublicId: 1 }, { sparse: true });

export const SupportTicket = model('SupportTicket', supportTicketSchema);
