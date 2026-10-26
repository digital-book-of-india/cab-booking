import type { Types } from 'mongoose';
import { REQUIRED_DOCUMENT_TYPES, type DocumentType } from '../../common/enums';
import { DriverDocument } from './driverDocument.model';

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  DRIVING_LICENCE: 'driving licence',
  VEHICLE_RC: 'vehicle registration certificate',
  INSURANCE: 'insurance',
  PERMIT: 'permit',
  ID_PROOF: 'ID proof',
  PROFILE_PHOTO: 'profile photo',
};

/**
 * The required document types for which this driver has no CURRENT document: one that is approved
 * and has not expired. A single rule shared by approval, going online and the expiry job.
 */
export async function missingRequiredDocuments(
  driverId: Types.ObjectId | string,
  at: Date,
): Promise<DocumentType[]> {
  const docs = await DriverDocument.find({
    driverId,
    status: 'APPROVED',
    type: { $in: REQUIRED_DOCUMENT_TYPES },
  })
    .select('type expiresAt')
    .lean();
  const valid = new Set(
    docs
      .filter((d) => !d.expiresAt || d.expiresAt.getTime() > at.getTime())
      .map((d) => d.type as DocumentType),
  );
  return REQUIRED_DOCUMENT_TYPES.filter((t) => !valid.has(t));
}
