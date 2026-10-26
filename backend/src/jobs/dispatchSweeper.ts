import type { Logger } from 'pino';
import type { DispatchService } from '../modules/dispatch/dispatch.service';

/**
 * Runs dispatch housekeeping on intervals.
 *  - sweep (fast): expires stale offers and advances searches.
 *  - reconcile (slow): repairs half-finished writes and sets silent drivers OFFLINE.
 *
 * Both are database-driven (no Redis/BullMQ) so dispatch works with only MongoDB. They are safe on
 * several instances at once: every step is a conditional update. When Redis is available the sweep
 * can be replaced by BullMQ delayed jobs without touching DispatchService.
 */
export function startDispatchSweeper(
  dispatch: Pick<DispatchService, 'sweep' | 'reconcile'>,
  logger: Logger,
  intervals: {
    sweepMs?: number;
    reconcileMs?: number;
    pushMs?: number;
    documentsMs?: number;
    financeMs?: number;
  } = {},
  push?: { deliverDue: () => Promise<unknown> },
  documents?: { run: () => Promise<unknown> },
  finance?: { run: () => Promise<unknown> },
  extra: { name: string; ms: number; run: () => Promise<unknown> }[] = [],
  /** Told after every run of every job (used by the monitor to notice a job that stopped). */
  heartbeat?: (name: string, intervalMs: number, ok: boolean) => void,
): { stop: () => void } {
  const every = (name: string, ms: number, job: () => Promise<unknown>) => {
    let running = false;
    const timer = setInterval(async () => {
      if (running) return; // never overlap with a slow previous pass
      running = true;
      try {
        await job();
        heartbeat?.(name, ms, true);
      } catch (err) {
        heartbeat?.(name, ms, false);
        logger.error({ err }, `dispatch ${name} failed`);
      } finally {
        running = false;
      }
    }, ms);
    timer.unref();
    return timer;
  };
  const timers = [
    every('sweep', intervals.sweepMs ?? 2000, () => dispatch.sweep()),
    every('reconcile', intervals.reconcileMs ?? 15_000, () => dispatch.reconcile()),
    // Push delivery: sends what the request path wrote to the outbox, with retries.
    ...(push ? [every('push delivery', intervals.pushMs ?? 2000, () => push.deliverDue())] : []),
    ...extra.map((job) => every(job.name, job.ms, job.run)),
    // Money repair: payments, ledger accruals, cash and settlements that a crash left half-done.
    ...(finance
      ? [every('finance repair', intervals.financeMs ?? 60_000, () => finance.run())]
      : []),
    // Driver document reminders and expiry: every 10 minutes is plenty for a daily-scale rule.
    ...(documents
      ? [every('document expiry', intervals.documentsMs ?? 600_000, () => documents.run())]
      : []),
  ];
  return { stop: () => timers.forEach((t) => clearInterval(t)) };
}
