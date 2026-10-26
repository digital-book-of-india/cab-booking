import { Schema, model } from 'mongoose';

const serviceZoneSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    cityCode: { type: String, required: true, uppercase: true, trim: true, maxlength: 20 },
    // GeoJSON Polygon, coordinates are [lng, lat]. One outer ring, no holes (MVP).
    polygon: {
      type: { type: String, enum: ['Polygon'], required: true },
      coordinates: { type: [[[Number]]], required: true },
    },
    active: { type: Boolean, default: true },
    // Daily window in Asia/Kolkata local time, "HH:mm". Absent = open 24h. end <= start means overnight.
    operatingHours: {
      start: { type: String },
      end: { type: String },
    },
  },
  { timestamps: true },
);
serviceZoneSchema.index({ polygon: '2dsphere' });

export const ServiceZone = model('ServiceZone', serviceZoneSchema);
