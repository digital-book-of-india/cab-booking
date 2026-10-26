import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import { createReferralsController } from './referrals.controller';
import type { ReferralsService } from './referrals.service';

export function referralsRouter(ctx: ModuleContext, service: ReferralsService): Router {
  const r = Router();
  const c = createReferralsController(service);
  const customerOnly = [ctx.authenticate, requireRole('CUSTOMER')];

  r.get('/customers/me/referrals', ...customerOnly, c.getMe);
  r.post('/customers/me/referrals/claim', ...customerOnly, c.claim);

  return r;
}
