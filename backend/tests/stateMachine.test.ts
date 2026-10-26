import { describe, expect, it } from 'vitest';
import { BookingStatuses } from '../src/modules/bookings/booking.model';
import {
  DRIVER_ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  TRANSITIONS,
  assertTransition,
  canTransition,
} from '../src/modules/bookings/stateMachine';

describe('booking state machine', () => {
  it('defines transitions for every status', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...BookingStatuses].sort());
  });

  it('only ever points at real statuses', () => {
    for (const targets of Object.values(TRANSITIONS)) {
      for (const t of targets) expect(BookingStatuses).toContain(t);
    }
  });

  it('allows the happy path in order, and nothing else from each step', () => {
    const path = [
      'REQUESTED',
      'DISPATCHING',
      'DRIVER_ASSIGNED',
      'DRIVER_ARRIVING',
      'DRIVER_ARRIVED',
      'IN_PROGRESS',
      'COMPLETED',
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
    // No skipping ahead, no going backwards.
    expect(canTransition('REQUESTED', 'DRIVER_ASSIGNED')).toBe(false);
    expect(canTransition('DRIVER_ASSIGNED', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('DRIVER_ARRIVED', 'COMPLETED')).toBe(false);
    expect(canTransition('IN_PROGRESS', 'DRIVER_ARRIVED')).toBe(false);
    expect(canTransition('REQUESTED', 'COMPLETED')).toBe(false);
  });

  it('a driver cancel before the trip may put the booking back in the search, never later', () => {
    for (const s of ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'] as const) {
      expect(canTransition(s, 'DISPATCHING'), s).toBe(true);
    }
    expect(canTransition('IN_PROGRESS', 'DISPATCHING')).toBe(false);
    expect(canTransition('COMPLETED', 'DISPATCHING')).toBe(false);
    expect(canTransition('CANCELLED', 'DISPATCHING')).toBe(false);
    // A rider no-show is only possible once the driver has arrived.
    expect(canTransition('DRIVER_ARRIVED', 'NO_SHOW')).toBe(true);
    expect(canTransition('DRIVER_ARRIVING', 'NO_SHOW')).toBe(false);
  });

  it('cannot cancel once the ride is in progress', () => {
    expect(canTransition('IN_PROGRESS', 'CANCELLED')).toBe(false);
    for (const s of [
      'REQUESTED',
      'DISPATCHING',
      'DRIVER_ASSIGNED',
      'DRIVER_ARRIVING',
      'DRIVER_ARRIVED',
    ] as const) {
      expect(canTransition(s, 'CANCELLED')).toBe(true);
    }
  });

  it('has no way out of a finished ride', () => {
    for (const s of TERMINAL_STATUSES) expect(TRANSITIONS[s]).toEqual([]);
    expect(canTransition('COMPLETED', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('CANCELLED', 'DISPATCHING')).toBe(false);
  });

  it('allows retrying a failed search and nothing else from NO_DRIVER_FOUND', () => {
    expect(TRANSITIONS['NO_DRIVER_FOUND']).toEqual(['DISPATCHING']);
  });

  it('treats an illegal request as a programming error', () => {
    expect(() => assertTransition('COMPLETED', 'IN_PROGRESS')).toThrow();
    expect(() => assertTransition('DISPATCHING', 'DRIVER_ASSIGNED')).not.toThrow();
  });

  it('marks exactly the statuses that tie up a driver', () => {
    expect([...DRIVER_ACTIVE_STATUSES].sort()).toEqual(
      ['DRIVER_ARRIVED', 'DRIVER_ARRIVING', 'DRIVER_ASSIGNED', 'IN_PROGRESS'].sort(),
    );
  });
});
