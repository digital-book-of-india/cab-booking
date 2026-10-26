import type { Logger } from 'pino';
import { Booking } from '../bookings/booking.model';
import { Ride } from '../rides/ride.model';
import type { LedgerService } from '../ledger/ledger.service';
import { Notification } from '../notifications/notification.model';
import { Invoice } from '../corporate/corporate.models';
import { Payment } from '../payments/payment.model';
import { Payout } from '../payouts/payout.model';
import { Settlement } from '../settlements/settlement.model';
import { WebhookEvent } from '../payments/webhookEvent.model';
import { SafetyIncident } from '../safety/safety.models';

export type Check = {
  name: string;
  ok: boolean;
  /** How many things are wrong (0 when fine). */
  count: number;
  /** One sentence a person can act on. */
  detail: string;
};

export type MonitorConfig = {
  /** A search that has been running this long is stuck (the search itself gives up after a few minutes). */
  stuckDispatchMs: number;
  /** A city ride still in progress after this long was probably never ended (rentals and outstation trips are expected to run long). */
  cityRideOverrunMs: number;
  /** A scheduled ride this far past its pickup time still waiting means the job that starts them is not working. */
  scheduledOverdueMs: number;
  /** An SOS still OPEN this long means escalation did not work either. */
  unackedSosMs: number;
  /** Push messages waiting longer than this are not being delivered. */
  pushBacklogMs: number;
  /** A webhook received but never finished, or a paid payment missing from the ledger, after this long. */
  moneyGraceMs: number;
  /** A background job that has not succeeded for this many of its own intervals is considered dead. */
  jobMissedIntervals: number;
  /** Server errors (5xx): alert when at least this many happened in the last 5 minutes... */
  errorMinCount: number;
  /** ...and they are at least this share of all requests. */
  errorRatio: number;
  /** The same alert is repeated at most this often while it stays broken. */
  alertCooldownMs: number;
};

export const defaultMonitorConfig: MonitorConfig = {
  stuckDispatchMs: 10 * 60_000,
  cityRideOverrunMs: 6 * 3_600_000,
  scheduledOverdueMs: 10 * 60_000,
  unackedSosMs: 5 * 60_000,
  pushBacklogMs: 5 * 60_000,
  moneyGraceMs: 10 * 60_000,
  jobMissedIntervals: 5,
  errorMinCount: 5,
  errorRatio: 0.05,
  alertCooldownMs: 30 * 60_000,
};

type JobBeat = { intervalMs: number; lastOkAt: number | null; lastFailAt: number | null };

/**
 * Looks for the things that mean "a person must act now": money that does not add up, searches and
 * alerts that are stuck, background jobs that stopped. `run` is called on a timer; it alerts when a
 * check starts failing, repeats at most every `alertCooldownMs`, and says when it recovers.
 * Alerts go to the log (always) and, if configured, to a webhook (Slack/Discord-style `{ text }`).
 */
