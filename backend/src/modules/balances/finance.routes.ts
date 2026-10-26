import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { actorFrom } from '../../common/actor';
import { CONFIG_ROLES, type Role } from '../../common/enums';
import { ok } from '../../common/response';
import { objectId } from '../../common/zod';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import { idempotencyKeySchema } from '../bookings/bookings.schemas';
import {
  cashCollectedSchema,
  cashDepositSchema,
  customerCashConfirmSchema,
  type CashService,
} from '../cash/cash.service';
import {
  createCommissionSchema,
  listCommissionQuerySchema,
  type CommissionService,
} from '../ledger/commission.service';
import {
  paymentListQuerySchema,
  refundSchema,
  verifyPaymentSchema,
  type PaymentsService,
} from '../payments/payments.service';
import {
  generateSettlementSchema,
  markPaidSchema,
  settlementListQuerySchema,
  type SettlementsService,
} from '../settlements/settlements.service';
import {
  disputeSchema,
  driverBalancesQuerySchema,
  earningsQuerySchema,
  ledgerQuerySchema,
  writeOffSchema,
  type BalancesService,
} from './balances.service';

const FINANCE: Role[] = ['FINANCE', 'SUPER_ADMIN'];
const PAYMENT_VIEWERS: Role[] = ['FINANCE', 'SUPER_ADMIN', 'OPS', 'SUPPORT'];
const DISPUTERS: Role[] = ['FINANCE', 'SUPER_ADMIN', 'OPS', 'SUPPORT'];

const rideIdSchema = z.string().regex(/^ride_[0-9a-f]{12}$/, 'Invalid ride id');
const bookingIdSchema = z.string().regex(/^bk_[0-9a-f]{12}$/, 'Invalid booking id');
const paymentIdSchema = z.string().regex(/^pay_[0-9a-f]{12}$/, 'Invalid payment id');
const settlementIdSchema = z.string().regex(/^stl_[0-9a-f]{12}$/, 'Invalid settlement id');

