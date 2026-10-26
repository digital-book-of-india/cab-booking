import { Schema, model } from 'mongoose';

/** A switch staff can flip without a deploy. The set of keys is fixed in code (see flags.service.ts). */
const featureFlagSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    enabled: { type: Boolean, required: true },
    // When set, the flag applies only to these roles (everyone else sees it as off).
    roles: { type: [String], default: [] },
    description: { type: String, maxlength: 200 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const FeatureFlag = model('FeatureFlag', featureFlagSchema);
