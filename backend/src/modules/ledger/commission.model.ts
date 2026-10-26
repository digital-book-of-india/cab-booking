import { Schema, model } from 'mongoose';

/** The platform's cut of each fare, per zone. Append-only like fares: a change is a new version. */
const commissionConfigSchema = new Schema(
  {
    zoneId: { type: Schema.Types.ObjectId, ref: 'ServiceZone', required: true },
    version: { type: Number, required: true, min: 1 },
    // Basis points: 2000 = 20.00%.
    rateBp: { type: Number, required: true, min: 0, max: 5000 },
    effectiveFrom: { type: Date, required: true },
    changeReason: { type: String, required: true, maxlength: 300 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
commissionConfigSchema.index({ zoneId: 1, version: 1 }, { unique: true });
commissionConfigSchema.index({ zoneId: 1, effectiveFrom: -1 });

export const CommissionConfig = model('CommissionConfig', commissionConfigSchema);
