import { Router } from 'express';
import { z } from 'zod';
import { actorFrom } from '../../common/actor';
import { h } from '../../common/route';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import { idempotencyKeySchema } from '../bookings/bookings.schemas';
import { tipSchema, type TipsService } from './tips.service';

const rideId = z.string().regex(/^ride_[0-9a-f]{12}$/, 'Invalid ride id');

export function tipsRouter(ctx: ModuleContext, tips: TipsService): Router {
  const r = Router();
  r.post(
    '/rides/:rideId/tip',
    ctx.authenticate,
    requireRole('CUSTOMER'),
    h(async (req) => ({
      data: await tips.tip(
        actorFrom(req).userId,
        rideId.parse(req.params['rideId']),
        tipSchema.parse(req.body),
        idempotencyKeySchema.parse(req.header('idempotency-key')),
      ),
      status: 201,
    })),
  );
  r.get(
    '/rides/:rideId/tip',
    ctx.authenticate,
    requireRole('CUSTOMER', 'DRIVER'),
    h(async (req) => ({
      data: await tips.forRide(actorFrom(req), rideId.parse(req.params['rideId'])),
    })),
  );
  return r;
}
