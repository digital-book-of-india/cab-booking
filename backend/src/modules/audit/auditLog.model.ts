import { Schema, model } from 'mongoose';

const auditLogSchema = new Schema(
  {
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actorRole: { type: String },
    action: { type: String, required: true, index: true },
    targetType: { type: String, required: true },
    targetId: { type: String, required: true },
    // Keep small and free of secrets / unnecessary PII.
    metadata: { type: Schema.Types.Mixed },
    requestId: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

// Hardening: Audit logs are strictly immutable and append-only
auditLogSchema.pre(['updateOne', 'updateMany', 'deleteOne', 'deleteMany'], function () {
  throw new Error('Audit logs are immutable append-only records and cannot be modified or deleted.');
});

export const AuditLog = model('AuditLog', auditLogSchema);
