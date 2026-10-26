import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { limiterStore } from '../../middleware/limiterStore';
import { z } from 'zod';
import { actorFrom } from '../../common/actor';
import { AppError } from '../../common/errors';
import { SAFETY_ROLES } from '../../common/enums';
import { h, paged } from '../../common/route';
import { objectId } from '../../common/zod';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import {
  contactSchema,
  incidentListQuerySchema,
  noteSchema,
  resolveIncidentSchema,
  sosSchema,
  type SafetyService,
} from './safety.service';

const rideId = z.string().regex(/^ride_[0-9a-f]{12}$/, 'Invalid ride id');
const incidentId = z.string().regex(/^inc_[0-9a-f]{12}$/, 'Invalid incident id');

/** SOS, emergency contacts, trip sharing and the safety team's incident desk. */
export function safetyRouter(ctx: ModuleContext, safety: SafetyService): Router {
  const r = Router();
  const rider = [ctx.authenticate, requireRole('CUSTOMER')];
  const people = [ctx.authenticate, requireRole('CUSTOMER', 'DRIVER')];
  const desk = [ctx.authenticate, requireRole(...SAFETY_ROLES)];
  const uid = (req: Request) => actorFrom(req).userId;
  const rid = (req: Request) => rideId.parse(req.params['rideId']);
  const iid = (req: Request) => incidentId.parse(req.params['incidentId']);

  /* the person in need */
  r.post(
    '/rides/:rideId/sos',
    ...people,
    h(async (req) => ({
      data: await safety.trigger(actorFrom(req), rid(req), sosSchema.parse(req.body ?? {})),
      status: 201,
    })),
  );
  r.get(
    '/rides/:rideId/sos',
    ...people,
    h(async (req) => ({ data: await safety.mine(actorFrom(req), rid(req)) })),
  );
  r.get(
    '/me/emergency-contacts',
    ...people,
    h(async (req) => ({ data: await safety.listContacts(uid(req)) })),
  );
  r.post(
    '/me/emergency-contacts',
    ...people,
    h(async (req) => ({
      data: await safety.addContact(uid(req), contactSchema.parse(req.body)),
      status: 201,
    })),
  );
  r.delete(
    '/me/emergency-contacts/:contactId',
    ...people,
    h(async (req) => {
      await safety.removeContact(uid(req), objectId.parse(req.params['contactId']));
      return { data: { removed: true } };
    }),
  );

  /* trip sharing */
  r.post(
    '/rides/:rideId/share',
    ...rider,
    h(async (req) => ({ data: await safety.share(actorFrom(req), rid(req)), status: 201 })),
  );
  r.delete(
    '/rides/:rideId/share',
    ...rider,
    h(async (req) => ({ data: await safety.stopSharing(actorFrom(req), rid(req)) })),
  );
  // The one endpoint anyone may open (no login): limited per IP so tokens cannot be guessed at speed.
  const publicLimiter = rateLimit({
    ...limiterStore('public-trips'),
    windowMs: 60_000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError('RATE_LIMITED')),
  });
  r.get(
    '/public/trips/:token',
    publicLimiter,
    h(async (req) => ({
      data: await safety.publicTrip(z.string().min(20).max(80).parse(req.params['token'])),
    })),
  );

  /* the safety desk */
  r.get(
    '/admin/incidents',
    ...desk,
    h(async (req) => paged(await safety.list(incidentListQuerySchema.parse(req.query)))),
  );
  r.get(
    '/admin/incidents/:incidentId',
    ...desk,
    h(async (req) => ({ data: await safety.detail(actorFrom(req), iid(req)) })),
  );
  r.get(
    '/admin/incidents/:incidentId/location',
    ...desk,
    h(async (req) => ({ data: await safety.liveLocation(iid(req)) })),
  );
  r.post(
    '/admin/incidents/:incidentId/acknowledge',
    ...desk,
    h(async (req) => ({ data: await safety.acknowledge(actorFrom(req), iid(req)) })),
  );
  r.post(
    '/admin/incidents/:incidentId/notes',
    ...desk,
    h(async (req) => ({
      data: await safety.addNote(actorFrom(req), iid(req), noteSchema.parse(req.body).text),
    })),
  );
  r.post(
    '/admin/incidents/:incidentId/resolve',
    ...desk,
    h(async (req) => ({
      data: await safety.resolve(actorFrom(req), iid(req), resolveIncidentSchema.parse(req.body)),
    })),
  );

  return r;
}
