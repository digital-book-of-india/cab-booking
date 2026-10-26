import { Schema, model } from 'mongoose';

/** People a rider or driver wants told if they trigger an emergency alert. At most 3 per user. */
const emergencyContactSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, required: true },
    relationship: { type: String, trim: true, maxlength: 40 },
  },
  { timestamps: true },
);
emergencyContactSchema.index({ userId: 1, phone: 1 }, { unique: true });

export const EmergencyContact = model('EmergencyContact', emergencyContactSchema);

export const IncidentStatuses = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const;
export const IncidentOutcomes = ['FALSE_ALARM', 'ASSISTED', 'POLICE_INFORMED', 'OTHER'] as const;

const place = new Schema({ lat: Number, lng: Number, label: String }, { _id: false });
const person = new Schema({ name: String, phone: String }, { _id: false });

/**
 * An emergency alert. The ride is NOT stopped or frozen by it: it carries on, and staff are told
 * straight away. The snapshot keeps what staff need even after the ride ends.
 */
const safetyIncidentSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    bookingPublicId: { type: String, required: true },
    ridePublicId: { type: String, required: true },
    triggeredBy: {
      userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      role: { type: String, enum: ['CUSTOMER', 'DRIVER'], required: true },
    },
    note: { type: String, maxlength: 300 },
    status: { type: String, enum: IncidentStatuses, default: 'OPEN' },
    // True while OPEN or ACKNOWLEDGED: one live alert per person per ride.
    open: { type: Boolean, default: true },
    snapshot: {
      bookingStatus: String,
      pickup: place,
      drop: place,
      driverLocation: { lat: Number, lng: Number, at: Date },
      rider: person,
      driver: person,
      vehicle: { registrationNumber: String, make: String, model: String, color: String },
    },
    contactsNotified: { type: Number, default: 0 },
    notes: {
      type: [
        new Schema(
          {
            by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
            text: { type: String, required: true, maxlength: 500 },
            at: { type: Date, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    acknowledgedAt: { type: Date },
    escalatedAt: { type: Date },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },
    outcome: { type: String, enum: IncidentOutcomes },
    outcomeNote: { type: String, maxlength: 500 },
  },
  { timestamps: true },
);
safetyIncidentSchema.index(
  { bookingId: 1, 'triggeredBy.userId': 1 },
  { unique: true, partialFilterExpression: { open: true } },
);
safetyIncidentSchema.index({ status: 1, createdAt: -1 });
safetyIncidentSchema.index({ status: 1, escalatedAt: 1, createdAt: 1 });

export const SafetyIncident = model('SafetyIncident', safetyIncidentSchema);

/** A link the rider can send so others follow the trip. Only a hash of the token is stored. */
const tripShareSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
  },
  { timestamps: true },
);
tripShareSchema.index({ bookingId: 1, revokedAt: 1 });
tripShareSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const TripShare = model('TripShare', tripShareSchema);
