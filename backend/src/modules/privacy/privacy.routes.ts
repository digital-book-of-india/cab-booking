import { Router } from 'express';
import { z } from 'zod';
import { actorFrom } from '../../common/actor';
import { h } from '../../common/route';
import { objectId } from '../../common/zod';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import { deletionSchema, staffDeleteSchema, type PrivacyService } from './privacy.service';

/** Your data, and the right to have your account deleted. */
export function privacyRouter(ctx: ModuleContext, privacy: PrivacyService): Router {
  const r = Router();
  const people = [ctx.authenticate, requireRole('CUSTOMER', 'DRIVER')];
  const uid = (req: Parameters<typeof actorFrom>[0]) => actorFrom(req).userId;

  r.get(
    '/me/data-export',
    ...people,
    h(async (req) => ({ data: await privacy.exportData(uid(req)) })),
  );
  r.get(
    '/me/deletion',
    ...people,
    h(async (req) => ({ data: await privacy.status(uid(req)) })),
  );
  r.post(
    '/me/deletion',
    ...people,
    h(async (req) => {
      deletionSchema.parse(req.body);
      return { data: await privacy.requestDeletion(uid(req)), status: 201 };
    }),
  );
  r.delete(
    '/me/deletion',
    ...people,
    h(async (req) => ({ data: await privacy.cancelDeletion(uid(req)) })),
  );
  r.post(
    '/admin/users/:userId/delete',
    ctx.authenticate,
    requireRole('SUPER_ADMIN'),
    h(async (req) => ({
      data: await privacy.deleteNow(
        actorFrom(req),
        z.string().pipe(objectId).parse(req.params['userId']),
        staffDeleteSchema.parse(req.body).reason,
      ),
    })),
  );
  return r;
}
