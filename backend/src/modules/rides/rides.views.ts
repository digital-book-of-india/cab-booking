import { fromPoint } from '../../common/geo';
import { amountDue } from '../payments/amountDue';
import { DriverProfile } from '../drivers/driverProfile.model';
import { User } from '../users/user.model';
import { Vehicle } from '../vehicles/vehicle.model';

type BookingLike = {
  publicId: string;
  assignedDriverId?: { toString(): string } | null;
  stops?: { label?: string | null; location?: { coordinates: number[] } | null }[];
  fee?: { type: string; amountPaise: number; status: string } | null;
  receipt?: { number?: string | null } | null;
  rideId?: string | null;
  status: string;
  paymentStatus?: string | null;
  paymentMethod: string;
  estimatedFarePaise: number;
  finalFarePaise?: number | null;
  fareSnapshot: unknown;
  finalFare?: unknown;
  notes?: string | null;
  pickup: {
    label?: string | null;
    contactName?: string | null;
    contactPhone?: string | null;
    location?: { coordinates: number[] } | null;
  };
  drop: { label?: string | null; location?: { coordinates: number[] } | null };
  cancellation?: {
    actor?: string | null;
    reasonCode?: string | null;
    note?: string | null;
    at?: Date | null;
  } | null;
  requestedAt: Date;
  completedAt?: Date | null;
};

type RideLike = {
  publicId: string;
  customerId: { toString(): string };
  driverId: { toString(): string };
  vehicleId: { toString(): string };
  assignedAt?: Date | null;
  enRouteAt?: Date | null;
  arrivedAt?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  cancelledAt?: Date | null;
};

export type Viewer = 'CUSTOMER' | 'DRIVER' | 'ADMIN';

/** A driver's average appears on their card only after this many ratings. */
export const MIN_RATINGS_SHOWN = 5;

/** What a rider may know about their driver: first name and the cab to look for, never the phone. */
export async function driverCard(ride: RideLike) {
  const profile = await DriverProfile.findById(ride.driverId)
    .select('userId ratingCount ratingSum')
    .lean();
  const [user, vehicle] = await Promise.all([
    profile ? User.findById(profile.userId).select('name').lean() : null,
    Vehicle.findById(ride.vehicleId).lean(),
  ]);
  const rated = profile?.ratingCount ?? 0;
  return {
    // Shown only once enough riders have rated, so one rating cannot brand a new driver.
    rating:
      rated >= MIN_RATINGS_SHOWN
        ? { average: Math.round(((profile?.ratingSum ?? 0) / rated) * 100) / 100, count: rated }
        : null,
    firstName: user?.name?.trim().split(/\s+/)[0] ?? null,
    vehicle: vehicle
      ? {
          make: vehicle.make ?? null,
          model: vehicle.model ?? null,
          color: vehicle.color ?? null,
          registrationNumber: vehicle.registrationNumber,
          categoryId: vehicle.categoryId.toString(),
        }
      : null,
  };
}

