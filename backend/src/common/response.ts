import type { Response } from 'express';

export function ok<T>(
  res: Response,
  data: T,
  status = 200,
  meta: Record<string, unknown> = {},
): Response {
  return res.status(status).json({ success: true, data, meta: { requestId: res.req.id, ...meta } });
}
