import { Schema, model } from 'mongoose';

export const SAVED_PLACE_TYPES = ['home', 'work', 'other'] as const;
export type SavedPlaceType = (typeof SAVED_PLACE_TYPES)[number];

const savedPlaceSchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    type: { type: String, enum: SAVED_PLACE_TYPES, required: true },
    address: { type: String, required: true, trim: true, maxlength: 300 },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },
  },
  { timestamps: true },
);

// Index to list places for a customer fast, newest first.
savedPlaceSchema.index({ customerId: 1, createdAt: -1 });

export const SavedPlace = model('SavedPlace', savedPlaceSchema);

export type SavedPlaceDoc = InstanceType<typeof SavedPlace>;

export function savedPlaceView(doc: {
  _id?: unknown;
  name?: string | null;
  type?: string | null;
  address?: string | null;
  location?: { coordinates?: number[] | null } | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}) {
  const coords = doc.location?.coordinates ?? [0, 0];
  return {
    id: doc._id?.toString() ?? '',
    name: doc.name ?? '',
    type: doc.type ?? 'other',
    address: doc.address ?? '',
    lat: coords[1] ?? 0,
    lng: coords[0] ?? 0,
    createdAt: doc.createdAt ?? new Date(),
    updatedAt: doc.updatedAt ?? new Date(),
  };
}
