import { Schema, model } from 'mongoose';

/** Append-only timeline: who moved a booking between which states, and when. */
const bookingEventSchema = new Schema(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    type: { type: String, required: true },
    fromStatus: { type: String },
    toStatus: { type: String },
    actorType: { type: String, enum: ['CUSTOMER', 'DRIVER', 'ADMIN', 'SYSTEM'], required: true },
    actorId: { type: String },
    metadata: { type: Schema.Types.Mixed },
    at: { type: Date, required: true },
  },
  { timestamps: false },
);
bookingEventSchema.index({ bookingId: 1, at: 1 });

export const BookingEvent = model('BookingEvent', bookingEventSchema);
