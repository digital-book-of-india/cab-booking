import { describe, expect, it } from 'vitest';
import {
  calendarDays,
  outstationEstimate,
  outstationFinal,
  rentalEstimate,
  rentalFinal,
  type OutstationSnapshot,
  type RentalSnapshot,
  type TripRules,
} from '../src/modules/trips/tripFares';
import { sumPath } from '../src/modules/trips/tripDistance';

const rules: TripRules = { rentalGraceMinutes: 10, rentalGraceKm: 2, oneWayDetourBp: 2000 };
const H = 3600;

describe('rental fares', () => {
  // 4 hours / 40 km for Rs 800; Rs 12 a km and Rs 150 an hour beyond.
  const pkg: RentalSnapshot = {
    packageId: 'p1',
    name: '4 hr / 40 km',
    hours: 4,
    includedKm: 40,
    pricePaise: 80_000,
    extraKmPaise: 1200,
    extraHourPaise: 15_000,
  };

  it('costs the package price when nothing goes over', () => {
    expect(rentalEstimate(pkg).breakdown.estimatedTotalPaise).toBe(80_000);
    const within = rentalFinal(
      pkg,
      { elapsedSeconds: 3 * H + 3000, measuredMeters: 38_000 },
      rules,
    );
    expect(within.breakdown).toMatchObject({
      baseFarePaise: 80_000,
      distanceFarePaise: 0,
      timeFarePaise: 0,
      estimatedTotalPaise: 80_000,
    });
  });

  it('forgives a few minutes and a couple of km over', () => {
    const f = rentalFinal(pkg, { elapsedSeconds: 4 * H + 9 * 60, measuredMeters: 41_500 }, rules);
    expect(f.breakdown.estimatedTotalPaise).toBe(80_000);
  });

  it('charges extra time by the minute and extra distance by the metre beyond the grace', () => {
    // 5 h: 60 min over, 10 forgiven = 50 min x Rs 150/h = Rs 125. 52 km: 12 over, 2 forgiven = 10 km x Rs 12 = Rs 120.
    const f = rentalFinal(pkg, { elapsedSeconds: 5 * H, measuredMeters: 52_000 }, rules);
    expect(f.breakdown).toMatchObject({
      baseFarePaise: 80_000,
      timeFarePaise: 12_500,
      distanceFarePaise: 12_000,
      estimatedTotalPaise: 104_500,
    });
    expect(f.details.distance).toContain('10.0 km over');
    expect(f.details.time).toBe('50 min over');
    expect(f.billableDistanceMeters).toBe(52_000);
  });

  it('rounds the total to the rupee and shows the rounding', () => {
    const odd = { ...pkg, extraKmPaise: 1250 };
    const f = rentalFinal(odd, { elapsedSeconds: 3 * H, measuredMeters: 43_300 }, rules); // 1.3 km billed = 1625
    expect(f.breakdown.distanceFarePaise).toBe(1625);
    expect(f.breakdown.estimatedTotalPaise).toBe(81_600);
    expect(f.breakdown.roundingAdjustmentPaise).toBe(-25);
    const b = f.breakdown;
    expect(
      b.baseFarePaise + b.distanceFarePaise + b.timeFarePaise + b.roundingAdjustmentPaise,
    ).toBe(b.estimatedTotalPaise);
  });
});

