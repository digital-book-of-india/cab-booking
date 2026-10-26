import { Router, type Request } from 'express';
import { z } from 'zod';
import { actorFrom } from '../../common/actor';
import { h, paged } from '../../common/route';
import { requireRole } from '../../middleware/auth';
import { SUPPORT_ROLES } from '../../common/enums';
import type { ModuleContext } from '../../context';
import {
  assignSchema,
  createTicketSchema,
  messageSchema,
  resolveTicketSchema,
  staffMessageSchema,
  staffTicketListQuerySchema,
  ticketListQuerySchema,
  updateTicketSchema,
  type SupportService,
} from './support.service';

const ticketId = z.string().regex(/^tkt_[0-9a-f]{12}$/, 'Invalid ticket id');

/** Help requests: riders and drivers raise and follow them; support staff work the queue. */
export function supportRouter(ctx: ModuleContext, support: SupportService): Router {
  const r = Router();
  const people = [ctx.authenticate, requireRole('CUSTOMER', 'DRIVER')];
  const desk = [ctx.authenticate, requireRole(...SUPPORT_ROLES)];
  const tid = (req: Request) => ticketId.parse(req.params['ticketId']);

  r.post(
    '/support/tickets',
    ...people,
    h(async (req) => ({
      data: await support.create(actorFrom(req), createTicketSchema.parse(req.body)),
      status: 201,
    })),
  );
  r.get(
    '/support/tickets',
    ...people,
    h(async (req) =>
      paged(await support.listOwn(actorFrom(req), ticketListQuerySchema.parse(req.query))),
    ),
  );
  r.get(
    '/support/tickets/:ticketId',
    ...people,
    h(async (req) => ({ data: await support.getOwn(actorFrom(req), tid(req)) })),
  );
  r.post(
    '/support/tickets/:ticketId/messages',
    ...people,
    h(async (req) => ({
      data: await support.reply(actorFrom(req), tid(req), messageSchema.parse(req.body).text),
      status: 201,
    })),
  );
  r.post(
    '/support/tickets/:ticketId/close',
    ...people,
    h(async (req) => ({ data: await support.close(actorFrom(req), tid(req)) })),
  );

  r.get(
    '/admin/support/tickets',
    ...desk,
    h(async (req) =>
      paged(await support.list(actorFrom(req), staffTicketListQuerySchema.parse(req.query))),
    ),
  );
  r.get(
    '/admin/support/tickets/:ticketId',
    ...desk,
    h(async (req) => ({ data: await support.detail(tid(req)) })),
  );
  r.post(
    '/admin/support/tickets/:ticketId/assign',
    ...desk,
    h(async (req) => ({
      data: await support.assign(
        actorFrom(req),
        tid(req),
        assignSchema.parse(req.body ?? {}).assigneeId,
      ),
    })),
  );
  r.post(
    '/admin/support/tickets/:ticketId/messages',
    ...desk,
    h(async (req) => ({
      data: await support.staffReply(actorFrom(req), tid(req), staffMessageSchema.parse(req.body)),
      status: 201,
    })),
  );
  r.patch(
    '/admin/support/tickets/:ticketId',
    ...desk,
    h(async (req) => ({
      data: await support.update(actorFrom(req), tid(req), updateTicketSchema.parse(req.body)),
    })),
  );
  r.post(
    '/admin/support/tickets/:ticketId/resolve',
    ...desk,
    h(async (req) => ({
      data: await support.resolve(actorFrom(req), tid(req), resolveTicketSchema.parse(req.body)),
    })),
  );
  return r;
}
