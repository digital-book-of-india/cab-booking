import { Router } from 'express';
import { FEE_WAIVE_ROLES, OPS_VIEW_ROLES, USER_STATUS_ROLES } from '../../common/enums';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import { createAdminController } from './admin.controller';
import type { AdminService } from './admin.service';

/** Operations views: users, bookings, dashboard. Driver, zone and pricing admin live in their own modules. */
export function adminRouter(ctx: ModuleContext, service: AdminService): Router {
  const r = Router();
  const c = createAdminController(service);
  const view = [ctx.authenticate, requireRole(...OPS_VIEW_ROLES)];

  r.get('/admin/dashboard', ...view, c.dashboard);
  r.get('/admin/users', ...view, c.listUsers);
  r.get('/admin/users/:userId', ...view, c.userDetail);
  r.patch(
    '/admin/users/:userId/status',
    ctx.authenticate,
    requireRole(...USER_STATUS_ROLES),
    c.setUserStatus,
  );
  r.get('/admin/bookings', ...view, c.listBookings);
  r.get('/admin/bookings/:bookingId', ...view, c.bookingDetail);
  r.get('/admin/rides', ...view, c.listBookings);
  r.get('/admin/rides/:bookingId', ...view, c.bookingDetail);
  r.get('/admin/outstanding', ...view, async (req, res, next) => {
    try {
      const { items } = await service.listBookings({ paymentStatus: 'DUE', limit: 100 } as any);
      res.json({
        success: true,
        data: items.map((b: any) => ({
          rideId: b.rideId || b.bookingId,
          bookingId: b.bookingId,
          customerId: b.customer?.userId || b.customerId || 'N/A',
          customerName: b.customer?.name || 'Customer',
          customerPhoneMasked: b.customer?.phone || '+91 ••••• •••••',
          amountDuePaise: b.finalFarePaise || b.estimatedFarePaise || 0,
          status: b.paymentStatus || 'DUE',
          bookingRestriction: b.paymentStatus === 'DUE' ? 'RESTRICTED' : 'ACTIVE',
          completedAt: b.requestedAt || new Date().toISOString(),
        })),
      });
    } catch (err) {
      next(err);
    }
  });
  r.get('/admin/rides/:rideId/trail', ...view, c.rideTrail);
  r.post(
    '/admin/bookings/:bookingId/fee/waive',
    ctx.authenticate,
    requireRole(...FEE_WAIVE_ROLES),
    c.waiveFee,
  );
  r.get('/admin/documents/expiring', ...view, c.expiringDocuments);

  r.post(
    '/admin/customers/:customerId/restrictions',
    ctx.authenticate,
    requireRole(...USER_STATUS_ROLES),
    c.setCustomerBookingRestriction,
  );
  r.get('/admin/drivers/live', ...view, c.liveDrivers);
  r.get('/admin/dispatch/queue', ...view, c.dispatchQueue);
  r.post(
    '/admin/bookings/:bookingId/assign-driver',
    ctx.authenticate,
    requireRole(...USER_STATUS_ROLES),
    c.assignDriver,
  );

  return r;
}
