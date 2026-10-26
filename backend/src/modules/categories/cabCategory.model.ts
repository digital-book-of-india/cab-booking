import { Schema, model } from 'mongoose';

const cabCategorySchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    capacity: { type: Number, required: true, min: 1, max: 20 },
    active: { type: Boolean, default: true },
    displayOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const CabCategory = model('CabCategory', cabCategorySchema);
