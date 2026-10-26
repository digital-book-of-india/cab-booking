import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Reuse a well-formed inbound X-Request-Id, otherwise generate one. Echoed in the response. */
export const requestId: RequestHandler = (req, res, next) => {
  const inbound = req.header('x-request-id');
  req.id = inbound && SAFE_ID.test(inbound) ? inbound : `req_${randomUUID()}`;
  res.setHeader('X-Request-Id', req.id);
  next();
};
