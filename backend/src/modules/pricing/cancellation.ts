/**
 * Cancellation and no-show rules. Pure functions on a policy snapshot, so the amount a rider is
 * quoted in the preview is exactly the amount charged when they cancel.
 */
export type PolicySnapshot = {
  /** Which stored policy version this came from; null = the built-in default. */
  version?: number | null;
  freeCancelWindowSeconds: number;
  cancelFeePaise: number;
  noShowWaitSeconds: number;
  noShowFeePaise: number;
};

/** PLACEHOLDER numbers, used until an admin creates a policy for the zone. */
export const DEFAULT_POLICY: PolicySnapshot = {
  version: null,
  freeCancelWindowSeconds: 120,
  cancelFeePaise: 3000,
  noShowWaitSeconds: 300,
  noShowFeePaise: 5000,
};

export type CancellationAssessment = {
  /** Charged to the rider if they cancel right now. */
  amountPaise: number;
  reason:
    'FREE_BEFORE_ASSIGNMENT' | 'DRIVER_NOT_MOVING' | 'WITHIN_FREE_WINDOW' | 'AFTER_FREE_WINDOW';
  /** Until when cancelling is free (when a free window is still running). */
  freeUntil: Date | null;
};

/**
 * A rider pays only if the driver has actually set off and the free window after assignment has
 * passed. Before a driver is assigned, or while the driver has not started moving, it is free.
 * Cancellations by the driver, staff or the system never cost the rider anything (not asked here).
 */
export function assessCustomerCancellation(
  policy: PolicySnapshot,
  booking: { status: string; assignedAt: Date | null | undefined },
  at: Date,
): CancellationAssessment {
  if (
    !booking.assignedAt ||
    !['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'].includes(booking.status)
  ) {
    return { amountPaise: 0, reason: 'FREE_BEFORE_ASSIGNMENT', freeUntil: null };
  }
  const freeUntil = new Date(booking.assignedAt.getTime() + policy.freeCancelWindowSeconds * 1000);
  if (booking.status === 'DRIVER_ASSIGNED') {
    return { amountPaise: 0, reason: 'DRIVER_NOT_MOVING', freeUntil: null };
  }
  if (at.getTime() <= freeUntil.getTime()) {
    return { amountPaise: 0, reason: 'WITHIN_FREE_WINDOW', freeUntil };
  }
  return { amountPaise: policy.cancelFeePaise, reason: 'AFTER_FREE_WINDOW', freeUntil: null };
}

/** May the driver call this a no-show yet? They must have waited the policy's time at the pickup. */
export function noShowEligibility(
  policy: PolicySnapshot,
  arrivedAt: Date | null | undefined,
  at: Date,
): { allowed: boolean; waitedSeconds: number; mustWaitUntil: Date | null } {
  if (!arrivedAt) return { allowed: false, waitedSeconds: 0, mustWaitUntil: null };
  const waitedSeconds = Math.max(0, Math.floor((at.getTime() - arrivedAt.getTime()) / 1000));
  const mustWaitUntil = new Date(arrivedAt.getTime() + policy.noShowWaitSeconds * 1000);
  return { allowed: waitedSeconds >= policy.noShowWaitSeconds, waitedSeconds, mustWaitUntil };
}
