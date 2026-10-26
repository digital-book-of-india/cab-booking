import 'express-serve-static-core';
import type { Role } from './enums';

declare module 'express-serve-static-core' {
  interface Request {
    id: string;
    /** Set by the authenticate middleware. Always derived server-side, never from the client. */
    auth?: { userId: string; role: Role; sessionId: string };
  }
}
