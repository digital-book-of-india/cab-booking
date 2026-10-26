import { Router } from 'express';
import { ok } from '../../common/response';
import { AppError } from '../../common/errors';

export type ReadinessCheck = { name: string; check: () => Promise<void> };

const CHECK_TIMEOUT_MS = 2000;

function withTimeout(p: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      () => (clearTimeout(t), resolve()),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

export function healthRouter(checks: ReadinessCheck[], isShuttingDown: () => boolean): Router {
  const router = Router();

  // Liveness: the process is up. No dependency checks.
  router.get('/health/live', (_req, res) => {
    ok(res, { status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  });

  // Readiness: dependencies reachable and not draining.
  router.get('/health/ready', async (_req, res, next) => {
    if (isShuttingDown()) {
      return next(new AppError('SERVICE_UNAVAILABLE', 'Service is shutting down.'));
    }
    const results = await Promise.all(
      checks.map(async ({ name, check }) => {
        try {
          await withTimeout(check(), CHECK_TIMEOUT_MS);
          return [name, 'up'] as const;
        } catch {
          return [name, 'down'] as const;
        }
      }),
    );
    const dependencies = Object.fromEntries(results);
    if (results.some(([, s]) => s === 'down')) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'One or more dependencies are unavailable.',
          fieldErrors: [],
          requestId: res.req.id,
        },
        data: { status: 'degraded', dependencies },
      });
    }
    ok(res, { status: 'ready', dependencies });
  });

  return router;
}
