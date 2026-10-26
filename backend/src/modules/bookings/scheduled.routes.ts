import { Router } from 'express';
import { actorFrom } from '../../common/actor';
import { h } from '../../common/route';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import { staffCancelSchema, type ScheduledService } from './scheduled.service';

/** Staff actions on a ride that is booked for later and still waiting. */
export function scheduledRouter(ctx: ModuleContext, scheduled: ScheduledService) {
  const r = Router();
  r.post(
    '/admin/bookings/:bookingId/scheduled/cancel',
    ctx.authenticate,
    requireRole('OPS', 'SUPPORT', 'SUPER_ADMIN'),
    h(async (req) => ({
      data: await scheduled.cancelByStaff(
        actorFrom(req),
        String(req.params['bookingId']),
        staffCancelSchema.parse(req.body).reason,
      ),
    })),
  );
  r.post(
    '/admin/bookings/:bookingId/scheduled/start-now',
    ctx.authenticate,
    requireRole('OPS', 'SUPER_ADMIN'),
    h(async (req) => ({
      data: await scheduled.startNow(actorFrom(req), String(req.params['bookingId'])),
    })),
  );
  return r;
}
