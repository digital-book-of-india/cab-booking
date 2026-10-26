import { Router } from 'express';
import { h } from '../../common/route';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import {
  analyticsRangeSchema,
  driversQuerySchema,
  retentionQuerySchema,
  type AnalyticsService,
} from './analytics.service';

/** Management analytics. Money figures are for finance; the rest for operations as well. */
export function analyticsRouter(ctx: ModuleContext, analytics: AnalyticsService): Router {
  const r = Router();
  const ops = [ctx.authenticate, requireRole('OPS', 'FINANCE', 'SUPER_ADMIN')];
  const finance = [ctx.authenticate, requireRole('FINANCE', 'SUPER_ADMIN')];
  r.get(
    '/admin/analytics/demand',
    ...ops,
    h(async (req) => ({ data: await analytics.demand(analyticsRangeSchema.parse(req.query)) })),
  );
  r.get(
    '/admin/analytics/fulfilment',
    ...ops,
    h(async (req) => ({ data: await analytics.fulfilment(analyticsRangeSchema.parse(req.query)) })),
  );
  r.get(
    '/admin/analytics/cancellations',
    ...ops,
    h(async (req) => ({
      data: await analytics.cancellations(analyticsRangeSchema.parse(req.query)),
    })),
  );
  r.get(
    '/admin/analytics/drivers',
    ...ops,
    h(async (req) => ({ data: await analytics.drivers(driversQuerySchema.parse(req.query)) })),
  );
  r.get(
    '/admin/analytics/retention',
    ...ops,
    h(async (req) => ({ data: await analytics.retention(retentionQuerySchema.parse(req.query)) })),
  );
  r.get(
    '/admin/analytics/revenue',
    ...finance,
    h(async (req) => ({ data: await analytics.revenue(analyticsRangeSchema.parse(req.query)) })),
  );
  return r;
}
