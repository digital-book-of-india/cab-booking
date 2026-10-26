import { Router } from 'express';
import { CONFIG_ROLES } from '../../common/enums';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import { createPricingController } from './pricing.controller';
import type { PricingService } from './pricing.service';

export function pricingRouter(ctx: ModuleContext, service: PricingService): Router {
  const r = Router();
  const c = createPricingController(service);
  const admin = [ctx.authenticate, requireRole(...CONFIG_ROLES)];

  // Fare configs are append-only: a price change is a new version (no PATCH).
  r.post('/admin/pricing/configs', ...admin, c.create);
  r.get('/admin/pricing/configs', ...admin, c.list);
  r.get('/admin/pricing/configs/active', ...admin, c.active);

  return r;
}
