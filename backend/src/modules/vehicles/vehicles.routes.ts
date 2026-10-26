import { Router } from 'express';
import { DRIVER_REVIEW_ROLES } from '../../common/enums';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import { createVehiclesController } from './vehicles.controller';
import { createVehiclesService } from './vehicles.service';

export function vehiclesRouter(ctx: ModuleContext): Router {
  const r = Router();
  const c = createVehiclesController(createVehiclesService({ audit: ctx.audit }));
  const driverOnly = [ctx.authenticate, requireRole('DRIVER')];

  r.post('/drivers/me/vehicles', ...driverOnly, c.create);
  r.get('/drivers/me/vehicles', ...driverOnly, c.listOwn);
  r.patch('/drivers/me/vehicles/:vehicleId', ...driverOnly, c.updateOwn);
  r.patch(
    '/admin/vehicles/:vehicleId/verification',
    ctx.authenticate,
    requireRole(...DRIVER_REVIEW_ROLES),
    c.verify,
  );

  return r;
}
