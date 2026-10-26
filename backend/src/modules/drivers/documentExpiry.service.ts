import type { Logger } from 'pino';
import {
  DOCUMENT_REMINDER_DAYS,
  REQUIRED_DOCUMENT_TYPES,
  type DocumentType,
} from '../../common/enums';
import type { NotificationsService } from '../notifications/notifications.service';
import { RideOffer } from '../dispatch/rideOffer.model';
import { DOCUMENT_LABELS } from './documents';
import { DriverDocument } from './driverDocument.model';
import { DriverProfile } from './driverProfile.model';

const DAY_MS = 86_400_000;

export type ExpiryReport = { expired: number; reminded: number; driversSetOffline: number };

/**
 * Runs on a timer. Reminds drivers 30, 7 and 1 days before a document expires (each reminder once),
 * and when one expires retires it and takes the driver offline until a new one is approved.
 * Safe to run on several instances at once: every step is a conditional update.
 */
export function createDocumentExpiryService(deps: {
  notifications: Pick<NotificationsService, 'notify'>;
  now: () => Date;
  logger: Logger;
}) {
  const { notifications, now, logger } = deps;
  const label = (type: string) => DOCUMENT_LABELS[type as DocumentType] ?? type.toLowerCase();

  return {
    async run(): Promise<ExpiryReport> {
      const t = now();
      const report: ExpiryReport = { expired: 0, reminded: 0, driversSetOffline: 0 };

      // 1. Expire: an approved document past its date is no longer valid.
      const lapsed = await DriverDocument.find({ status: 'APPROVED', expiresAt: { $lte: t } })
        .select('_id driverId type')
        .limit(500)
        .lean();
      for (const d of lapsed) {
        const retired = await DriverDocument.findOneAndUpdate(
          { _id: d._id, status: 'APPROVED' },
          { status: 'EXPIRED' },
          { returnDocument: 'after' },
        );
        if (!retired) continue; // another instance got there first
        report.expired += 1;
        const profile = await DriverProfile.findById(d.driverId)
          .select('userId onlineStatus activeRideId')
          .lean();
        if (!profile) continue;
        await notifications.notify(profile.userId.toString(), {
          type: 'document.expired',
          title: 'Document expired',
          body: `Your ${label(d.type)} has expired. Upload a new one to keep driving.`,
          data: { documentId: d._id.toString(), documentType: d.type },
          dedupeKey: `doc-expired:${d._id.toString()}`,
        });
        // Required papers: off the road now, unless a ride is under way (they finish it, then
        // cannot go online again until a new document is approved).
        const required = (REQUIRED_DOCUMENT_TYPES as readonly string[]).includes(d.type);
        if (required && profile.onlineStatus === 'ONLINE' && !profile.activeRideId) {
          const off = await DriverProfile.updateOne(
            { _id: d.driverId, onlineStatus: 'ONLINE', activeRideId: null },
            { onlineStatus: 'OFFLINE', $unset: { currentLocation: 1, currentVehicleId: 1 } },
          );
          if (off.modifiedCount === 1) {
            report.driversSetOffline += 1;
            await RideOffer.updateMany(
              { driverId: d.driverId, status: 'PENDING' },
              { status: 'WITHDRAWN', respondedAt: t },
            );
          }
        }
      }

      // 2. Remind: at most one reminder per document per threshold, the closest one that applies.
      const horizon = new Date(t.getTime() + Math.max(...DOCUMENT_REMINDER_DAYS) * DAY_MS);
      const upcoming = await DriverDocument.find({
        status: 'APPROVED',
        expiresAt: { $gt: t, $lte: horizon },
      })
        .select('_id driverId type expiresAt remindersSent')
        .limit(1000)
        .lean();
      for (const d of upcoming) {
        const daysLeft = Math.ceil((d.expiresAt!.getTime() - t.getTime()) / DAY_MS);
        const sent = d.remindersSent ?? [];
        const due = DOCUMENT_REMINDER_DAYS.filter(
          (days) => daysLeft <= days && !sent.includes(days),
        );
        if (due.length === 0) continue;
        const closest = Math.min(...due);
        // Marking first (conditionally) means two instances cannot both send it.
        const marked = await DriverDocument.updateOne(
          { _id: d._id, remindersSent: { $ne: closest } },
          { $addToSet: { remindersSent: { $each: due } } },
        );
        if (marked.modifiedCount !== 1) continue;
        const profile = await DriverProfile.findById(d.driverId).select('userId').lean();
        if (!profile) continue;
        await notifications.notify(profile.userId.toString(), {
          type: 'document.expiring',
          title: 'Document expiring soon',
          body: `Your ${label(d.type)} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Upload a new one to avoid being taken offline.`,
          data: { documentId: d._id.toString(), documentType: d.type, daysLeft: String(daysLeft) },
          dedupeKey: `doc-expiring:${d._id.toString()}:${closest}`,
        });
        report.reminded += 1;
      }

      if (report.expired + report.reminded > 0) logger.info(report, 'document expiry pass');
      return report;
    },
  };
}

export type DocumentExpiryService = ReturnType<typeof createDocumentExpiryService>;
