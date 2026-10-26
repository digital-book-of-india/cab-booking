import { Router } from 'express';
import { actorFrom } from '../../common/actor';
import { FLAG_ROLES } from '../../common/enums';
import { h } from '../../common/route';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import { flagKeySchema, setFlagSchema, type FlagsService } from './flags.service';

export function flagsRouter(ctx: ModuleContext, flags: FlagsService): Router {
  const r = Router();
  const staff = [ctx.authenticate, requireRole(...FLAG_ROLES)];

  r.get(
    '/config/flags',
    ctx.authenticate,
    h(async (req) => ({ data: await flags.forRole(actorFrom(req).role) })),
  );
  r.get(
    '/admin/feature-flags',
    ...staff,
    h(async () => ({ data: await flags.list() })),
  );
  r.put(
    '/admin/feature-flags/:key',
    ...staff,
    h(async (req) => ({
      data: await flags.set(
        actorFrom(req),
        flagKeySchema.parse(req.params['key']),
        setFlagSchema.parse(req.body),
      ),
    })),
  );
  return r;
}