describe('outstation fares', () => {
  const base: OutstationSnapshot = {
    rateId: 'r1',
    tripType: 'ONE_WAY',
    routeMeters: 200_000,
    days: 1,
    nights: 0,
    perKmPaise: 1400,
    minKmPerDay: 250,
    allowancePerNightPaise: 30_000,
    minimumFarePaise: 200_000,
    estimatedKm: 200,
  };

  it('one way is the route distance at the one-way rate, with a minimum fare', () => {
    expect(outstationEstimate(base).breakdown.estimatedTotalPaise).toBe(280_000);
    const short = outstationEstimate({ ...base, routeMeters: 100_000, estimatedKm: 100 });
    expect(short.breakdown).toMatchObject({
      baseFarePaise: 140_000,
      minimumFareAdjustmentPaise: 60_000,
      estimatedTotalPaise: 200_000,
    });
  });

  it('a round trip is charged for at least the minimum km every day, plus a night allowance', () => {
    const rt: OutstationSnapshot = {
      ...base,
      tripType: 'ROUND_TRIP',
      perKmPaise: 1100,
      days: 2,
      nights: 1,
      estimatedKm: 300,
      routeMeters: 150_000,
    };
    const f = outstationEstimate(rt); // max(300, 2 x 250) = 500 km x Rs 11 = 5500 + one night Rs 300
    expect(f.breakdown.estimatedTotalPaise).toBe(580_000);
    expect(f.extraLines).toEqual([
      expect.objectContaining({ code: 'DRIVER_ALLOWANCE', amountPaise: 30_000 }),
    ]);
    const b = f.breakdown;
    expect(
      b.baseFarePaise +
        f.extraLines[0]!.amountPaise +
        b.minimumFareAdjustmentPaise +
        b.roundingAdjustmentPaise,
    ).toBe(b.estimatedTotalPaise);
  });

  it('one way keeps the quoted distance unless the rider really made a detour, and caps it at double', () => {
    const at = new Date('2026-11-02T10:00:00Z');
    const end = (km: number) =>
      outstationFinal(
        base,
        {
          startedAt: at,
          endedAt: new Date(at.getTime() + 5 * H * 1000),
          measuredMeters: km * 1000,
        },
        rules,
      );
    expect(end(215).breakdown.estimatedTotalPaise).toBe(280_000); // 7.5% over: quoted km stands
    expect(end(260).breakdown.estimatedTotalPaise).toBe(364_000); // 30% over: the real 260 km
    expect(end(900).breakdown.estimatedTotalPaise).toBe(560_000); // capped at 400 km
    expect(end(150).breakdown.estimatedTotalPaise).toBe(280_000); // shorter than quoted: still the quoted
  });

  it('a round trip that lasts longer than booked is charged the extra days', () => {
    const rt: OutstationSnapshot = {
      ...base,
      tripType: 'ROUND_TRIP',
      perKmPaise: 1100,
      days: 2,
      nights: 1,
      estimatedKm: 300,
      routeMeters: 150_000,
    };
    // Left Monday 20:00 India time, back Wednesday 02:00: that touches three calendar days.
    const startedAt = new Date('2026-11-02T14:30:00Z');
    const endedAt = new Date('2026-11-03T20:30:00Z');
    expect(calendarDays(startedAt, endedAt)).toBe(3);
    const f = outstationFinal(rt, { startedAt, endedAt, measuredMeters: 400_000 }, rules);
    // 3 days x 250 = 750 km minimum (more than the 400 driven) x Rs 11 = 8250, plus 2 nights x Rs 300.
    expect(f.breakdown.estimatedTotalPaise).toBe(885_000);
    expect(f.extraLines[0]!.amountPaise).toBe(60_000);
    // Driving more than the minimum is charged for what was driven.
    const long = outstationFinal(rt, { startedAt, endedAt, measuredMeters: 1_000_000 }, rules);
    expect(long.breakdown.estimatedTotalPaise).toBe(1_100_000 + 60_000);
  });
});

describe('measuring a route from GPS points', () => {
  const t0 = new Date('2026-11-02T10:00:00Z').getTime();
  const pt = (lat: number, lng: number, sec: number, accuracy?: number) => ({
    lat,
    lng,
    at: new Date(t0 + sec * 1000),
    accuracy,
  });
  // 0.009 degrees of latitude is about 1 km.
  it('adds up the segments', () => {
    const d = sumPath([pt(28.0, 77.0, 0), pt(28.009, 77.0, 60), pt(28.018, 77.0, 120)], 70, 100);
    expect(d).toBeGreaterThan(1990);
    expect(d).toBeLessThan(2010);
  });
  it('ignores wobble while standing, vague fixes, and jumps no car can make', () => {
    const d = sumPath(
      [
        pt(28.0, 77.0, 0),
        pt(28.00001, 77.0, 10), // about 1 m: wobble
        pt(28.5, 77.0, 11, 10), // 55 km in one second: a bad fix
        pt(28.009, 77.0, 60, 500), // too vague to trust
        pt(28.009, 77.0, 70, 8), // 1 km from the start
      ],
      70,
      100,
    );
    expect(d).toBeGreaterThan(990);
    expect(d).toBeLessThan(1010);
  });
  it('is zero for nothing', () => {
    expect(sumPath([], 70, 100)).toBe(0);
    expect(sumPath([pt(28, 77, 0)], 70, 100)).toBe(0);
  });
});
