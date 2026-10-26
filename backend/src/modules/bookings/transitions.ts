import type { Types } from 'mongoose';
import { Booking, type BookingStatus } from './booking.model';
import { BookingEvent } from './bookingEvent.model';
import { assertTransition } from './stateMachine';

type Filter = { _id?: Types.ObjectId | string; publicId?: string; [key: string]: unknown };

/**
 * Atomically move a booking from one of `from` to `to`. Returns the updated booking, or null if
 * the booking was not in an allowed `from` state (or did not match `filter`), in which case nothing
 * changed. Callers translate null into the right HTTP error.
 */
export async function transitionBooking(
  filter: Filter,
  from: readonly BookingStatus[],
  to: BookingStatus,
  update: {
    set?: Record<string, unknown>;
    inc?: Record<string, number>;
    unset?: Record<string, 1>;
    push?: Record<string, unknown>;
    addToSet?: Record<string, unknown>;
  } = {},
) {
  for (const f of from) assertTransition(f, to);
  const mongoUpdate: Record<string, unknown> = { $set: { ...update.set, status: to } };
  if (update.inc) mongoUpdate['$inc'] = update.inc;
  if (update.unset) mongoUpdate['$unset'] = update.unset;
  if (update.push) mongoUpdate['$push'] = update.push;
  if (update.addToSet) mongoUpdate['$addToSet'] = update.addToSet;
  return Booking.findOneAndUpdate({ ...filter, status: { $in: from } }, mongoUpdate, {
    returnDocument: 'after',
  });
}

export type ActorType = 'CUSTOMER' | 'DRIVER' | 'ADMIN' | 'SYSTEM';

export async function recordEvent(entry: {
  bookingId: Types.ObjectId;
  type: string;
  fromStatus?: BookingStatus;
  toStatus?: BookingStatus;
  actorType: ActorType;
  actorId?: string;
  at: Date;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const created = await BookingEvent.create(entry);
  return created._id.toString();
}
