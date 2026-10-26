import { z } from 'zod';
import { paginationSchema } from '../../common/pagination';
import { objectId } from '../../common/zod';
import { RoundingModes } from './fareConfig.model';

const paise = (max = 10_000_000) => z.number().int().min(0).max(max);

export const createFareConfigSchema = z
  .object({
    zoneId: objectId,
    categoryId: objectId,
    baseFarePaise: paise(),
    perKmPaise: paise(1_000_000),
    perMinutePaise: paise(1_000_000),
    minimumFarePaise: paise(),
    freeWaitingSeconds: z.number().int().min(0).max(3600).default(180),
    waitingPerMinutePaise: paise(1_000_000).default(0),
    roundingMode: z.enum(RoundingModes).default('NEAREST_RUPEE'),
    effectiveFrom: z.coerce.date().optional(),
    changeReason: z.string().trim().min(3).max(300),
  })
  .strict();

export const listFareConfigsQuerySchema = paginationSchema.extend({
  zoneId: objectId.optional(),
  categoryId: objectId.optional(),
});

export const activeFareConfigQuerySchema = z.object({ zoneId: objectId, categoryId: objectId });

export type CreateFareConfigInput = z.infer<typeof createFareConfigSchema>;
export type ListFareConfigsQuery = z.infer<typeof listFareConfigsQuerySchema>;
