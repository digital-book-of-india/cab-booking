import { Schema, model } from 'mongoose';

export const RoundingModes = ['NEAREST_RUPEE', 'NONE'] as const;

/** Immutable once created. A price change is a new version, never an edit. */
const fareConfigSchema = new Schema(
  {
    zoneId: { type: Schema.Types.ObjectId, ref: 'ServiceZone', required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'CabCategory', required: true },
    version: { type: Number, required: true, min: 1 },
    baseFarePaise: { type: Number, required: true, min: 0 },
    perKmPaise: { type: Number, required: true, min: 0 },
    perMinutePaise: { type: Number, required: true, min: 0 },
    minimumFarePaise: { type: Number, required: true, min: 0 },
    freeWaitingSeconds: { type: Number, default: 180, min: 0 },
    waitingPerMinutePaise: { type: Number, default: 0, min: 0 },
    roundingMode: { type: String, enum: RoundingModes, default: 'NEAREST_RUPEE' },
    effectiveFrom: { type: Date, required: true },
    changeReason: { type: String, required: true, maxlength: 300 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
fareConfigSchema.index({ zoneId: 1, categoryId: 1, version: 1 }, { unique: true });
fareConfigSchema.index({ zoneId: 1, categoryId: 1, effectiveFrom: -1 });

export const FareConfig = model('FareConfig', fareConfigSchema);
