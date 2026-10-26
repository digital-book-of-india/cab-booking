import type { Types } from 'mongoose';
import { z } from 'zod';
import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import { pageMeta, paginationSchema } from '../../common/pagination';
import { objectId } from '../../common/zod';
import type { AuditService } from '../audit/audit.service';
import { ServiceZone } from '../zones/serviceZone.model';
import { CommissionConfig } from './commission.model';

const MAX_VERSION_RETRIES = 5;
const BACKDATE_TOLERANCE_MS = 60_000;

export const createCommissionSchema = z
  .object({
    zoneId: objectId,
    // Whole basis points, at most 50%.
    rateBp: z.number().int().min(0).max(5000),
    effectiveFrom: z.coerce.date().optional(),
    changeReason: z.string().trim().min(3).max(300),
  })
  .strict();

export const listCommissionQuerySchema = paginationSchema.extend({ zoneId: objectId.optional() });

export type CreateCommissionInput = z.infer<typeof createCommissionSchema>;
export type ListCommissionQuery = z.infer<typeof listCommissionQuerySchema>;

/** What a booking freezes at the moment it is made. */
export type CommissionSnapshot = { version: number | null; rateBp: number };

const view = (c: {
  _id: { toString(): string };
  zoneId: { toString(): string };
  version: number;
  rateBp: number;
  effectiveFrom: Date;
  changeReason: string;
  createdAt: Date;
}) => ({
  id: c._id.toString(),
  zoneId: c.zoneId.toString(),
  version: c.version,
  rateBp: c.rateBp,
  ratePercent: c.rateBp / 100,
  effectiveFrom: c.effectiveFrom,
  changeReason: c.changeReason,
  createdAt: c.createdAt,
});

export function createCommissionService(deps: {
  audit: AuditService;
  now: () => Date;
  defaultRateBp: number;
}) {
  async function activeSnapshot(
    zoneId: string | Types.ObjectId,
    at: Date,
  ): Promise<CommissionSnapshot> {
    const c = await CommissionConfig.findOne({ zoneId, effectiveFrom: { $lte: at } })
      .sort({ effectiveFrom: -1, version: -1 })
      .lean();
    return c
      ? { version: c.version, rateBp: c.rateBp }
      : { version: null, rateBp: deps.defaultRateBp };
  }

  return {
    activeSnapshot,

    async create(actor: Actor, input: CreateCommissionInput) {
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
      for (let attempt = 0; attempt < MAX_VERSION_RETRIES; attempt++) {
        const latest = await CommissionConfig.findOne({ zoneId: input.zoneId })
          .sort({ version: -1 })
          .select('version')
          .lean();
        try {
          const created = await CommissionConfig.create({
            ...input,
            effectiveFrom,
            version: (latest?.version ?? 0) + 1,
            createdBy: actor.userId,
          });
          await deps.audit.record(actor, {
            action: 'finance.commission.create',
            targetType: 'CommissionConfig',
            targetId: created.id,
            metadata: {
              zoneId: input.zoneId,
              version: created.version,
              rateBp: input.rateBp,
              reason: input.changeReason,
            },
          });
          return view(created.toObject());
        } catch (err) {
          if ((err as { code?: number }).code !== 11000) throw err;
        }
      }
      throw new AppError('CONFLICT', 'Could not allocate a version. Please retry.');
    },

    async list(query: ListCommissionQuery) {
      const { page, limit, zoneId } = query;
      const filter = zoneId ? { zoneId } : {};
      const [total, rows] = await Promise.all([
        CommissionConfig.countDocuments(filter),
        CommissionConfig.find(filter)
          .sort({ zoneId: 1, version: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);
      return { items: rows.map(view), meta: pageMeta(page, limit, total) };
    },
  };
}

export type CommissionService = ReturnType<typeof createCommissionService>;
