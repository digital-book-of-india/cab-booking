import { AppError } from '../../common/errors';
import type { BookingStatus } from './booking.model';

/**
 * The booking lifecycle. Every status change in the codebase goes through transitionBooking(),
 * which is a conditional database update guarded by this table, so a bad order of calls,
 * a duplicate call, or two racing callers can never skip or repeat a step.
 */
export const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  // Booked for later; the search starts shortly before pickup (REQUESTED) or the rider cancels.
  SCHEDULED: ['REQUESTED', 'CANCELLED'],
  REQUESTED: ['DISPATCHING', 'CANCELLED'],
  DISPATCHING: ['DRIVER_ASSIGNED', 'NO_DRIVER_FOUND', 'CANCELLED'],
  // DISPATCHING again = the driver cancelled and the rider is given another driver.
  DRIVER_ASSIGNED: ['DRIVER_ARRIVING', 'CANCELLED', 'DISPATCHING'],
  DRIVER_ARRIVING: ['DRIVER_ARRIVED', 'CANCELLED', 'DISPATCHING'],
  DRIVER_ARRIVED: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW', 'DISPATCHING'],
  IN_PROGRESS: ['COMPLETED', 'INCIDENT_REVIEW'],
  // Terminal, except that an admin may retry a search that found nobody.
  NO_DRIVER_FOUND: ['DISPATCHING'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
  INCIDENT_REVIEW: [],
};

export const TERMINAL_STATUSES: readonly BookingStatus[] = [
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'INCIDENT_REVIEW',
];

/** Statuses in which a driver is attached to the booking and unavailable for other rides. */
export const DRIVER_ACTIVE_STATUSES: readonly BookingStatus[] = [
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVING',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
];

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) {
    // A coding error, not a user error: callers must only request transitions in the table.
    throw new AppError('INTERNAL_ERROR', `Illegal transition ${from} -> ${to}`);
  }
}
