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
  r.post('/admin/pricing/preview', ...admin, async (req, res, next) => {
    try {
      const distanceMeters = Number(req.body?.distanceMeters) || 10000;
      const durationSeconds = Number(req.body?.durationSeconds) || 600;
      const active = await service.listConfigs({ page: 1, limit: 1 });
      const first = active.items[0];
      const baseFarePaise = first ? first.baseFarePaise : 5000;
      const perKmPaise = first ? first.perKmPaise : 1200;
      const perMinutePaise = first ? first.perMinutePaise : 200;
      const distanceFarePaise = Math.round((distanceMeters / 1000) * perKmPaise);
      const timeFarePaise = Math.round((durationSeconds / 60) * perMinutePaise);
      const estimatedTotalPaise = baseFarePaise + distanceFarePaise + timeFarePaise;
      res.json({
        success: true,
        data: {
          configVersion: first?.version || 1,
          breakdown: {
            baseFarePaise,
            distanceFarePaise,
            timeFarePaise,
            estimatedTotalPaise,
          },
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return r;
}
