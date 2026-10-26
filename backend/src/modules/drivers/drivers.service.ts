import { randomUUID } from 'node:crypto';
import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import type { DriverApprovalStatus } from '../../common/enums';
import { pageMeta } from '../../common/pagination';
import { escapeRegex } from '../../common/zod';
import type { StorageProvider } from '../../providers';
import type { AuditService } from '../audit/audit.service';
import { User } from '../users/user.model';
import { Vehicle } from '../vehicles/vehicle.model';
import { DriverProfile } from './driverProfile.model';
import { DriverDocument } from './driverDocument.model';
import { DOCUMENT_LABELS, missingRequiredDocuments } from './documents';
import type {
  ApplicationInput,
  ApprovalInput,
  DocumentInput,
  DocumentReviewInput,
  DriverListQuery,
} from './drivers.schemas';

const MAX_DOCUMENTS = 20;
/** A scanned licence or RC photo is well under this; anything bigger is refused. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Resolve the caller's own driver profile. Always keyed by the authenticated user id. */
export async function requireDriverProfile(userId: string) {
  const profile = await DriverProfile.findOne({ userId });
  if (!profile) throw new AppError('NOT_FOUND', 'Driver profile not found.');
  return profile;
}

export type DriverDecision = ApprovalInput['decision'];

/** decision -> resulting status and the statuses it may be applied from. */
export const DECISIONS: Record<
  DriverDecision,
  {
    to: 'APPROVED' | 'REJECTED' | 'NEEDS_RESUBMISSION' | 'SUSPENDED';
    from: DriverApprovalStatus[];
  }
> = {
  APPROVE: { to: 'APPROVED', from: ['PENDING', 'NEEDS_RESUBMISSION', 'SUSPENDED'] },
  REJECT: { to: 'REJECTED', from: ['PENDING', 'NEEDS_RESUBMISSION'] },
  REQUEST_RESUBMISSION: { to: 'NEEDS_RESUBMISSION', from: ['PENDING'] },
  SUSPEND: { to: 'SUSPENDED', from: ['APPROVED'] },
};

type DocLean = {
  _id: { toString(): string };
  type: string;
  status?: string | null;
  documentNumberLast4?: string | null;
  expiresAt?: Date | null;
  rejectionReason?: string | null;
  createdAt: Date;
};

const docView = (d: DocLean) => ({
  id: d._id.toString(),
  type: d.type,
  status: d.status,
  documentNumberLast4: d.documentNumberLast4 ?? null,
  expiresAt: d.expiresAt ?? null,
  rejectionReason: d.rejectionReason ?? null,
  createdAt: d.createdAt,
});

