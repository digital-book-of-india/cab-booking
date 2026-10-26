import type { Actor } from '../../common/actor';
import { pageMeta } from '../../common/pagination';
import { AuditLog } from './auditLog.model';
import type { AuditListQuery } from './audit.schemas';

export type AuditEntry = {
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
};

export function createAuditService() {
  return {
    async record(actor: Actor, entry: AuditEntry): Promise<void> {
      await AuditLog.create({
        actorUserId: actor.userId,
        actorRole: actor.role,
        ...entry,
        requestId: actor.requestId,
      });
    },

    async list(query: AuditListQuery) {
      const { page, limit, ...filters } = query;
      const filter = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined));
      const [total, rows] = await Promise.all([
        AuditLog.countDocuments(filter),
        AuditLog.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);
      return {
        items: rows.map((a) => ({
          id: a._id.toString(),
          actorUserId: a.actorUserId.toString(),
          actorRole: a.actorRole ?? null,
          action: a.action,
          targetType: a.targetType,
          targetId: a.targetId,
          metadata: a.metadata ?? null,
          requestId: a.requestId ?? null,
          createdAt: a.createdAt,
        })),
        meta: pageMeta(page, limit, total),
      };
    },
  };
}

export type AuditService = ReturnType<typeof createAuditService>;
