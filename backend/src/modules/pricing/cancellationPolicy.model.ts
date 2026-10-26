import { Schema, model } from 'mongoose';

/**
 * Cancellation and no-show rules per zone. Immutable once created: a change is a new version, and
 * each booking keeps a copy of the rules that were in force when it was made.
 */
const cancellationPolicySchema = new Schema(
  {
    zoneId: { type: Schema.Types.ObjectId, ref: 'ServiceZone', required: true },
    version: { type: Number, required: true, min: 1 },
    freeCancelWindowSeconds: { type: Number, required: true, min: 0 },
    cancelFeePaise: { type: Number, required: true, min: 0 },
    noShowWaitSeconds: { type: Number, required: true, min: 0 },
    noShowFeePaise: { type: Number, required: true, min: 0 },
    effectiveFrom: { type: Date, required: true },
    changeReason: { type: String, required: true, maxlength: 300 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
cancellationPolicySchema.index({ zoneId: 1, version: 1 }, { unique: true });
cancellationPolicySchema.index({ zoneId: 1, effectiveFrom: -1 });

export const CancellationPolicy = model('CancellationPolicy', cancellationPolicySchema);
