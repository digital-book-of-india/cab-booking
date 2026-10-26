import type { RequestHandler } from 'express';
import { ok } from '../../common/response';
import { auditListQuerySchema } from './audit.schemas';
import type { AuditService } from './audit.service';

export function createAuditController(service: AuditService) {
  const list: RequestHandler = async (req, res) => {
    const { items, meta } = await service.list(auditListQuerySchema.parse(req.query));
    ok(res, items, 200, meta);
  };
  return { list };
}