/** One ride, shaped for who is asking. The OTP is never part of this view. */
export async function rideView(viewer: Viewer, booking: BookingLike, ride: RideLike) {
  const base = {
    rideId: ride.publicId,
    bookingId: booking.publicId,
    status: booking.status,
    paymentStatus: booking.paymentStatus ?? 'NOT_DUE',
    paymentMethod: booking.paymentMethod,
    currency: 'INR',
    pickup: { ...fromPoint(booking.pickup.location!), label: booking.pickup.label ?? null },
    drop: { ...fromPoint(booking.drop.location!), label: booking.drop.label ?? null },
    stops: (booking.stops ?? []).map((st) => ({
      ...fromPoint(st.location!),
      label: st.label ?? null,
    })),
    fee: booking.fee
      ? {
          type: booking.fee.type,
          amountPaise: booking.fee.amountPaise,
          status: booking.fee.status,
        }
      : null,
    receiptNumber: booking.receipt?.number ?? null,
    amountDuePaise: amountDue(booking)?.amountPaise ?? 0,
    estimatedFarePaise: booking.estimatedFarePaise,
    finalFarePaise: booking.finalFarePaise ?? null,
    fare: booking.finalFare ?? booking.fareSnapshot,
    notes: booking.notes ?? null,
    timeline: {
      requestedAt: booking.requestedAt,
      assignedAt: ride.assignedAt ?? null,
      enRouteAt: ride.enRouteAt ?? null,
      arrivedAt: ride.arrivedAt ?? null,
      startedAt: ride.startedAt ?? null,
      completedAt: ride.completedAt ?? null,
      cancelledAt: ride.cancelledAt ?? null,
    },
    cancellation: booking.cancellation?.actor
      ? {
          actor: booking.cancellation.actor,
          reasonCode: booking.cancellation.reasonCode ?? null,
          at: booking.cancellation.at ?? null,
        }
      : null,
  };

  if (viewer === 'DRIVER') {
    // The driver needs to reach the rider while the ride is live, and no longer once it is over.
    const live = ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS'].includes(
      booking.status,
    );
    return {
      ...base,
      customer: live
        ? {
            name: booking.pickup.contactName ?? null,
            phone: booking.pickup.contactPhone ?? null,
          }
        : null,
    };
  }
  const stillAssigned = Boolean(booking.assignedDriverId?.toString() === ride.driverId.toString());
  if (viewer === 'CUSTOMER') {
    return { ...base, driver: stillAssigned ? await driverCard(ride) : null };
  }
  return {
    ...base,
    driver: stillAssigned ? await driverCard(ride) : null,
    customer: {
      name: booking.pickup.contactName ?? null,
      phone: booking.pickup.contactPhone ?? null,
    },
  };
}

/** Compact row for history lists. */
export function historyRow(b: BookingLike) {
  return {
    bookingId: b.publicId,
    rideId: b.rideId ?? null,
    status: b.status,
    paymentStatus: b.paymentStatus ?? 'NOT_DUE',
    pickupLabel: b.pickup.label ?? null,
    dropLabel: b.drop.label ?? null,
    estimatedFarePaise: b.estimatedFarePaise,
    finalFarePaise: b.finalFarePaise ?? null,
    createdAt: b.requestedAt,
    completedAt: b.completedAt ?? null,
  };
}

/* ---------------- receipt ---------------- */

type ReceiptBooking = BookingLike & {
  requestedAt: Date;
  completedAt?: Date | null;
  cancellation?: { actor?: string | null; at?: Date | null } | null;
  fareAmendments?: unknown[];
};

type FareLine = { code: string; label: string; amountPaise: number; detail?: string };

/**
 * The receipt is built only from what was stored when the ride ended, so it can never change
 * afterwards. Issuer details are placeholders until the company's legal and GST data is supplied.
 */
