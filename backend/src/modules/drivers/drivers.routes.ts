import { Router } from 'express';
import { DRIVER_REVIEW_ROLES } from '../../common/enums';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import { createDriversController } from './drivers.controller';
import { createDriversService } from './drivers.service';

export function driversRouter(ctx: ModuleContext): Router {
  const r = Router();
  const c = createDriversController(
    createDriversService({ storage: ctx.providers.storage, audit: ctx.audit, now: ctx.now }),
  );
  const driverOnly = [ctx.authenticate, requireRole('DRIVER')];
  const reviewers = [ctx.authenticate, requireRole(...DRIVER_REVIEW_ROLES)];

  // Driver (self)
  r.post('/drivers/applications', ...driverOnly, c.submitApplication);
  r.get('/drivers/me/application', ...driverOnly, c.getApplication);
  r.post('/drivers/me/documents', ...driverOnly, c.addDocument);
  r.post('/drivers/me/documents/:documentId/uploaded', ...driverOnly, c.confirmUpload);
  r.get('/drivers/me/documents', ...driverOnly, c.listDocuments);

  // Admin / reviewers
  r.get('/admin/drivers', ...reviewers, c.list);
  r.get('/admin/drivers/:driverId', ...reviewers, c.detail);
  r.patch('/admin/drivers/:driverId/approval', ...reviewers, c.decide);
  r.patch('/admin/drivers/:driverId/documents/:documentId', ...reviewers, c.reviewDocument);

  return r;
}
