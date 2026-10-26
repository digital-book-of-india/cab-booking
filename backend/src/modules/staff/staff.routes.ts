import { Router } from 'express';
import { actorFrom } from '../../common/actor';
import { h, paged } from '../../common/route';
import { objectId } from '../../common/zod';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import {
  changeRoleSchema,
  createStaffSchema,
  staffListQuerySchema,
  type StaffService,
} from './staff.service';

/** Staff accounts: super admin only. */
export function staffRouter(ctx: ModuleContext, staff: StaffService): Router {
  const r = Router();
  const root = [ctx.authenticate, requireRole('SUPER_ADMIN')];

  r.get(
    '/admin/staff',
    ...root,
    h(async (req) => paged(await staff.list(staffListQuerySchema.parse(req.query)))),
  );
  r.post(
    '/admin/staff',
    ...root,
    h(async (req) => ({
      data: await staff.create(actorFrom(req), createStaffSchema.parse(req.body)),
      status: 201,
    })),
  );
  r.patch(
    '/admin/staff/:userId/role',
    ...root,
    h(async (req) => ({
      data: await staff.changeRole(
        actorFrom(req),
        objectId.parse(req.params['userId']),
        changeRoleSchema.parse(req.body),
      ),
    })),
  );
  return r;
}
