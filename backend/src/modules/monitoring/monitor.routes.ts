import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { actorFrom } from '../../common/actor';
import { AppError } from '../../common/errors';
import { h } from '../../common/route';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import type { Metrics } from './metrics';
import type { MonitorService } from './monitor.service';

/** Same length check first so the comparison itself is constant time. */
function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * What the monitor and the metrics see right now: for the operations team, and (the Prometheus text)
 * for a metrics tool holding METRICS_TOKEN.
 */
export function monitorRouter(
  ctx: ModuleContext,
  monitor: MonitorService,
  metrics: Metrics,
  metricsToken?: string | undefined,
): Router {
  const r = Router();
  const ops = [ctx.authenticate, requireRole('OPS', 'SUPER_ADMIN')];
  r.get(
    '/admin/system/health',
    ...ops,
    h(async () => ({ data: await monitor.report() })),
  );
  // Proves the alert channel works (and who tested it).
  r.post(
    '/admin/system/test-alert',
    ...ops,
    h(async (req) => {
      await ctx.audit.record(actorFrom(req), {
        action: 'system.test_alert',
        targetType: 'System',
        targetId: 'alerts',
      });
      return { data: await monitor.testAlert() };
    }),
  );
  r.get(
    '/admin/system/metrics',
    ...ops,
    h(async () => ({ data: metrics.snapshot() })),
  );
  // Not a staff login: a metrics tool presents the shared token. Without a configured token it does not exist.
  r.get('/metrics', (req, res, next) => {
    if (!metricsToken) return next(new AppError('NOT_FOUND'));
    const given = (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!sameSecret(given, metricsToken)) return next(new AppError('UNAUTHENTICATED'));
    res.status(200).type('text/plain; version=0.0.4').send(metrics.prometheus());
  });
  return r;
}
