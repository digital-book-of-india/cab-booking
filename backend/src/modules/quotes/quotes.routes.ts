import { Router, type RequestHandler } from 'express';
import { requireRole } from '../../middleware/auth';
import type { ModuleContext } from '../../context';
import { createQuotesController } from './quotes.controller';
import type { QuotesService } from './quotes.service';

export function quotesRouter(
  ctx: ModuleContext,
  service: QuotesService,
  writeLimiter: RequestHandler,
): Router {
  const r = Router();
  const c = createQuotesController(service);
  const customerOnly = [ctx.authenticate, requireRole('CUSTOMER')];

  // Public: lets an app show "we're not in your area" before login.
  r.get('/serviceability', c.serviceability);

  r.post('/fare-quotes', ...customerOnly, writeLimiter, c.create);
  r.get('/fare-quotes/:quoteId', ...customerOnly, c.get);
  r.post('/fare-quotes/:quoteId/refresh', ...customerOnly, writeLimiter, c.refresh);

  return r;
}
