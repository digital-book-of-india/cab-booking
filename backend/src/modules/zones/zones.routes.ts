import { Router } from 'express';
import { CONFIG_ROLES } from '../../common/enums';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import { createZonesController } from './zones.controller';
import type { ZonesService } from './zones.service';

export function zonesRouter(ctx: ModuleContext, service: ZonesService): Router {
  const r = Router();
  const c = createZonesController(service);
  const admin = [ctx.authenticate, requireRole(...CONFIG_ROLES)];

  r.get('/admin/zones', ...admin, c.list);
  r.post('/admin/zones', ...admin, c.create);
  r.patch('/admin/zones/:zoneId', ...admin, c.update);

  return r;
}
