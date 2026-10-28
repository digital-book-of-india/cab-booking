import { Router } from 'express';
import { DRIVER_REVIEW_ROLES, OPS_VIEW_ROLES } from '../../common/enums';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import { createVehiclesController } from './vehicles.controller';
import { createVehiclesService } from './vehicles.service';

export function vehiclesRouter(ctx: ModuleContext): Router {
  const r = Router();
  const c = createVehiclesController(createVehiclesService({ audit: ctx.audit }));
  const driverOnly = [ctx.authenticate, requireRole('DRIVER')];
  const reviewers = [ctx.authenticate, requireRole(...DRIVER_REVIEW_ROLES)];

  r.post('/drivers/me/vehicles', ...driverOnly, c.create);
  r.get('/drivers/me/vehicles', ...driverOnly, c.listOwn);
  r.patch('/drivers/me/vehicles/:vehicleId', ...driverOnly, c.updateOwn);
  r.get(
    '/admin/vehicles',
    ctx.authenticate,
    requireRole(...OPS_VIEW_ROLES),
    c.listAdmin,
  );
  r.patch(
    '/admin/vehicles/:vehicleId/verification',
    ctx.authenticate,
    requireRole(...DRIVER_REVIEW_ROLES),
    c.verify,
  );
  r.get('/admin/vehicles', ...reviewers, c.listAll);

  return r;
}
