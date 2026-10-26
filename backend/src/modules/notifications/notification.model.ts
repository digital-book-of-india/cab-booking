import { Schema, model } from 'mongoose';

export const NotificationStatuses = [
  'PENDING',
  'SENDING',
  'SENT',
  'SKIPPED',
  'EXPIRED',
  'FAILED',
] as const;
export type NotificationStatus = (typeof NotificationStatuses)[number];

/** Placeholder retention; the in-app inbox and the delivery log are both removed after this. */
export const NOTIFICATION_RETENTION_DAYS = 30;

/**
 * Both the in-app inbox entry and the push outbox. It is written FIRST, inside the request, and a
 * background worker delivers it, so a push-service outage loses nothing and never slows a ride.
 */
const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true, maxlength: 60 },
    title: { type: String, required: true, maxlength: 100 },
    body: { type: String, required: true, maxlength: 300 },
    // String values only (push-service rule). Never a phone number or an OTP.
    data: { type: Map, of: String },
    // Same event + same user can never produce two notifications.
    dedupeKey: { type: String, required: true, maxlength: 200 },
    priority: { type: String, enum: ['high', 'normal'], default: 'normal' },
    // Past this moment the push is pointless (an expired ride offer) and is dropped.
    expiresAt: { type: Date },
    status: { type: String, enum: NotificationStatuses, default: 'PENDING' },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, required: true },
    // Lease while a worker is sending, so two server instances never send the same push.
    lockUntil: { type: Date },
    sentAt: { type: Date },
    lastError: { type: String, maxlength: 200 },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
notificationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true });
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });
notificationSchema.index({ status: 1, nextAttemptAt: 1 });
notificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: NOTIFICATION_RETENTION_DAYS * 86400 },
);

export const Notification = model('Notification', notificationSchema);
