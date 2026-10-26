import { Router } from 'express';
import { CONFIG_ROLES } from '../../common/enums';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import { createCategoriesController } from './categories.controller';
import { createCategoriesService } from './categories.service';

export function categoriesRouter(ctx: ModuleContext): Router {
  const r = Router();
  const c = createCategoriesController(createCategoriesService({ audit: ctx.audit }));
  const admin = [ctx.authenticate, requireRole(...CONFIG_ROLES)];

  r.get('/cab-categories', c.listActive);
  r.get('/admin/cab-categories', ...admin, c.listAll);
  r.post('/admin/cab-categories', ...admin, c.create);
  r.patch('/admin/cab-categories/:categoryId', ...admin, c.update);

  return r;
}
