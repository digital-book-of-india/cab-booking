import type { Types } from 'mongoose';
import { z } from 'zod';
import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import { pageMeta, paginationSchema } from '../../common/pagination';
import { objectId } from '../../common/zod';
import type { AuditService } from '../audit/audit.service';
import { ServiceZone } from '../zones/serviceZone.model';
import { DEFAULT_POLICY, type PolicySnapshot } from './cancellation';
import { CancellationPolicy } from './cancellationPolicy.model';

const MAX_VERSION_RETRIES = 5;
const BACKDATE_TOLERANCE_MS = 60_000;
const paise = z.number().int().min(0).max(10_000_000);
const seconds = z.number().int().min(0).max(86_400);

export const createPolicySchema = z
  .object({
    zoneId: objectId,
    freeCancelWindowSeconds: seconds,
    cancelFeePaise: paise,
    noShowWaitSeconds: seconds,
    noShowFeePaise: paise,
    effectiveFrom: z.coerce.date().optional(),
    changeReason: z.string().trim().min(3).max(300),
  })
  .strict();

export const listPoliciesQuerySchema = paginationSchema.extend({ zoneId: objectId.optional() });

export type CreatePolicyInput = z.infer<typeof createPolicySchema>;
export type ListPoliciesQuery = z.infer<typeof listPoliciesQuerySchema>;

const view = (p: {
  _id: { toString(): string };
  zoneId: { toString(): string };
  version: number;
  freeCancelWindowSeconds: number;
  cancelFeePaise: number;
  noShowWaitSeconds: number;
  noShowFeePaise: number;
  effectiveFrom: Date;
  changeReason: string;
  createdAt: Date;
}) => ({
  id: p._id.toString(),
  zoneId: p.zoneId.toString(),
  version: p.version,
  freeCancelWindowSeconds: p.freeCancelWindowSeconds,
  cancelFeePaise: p.cancelFeePaise,
  noShowWaitSeconds: p.noShowWaitSeconds,
  noShowFeePaise: p.noShowFeePaise,
  effectiveFrom: p.effectiveFrom,
  changeReason: p.changeReason,
  createdAt: p.createdAt,
});

export function createCancellationPolicyService(deps: { audit: AuditService; now: () => Date }) {
  /** The rules a booking made at `at` in this zone will carry. Falls back to the built-in default. */
  async function activeSnapshot(
    zoneId: string | Types.ObjectId,
    at: Date,
  ): Promise<PolicySnapshot> {
    const p = await CancellationPolicy.findOne({ zoneId, effectiveFrom: { $lte: at } })
      .sort({ effectiveFrom: -1, version: -1 })
      .lean();
    if (!p) return { ...DEFAULT_POLICY };
    return {
      version: p.version,
      freeCancelWindowSeconds: p.freeCancelWindowSeconds,
      cancelFeePaise: p.cancelFeePaise,
      noShowWaitSeconds: p.noShowWaitSeconds,
      noShowFeePaise: p.noShowFeePaise,
    };
  }

  return {
    activeSnapshot,

    async create(actor: Actor, input: CreatePolicyInput) {
      const now = deps.now();
      const effectiveFrom = input.effectiveFrom ?? now;
      if (effectiveFrom.getTime() < now.getTime() - BACKDATE_TOLERANCE_MS) {
        throw new AppError('UNPROCESSABLE', undefined, [
          { field: 'effectiveFrom', message: 'Cannot be in the past' },
        ]);
      }
      if (!(await ServiceZone.exists({ _id: input.zoneId }))) {
        throw new AppError('UNPROCESSABLE', undefined, [
          { field: 'zoneId', message: 'Unknown zone' },
        ]);
      }
      // The unique (zone, version) index makes concurrent creators collide instead of sharing a number.
      for (let attempt = 0; attempt < MAX_VERSION_RETRIES; attempt++) {
        const latest = await CancellationPolicy.findOne({ zoneId: input.zoneId })
          .sort({ version: -1 })
          .select('version')
          .lean();
        try {
          const created = await CancellationPolicy.create({
            ...input,
            effectiveFrom,
            version: (latest?.version ?? 0) + 1,
            createdBy: actor.userId,
          });
          await deps.audit.record(actor, {
            action: 'pricing.cancellation_policy.create',
            targetType: 'CancellationPolicy',
            targetId: created.id,
            metadata: {
              zoneId: input.zoneId,
              version: created.version,
              reason: input.changeReason,
            },
          });
          return view(created.toObject());
        } catch (err) {
          if ((err as { code?: number }).code !== 11000) throw err;
        }
      }
      throw new AppError('CONFLICT', 'Could not allocate a policy version. Please retry.');
    },

    async list(query: ListPoliciesQuery) {
      const { page, limit, zoneId } = query;
      const filter = zoneId ? { zoneId } : {};
      const [total, rows] = await Promise.all([
        CancellationPolicy.countDocuments(filter),
        CancellationPolicy.find(filter)
          .sort({ zoneId: 1, version: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);
      return { items: rows.map(view), meta: pageMeta(page, limit, total) };
    },
  };
}

export type CancellationPolicyService = ReturnType<typeof createCancellationPolicyService>;
