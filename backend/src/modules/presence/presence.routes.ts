import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import { createPresenceController } from './presence.controller';
import type { PresenceService } from './presence.service';

export function presenceRouter(ctx: ModuleContext, service: PresenceService): Router {
  const r = Router();
  const c = createPresenceController(service);
  const driverOnly = [ctx.authenticate, requireRole('DRIVER')];

  r.post('/drivers/me/presence', ...driverOnly, c.setPresence);
  r.get('/drivers/me/presence', ...driverOnly, c.getPresence);
  r.post('/drivers/me/location', ...driverOnly, c.updateLocation);

  return r;
}
