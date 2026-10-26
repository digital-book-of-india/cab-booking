import { z } from 'zod';
import { paginationSchema } from '../../common/pagination';
import { objectId } from '../../common/zod';

export const auditListQuerySchema = paginationSchema.extend({
  action: z.string().max(80).optional(),
  targetType: z.string().max(40).optional(),
  targetId: z.string().max(40).optional(),
  actorUserId: objectId.optional(),
});

export type AuditListQuery = z.infer<typeof auditListQuerySchema>;
