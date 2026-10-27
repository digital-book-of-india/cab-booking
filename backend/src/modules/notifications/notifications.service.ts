import type { Logger } from 'pino';
import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import { pageMeta } from '../../common/pagination';
import { InvalidPushTokenError, type PushProvider, type SmsProvider } from '../../providers';
import type { AuditService } from '../audit/audit.service';
import { User } from '../users/user.model';
import { Device } from './device.model';
import { Notification } from './notification.model';
import type {
  MarkReadInput,
  NotificationListQuery,
  RegisterDeviceInput,
  TestNotificationInput,
} from './notifications.schemas';

const DUPLICATE_KEY = 11000;
const MAX_DEVICES_PER_USER = 10;
/** Wait before retry 1, 2, 3 ... then give up. */
const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 1_800_000];
const MAX_ATTEMPTS = BACKOFF_MS.length;
const SEND_LEASE_MS = 30_000;
const BATCH = 50;

export type NotifyInput = {
  type: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  /** Same key + same user = one notification, however many times this is called. */
  dedupeKey: string;
  priority?: 'high' | 'normal';
  /** Do not deliver after this moment (e.g. a ride offer that has already expired). */
  expiresAt?: Date;
  ttlSeconds?: number;
};

export type DeliveryReport = {
  sent: number;
  skipped: number;
  expired: number;
  retried: number;
  failed: number;
};