export function createMonitorService(deps: {
  ledger: Pick<LedgerService, 'checkBalance'>;
  /** Requests and server errors over the last N minutes (this instance). */
  errorWindow?: (minutes: number) => { requests: number; serverErrors: number };
  logger: Logger;
  now: () => Date;
  config?: Partial<MonitorConfig>;
  alertWebhookUrl?: string | undefined;
  environment?: string;
  fetchFn?: typeof fetch;
}) {
  const config = { ...defaultMonitorConfig, ...deps.config };
  const { logger, now } = deps;
  const doFetch = deps.fetchFn ?? fetch;
  const beats = new Map<string, JobBeat>();
  const lastAlert = new Map<string, number>(); // check name -> when we last alerted
  const failing = new Set<string>();

  const ago = (ms: number) => new Date(now().getTime() - ms);

  async function checks(): Promise<Check[]> {
    const result: Check[] = [];
    const add = (name: string, count: number, detail: (n: number) => string) =>
      result.push({ name, ok: count === 0, count, detail: count === 0 ? 'OK' : detail(count) });

    const balance = await deps.ledger.checkBalance();
    add(
      'ledger_balanced',
      (balance.ledgerTotalPaise === 0 ? 0 : 1) +
        balance.unbalancedTransactions.length +
        balance.completedRidesWithoutAccrual,
      () =>
        `Ledger total ${balance.ledgerTotalPaise} paise, ${balance.unbalancedTransactions.length} unbalanced transactions, ${balance.completedRidesWithoutAccrual} completed rides without money recorded. Open /admin/finance/consistency.`,
    );

    add(
      'dispatch_stuck',
      await Booking.countDocuments({
        status: 'DISPATCHING',
        updatedAt: { $lte: ago(config.stuckDispatchMs) },
      }),
      (n) =>
        `${n} booking(s) have been searching for a driver for more than ${config.stuckDispatchMs / 60_000} minutes.`,
    );

    const longRides = await Ride.find({
      startedAt: { $lte: ago(config.cityRideOverrunMs) },
      completedAt: null,
    })
      .select('bookingId')
      .limit(500)
      .lean();
    add(
      'rides_overrunning',
      longRides.length === 0
        ? 0
        : await Booking.countDocuments({
            _id: { $in: longRides.map((r) => r.bookingId) },
            status: 'IN_PROGRESS',
            tripKind: { $nin: ['RENTAL', 'OUTSTATION'] },
          }),
      (n) =>
        `${n} city ride(s) have been in progress for more than ${config.cityRideOverrunMs / 3_600_000} hours. The driver may have forgotten to end them.`,
    );

    add(
      'corporate_invoices_overdue',
      await Invoice.countDocuments({ status: 'ISSUED', dueAt: { $lt: now() } }),
      (n) =>
        `${n} company invoice(s) are past their due date and unpaid. See GET /admin/corporate-invoices?overdue=true.`,
    );

    add(
      'scheduled_rides_overdue',
      await Booking.countDocuments({
        status: 'SCHEDULED',
        scheduledFor: { $lte: ago(config.scheduledOverdueMs) },
      }),
      (n) =>
        `${n} scheduled ride(s) are past their pickup time and the search never started. Check the scheduled-rides job.`,
    );

    add(
      'sos_unacknowledged',
      await SafetyIncident.countDocuments({
        status: 'OPEN',
        createdAt: { $lte: ago(config.unackedSosMs) },
      }),
      (n) =>
        `${n} SOS alert(s) still OPEN after ${config.unackedSosMs / 60_000} minutes. Someone must take them NOW.`,
    );

    add(
      'push_backlog',
      await Notification.countDocuments({
        status: 'PENDING',
        nextAttemptAt: { $lte: ago(config.pushBacklogMs) },
      }),
      (n) =>
        `${n} push message(s) have been waiting more than ${config.pushBacklogMs / 60_000} minutes.`,
    );

    add(
      'webhooks_unfinished',
      await WebhookEvent.countDocuments({
        outcome: { $exists: false },
        receivedAt: { $lte: ago(config.moneyGraceMs) },
      }),
      (n) => `${n} payment webhook(s) were received but never finished processing.`,
    );

    add(
      'payments_not_in_ledger',
      await Payment.countDocuments({
        status: 'PAID',
        ledgerRecordedAt: { $exists: false },
        paidAt: { $lte: ago(config.moneyGraceMs) },
      }),
      (n) =>
        `${n} paid payment(s) are not recorded in the ledger after ${config.moneyGraceMs / 60_000} minutes.`,
    );

    // A payout nobody has an answer for, one that has been "on its way" over a day, or a settlement
    // whose payout failed and was not retried: a person has to look.
    const [unanswered, slow, failed] = await Promise.all([
      Payout.countDocuments({ status: 'CREATED', updatedAt: { $lte: ago(config.moneyGraceMs) } }),
      Payout.countDocuments({ status: 'PROCESSING', updatedAt: { $lte: ago(24 * 3_600_000) } }),
      (async () => {
        const rows = await Payout.find({ status: { $in: ['FAILED', 'REVERSED'] } })
          .sort({ createdAt: -1 })
          .limit(50)
          .lean();
        let n = 0;
        for (const p of rows) {
          const open = await Settlement.exists({ _id: p.settlementId, status: 'APPROVED' });
          const retried = await Payout.exists({
            settlementId: p.settlementId,
            status: { $in: ['CREATED', 'PROCESSING', 'PAID'] },
          });
          if (open && !retried) n += 1;
        }
        return n;
      })(),
    ]);
    add(
      'payouts_need_attention',
      unanswered + slow + failed,
      () =>
        `${unanswered} payout(s) not answered, ${slow} on their way for over a day, ${failed} failed and not retried. See GET /admin/payouts.`,
    );

    const errs = deps.errorWindow?.(5) ?? { requests: 0, serverErrors: 0 };
    const elevated =
      errs.serverErrors >= config.errorMinCount &&
      errs.serverErrors / Math.max(1, errs.requests) >= config.errorRatio;
    add(
      'error_rate',
      elevated ? errs.serverErrors : 0,
      (n) =>
        `${n} server errors out of ${errs.requests} requests in the last 5 minutes. Check the log for "unhandled error".`,
    );

    const dead = [...beats.entries()].filter(([, b]) => {
      const reference = b.lastOkAt ?? startedAt;
      return now().getTime() - reference > b.intervalMs * config.jobMissedIntervals;
    });
    add(
      'jobs_alive',
      dead.length,
      () => `Background job(s) not succeeding: ${dead.map(([n]) => n).join(', ')}.`,
    );

    return result;
  }

  const startedAt = now().getTime();

  /** Log the alert and send it to the webhook. True only when the webhook accepted it. */
  async function notify(text: string): Promise<boolean> {
    logger.error({ alert: true }, text);
    if (!deps.alertWebhookUrl) return false;
    try {
      const res = await doFetch(deps.alertWebhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `[${deps.environment ?? 'cab-booking'}] ${text}` }),
        signal: AbortSignal.timeout(5000),
      });
      // A deleted or wrong webhook answers with an error status: that is not a delivered alert.
      if (!res.ok) {
        logger.warn({ status: res.status }, 'the alert webhook refused the message');
        return false;
      }
      return true;
    } catch {
      // The log line above is the fallback; never let a dead webhook break the monitor.
      logger.warn('could not deliver an alert to the webhook');
      return false;
    }
  }

  return {
    /** Called by the background job runner after every run of a job. */
    recordJob(name: string, intervalMs: number, ok: boolean) {
      const b = beats.get(name) ?? { intervalMs, lastOkAt: null, lastFailAt: null };
      if (ok) b.lastOkAt = now().getTime();
      else b.lastFailAt = now().getTime();
      b.intervalMs = intervalMs;
      beats.set(name, b);
    },

    checks,

    /** Sends a harmless test message through the real alert path, so the channel can be proven before it is needed. */
    async testAlert(): Promise<{ webhookConfigured: boolean; delivered: boolean }> {
      const delivered = await notify(
        `TEST ALERT: nothing is wrong. Sent by staff at ${now().toISOString()} to prove alerts reach this channel.`,
      );
      return { webhookConfigured: Boolean(deps.alertWebhookUrl), delivered };
    },

    async report() {
      const list = await checks();
      return {
        ok: list.every((c) => c.ok),
        checkedAt: now(),
        checks: list,
        jobs: [...beats.entries()].map(([name, b]) => ({
          name,
          intervalMs: b.intervalMs,
          lastOkAt: b.lastOkAt ? new Date(b.lastOkAt) : null,
          lastFailAt: b.lastFailAt ? new Date(b.lastFailAt) : null,
        })),
      };
    },

    /** One monitoring pass: alert on new or lasting trouble, announce recovery. */
    async run(): Promise<{ alerted: string[]; recovered: string[] }> {
      const list = await checks();
      const alerted: string[] = [];
      const recovered: string[] = [];
      for (const c of list) {
        if (!c.ok) {
          const last = lastAlert.get(c.name) ?? 0;
          if (!failing.has(c.name) || now().getTime() - last >= config.alertCooldownMs) {
            failing.add(c.name);
            lastAlert.set(c.name, now().getTime());
            alerted.push(c.name);
            await notify(`ALERT ${c.name}: ${c.detail}`);
          }
        } else if (failing.has(c.name)) {
          failing.delete(c.name);
          lastAlert.delete(c.name);
          recovered.push(c.name);
          await notify(`RECOVERED ${c.name}`);
        }
      }
      return { alerted, recovered };
    },
  };
}

export type MonitorService = ReturnType<typeof createMonitorService>;