export function createDriversService(deps: {
  storage: StorageProvider;
  audit: AuditService;
  now?: () => Date;
}) {
  const { storage, audit } = deps;
  const now = deps.now ?? (() => new Date());

  /** Is the file there, a sensible size, and of the type that was declared? */
  async function uploadProblem(
    objectKey: string,
    declaredType?: string | null,
  ): Promise<{ message: string; delete: boolean } | null> {
    const stat = await storage.statObject(objectKey);
    if (!stat.exists) return { message: 'the file has not been uploaded yet.', delete: false };
    if (stat.sizeBytes <= 0) return { message: 'the uploaded file is empty.', delete: true };
    if (stat.sizeBytes > MAX_UPLOAD_BYTES) {
      return {
        message: `the file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
        delete: true,
      };
    }
    if (
      declaredType &&
      stat.contentType &&
      stat.contentType.split(';')[0]!.trim() !== declaredType
    ) {
      return { message: 'the file is not the type that was declared.', delete: true };
    }
    return null;
  }

  return {
    /* ---------- Driver (self) ---------- */

    async submitApplication(userId: string, input: ApplicationInput) {
      const profile = await requireDriverProfile(userId);
      // Atomic: only a never-submitted application, or one sent back for resubmission, may be (re)submitted.
      const updated = await DriverProfile.findOneAndUpdate(
        {
          _id: profile._id,
          $or: [{ applicationSubmittedAt: null }, { approvalStatus: 'NEEDS_RESUBMISSION' }],
        },
        {
          $set: {
            city: input.city,
            applicationSubmittedAt: new Date(),
            approvalStatus: 'PENDING',
          },
          $unset: { decisionReason: 1 },
        },
        { returnDocument: 'after' },
      );
      if (!updated) throw new AppError('CONFLICT', 'Application has already been submitted.');
      await User.updateOne({ _id: userId }, { name: input.fullName });
      return {
        driverId: updated.id,
        approvalStatus: updated.approvalStatus,
        submittedAt: updated.applicationSubmittedAt,
      };
    },

    async getApplication(userId: string) {
      const profile = await requireDriverProfile(userId);
      const [documents, vehicleCount] = await Promise.all([
        DriverDocument.find({ driverId: profile._id }).sort({ createdAt: -1 }).lean(),
        Vehicle.countDocuments({ driverId: profile._id }),
      ]);
      return {
        driverId: profile.id,
        approvalStatus: profile.approvalStatus,
        submittedAt: profile.applicationSubmittedAt ?? null,
        decisionReason: profile.decisionReason ?? null,
        city: profile.city ?? null,
        documents: documents.map(docView),
        vehicleCount,
      };
    },

    async addDocument(userId: string, input: DocumentInput) {
      const profile = await requireDriverProfile(userId);
      if (profile.approvalStatus === 'SUSPENDED') {
        throw new AppError('FORBIDDEN', 'Account suspended.');
      }
      if ((await DriverDocument.countDocuments({ driverId: profile._id })) >= MAX_DOCUMENTS) {
        throw new AppError('UNPROCESSABLE', 'Document limit reached.');
      }
      // Object key is generated server-side; the client never chooses where files live.
      const objectKey = `private/driver-docs/${profile.id}/${randomUUID()}`;
      const doc = await DriverDocument.create({
        driverId: profile._id,
        type: input.type,
        objectKey,
        documentNumberLast4: input.documentNumberLast4,
        expiresAt: input.expiresAt,
        contentType: input.contentType,
      });
      const upload = await storage.createUploadUrl(objectKey, input.contentType);
      return { document: docView(doc.toObject()), upload };
    },

    /**
     * The app says the file is uploaded. We look in storage: it must be there, not too big, and of
     * the declared type. A file that is not acceptable is deleted so it cannot be approved later.
     */
    async confirmUpload(userId: string, documentId: string) {
      const profile = await requireDriverProfile(userId);
      const doc = await DriverDocument.findOne({ _id: documentId, driverId: profile._id });
      if (!doc) throw new AppError('NOT_FOUND', 'Document not found.');
      const problem = await uploadProblem(doc.objectKey, doc.contentType);
      if (problem) {
        if (problem.delete) await storage.deleteObject(doc.objectKey).catch(() => undefined);
        throw new AppError('UNPROCESSABLE', undefined, [
          { field: 'file', message: problem.message },
        ]);
      }
      await DriverDocument.updateOne({ _id: doc._id }, { uploadVerifiedAt: new Date() });
      return docView((await DriverDocument.findById(doc._id))!.toObject());
    },

    async listDocuments(userId: string) {
      const profile = await requireDriverProfile(userId);
      const docs = await DriverDocument.find({ driverId: profile._id })
        .sort({ createdAt: -1 })
        .lean();
      return docs.map(docView);
    },

    /* ---------- Admin / reviewers ---------- */

    async list(query: DriverListQuery) {
      const { page, limit, approvalStatus, q } = query;
      const filter: Record<string, unknown> = {};
      if (approvalStatus) filter['approvalStatus'] = approvalStatus;
      if (q) {
        const rx = new RegExp(escapeRegex(q), 'i');
        const matches = await User.find({ role: 'DRIVER', $or: [{ phone: rx }, { name: rx }] })
          .select('_id')
          .lean();
        filter['userId'] = { $in: matches.map((u) => u._id) };
      }
      const [total, profiles] = await Promise.all([
        DriverProfile.countDocuments(filter),
        DriverProfile.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);
      const users = await User.find({ _id: { $in: profiles.map((p) => p.userId) } }).lean();
      const byId = new Map(users.map((u) => [u._id.toString(), u]));
      return {
        items: profiles.map((p) => {
          const u = byId.get(p.userId.toString());
          return {
            driverId: p._id.toString(),
            userId: p.userId.toString(),
            name: u?.name ?? null,
            phone: u?.phone ?? null,
            approvalStatus: p.approvalStatus,
            onlineStatus: p.onlineStatus,
            city: p.city ?? null,
            submittedAt: p.applicationSubmittedAt ?? null,
            createdAt: p.createdAt,
          };
        }),
        meta: pageMeta(page, limit, total),
      };
    },

    async detail(actor: Actor, driverId: string) {
      const profile = await DriverProfile.findById(driverId).lean();
      if (!profile) throw new AppError('NOT_FOUND');
      const [user, docs, vehicles] = await Promise.all([
        User.findById(profile.userId).lean(),
        DriverDocument.find({ driverId }).sort({ createdAt: -1 }).lean(),
        Vehicle.find({ driverId }).lean(),
      ]);
      const documents = await Promise.all(
        docs.map(async (d) => ({
          ...docView(d),
          downloadUrl: (await storage.createDownloadUrl(d.objectKey)).url,
        })),
      );
      // Viewing KYC documents is itself an audited action.
      await audit.record(actor, {
        action: 'driver.view',
        targetType: 'DriverProfile',
        targetId: driverId,
        metadata: { documentCount: docs.length },
      });
      return {
        driverId,
        name: user?.name ?? null,
        phone: user?.phone ?? null,
        accountStatus: user?.accountStatus ?? null,
        approvalStatus: profile.approvalStatus,
        onlineStatus: profile.onlineStatus,
        city: profile.city ?? null,
        submittedAt: profile.applicationSubmittedAt ?? null,
        decisionReason: profile.decisionReason ?? null,
        documents,
        vehicles: vehicles.map((v) => ({
          id: v._id.toString(),
          registrationNumber: v.registrationNumber,
          categoryId: v.categoryId.toString(),
          verificationStatus: v.verificationStatus,
        })),
      };
    },

    async decide(actor: Actor, driverId: string, input: ApprovalInput) {
      const rule = DECISIONS[input.decision];
      const profile = await DriverProfile.findOne({ _id: driverId });
      if (!profile) throw new AppError('NOT_FOUND');
      if (input.decision === 'APPROVE' && !profile.applicationSubmittedAt) {
        throw new AppError('UNPROCESSABLE', 'Driver has not submitted an application.');
      }
      if (input.decision === 'APPROVE') {
        // Nobody drives without a current, approved licence, RC, insurance and ID proof.
        const missing = await missingRequiredDocuments(profile._id, now());
        if (missing.length > 0) {
          throw new AppError(
            'UNPROCESSABLE',
            `Missing or expired required documents: ${missing.map((t) => DOCUMENT_LABELS[t]).join(', ')}.`,
            missing.map((t) => ({
              field: `documents.${t}`,
              message: 'No current approved document',
            })),
          );
        }
      }

      const set: Record<string, unknown> = {
        approvalStatus: rule.to,
        reviewedAt: new Date(),
        reviewedBy: actor.userId,
      };
      const update: Record<string, unknown> = { $set: set };
      if (input.decision === 'APPROVE') {
        // An approval clears any earlier rejection/suspension reason.
        update['$unset'] = { decisionReason: 1 };
      } else {
        set['decisionReason'] = input.reason;
        set['onlineStatus'] = 'OFFLINE';
      }
      // Atomic conditional update: the decision only applies if the status hasn't changed under us.
      const updated = await DriverProfile.findOneAndUpdate(
        { _id: driverId, approvalStatus: { $in: rule.from } },
        update,
        { returnDocument: 'after' },
      );
      if (!updated) {
        throw new AppError(
          'CONFLICT',
          `Cannot ${input.decision} a driver whose status is ${profile.approvalStatus}.`,
        );
      }
      await audit.record(actor, {
        action: `driver.${input.decision.toLowerCase()}`,
        targetType: 'DriverProfile',
        targetId: driverId,
        metadata: {
          from: profile.approvalStatus,
          to: updated.approvalStatus,
          reason: input.reason,
        },
      });
      return {
        driverId,
        approvalStatus: updated.approvalStatus,
        decisionReason: updated.decisionReason ?? null,
      };
    },

    async reviewDocument(
      actor: Actor,
      driverId: string,
      documentId: string,
      input: DocumentReviewInput,
    ) {
      if (input.status === 'APPROVED') {
        // Never approve a file nobody can see: it must really be in storage, and acceptable.
        const existing = await DriverDocument.findOne({ _id: documentId, driverId });
        if (existing) {
          const problem = await uploadProblem(existing.objectKey, existing.contentType);
          if (problem) {
            throw new AppError('CONFLICT', `This document cannot be approved: ${problem.message}`);
          }
        }
      }
      const doc = await DriverDocument.findOneAndUpdate(
        { _id: documentId, driverId },
        {
          status: input.status,
          reviewedBy: actor.userId,
          reviewedAt: new Date(),
          ...(input.status === 'REJECTED'
            ? { rejectionReason: input.reason }
            : { $unset: { rejectionReason: 1 } }),
        },
        { returnDocument: 'after' },
      ).lean();
      if (!doc) throw new AppError('NOT_FOUND');
      if (input.status === 'APPROVED') {
        // The newly approved document is the current one: older copies of the same type retire.
        await DriverDocument.updateMany(
          {
            driverId,
            type: doc.type,
            _id: { $ne: doc._id },
            status: { $in: ['APPROVED', 'PENDING'] },
            createdAt: { $lte: doc.createdAt },
          },
          { status: 'SUPERSEDED' },
        );
      }
      await audit.record(actor, {
        action: `driver.document.${input.status.toLowerCase()}`,
        targetType: 'DriverDocument',
        targetId: documentId,
        metadata: { driverId, type: doc.type, reason: input.reason },
      });
      return docView(doc);
    },
  };
}

export type DriversService = ReturnType<typeof createDriversService>;