/** Money endpoints for riders, drivers and finance staff. */
export function financeRouter(
  ctx: ModuleContext,
  s: {
    payments: PaymentsService;
    cash: CashService;
    settlements: SettlementsService;
    balances: BalancesService;
    commission: CommissionService;
    /** Development-only "pretend the rider paid" endpoint (mock payments outside production). */
    devPayments: boolean;
  },
): Router {
  const r = Router();
  const customer = [ctx.authenticate, requireRole('CUSTOMER')];
  const driver = [ctx.authenticate, requireRole('DRIVER')];
  const staff = (...roles: Role[]) => [ctx.authenticate, requireRole(...roles)];

  const uid = (req: Request) => actorFrom(req).userId;
  const key = (req: Request) => idempotencyKeySchema.parse(req.header('idempotency-key'));
  const h =
    (
      fn: (
        req: Request,
      ) => Promise<{ data: unknown; status?: number; meta?: Record<string, unknown> }>,
    ): RequestHandler =>
    async (req, res) => {
      const out = await fn(req);
      ok(res, out.data, out.status ?? 200, out.meta);
    };

  /* ---------- rider ---------- */
  r.post(
    '/bookings/:bookingId/payments',
    ...customer,
    h(async (req) => ({
      data: await s.payments.start(
        uid(req),
        bookingIdSchema.parse(req.params['bookingId']),
        key(req),
      ),
      status: 201,
    })),
  );
  r.post(
    '/payments/verify',
    ...customer,
    h(async (req) => ({
      data: await s.payments.verify(uid(req), verifyPaymentSchema.parse(req.body)),
    })),
  );
  r.get(
    '/payments/:paymentId',
    ctx.authenticate,
    requireRole('CUSTOMER', 'SUPPORT', 'OPS', 'FINANCE', 'SUPER_ADMIN'),
    h(async (req) => ({
      data: await s.payments.get(actorFrom(req), paymentIdSchema.parse(req.params['paymentId'])),
    })),
  );
  r.get(
    '/customers/me/balance',
    ...customer,
    h(async (req) => ({ data: await s.balances.customerBalance(uid(req)) })),
  );

  if (s.devPayments) {
    r.post(
      '/dev/payments/:paymentId/complete',
      ...customer,
      h(async (req) => ({
        data: await s.payments.devComplete(
          uid(req),
          paymentIdSchema.parse(req.params['paymentId']),
        ),
      })),
    );
  }

  /* ---------- driver ---------- */
  r.post(
    '/rides/:rideId/cash-collected',
    ...driver,
    h(async (req) => ({
      data: await s.cash.collect(
        uid(req),
        rideIdSchema.parse(req.params['rideId']),
        cashCollectedSchema.parse(req.body),
      ),
    })),
  );
  r.post(
    '/rides/:rideId/cash-collection/customer-confirm',
    ...customer,
    h(async (req) => ({
      data: await s.cash.customerConfirm(
        actorFrom(req),
        rideIdSchema.parse(req.params['rideId']),
        customerCashConfirmSchema.parse(req.body),
      ),
    })),
  );
  r.get(
    '/drivers/me/balance',
    ...driver,
    h(async (req) => ({ data: await s.balances.driverBalance(uid(req)) })),
  );
  r.get(
    '/drivers/me/earnings',
    ...driver,
    h(async (req) => {
      const { meta, ...rest } = await s.balances.earnings(
        uid(req),
        earningsQuerySchema.parse(req.query),
      );
      return { data: rest, meta: { ...meta } };
    }),
  );
  r.get(
    '/drivers/me/settlements',
    ...driver,
    h(async (req) => {
      const { items, meta } = await s.settlements.listOwn(
        uid(req),
        settlementListQuerySchema.parse(req.query),
      );
      return { data: items, meta: { ...meta } };
    }),
  );

  /* ---------- staff ---------- */
  r.get(
    '/admin/payments',
    ...staff(...PAYMENT_VIEWERS),
    h(async (req) => {
      const { items, meta } = await s.payments.list(paymentListQuerySchema.parse(req.query));
      return { data: items, meta: { ...meta } };
    }),
  );
  r.post(
    '/admin/bookings/:bookingId/refund',
    ...staff(...FINANCE),
    h(async (req) => ({
      data: await s.payments.refund(
        actorFrom(req),
        bookingIdSchema.parse(req.params['bookingId']),
        refundSchema.parse(req.body),
        key(req),
      ),
      status: 201,
    })),
  );
  r.post(
    '/admin/bookings/:bookingId/write-off',
    ...staff('SUPER_ADMIN'),
    h(async (req) => ({
      data: await s.balances.writeOff(
        actorFrom(req),
        bookingIdSchema.parse(req.params['bookingId']),
        writeOffSchema.parse(req.body),
      ),
    })),
  );
  r.patch(
    '/admin/bookings/:bookingId/payment-dispute',
    ...staff(...DISPUTERS),
    h(async (req) => ({
      data: await s.balances.dispute(
        actorFrom(req),
        bookingIdSchema.parse(req.params['bookingId']),
        disputeSchema.parse(req.body),
      ),
    })),
  );
  r.get(
    '/admin/ledger',
    ...staff(...FINANCE),
    h(async (req) => {
      const { items, meta } = await s.balances.ledgerEntries(ledgerQuerySchema.parse(req.query));
      return { data: items, meta: { ...meta } };
    }),
  );
  r.get(
    '/admin/balances/drivers',
    ...staff(...FINANCE),
    h(async (req) => {
      const { items, meta } = await s.balances.driverBalances(
        driverBalancesQuerySchema.parse(req.query),
      );
      return { data: items, meta: { ...meta } };
    }),
  );
  r.get(
    '/admin/finance/consistency',
    ...staff(...FINANCE),
    h(async () => ({ data: await s.balances.consistency() })),
  );
  r.post(
    '/admin/drivers/:driverId/cash-deposits',
    ...staff(...FINANCE),
    h(async (req) => ({
      data: await s.cash.deposit(
        actorFrom(req),
        objectId.parse(req.params['driverId']),
        cashDepositSchema.parse(req.body),
        key(req),
      ),
      status: 201,
    })),
  );

  /* ---------- settlements ---------- */
  r.post(
    '/admin/settlements',
    ...staff(...FINANCE),
    h(async (req) => ({
      data: await s.settlements.generate(actorFrom(req), generateSettlementSchema.parse(req.body)),
      status: 201,
    })),
  );
  r.get(
    '/admin/settlements',
    ...staff(...FINANCE),
    h(async (req) => {
      const { items, meta } = await s.settlements.list(settlementListQuerySchema.parse(req.query));
      return { data: items, meta: { ...meta } };
    }),
  );
  const sid = (req: Request) => settlementIdSchema.parse(req.params['settlementId']);
  r.get(
    '/admin/settlements/:settlementId',
    ...staff(...FINANCE),
    h(async (req) => ({ data: await s.settlements.detail(sid(req)) })),
  );
  r.post(
    '/admin/settlements/:settlementId/approve',
    ...staff(...FINANCE),
    h(async (req) => ({ data: await s.settlements.approve(actorFrom(req), sid(req)) })),
  );
  r.post(
    '/admin/settlements/:settlementId/mark-paid',
    ...staff(...FINANCE),
    h(async (req) => ({
      data: await s.settlements.markPaid(actorFrom(req), sid(req), markPaidSchema.parse(req.body)),
    })),
  );
  r.post(
    '/admin/settlements/:settlementId/cancel',
    ...staff(...FINANCE),
    h(async (req) => ({ data: await s.settlements.cancel(actorFrom(req), sid(req)) })),
  );

  /* ---------- commission rates ---------- */
  r.post(
    '/admin/pricing/commission',
    ...staff(...CONFIG_ROLES),
    h(async (req) => ({
      data: await s.commission.create(actorFrom(req), createCommissionSchema.parse(req.body)),
      status: 201,
    })),
  );
  r.get(
    '/admin/pricing/commission',
    ...staff(...CONFIG_ROLES),
    h(async (req) => {
      const { items, meta } = await s.commission.list(listCommissionQuerySchema.parse(req.query));
      return { data: items, meta: { ...meta } };
    }),
  );

  return r;
}
