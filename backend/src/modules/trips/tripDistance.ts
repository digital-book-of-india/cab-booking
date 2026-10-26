import type { Types } from 'mongoose';
import { haversineMeters } from '../../common/geo';
import { LocationPing } from '../tracking/locationPing.model';

type Pt = { lat: number; lng: number; at: Date; accuracy?: number | undefined };

type TrailOptions = {
  start?: { lat: number; lng: number; at: Date } | null;
  end?: { lat: number; lng: number; at: Date } | null;
  maxSpeedMps: number;
  maxAccuracyMeters: number;
  /** Only count points taken while the booking was in this status (the trip itself, not the drive to the pickup). */
  bookingStatus?: string;
};

/**
 * How far a ride really went, from the route trail the SERVER recorded (never a number typed in
 * by the driver or rider). Small jitters and impossible jumps (a bad GPS fix) are ignored, and
 * the start and end positions are added so the first and last stretch are counted.
 * `pings` is how many recorded points the trail had, so a caller can tell a thin trail from a good one.
 */
export async function trailSummary(
  bookingId: Types.ObjectId,
  opts: TrailOptions,
): Promise<{ meters: number; pings: number }> {
  const rows = await LocationPing.find({
    bookingId,
    ...(opts.bookingStatus ? { bookingStatus: opts.bookingStatus } : {}),
  })
    .sort({ recordedAt: 1 })
    .select('location recordedAt accuracyMeters')
    .lean();
  const points: Pt[] = [];
  if (opts.start) points.push({ ...opts.start });
  let pings = 0;
  for (const r of rows) {
    if (!r.location) continue;
    const [lng, lat] = r.location.coordinates as [number, number];
    points.push({ lat, lng, at: r.recordedAt, accuracy: r.accuracyMeters ?? undefined });
    pings += 1;
  }
  if (opts.end) points.push({ ...opts.end });
  return { meters: sumPath(points, opts.maxSpeedMps, opts.maxAccuracyMeters), pings };
}

export async function trailMeters(bookingId: Types.ObjectId, opts: TrailOptions): Promise<number> {
  return (await trailSummary(bookingId, opts)).meters;
}

/** Pure part, exported for tests. */
export function sumPath(points: Pt[], maxSpeedMps: number, maxAccuracyMeters: number): number {
  let total = 0;
  let last: Pt | null = null;
  for (const p of points) {
    if (p.accuracy !== undefined && p.accuracy > maxAccuracyMeters) continue; // too vague to trust
    if (!last) {
      last = p;
      continue;
    }
    const d = haversineMeters(last, p);
    const seconds = Math.max(0, (p.at.getTime() - last.at.getTime()) / 1000);
    if (d < 3) continue; // standing still: GPS wobble
    if (seconds > 0 && d / seconds > maxSpeedMps) continue; // a jump no car can make: a bad fix
    total += d;
    last = p;
  }
  return Math.round(total);
}
