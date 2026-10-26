import { Router, type Request } from 'express';
import { z } from 'zod';
import { actorFrom } from '../../common/actor';
import { OPS_VIEW_ROLES } from '../../common/enums';
import { h, paged } from '../../common/route';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import {
  hideSchema,
  lowRatingsQuerySchema,
  ratingSchema,
  type RatingsService,
} from './ratings.service';

const rideId = z.string().regex(/^ride_[0-9a-f]{12}$/, 'Invalid ride id');

export function ratingsRouter(ctx: ModuleContext, ratings: RatingsService): Router {
  const r = Router();
  const people = [ctx.authenticate, requireRole('CUSTOMER', 'DRIVER')];
  const staff = [ctx.authenticate, requireRole(...OPS_VIEW_ROLES)];
  const rid = (req: Request) => rideId.parse(req.params['rideId']);

  r.post(
    '/rides/:rideId/rating',
    ...people,
    h(async (req) => ({
      data: await ratings.rate(actorFrom(req), rid(req), ratingSchema.parse(req.body)),
      status: 201,
    })),
  );
  r.get(
    '/rides/:rideId/rating',
    ...people,
    h(async (req) => ({ data: await ratings.mine(actorFrom(req), rid(req)) })),
  );
  r.get(
    '/drivers/me/ratings',
    ctx.authenticate,
    requireRole('DRIVER'),
    h(async (req) => ({ data: await ratings.driverSummary(actorFrom(req).userId) })),
  );
  r.get(
    '/admin/ratings',
    ...staff,
    h(async (req) => paged(await ratings.lowRatings(lowRatingsQuerySchema.parse(req.query)))),
  );
  r.patch(
    '/admin/ratings/:ratingId',
    ctx.authenticate,
    requireRole('OPS', 'SUPER_ADMIN'),
    h(async (req) => ({
      data: await ratings.hide(
        actorFrom(req),
        String(req.params['ratingId']),
        hideSchema.parse(req.body),
      ),
    })),
  );
  return r;
}
