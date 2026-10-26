import { Router } from 'express';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import { createRidesController } from './rides.controller';
import type { RidesService } from './rides.service';

export function ridesRouter(ctx: ModuleContext, service: RidesService): Router {
  const r = Router();
  const c = createRidesController(service);
  const driverOnly = [ctx.authenticate, requireRole('DRIVER')];
  const customerOnly = [ctx.authenticate, requireRole('CUSTOMER')];
  // The service narrows these to the ride's own customer / driver (or support staff).
  const participants = [
    ctx.authenticate,
    requireRole('CUSTOMER', 'DRIVER', 'OPS', 'SUPPORT', 'SUPER_ADMIN'),
  ];

  r.get('/rides/:rideId', ...participants, c.get);
  r.get('/rides/:rideId/receipt', ...participants, c.receipt);

  // Driver actions on their assigned ride
  r.post('/rides/:rideId/en-route', ...driverOnly, c.enRoute);
  r.post('/rides/:rideId/arrived', ...driverOnly, c.arrived);
  r.post('/rides/:rideId/start', ...driverOnly, c.start);
  r.post('/rides/:rideId/complete', ...driverOnly, c.complete);
  r.post('/rides/:rideId/cancel', ...driverOnly, c.driverCancel);
  r.post('/rides/:rideId/no-show', ...driverOnly, c.noShow);
  r.post('/rides/:rideId/stops/:index/arrived', ...driverOnly, c.stopArrived);
  r.post('/rides/:rideId/stops/:index/departed', ...driverOnly, c.stopDeparted);
  r.post('/rides/:rideId/destination/respond', ...driverOnly, c.respondDestination);

  // Customer actions
  r.post('/bookings/:bookingId/cancel', ...customerOnly, c.customerCancel);
  r.get('/bookings/:bookingId/cancel-preview', ...customerOnly, c.cancelPreview);
  r.post('/rides/:rideId/destination', ...customerOnly, c.requestDestination);
  r.get('/rides/:rideId/pickup-otp', ...customerOnly, c.pickupOtp);
  r.post('/rides/:rideId/otp/resend', ...customerOnly, c.resendOtp);
  r.get('/rides/:rideId/track', ...customerOnly, c.track);

  // History
  r.get('/customers/me/rides', ...customerOnly, c.customerHistory);
  r.get('/drivers/me/rides', ...driverOnly, c.driverHistory);

  return r;
}
