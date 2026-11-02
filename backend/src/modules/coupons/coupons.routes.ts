import { Router } from 'express';
import { actorFrom } from '../../common/actor';
import { CONFIG_ROLES } from '../../common/enums';
import { h, paged } from '../../common/route';
import { objectId } from '../../common/zod';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import {
  activeOffersQuerySchema,
  couponListQuerySchema,
  createCouponSchema,
  updateCouponSchema,
  type CouponsService,
} from './coupons.service';

export function couponsRouter(ctx: ModuleContext, coupons: CouponsService): Router {
  const r = Router();
  const admin = [ctx.authenticate, requireRole(...CONFIG_ROLES)];

  // Customer/Rider: list active, eligible promotional offers
  r.get(
    '/coupons/active',
    ctx.authenticate,
    h(async (req) => {
      const actor = actorFrom(req);
      const query = activeOffersQuerySchema.parse(req.query);
      return {
        data: await coupons.listActiveForRider(actor.role, actor.userId, query),
      };
    }),
  );

  // Configuration staff / Admin management
  r.post(
    '/admin/coupons',
    ...admin,
    h(async (req) => ({
      data: await coupons.create(actorFrom(req), createCouponSchema.parse(req.body)),
      status: 201,
    })),
  );
  r.get(
    '/admin/coupons',
    ...admin,
    h(async (req) => paged(await coupons.list(couponListQuerySchema.parse(req.query)))),
  );
  r.patch(
    '/admin/coupons/:couponId',
    ...admin,
    h(async (req) => ({
      data: await coupons.update(
        actorFrom(req),
        objectId.parse(req.params['couponId']),
        updateCouponSchema.parse(req.body),
      ),
    })),
  );
  return r;
}
