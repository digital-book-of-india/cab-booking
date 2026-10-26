import type { Types } from 'mongoose';
import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import { pageMeta } from '../../common/pagination';
import type { AuditService } from '../audit/audit.service';
import { CabCategory } from '../categories/cabCategory.model';
import { ServiceZone } from '../zones/serviceZone.model';
import { FareConfig } from './fareConfig.model';
import type { CreateFareConfigInput, ListFareConfigsQuery } from './pricing.schemas';

/** An admin may not back-date a price change by more than this (clock skew tolerance). */
const BACKDATE_TOLERANCE_MS = 5 * 60_000;
const MAX_VERSION_RETRIES = 3;

type ConfigLean = {
  _id: { toString(): string };
  zoneId: { toString(): string };
  categoryId: { toString(): string };
  version: number;
  baseFarePaise: number;
  perKmPaise: number;
  perMinutePaise: number;
  minimumFarePaise: number;
  freeWaitingSeconds?: number | null;
  waitingPerMinutePaise?: number | null;
  roundingMode?: string | null;
  effectiveFrom: Date;
  changeReason: string;
  createdAt: Date;
};

export const configView = (c: ConfigLean) => ({
  id: c._id.toString(),
  zoneId: c.zoneId.toString(),
  categoryId: c.categoryId.toString(),
  version: c.version,
  baseFarePaise: c.baseFarePaise,
  perKmPaise: c.perKmPaise,
  perMinutePaise: c.perMinutePaise,
  minimumFarePaise: c.minimumFarePaise,
  freeWaitingSeconds: c.freeWaitingSeconds ?? 0,
  waitingPerMinutePaise: c.waitingPerMinutePaise ?? 0,
  roundingMode: c.roundingMode ?? 'NEAREST_RUPEE',
  effectiveFrom: c.effectiveFrom,
  changeReason: c.changeReason,
  createdAt: c.createdAt,
});

export function createPricingService(deps: { audit: AuditService; now: () => Date }) {
  /** The config in force at `at`: latest effectiveFrom not in the future, highest version wins ties. */
  async function getActiveConfig(
    zoneId: string | Types.ObjectId,
    categoryId: string | Types.ObjectId,
    at: Date,
  ) {
    return FareConfig.findOne({ zoneId, categoryId, effectiveFrom: { $lte: at } })
      .sort({ effectiveFrom: -1, version: -1 })
      .lean();
  }

  return {
    getActiveConfig,

    async createConfig(actor: Actor, input: CreateFareConfigInput) {
      const now = deps.now();
      const effectiveFrom = input.effectiveFrom ?? now;
      if (effectiveFrom.getTime() < now.getTime() - BACKDATE_TOLERANCE_MS) {
        throw new AppError('UNPROCESSABLE', undefined, [
          { field: 'effectiveFrom', message: 'Cannot be in the past' },
        ]);
      }
      const [zone, category] = await Promise.all([
        ServiceZone.exists({ _id: input.zoneId }),
        CabCategory.exists({ _id: input.categoryId }),
      ]);
      if (!zone) {
        throw new AppError('UNPROCESSABLE', undefined, [
          { field: 'zoneId', message: 'Unknown zone' },
        ]);
      }
      if (!category) {
        throw new AppError('UNPROCESSABLE', undefined, [
          { field: 'categoryId', message: 'Unknown category' },
        ]);
      }

      // Versions are per (zone, category). The unique index makes concurrent creators collide
      // instead of silently sharing a version, so retry with the next number.
      for (let attempt = 0; attempt < MAX_VERSION_RETRIES; attempt++) {
        const latest = await FareConfig.findOne({
          zoneId: input.zoneId,
          categoryId: input.categoryId,
        })
          .sort({ version: -1 })
          .select('version')
          .lean();
        try {
          const created = await FareConfig.create({
            ...input,
            effectiveFrom,
            version: (latest?.version ?? 0) + 1,
            createdBy: actor.userId,
          });
          await deps.audit.record(actor, {
            action: 'pricing.config.create',
            targetType: 'FareConfig',
            targetId: created.id,
            metadata: {
              zoneId: input.zoneId,
              categoryId: input.categoryId,
              version: created.version,
              reason: input.changeReason,
            },
          });
          return configView(created.toObject());
        } catch (err) {
          if ((err as { code?: number }).code !== 11000) throw err;
        }
      }
      throw new AppError('CONFLICT', 'Could not allocate a config version. Please retry.');
    },

    async listConfigs(query: ListFareConfigsQuery) {
      const { page, limit, ...filters } = query;
      const filter = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined));
      const [total, rows] = await Promise.all([
        FareConfig.countDocuments(filter),
        FareConfig.find(filter)
          .sort({ zoneId: 1, categoryId: 1, version: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);
      return { items: rows.map(configView), meta: pageMeta(page, limit, total) };
    },

    async previewActive(zoneId: string, categoryId: string) {
      const config = await getActiveConfig(zoneId, categoryId, deps.now());
      if (!config)
        throw new AppError('NOT_FOUND', 'No fare config is active for this zone and category.');
      return configView(config);
    },
  };
}

export type PricingService = ReturnType<typeof createPricingService>;
