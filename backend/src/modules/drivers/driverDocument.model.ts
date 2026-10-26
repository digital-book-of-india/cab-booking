import { Schema, model } from 'mongoose';
import { DocumentStatuses, DocumentTypes } from '../../common/enums';

const driverDocumentSchema = new Schema(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'DriverProfile', required: true, index: true },
    type: { type: String, enum: DocumentTypes, required: true },
    // Server-generated key in private object storage. Files are never stored in MongoDB.
    objectKey: { type: String, required: true },
    // What the driver said the file is (and the phone must send exactly this when uploading).
    contentType: { type: String, maxlength: 60 },
    // Set when the server saw the file in storage with an acceptable size and type.
    uploadVerifiedAt: { type: Date },
    // Only the last 4 characters of any document number are kept.
    documentNumberLast4: { type: String, maxlength: 4 },
    status: { type: String, enum: DocumentStatuses, default: 'PENDING' },
    expiresAt: { type: Date },
    // Reminder thresholds (days) already sent for this document, so each is sent once.
    remindersSent: { type: [Number], default: [] },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    rejectionReason: { type: String, maxlength: 500 },
  },
  { timestamps: true },
);

// Review queue / dashboard count by status; one driver's documents by type.
driverDocumentSchema.index({ status: 1, createdAt: 1 });
driverDocumentSchema.index({ driverId: 1, type: 1 });
// Expiry job: approved documents ordered by expiry date.
driverDocumentSchema.index({ status: 1, expiresAt: 1 });

export const DriverDocument = model('DriverDocument', driverDocumentSchema);
