import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY,
  assessCustomerCancellation,
  noShowEligibility,
  type PolicySnapshot,
} from '../src/modules/pricing/cancellation';
import { calculateFare, computeWaiting } from '../src/modules/pricing/fare';

const rates = {
  baseFarePaise: 4000,
  perKmPaise: 1200,
  perMinutePaise: 150,
  minimumFarePaise: 0,
  roundingMode: 'NONE' as const,
};

describe('waiting time', () => {
  it('is free inside the allowance, then billed per minute beyond it', () => {
    const w = (pickup: number) =>
      computeWaiting({
        pickupWaitSeconds: pickup,
        stopWaitSeconds: [],
        freeSeconds: 180,
        capSeconds: 1800,
      });
    expect(w(0).billableSeconds).toBe(0);
    expect(w(180).billableSeconds).toBe(0);
    expect(w(181).billableSeconds).toBe(1);
    expect(w(480).billableSeconds).toBe(300); // 8 min wait, 3 free -> 5 billed
  });

  it('gives the pickup and every stop their own free allowance', () => {
    const w = computeWaiting({
      pickupWaitSeconds: 200, // 20 over
      stopWaitSeconds: [100, 300, 181], // 0, 120, 1 over
      freeSeconds: 180,
      capSeconds: 1800,
    });
    expect(w.billableSeconds).toBe(20 + 0 + 120 + 1);
    expect(w.pickupWaitSeconds).toBe(200);
    expect(w.stopWaitSeconds).toBe(581);
    expect(w.totalWaitSeconds).toBe(781);
  });

  it('never bills more than the cap', () => {
    const w = computeWaiting({
      pickupWaitSeconds: 10_000,
      stopWaitSeconds: [10_000],
      freeSeconds: 180,
      capSeconds: 1800,
    });
    expect(w.billableSeconds).toBe(1800);
  });

  it('ignores nonsense (negative, NaN) instead of charging for it', () => {
    const w = computeWaiting({
      pickupWaitSeconds: -50,
      stopWaitSeconds: [Number.NaN, -1],
      freeSeconds: 180,
      capSeconds: 1800,
    });
    expect(w.billableSeconds).toBe(0);
    expect(w.totalWaitSeconds).toBe(0);
  });

  it('adds the waiting charge to the fare, in whole paise', () => {
    const none = calculateFare(rates, 10_000, 1200);
    const waited = calculateFare(rates, 10_000, 1200, {
      billableSeconds: 300,
      perMinutePaise: 200,
    });
    expect(none.waitingFarePaise).toBe(0);
    expect(waited.waitingFarePaise).toBe(1000);
    expect(waited.estimatedTotalPaise - none.estimatedTotalPaise).toBe(1000);
    // Rounded once: 90 s at 200 paise/min = 300 paise exactly; 1 s = 3.33 -> 3
    expect(
      calculateFare(rates, 0, 0, { billableSeconds: 1, perMinutePaise: 200 }).waitingFarePaise,
    ).toBe(3);
  });

  it('counts toward the minimum fare rather than on top of a top-up', () => {
    const min = { ...rates, minimumFarePaise: 20_000 };
    const f = calculateFare(min, 1000, 60, { billableSeconds: 600, perMinutePaise: 200 });
    expect(f.estimatedTotalPaise).toBe(20_000); // still the minimum
    expect(
      f.baseFarePaise +
        f.distanceFarePaise +
        f.timeFarePaise +
        f.waitingFarePaise +
        f.minimumFareAdjustmentPaise,
    ).toBe(20_000);
  });
});

describe('cancellation fee', () => {
  const policy: PolicySnapshot = { ...DEFAULT_POLICY }; // 2 min free, then 3000
  const assignedAt = new Date('2026-10-17T10:00:00Z');
  const at = (seconds: number) => new Date(assignedAt.getTime() + seconds * 1000);

  it('is free until a driver is assigned', () => {
    for (const status of ['REQUESTED', 'DISPATCHING']) {
      expect(
        assessCustomerCancellation(policy, { status, assignedAt: null }, at(999)).amountPaise,
      ).toBe(0);
    }
  });

  it('is free while the driver has not set off, however long ago they were assigned', () => {
    const r = assessCustomerCancellation(
      policy,
      { status: 'DRIVER_ASSIGNED', assignedAt },
      at(3600),
    );
    expect(r).toMatchObject({ amountPaise: 0, reason: 'DRIVER_NOT_MOVING' });
  });

  it('is free inside the window and charged after it once the driver is on the way', () => {
    const inside = assessCustomerCancellation(
      policy,
      { status: 'DRIVER_ARRIVING', assignedAt },
      at(120),
    );
    expect(inside).toMatchObject({ amountPaise: 0, reason: 'WITHIN_FREE_WINDOW' });
    expect(inside.freeUntil?.getTime()).toBe(at(120).getTime());
    const after = assessCustomerCancellation(
      policy,
      { status: 'DRIVER_ARRIVING', assignedAt },
      at(121),
    );
    expect(after).toMatchObject({ amountPaise: 3000, reason: 'AFTER_FREE_WINDOW' });
    expect(
      assessCustomerCancellation(policy, { status: 'DRIVER_ARRIVED', assignedAt }, at(500))
        .amountPaise,
    ).toBe(3000);
  });

  it('uses the numbers of the policy it is given, including a zero fee', () => {
    const generous: PolicySnapshot = { ...policy, cancelFeePaise: 0 };
    expect(
      assessCustomerCancellation(generous, { status: 'DRIVER_ARRIVING', assignedAt }, at(900))
        .amountPaise,
    ).toBe(0);
    const strict: PolicySnapshot = { ...policy, freeCancelWindowSeconds: 0, cancelFeePaise: 9900 };
    expect(
      assessCustomerCancellation(strict, { status: 'DRIVER_ARRIVING', assignedAt }, at(1))
        .amountPaise,
    ).toBe(9900);
  });
});

describe('no-show eligibility', () => {
  const arrivedAt = new Date('2026-10-17T10:00:00Z');
  it('needs the full wait at the pickup', () => {
    const wait = (s: number) =>
      noShowEligibility(DEFAULT_POLICY, arrivedAt, new Date(arrivedAt.getTime() + s * 1000));
    expect(wait(299).allowed).toBe(false);
    expect(wait(300).allowed).toBe(true);
    expect(wait(300).waitedSeconds).toBe(300);
    expect(noShowEligibility(DEFAULT_POLICY, null, arrivedAt).allowed).toBe(false);
  });
});
