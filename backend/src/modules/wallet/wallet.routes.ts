import { Router } from 'express';
import { z } from 'zod';
import { actorFrom } from '../../common/actor';
import { h } from '../../common/route';
import { objectId } from '../../common/zod';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import { idempotencyKeySchema } from '../bookings/bookings.schemas';
import type { FlagsService } from '../flags/flags.service';
import type { PaymentsService } from '../payments/payments.service';
import { topupSchema, walletEntriesQuerySchema, type WalletService } from './wallet.service';

const bookingId = z.string().regex(/^bk_[0-9a-f]{12}$/, 'Invalid booking id');

/** The rider's wallet: see it, top it up, pay a ride from it. Staff can look at a rider's wallet. */
export function walletRouter(
  ctx: ModuleContext,
  s: { wallet: WalletService; payments: PaymentsService; flags: FlagsService },
): Router {
  const r = Router();
  const customer = [ctx.authenticate, requireRole('CUSTOMER')];
  const uid = (req: Parameters<typeof actorFrom>[0]) => actorFrom(req).userId;
  const key = (req: { header: (n: string) => string | undefined }) =>
    idempotencyKeySchema.parse(req.header('idempotency-key'));

  r.get(
    '/wallet',
    ...customer,
    h(async (req) => ({
      data: await s.wallet.view(uid(req), walletEntriesQuerySchema.parse(req.query).limit),
    })),
  );

  // Adding money: a normal online payment whose result lands in the wallet instead of paying a ride.
  r.post(
    '/wallet/topups',
    ...customer,
    h(async (req) => {
      await s.flags.assertEnabled('WALLET', 'CUSTOMER');
      const { amountPaise } = topupSchema.parse(req.body);
      await s.wallet.assertCanTopUp(uid(req), amountPaise);
      return {
        data: await s.payments.startAux(uid(req), {
          purpose: 'TOPUP',
          amountPaise,
          idempotencyKey: key(req),
        }),
        status: 201,
      };
    }),
  );

  r.post(
    '/bookings/:bookingId/pay-from-wallet',
    ...customer,
    h(async (req) => {
      await s.flags.assertEnabled('WALLET', 'CUSTOMER');
      return {
        data: await s.payments.payBookingFromWallet(
          uid(req),
          bookingId.parse(req.params['bookingId']),
          key(req),
        ),
        status: 201,
      };
    }),
  );

  r.get(
    '/admin/wallets/:customerId',
    ctx.authenticate,
    requireRole('SUPPORT', 'OPS', 'FINANCE', 'SUPER_ADMIN'),
    h(async (req) => ({
      data: await s.wallet.view(
        objectId.parse(req.params['customerId']),
        walletEntriesQuerySchema.parse(req.query).limit,
      ),
    })),
  );
  return r;
}
