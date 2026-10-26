import { Router } from 'express';
import { AUDIT_ROLES } from '../../common/enums';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import { createAuditController } from './audit.controller';

export function auditRouter(ctx: ModuleContext): Router {
  const r = Router();
  const c = createAuditController(ctx.audit);

  r.get('/admin/audit-logs', ctx.authenticate, requireRole(...AUDIT_ROLES), c.list);

  return r;
}
