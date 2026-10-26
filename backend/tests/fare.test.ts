import { describe, expect, it } from 'vitest';
import { calculateFare, type FareRates } from '../src/modules/pricing/fare';
import { isWithinOperatingHours } from '../src/modules/zones/zones.service';

const mini: FareRates = {
  baseFarePaise: 4000,
  perKmPaise: 1200,
  perMinutePaise: 150,
  minimumFarePaise: 10000,
  roundingMode: 'NEAREST_RUPEE',
};

describe('calculateFare', () => {
  it('adds base + distance + time in integer paise', () => {
    const f = calculateFare(mini, 10_000, 1200);
    expect(f.distanceFarePaise).toBe(12_000);
    expect(f.timeFarePaise).toBe(3_000);
    expect(f.estimatedTotalPaise).toBe(19_000);
  });

  it('tops up to the minimum fare and reports the adjustment', () => {
    const f = calculateFare(mini, 500, 60);
    expect(f.minimumFareAdjustmentPaise).toBe(10_000 - (4000 + 600 + 150));
    expect(f.estimatedTotalPaise).toBe(10_000);
  });

  it('rounds each component once and the total to the nearest rupee', () => {
    const f = calculateFare({ ...mini, baseFarePaise: 4010 }, 10_000, 1200);
    expect(f.estimatedTotalPaise).toBe(19_000); // 19010 -> 19000
    expect(f.roundingAdjustmentPaise).toBe(-10);
    const g = calculateFare({ ...mini, baseFarePaise: 4060 }, 10_000, 1200);
    expect(g.estimatedTotalPaise).toBe(19_100); // 19060 -> 19100
    expect(g.roundingAdjustmentPaise).toBe(40);
  });

  it('keeps exact paise when rounding is NONE', () => {
    const f = calculateFare({ ...mini, baseFarePaise: 4010, roundingMode: 'NONE' }, 10_000, 1200);
    expect(f.estimatedTotalPaise).toBe(19_010);
    expect(f.roundingAdjustmentPaise).toBe(0);
  });

  it('always returns an integer total that equals the sum of its parts', () => {
    for (const [d, t] of [
      [1234, 77],
      [99_999, 4321],
      [150, 5],
      [0, 0],
    ] as const) {
      const f = calculateFare(mini, d, t);
      expect(Number.isInteger(f.estimatedTotalPaise)).toBe(true);
      expect(
        f.baseFarePaise +
          f.distanceFarePaise +
          f.timeFarePaise +
          f.minimumFareAdjustmentPaise +
          f.roundingAdjustmentPaise,
      ).toBe(f.estimatedTotalPaise);
    }
  });

  it('refuses nonsense inputs', () => {
    expect(() => calculateFare(mini, -1, 10)).toThrow();
    expect(() => calculateFare(mini, 10, Number.NaN)).toThrow();
    expect(() => calculateFare(mini, Number.POSITIVE_INFINITY, 10)).toThrow();
  });
});

describe('isWithinOperatingHours (Asia/Kolkata)', () => {
  // 2026-11-02T00:00Z is 05:30 IST.
  const atIst = (h: number, m = 0) =>
    new Date(Date.UTC(2026, 10, 2, 0, 0) + (h * 60 + m - 330) * 60_000);

  it('is always open without a window', () => {
    expect(isWithinOperatingHours(undefined, atIst(3))).toBe(true);
    expect(isWithinOperatingHours({}, atIst(3))).toBe(true);
  });

  it('handles a same-day window with an inclusive start and exclusive end', () => {
    const h = { start: '05:00', end: '23:30' };
    expect(isWithinOperatingHours(h, atIst(5, 0))).toBe(true);
    expect(isWithinOperatingHours(h, atIst(23, 29))).toBe(true);
    expect(isWithinOperatingHours(h, atIst(23, 30))).toBe(false);
    expect(isWithinOperatingHours(h, atIst(4, 59))).toBe(false);
  });

  it('handles an overnight window', () => {
    const h = { start: '22:00', end: '06:00' };
    expect(isWithinOperatingHours(h, atIst(23))).toBe(true);
    expect(isWithinOperatingHours(h, atIst(2))).toBe(true);
    expect(isWithinOperatingHours(h, atIst(12))).toBe(false);
  });
});
