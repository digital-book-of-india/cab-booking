import { Schema, model } from 'mongoose';

/** Every webhook delivery is recorded once, so a redelivered event is recognised and ignored. */
const webhookEventSchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true },
    type: { type: String, required: true },
    outcome: { type: String },
    receivedAt: { type: Date, required: true },
  },
  { timestamps: false },
);
// Old deliveries are not needed for long.
webhookEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 30 * 86400 });

export const WebhookEvent = model('WebhookEvent', webhookEventSchema);
