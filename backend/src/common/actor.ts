import type { Request } from 'express';
import { AppError } from './errors';
import type { Role } from './enums';

/** Who is performing an action. Built from the authenticated request, passed down to services. */
export type Actor = { userId: string; role: Role; requestId: string };

export function actorFrom(req: Request): Actor {
  if (!req.auth) throw new AppError('UNAUTHENTICATED');
  return { userId: req.auth.userId, role: req.auth.role, requestId: req.id };
}
