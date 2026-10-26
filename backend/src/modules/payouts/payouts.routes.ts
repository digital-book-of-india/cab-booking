import { Router } from 'express';
import { z } from 'zod';
import { actorFrom } from '../../common/actor';
import { h, paged } from '../../common/route';
import { objectId } from '../../common/zod';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import {
  payoutAccountSchema,
  payoutListQuerySchema,
  reviewAccountSchema,
  type PayoutsService,
} from './payouts.service';

const settlementId = z.string().regex(/^stl_[0-9a-f]{12}$/, 'Invalid settlement id');
const payoutId = z.string().regex(/^pyo_[0-9a-f]{12}$/, 'Invalid payout id');

export function payoutsRouter(
  ctx: ModuleContext,
  payouts: PayoutsService,
  options: { devPayments: boolean },
): Router {
  const r = Router();
  const driver = [ctx.authenticate, requireRole('DRIVER')];
  const finance = [ctx.authenticate, requireRole('FINANCE', 'SUPER_ADMIN')];

  /* the driver says where the money should go */
  r.get(
    '/drivers/me/payout-account',
    ...driver,
    h(async (req) => ({ data: await payouts.getOwnAccount(actorFrom(req).userId) })),
  );
  r.put(
    '/drivers/me/payout-account',
    ...driver,
    h(async (req) => ({
      data: await payouts.setOwnAccount(actorFrom(req).userId, payoutAccountSchema.parse(req.body)),
    })),
  );

  /* finance checks the account and sends the money */
  r.get(
    '/admin/drivers/:driverId/payout-account',
    ...finance,
    h(async (req) => ({
      data: await payouts.accountForDriver(objectId.parse(req.params['driverId'])),
    })),
  );
  r.post(
    '/admin/drivers/:driverId/payout-account/review',
    ...finance,
    h(async (req) => ({
      data: await payouts.reviewAccount(
        actorFrom(req),
        objectId.parse(req.params['driverId']),
        reviewAccountSchema.parse(req.body),
      ),
    })),
  );
  r.post(
    '/admin/settlements/:settlementId/payout',
    ...finance,
    h(async (req) => ({
      data: await payouts.send(actorFrom(req), settlementId.parse(req.params['settlementId'])),
      status: 201,
    })),
  );
  r.get(
    '/admin/settlements/:settlementId/payouts',
    ...finance,
    h(async (req) => ({
      data: await payouts.forSettlement(settlementId.parse(req.params['settlementId'])),
    })),
  );
  r.get(
    '/admin/payouts',
    ...finance,
    h(async (req) => paged(await payouts.list(payoutListQuerySchema.parse(req.query)))),
  );

  if (options.devPayments) {
    r.post(
      '/dev/payouts/:payoutId/complete',
      ...finance,
      h(async (req) => ({
        data: await payouts.devComplete(payoutId.parse(req.params['payoutId'])),
      })),
    );
  }
  return r;
}
