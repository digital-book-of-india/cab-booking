import { Router } from 'express';
import { DRIVER_REVIEW_ROLES } from '../../common/enums';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import { createDispatchController } from './dispatch.controller';
import type { DispatchService } from './dispatch.service';

export function dispatchRouter(ctx: ModuleContext, service: DispatchService): Router {
  const r = Router();
  const c = createDispatchController(service);
  const driverOnly = [ctx.authenticate, requireRole('DRIVER')];

  r.get('/drivers/me/offers', ...driverOnly, c.listOffers);
  r.post('/ride-offers/:offerId/accept', ...driverOnly, c.accept);
  r.post('/ride-offers/:offerId/reject', ...driverOnly, c.reject);
  r.post(
    '/bookings/:bookingId/dispatch/retry',
    ctx.authenticate,
    requireRole(...DRIVER_REVIEW_ROLES),
    c.retry,
  );

  return r;
}