export async function receiptView(viewer: Viewer, bookingRaw: unknown, rideRaw: unknown) {
  const b = bookingRaw as ReceiptBooking;
  const ride = rideRaw as RideLike;
  const finalFare = (b as unknown as { finalFare?: unknown }).finalFare as
    | {
        currency?: string;
        billableDistanceMeters?: number;
        billableDurationSeconds?: number;
        waiting?: { billableSeconds: number; totalWaitSeconds: number };
        breakdown: Record<string, number>;
        labels?: { base: string; distance?: string; time?: string };
        details?: { base?: string; distance?: string; time?: string };
        extraLines?: FareLine[];
      }
    | undefined;
  const completed = b.status === 'COMPLETED' && Boolean(finalFare);

  const lines: FareLine[] = [];
  if (completed && finalFare) {
    const bd = finalFare.breakdown;
    const km = ((finalFare.billableDistanceMeters ?? 0) / 1000).toFixed(1);
    const min = Math.round((finalFare.billableDurationSeconds ?? 0) / 60);
    const waitMin = Math.round((finalFare.waiting?.billableSeconds ?? 0) / 60);
    const all: FareLine[] = [
      {
        code: 'BASE',
        label: finalFare.labels?.base ?? 'Base fare',
        amountPaise: bd['baseFarePaise'] ?? 0,
        ...(finalFare.details?.base ? { detail: finalFare.details.base } : {}),
      },
      {
        code: 'DISTANCE',
        label: finalFare.labels?.distance ?? 'Distance',
        amountPaise: bd['distanceFarePaise'] ?? 0,
        detail: finalFare.details?.distance ?? `${km} km`,
      },
      {
        code: 'TIME',
        label: finalFare.labels?.time ?? 'Ride time',
        amountPaise: bd['timeFarePaise'] ?? 0,
        detail: finalFare.details?.time ?? `${min} min`,
      },
      {
        code: 'WAITING',
        label: 'Waiting',
        amountPaise: bd['waitingFarePaise'] ?? 0,
        detail: `${waitMin} min billed`,
      },
      {
        code: 'MINIMUM_FARE',
        label: 'Minimum fare adjustment',
        amountPaise: bd['minimumFareAdjustmentPaise'] ?? 0,
      },
      { code: 'ROUNDING', label: 'Rounding', amountPaise: bd['roundingAdjustmentPaise'] ?? 0 },
      // Tax added on top of the fare (GST). Only shown when there is some.
      { code: 'TAX', label: 'GST', amountPaise: bd['taxPaise'] ?? 0 },
    ];
    // Show a line when it has an amount, but always the base fare.
    lines.push(...all.filter((l) => l.code === 'BASE' || l.amountPaise !== 0));
    // Extra charges that belong to the trip (e.g. an outstation driver's night allowance).
    lines.push(...(finalFare.extraLines ?? []));
    // A coupon lowers what the rider pays (the driver is still paid on the full fare).
    const discount = (finalFare as { discountPaise?: number }).discountPaise ?? 0;
    if (discount > 0) {
      lines.push({
        code: 'DISCOUNT',
        label: 'Coupon discount',
        amountPaise: -discount,
        detail: (finalFare as { couponCode?: string }).couponCode,
      });
    }
  }
  if (b.fee) {
    lines.push({
      code: b.fee.type === 'NO_SHOW' ? 'NO_SHOW_FEE' : 'CANCELLATION_FEE',
      label: b.fee.type === 'NO_SHOW' ? 'No-show fee' : 'Late cancellation fee',
      amountPaise: b.fee.status === 'WAIVED' ? 0 : b.fee.amountPaise,
      ...(b.fee.status === 'WAIVED' ? { detail: 'waived' } : {}),
    });
  }
  const totalPaise = lines.reduce((sum, l) => sum + l.amountPaise, 0);
  const base = {
    receiptNumber: b.receipt?.number ?? null,
    issuedAt: (b.receipt as { issuedAt?: Date } | null | undefined)?.issuedAt ?? null,
    kind: completed ? 'RIDE' : b.fee?.type === 'NO_SHOW' ? 'NO_SHOW_FEE' : 'CANCELLATION_FEE',
    rideId: ride.publicId,
    bookingId: b.publicId,
    currency: finalFare?.currency ?? 'INR',
    // PLACEHOLDER issuer block until the company's legal name and GSTIN are supplied.
    issuer: { name: 'Cab Platform (placeholder)', gstin: null },
    trip: {
      pickup: { ...fromPoint(b.pickup.location!), label: b.pickup.label ?? null },
      drop: { ...fromPoint(b.drop.location!), label: b.drop.label ?? null },
      stops: (b.stops ?? []).map((st) => ({ ...fromPoint(st.location!), label: st.label ?? null })),
      billedDistanceMeters: finalFare?.billableDistanceMeters ?? null,
      billedDurationSeconds: finalFare?.billableDurationSeconds ?? null,
      requestedAt: b.requestedAt,
      startedAt: ride.startedAt ?? null,
      completedAt: ride.completedAt ?? null,
    },
    lines,
    totalPaise,
    payment: { method: b.paymentMethod, status: b.paymentStatus ?? 'NOT_DUE' },
    destinationChanges: b.fareAmendments?.length ?? 0,
  };
  if (viewer === 'DRIVER') return base;
  return { ...base, driver: await driverCard(ride) };
}
