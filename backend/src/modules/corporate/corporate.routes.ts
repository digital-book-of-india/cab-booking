import { Router, type Request } from 'express';
import { z } from 'zod';
import { actorFrom } from '../../common/actor';
import { h, paged } from '../../common/route';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import { idempotencyKeySchema } from '../bookings/bookings.schemas';
import {
  companyListQuerySchema,
  companyRidesQuerySchema,
  createCompanySchema,
  creditSchema,
  generateInvoiceSchema,
  inviteSchema,
  invoiceListQuerySchema,
  invoicePaymentSchema,
  updateCompanySchema,
  updateMemberSchema,
  type CorporateService,
} from './corporate.service';

const companyId = z.string().regex(/^corp_[0-9a-f]{12}$/, 'Invalid company id');
const invoiceId = z.string().regex(/^inv_[0-9a-f]{12}$/, 'Invalid invoice id');
const membershipId = z.string().regex(/^mem_[0-9a-f]{12}$/, 'Invalid membership id');
const bookingId = z.string().regex(/^bk_[0-9a-f]{12}$/, 'Invalid booking id');

/** Company accounts. Riders and company admins use /corporate/...; finance and operations use /admin/... */
export function corporateRouter(ctx: ModuleContext, corporate: CorporateService): Router {
  const r = Router();
  const rider = [ctx.authenticate, requireRole('CUSTOMER')];
  const finance = [ctx.authenticate, requireRole('FINANCE', 'SUPER_ADMIN')];
  const viewers = [ctx.authenticate, requireRole('OPS', 'SUPPORT', 'FINANCE', 'SUPER_ADMIN')];
  const uid = (req: Request) => actorFrom(req).userId;

  /* ---- the rider and the company admin ---- */
  r.get(
    '/corporate/me',
    ...rider,
    h(async (req) => ({ data: await corporate.me(uid(req)) })),
  );
  r.post(
    '/corporate/invitations/:membershipId/accept',
    ...rider,
    h(async (req) => ({
      data: await corporate.accept(uid(req), membershipId.parse(req.params['membershipId'])),
    })),
  );
  r.post(
    '/corporate/me/leave',
    ...rider,
    h(async (req) => ({ data: await corporate.leave(uid(req)) })),
  );
  r.get(
    '/corporate/employees',
    ...rider,
    h(async (req) => ({ data: await corporate.employees(uid(req)) })),
  );
  r.post(
    '/corporate/employees',
    ...rider,
    h(async (req) => ({
      data: await corporate.invite(uid(req), inviteSchema.parse(req.body)),
      status: 201,
    })),
  );
  r.patch(
    '/corporate/employees/:membershipId',
    ...rider,
    h(async (req) => ({
      data: await corporate.updateMember(
        uid(req),
        membershipId.parse(req.params['membershipId']),
        updateMemberSchema.parse(req.body),
      ),
    })),
  );
  r.get(
    '/corporate/rides',
    ...rider,
    h(async (req) =>
      paged(await corporate.companyRides(uid(req), companyRidesQuerySchema.parse(req.query))),
    ),
  );
  r.get(
    '/corporate/invoices',
    ...rider,
    h(async (req) =>
      paged(await corporate.companyInvoices(uid(req), invoiceListQuerySchema.parse(req.query))),
    ),
  );
  r.get(
    '/corporate/invoices/:invoiceId',
    ...rider,
    h(async (req) => ({
      data: await corporate.companyInvoice(uid(req), invoiceId.parse(req.params['invoiceId'])),
    })),
  );

  /* ---- finance and operations ---- */
  r.post(
    '/admin/corporate',
    ...finance,
    h(async (req) => ({
      data: await corporate.createCompany(actorFrom(req), createCompanySchema.parse(req.body)),
      status: 201,
    })),
  );
  r.get(
    '/admin/corporate',
    ...viewers,
    h(async (req) => paged(await corporate.listCompanies(companyListQuerySchema.parse(req.query)))),
  );
  r.get(
    '/admin/corporate/:companyId',
    ...viewers,
    h(async (req) => ({
      data: await corporate.companyDetail(companyId.parse(req.params['companyId'])),
    })),
  );
  r.patch(
    '/admin/corporate/:companyId',
    ...finance,
    h(async (req) => ({
      data: await corporate.updateCompany(
        actorFrom(req),
        companyId.parse(req.params['companyId']),
        updateCompanySchema.parse(req.body),
      ),
    })),
  );
  r.post(
    '/admin/corporate/:companyId/invoices',
    ...finance,
    h(async (req) => ({
      data: await corporate.generateInvoice(
        actorFrom(req),
        companyId.parse(req.params['companyId']),
        generateInvoiceSchema.parse(req.body),
      ),
      status: 201,
    })),
  );
  r.get(
    '/admin/corporate-invoices',
    ...viewers,
    h(async (req) => paged(await corporate.listInvoices(invoiceListQuerySchema.parse(req.query)))),
  );
  r.get(
    '/admin/corporate-invoices/:invoiceId',
    ...viewers,
    h(async (req) => ({
      data: await corporate.invoiceDetail(invoiceId.parse(req.params['invoiceId'])),
    })),
  );
  r.post(
    '/admin/corporate-invoices/:invoiceId/issue',
    ...finance,
    h(async (req) => ({
      data: await corporate.issueInvoice(actorFrom(req), invoiceId.parse(req.params['invoiceId'])),
    })),
  );
  r.post(
    '/admin/corporate-invoices/:invoiceId/void',
    ...finance,
    h(async (req) => ({
      data: await corporate.voidInvoice(actorFrom(req), invoiceId.parse(req.params['invoiceId'])),
    })),
  );
  r.post(
    '/admin/corporate-invoices/:invoiceId/payments',
    ...finance,
    h(async (req) => ({
      data: await corporate.recordPayment(
        actorFrom(req),
        invoiceId.parse(req.params['invoiceId']),
        invoicePaymentSchema.parse(req.body),
        idempotencyKeySchema.parse(req.header('idempotency-key')),
      ),
      status: 201,
    })),
  );
  r.post(
    '/admin/corporate-bookings/:bookingId/credit',
    ...finance,
    h(async (req) => ({
      data: await corporate.creditBooking(
        actorFrom(req),
        bookingId.parse(req.params['bookingId']),
        creditSchema.parse(req.body),
      ),
    })),
  );
  return r;
}
