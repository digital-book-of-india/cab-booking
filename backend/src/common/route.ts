import type { Request, RequestHandler } from 'express';
import { ok } from './response';

export type Out = { data: unknown; status?: number; meta?: Record<string, unknown> };

/** Wrap a handler that returns data, so each route is one line. Errors propagate to the error handler. */
export const h =
  (fn: (req: Request) => Promise<Out>): RequestHandler =>
  async (req, res) => {
    const out = await fn(req);
    ok(res, out.data, out.status ?? 200, out.meta);
  };

/** A paged service result as a response. */
export const paged = <T>(r: { items: T[]; meta: object }): Out => ({
  data: r.items,
  meta: { ...r.meta },
});