export function createNotificationsService(deps: {
  push: PushProvider;
  sms?: SmsProvider;
  audit?: AuditService;
  now: () => Date;
  logger: Logger;
}) {
  const { push, now, logger } = deps;
  const testRateLimitWindow = new Map<string, number[]>();

  const view = (n: {
    _id: { toString(): string };
    type: string;
    title: string;
    body: string;
    data?: Map<string, string> | Record<string, string> | null;
    readAt?: Date | null;
    createdAt: Date;
  }) => ({
    id: n._id.toString(),
    type: n.type,
    title: n.title,
    body: n.body,
    data: n.data instanceof Map ? Object.fromEntries(n.data) : (n.data ?? {}),
    readAt: n.readAt ?? null,
    createdAt: n.createdAt,
  });

  return {
    /* ---------- devices ---------- */

    async registerDevice(userId: string, input: RegisterDeviceInput) {
      const t = now();
      const upsert = () =>
        Device.findOneAndUpdate(
          { token: input.token },
          {
            // A phone that switches accounts re-binds its token to the new user.
            userId,
            platform: input.platform,
            lastSeenAt: t,
            ...(input.deviceId ? { deviceId: input.deviceId } : {}),
            ...(input.appVersion ? { appVersion: input.appVersion } : {}),
          },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
        );
      let device;
      try {
        device = await upsert();
      } catch (err) {
        // Two registrations of a brand-new token raced; the second just updates the first.
        if ((err as { code?: number }).code !== DUPLICATE_KEY) throw err;
        device = await upsert();
      }
      if (!device) throw new AppError('INTERNAL_ERROR');

      // Same install, rotated token: drop the stale one so the user is not pushed twice.
      if (input.deviceId) {
        await Device.deleteMany({
          userId,
          deviceId: input.deviceId,
          _id: { $ne: device._id },
        });
      }
      // Bound the list so abandoned installs cannot pile up.
      const all = await Device.find({ userId }).sort({ lastSeenAt: -1 }).select('_id').lean();
      if (all.length > MAX_DEVICES_PER_USER) {
        await Device.deleteMany({
          _id: { $in: all.slice(MAX_DEVICES_PER_USER).map((d) => d._id) },
        });
      }
      return {
        id: device._id.toString(),
        platform: device.platform,
        registeredAt: device.createdAt,
      };
    },

    async removeDevice(userId: string, deviceId: string) {
      const res = await Device.deleteOne({ _id: deviceId, userId });
      if (res.deletedCount !== 1) throw new AppError('NOT_FOUND', 'Device not found.');
    },

    /* ---------- inbox ---------- */

    async list(userId: string, query: NotificationListQuery) {
      const { page, limit, unread } = query;
      const filter: Record<string, unknown> = { userId };
      if (unread === true) filter['readAt'] = null;
      if (unread === false) filter['readAt'] = { $ne: null };
      const [total, unreadCount, rows] = await Promise.all([
        Notification.countDocuments(filter),
        Notification.countDocuments({ userId, readAt: null }),
        Notification.find(filter)
          // _id breaks ties: notes created in the same millisecond keep their creation order.
          .sort({ createdAt: -1, _id: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);
      return {
        items: rows.map(view),
        meta: { ...pageMeta(page, limit, total), unreadCount },
      };
    },

    async markRead(userId: string, input: MarkReadInput) {
      const res = await Notification.updateMany(
        { userId, readAt: null, ...(input.ids ? { _id: { $in: input.ids } } : {}) },
        { readAt: now() },
      );
      return { updated: res.modifiedCount };
    },

    /* ---------- sending ---------- */

    /**
     * Record a notification for later delivery. Cheap, and safe to call twice with the same
     * dedupeKey. Never throws: a failure here must not break the ride action that caused it.
     */
    async notify(userId: string, n: NotifyInput): Promise<boolean> {
      try {
        await Notification.create({
          userId,
          type: n.type,
          title: n.title,
          body: n.body,
          ...(n.data ? { data: n.data } : {}),
          dedupeKey: n.dedupeKey,
          priority: n.priority ?? 'normal',
          ...(n.expiresAt ? { expiresAt: n.expiresAt } : {}),
          ...(n.ttlSeconds !== undefined ? { ttlSeconds: n.ttlSeconds } : {}),
          nextAttemptAt: now(),
        });
        return true;
      } catch (err) {
        if ((err as { code?: number }).code !== DUPLICATE_KEY) {
          logger.error({ err, type: n.type }, 'could not record notification');
        }
        return false;
      }
    },

    /**
     * Withdraw a notification that has not been sent yet (e.g. the ride offer it announces was
     * taken or cancelled), so a late worker never delivers something that is no longer true.
     */
    async cancelPending(userId: string, dedupeKey: string): Promise<boolean> {
      const res = await Notification.updateOne(
        { userId, dedupeKey, status: { $in: ['PENDING', 'SENDING'] } },
        { status: 'EXPIRED' },
      );
      return res.modifiedCount === 1;
    },

    /**
     * Deliver everything that is due. Several instances can run this together: each notification
     * is claimed with a conditional update before it is sent.
     */
    async deliverDue(): Promise<DeliveryReport> {
      const report: DeliveryReport = { sent: 0, skipped: 0, expired: 0, retried: 0, failed: 0 };
      for (let i = 0; i < BATCH; i++) {
        const t = now();
        const n = await Notification.findOneAndUpdate(
          {
            $or: [
              {
                status: 'PENDING',
                nextAttemptAt: { $lte: t },
                $or: [{ lockUntil: null }, { lockUntil: { $lte: t } }],
              },
              {
                status: 'SENDING',
                lockUntil: { $lte: t },
              },
            ],
          },
          { status: 'SENDING', lockUntil: new Date(t.getTime() + SEND_LEASE_MS) },
          { returnDocument: 'after' },
        );
        if (!n) break; // nothing due

        if (n.expiresAt && n.expiresAt.getTime() <= t.getTime()) {
          await Notification.updateOne({ _id: n._id }, { status: 'EXPIRED' });
          report.expired += 1;
          continue;
        }

        const devices = await Device.find({ userId: n.userId }).sort({ lastSeenAt: -1 }).lean();
        const ttlSeconds = n.expiresAt
          ? Math.max(1, Math.ceil((n.expiresAt.getTime() - t.getTime()) / 1000))
          : ((n as unknown as { ttlSeconds?: number }).ttlSeconds);
        let delivered = 0;
        let transient: string | null = null;
        for (const d of devices) {
          try {
            await push.send(d.token, {
              title: n.title,
              body: n.body,
              data: {
                type: n.type,
                notificationId: n._id.toString(),
                ...(n.data instanceof Map ? Object.fromEntries(n.data) : (n.data ?? {})),
              },
              priority: n.priority as 'high' | 'normal',
              ...(ttlSeconds !== undefined ? { ttlSeconds } : {}),
            });
            delivered += 1;
          } catch (err) {
            if (err instanceof InvalidPushTokenError) {
              await Device.deleteOne({ _id: d._id }); // a dead token never comes back
            } else {
              transient = err instanceof Error ? err.message : 'push failed';
            }
          }
        }

        if (delivered > 0) {
          // Delivered to at least one device: do not retry, or the others would get it twice.
          await Notification.updateOne(
            { _id: n._id },
            { status: 'SENT', sentAt: now(), $unset: { lockUntil: 1 } },
          );
          report.sent += 1;
        } else if (!transient) {
          await Notification.updateOne({ _id: n._id }, { status: 'SKIPPED' });
          report.skipped += 1; // every token was dead
        } else {
          const attempts = n.attempts + 1;
          if (attempts >= MAX_ATTEMPTS) {
            await Notification.updateOne(
              { _id: n._id },
              { status: 'FAILED', attempts, lastError: transient.slice(0, 200) },
            );
            report.failed += 1;
          } else {
            await Notification.updateOne(
              { _id: n._id },
              {
                status: 'PENDING',
                attempts,
                nextAttemptAt: new Date(t.getTime() + BACKOFF_MS[attempts - 1]!),
                lastError: transient.slice(0, 200),
                $unset: { lockUntil: 1 },
              },
            );
            report.retried += 1;
          }
        }
      }
      return report;
    },

    /* ---------- admin test notification ---------- */

    async sendTestNotification(actor: Actor, input: TestNotificationInput) {
      const adminKey = actor.userId;
      const t = now();
      const windowStart = t.getTime() - 60_000;
      let history = testRateLimitWindow.get(adminKey) ?? [];
      history = history.filter((ts) => ts > windowStart);
      if (history.length >= 10) {
        throw new AppError('RATE_LIMITED', 'Rate limit exceeded: max 10 test notifications per minute.');
      }
      history.push(t.getTime());
      testRateLimitWindow.set(adminKey, history);

      const recipient = await User.findById(input.recipientId);
      if (!recipient) throw new AppError('NOT_FOUND', 'Recipient user not found.');

      let outcome: 'delivered' | 'queued' | 'mock' | 'failed';
      if (input.channel === 'sms') {
        if (!deps.sms) throw new AppError('SERVICE_UNAVAILABLE', 'SMS provider not configured.');
        try {
          await deps.sms.sendText(recipient.phone, `[TEST] ${input.body}`);
          outcome = 'delivered';
        } catch (err: unknown) {
          logger.warn({ err }, 'Test SMS delivery failed');
          outcome = 'failed';
        }
      } else {
        const dedupeKey = `test_${actor.userId}_${t.getTime()}`;
        await Notification.create({
          userId: recipient._id,
          type: 'TEST_NOTIFICATION',
          title: input.title ?? 'Test Notification',
          body: input.body,
          dedupeKey,
          priority: 'high',
          nextAttemptAt: t,
        });
        outcome = 'queued';
      }

      if (deps.audit) {
        await deps.audit.record(actor, {
          action: 'ADMIN_TEST_NOTIFICATION_SENT',
          targetType: 'User',
          targetId: recipient._id.toString(),
          metadata: { channel: input.channel, outcome },
        });
      }

      return {
        success: outcome !== 'failed',
        recipientId: recipient._id.toString(),
        channel: input.channel,
        outcome,
        sentAt: t,
      };
    },
  };
}

export type NotificationsService = ReturnType<typeof createNotificationsService>;
