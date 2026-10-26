import type { RequestHandler } from 'express';
import type { Logger } from 'pino';
import type { Providers } from './providers';
import type { AuditService } from './modules/audit/audit.service';

/** Shared dependencies handed to module routers. Keeps modules free of globals. */
export type ModuleContext = {
  logger: Logger;
  providers: Providers;
  audit: AuditService;
  authenticate: RequestHandler;
  /** Injectable clock so time-dependent rules (quote expiry, operating hours) are testable. */
  now: () => Date;
};
