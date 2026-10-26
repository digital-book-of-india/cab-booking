import { Router, type RequestHandler } from 'express';
import { actorFrom } from '../../common/actor';
import { CONFIG_ROLES } from '../../common/enums';
import { ok } from '../../common/response';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import {
  createPolicySchema,
  listPoliciesQuerySchema,
  type CancellationPolicyService,
} from './cancellationPolicy.service';

/** Cancellation and no-show rules per zone. Append-only, like fare configs: a change is a new version. */
export function cancellationPolicyRouter(
  ctx: ModuleContext,
  service: CancellationPolicyService,
): Router {
  const r = Router();
  const admin = [ctx.authenticate, requireRole(...CONFIG_ROLES)];

  const create: RequestHandler = async (req, res) => {
    ok(res, await service.create(actorFrom(req), createPolicySchema.parse(req.body)), 201);
  };
  const list: RequestHandler = async (req, res) => {
    const { items, meta } = await service.list(listPoliciesQuerySchema.parse(req.query));
    ok(res, items, 200, meta);
  };

  r.post('/admin/pricing/cancellation-policies', ...admin, create);
  r.get('/admin/pricing/cancellation-policies', ...admin, list);
  return r;
}
