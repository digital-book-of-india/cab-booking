import { Router, type RequestHandler } from 'express';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import { createBookingsController } from './bookings.controller';
import { BOOKING_ADMIN_ROLES, type BookingsService } from './bookings.service';

export function bookingsRouter(
  ctx: ModuleContext,
  service: BookingsService,
  writeLimiter: RequestHandler,
): Router {
  const r = Router();
  const c = createBookingsController(service);

  r.post('/bookings', ctx.authenticate, requireRole('CUSTOMER'), writeLimiter, c.create);
  r.get('/bookings', ctx.authenticate, requireRole('CUSTOMER'), c.list);
  r.patch(
    '/bookings/:bookingId/schedule',
    ctx.authenticate,
    requireRole('CUSTOMER'),
    writeLimiter,
    c.reschedule,
  );
  // Owner or support staff; the service narrows customers to their own bookings.
  const readers = [ctx.authenticate, requireRole('CUSTOMER', ...BOOKING_ADMIN_ROLES)];
  r.get('/bookings/:bookingId', ...readers, c.get);
  r.get('/bookings/:bookingId/events', ...readers, c.events);

  return r;
}
