import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { AppError } from '../../common/errors';
import type { ModuleContext } from '../../context';
import { limiterStore } from '../../middleware/limiterStore';
import { requireRole } from '../../middleware/auth';
import { createLocationsController } from './locations.controller';
import type { LocationsService } from './locations.service';

export function locationsRouter(
  ctx: ModuleContext,
  service: LocationsService,
  perMinute = 60,
): Router {
  const r = Router();
  const c = createLocationsController(service);
  // Every call here costs money at the maps provider, so each signed-in user gets a ceiling.
  // Its own counter name, so it never shares a count with the booking limiter.
  const limit = rateLimit({
    ...limiterStore('locations'),
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? ''),
    handler: (_req, _res, next) => next(new AppError('RATE_LIMITED')),
  });
  const people = [ctx.authenticate, requireRole('CUSTOMER', 'DRIVER'), limit];

  r.post('/locations/autocomplete', ...people, c.autocomplete);
  r.post('/locations/place', ...people, c.place);
  r.post('/locations/reverse-geocode', ...people, c.reverseGeocode);
  r.post('/routes/estimate', ...people, c.estimateRoute);
  return r;
}
