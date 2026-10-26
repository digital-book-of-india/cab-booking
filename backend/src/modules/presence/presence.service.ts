import type { Types } from 'mongoose';
import { AppError } from '../../common/errors';
import { fromPoint, haversineMeters, toPoint } from '../../common/geo';
import { CabCategory } from '../categories/cabCategory.model';
import type { DispatchConfig } from '../dispatch/dispatch.config';
import { RideOffer } from '../dispatch/rideOffer.model';
import { DriverProfile } from '../drivers/driverProfile.model';
import { missingRequiredDocuments } from '../drivers/documents';
import { requireDriverProfile } from '../drivers/drivers.service';
import { Vehicle } from '../vehicles/vehicle.model';
import type { LocationUpdateInput, PresenceInput } from './presence.schemas';
import type { Notifier } from '../../realtime/notifier';
import type { LedgerService } from '../ledger/ledger.service';

const FUTURE_SKEW_MS = 5000;
/** A device clock more than this far behind the server is treated as stale, not trusted. */
const MAX_REPORT_AGE_MS = 30_000;

export function createPresenceService(deps: {
  now: () => Date;
  config: DispatchConfig;
  notifier?: Pick<Notifier, 'driverMoved'>;
  cashLimit?: { ledger: Pick<LedgerService, 'driverPosition'>; limitPaise: number };
}) {
  const { now, config, notifier, cashLimit } = deps;
  /** Last accepted fix per driver, so a fast sender is limited even while stationary writes are skipped. */
  const lastFixAt = new Map<string, number>();

  /** Why this driver can't go online / take rides, as machine-readable codes. Empty = eligible. */
  async function eligibilityIssues(profile: {
    _id: Types.ObjectId;
    approvalStatus: string;
    activeRideId?: Types.ObjectId | null;
  }): Promise<string[]> {
    const issues: string[] = [];
    if (profile.approvalStatus !== 'APPROVED') issues.push('NOT_APPROVED');
    if (profile.activeRideId) issues.push('ON_ACTIVE_RIDE');
    const vehicles = await Vehicle.find({
      driverId: profile._id,
      verificationStatus: 'VERIFIED',
      active: true,
    })
      .select('categoryId')
      .lean();
    const activeCats = new Set(
      (
        await CabCategory.find({ _id: { $in: vehicles.map((v) => v.categoryId) }, active: true })
          .select('_id')
          .lean()
      ).map((c) => c._id.toString()),
    );
    if (!vehicles.some((v) => activeCats.has(v.categoryId.toString()))) {
      issues.push('NO_VERIFIED_VEHICLE');
    }
    if ((await missingRequiredDocuments(profile._id, now())).length > 0) {
      issues.push('DOCUMENTS_INVALID');
    }
    if (cashLimit) {
      const position = await cashLimit.ledger.driverPosition(profile._id.toString());
      if (position.netOwedByDriverPaise > cashLimit.limitPaise) issues.push('CASH_LIMIT_EXCEEDED');
    }
    return issues;
  }

  return {
    async setPresence(userId: string, input: PresenceInput) {
      const profile = await requireDriverProfile(userId);
      const t = now();

      if (input.status === 'OFFLINE') {
        // Leaving mid-ride would strand the rider; finish or cancel the ride first.
        const res = await DriverProfile.updateOne(
          { _id: profile._id, activeRideId: null },
          { onlineStatus: 'OFFLINE', $unset: { currentLocation: 1, currentVehicleId: 1 } },
        );
        if (res.matchedCount !== 1) {
          throw new AppError(
            'RIDE_INVALID_STATE',
            'Finish or cancel your active ride before going offline.',
          );
        }
        await RideOffer.updateMany(
          { driverId: profile._id, status: 'PENDING' },
          { status: 'WITHDRAWN', respondedAt: t },
        );
        return { status: 'OFFLINE' as const };
      }

      const issues = await eligibilityIssues(profile);
      if (issues.length > 0) {
        throw new AppError('DRIVER_NOT_ELIGIBLE', `Cannot go online: ${issues.join(', ')}.`);
      }

      const verified = await Vehicle.find({
        driverId: profile._id,
        verificationStatus: 'VERIFIED',
        active: true,
        ...(input.vehicleId ? { _id: input.vehicleId } : {}),
      }).lean();
      const cats = new Set(
        (
          await CabCategory.find({ _id: { $in: verified.map((v) => v.categoryId) }, active: true })
            .select('_id')
            .lean()
        ).map((c) => c._id.toString()),
      );
      const usable = verified.filter((v) => cats.has(v.categoryId.toString()));
      if (usable.length === 0) {
        throw new AppError('UNPROCESSABLE', undefined, [
          { field: 'vehicleId', message: 'No verified, active vehicle matches' },
        ]);
      }
      if (!input.vehicleId && usable.length > 1) {
        throw new AppError('UNPROCESSABLE', undefined, [
          { field: 'vehicleId', message: 'You have several vehicles; choose one' },
        ]);
      }
      const vehicle = usable[0]!;
      const loc = input.location!;

      await DriverProfile.updateOne(
        { _id: profile._id },
        {
          onlineStatus: 'ONLINE',
          currentVehicleId: vehicle._id,
          currentLocation: toPoint(loc.lat, loc.lng),
          locationUpdatedAt: t,
          ...(input.headingDegrees !== undefined ? { headingDegrees: input.headingDegrees } : {}),
        },
      );
      return {
        status: 'ONLINE' as const,
        vehicleId: vehicle._id.toString(),
        categoryId: vehicle.categoryId.toString(),
      };
    },

    async getPresence(userId: string) {
      const profile = await requireDriverProfile(userId);
      const t = now().getTime();
      const issues = await eligibilityIssues(profile);
      const updated = profile.locationUpdatedAt?.getTime();
      return {
        status: profile.onlineStatus,
        approvalStatus: profile.approvalStatus,
        vehicleId: profile.currentVehicleId?.toString() ?? null,
        onActiveRide: Boolean(profile.activeRideId),
        locationUpdatedAt: profile.locationUpdatedAt ?? null,
        locationStale: updated === undefined ? true : t - updated > config.locationFreshMs,
        eligible: issues.length === 0,
        issues,
      };
    },

    /** GPS heartbeat. Validates freshness, accuracy, rate and plausibility before storing. */
    async updateLocation(userId: string, input: LocationUpdateInput) {
      const profile = await requireDriverProfile(userId);
      if (profile.onlineStatus !== 'ONLINE') {
        throw new AppError('DRIVER_NOT_ELIGIBLE', 'Go online before sending location updates.');
      }
      const t = now();
      const reported = input.recordedAt ?? t;
      const reject = (message: string): never => {
        throw new AppError('LOCATION_REJECTED', message);
      };

      if (reported.getTime() > t.getTime() + FUTURE_SKEW_MS) reject('Timestamp is in the future.');
      if (t.getTime() - reported.getTime() > MAX_REPORT_AGE_MS) reject('Timestamp is too old.');
      if (input.accuracyMeters !== undefined && input.accuracyMeters > config.maxAccuracyMeters) {
        reject('Accuracy is too poor to use.');
      }

      const prevAt = profile.locationUpdatedAt;
      const prev = profile.currentLocation ? fromPoint(profile.currentLocation) : null;
      const lastSeen = lastFixAt.get(userId);
      if (lastSeen !== undefined && t.getTime() - lastSeen < config.minLocationIntervalMs) {
        throw new AppError('RATE_LIMITED', 'Location updates are too frequent.');
      }
      if (prevAt) {
        const gap = t.getTime() - prevAt.getTime();
        if (gap < config.minLocationIntervalMs) {
          throw new AppError('RATE_LIMITED', 'Location updates are too frequent.');
        }
        if (prev) {
          const seconds = Math.max(gap / 1000, 1);
          const speed = haversineMeters(prev, input) / seconds;
          if (speed > config.maxSpeedMps) reject('Implausible movement since the last update.');
        }
      }

      lastFixAt.set(userId, t.getTime());
      if (lastFixAt.size > 20_000) lastFixAt.clear();

      // Most fixes of a parked or crawling driver change nothing useful: store one only when the
      // driver has moved enough or a while has passed (always well inside the freshness window).
      const movedMeters = prev ? haversineMeters(prev, input) : Infinity;
      const persist =
        !prevAt ||
        movedMeters >= config.persistMinDistanceMeters ||
        t.getTime() - prevAt.getTime() >= config.persistMinIntervalMs;

      if (persist) {
        await DriverProfile.updateOne(
          { _id: profile._id, onlineStatus: 'ONLINE' },
          {
            currentLocation: toPoint(input.lat, input.lng),
            locationUpdatedAt: t,
            ...(input.accuracyMeters !== undefined
              ? { locationAccuracyMeters: input.accuracyMeters }
              : {}),
            ...(input.headingDegrees !== undefined ? { headingDegrees: input.headingDegrees } : {}),
          },
        );
      }

      // The rider of this driver's active ride sees the position live (throttled in the notifier).
      if (profile.activeRideId && notifier) {
        await notifier.driverMoved({
          driverId: profile._id,
          bookingId: profile.activeRideId,
          lat: input.lat,
          lng: input.lng,
          ...(input.headingDegrees !== undefined ? { headingDegrees: input.headingDegrees } : {}),
          ...(input.accuracyMeters !== undefined ? { accuracyMeters: input.accuracyMeters } : {}),
          recordedAt: t,
        });
      }
      return { recordedAt: t };
    },
  };
}

export type PresenceService = ReturnType<typeof createPresenceService>;
