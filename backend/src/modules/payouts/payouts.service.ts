import { createHash } from 'node:crypto';
import type { Types } from 'mongoose';
import { z } from 'zod';
import type { Logger } from 'pino';
import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import { publicId } from '../../common/ids';
import { pageMeta, paginationSchema } from '../../common/pagination';
import { objectId } from '../../common/zod';
import type { PayoutResult, PayoutsProvider } from '../../providers';
import type { AuditService } from '../audit/audit.service';
import { DriverProfile } from '../drivers/driverProfile.model';
import { requireDriverProfile } from '../drivers/drivers.service';
import type { FinanceConfig } from '../ledger/finance.config';
import type { NotificationsService } from '../notifications/notifications.service';
import { WebhookEvent } from '../payments/webhookEvent.model';
import { Settlement } from '../settlements/settlement.model';
import type { SettlementsService } from '../settlements/settlements.service';
import { Payout, PayoutAccount, PayoutStatuses } from './payout.model';

const DUPLICATE_KEY = 11000;
const LIVE = ['CREATED', 'PROCESSING', 'PAID'];

export const payoutAccountSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('BANK'),
      holderName: z.string().trim().min(2).max(100),
      accountNumber: z
        .string()
        .trim()
        .regex(/^\d{9,18}$/, '9 to 18 digits'),
      ifsc: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code'),
    })
    .strict(),
  z
    .object({
      type: z.literal('UPI'),
      holderName: z.string().trim().min(2).max(100),
      vpa: z
        .string()
        .trim()
        .regex(/^[\w.-]{2,64}@[A-Za-z]{2,32}$/, 'Invalid UPI id'),
    })
    .strict(),
]);
export const reviewAccountSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: z.string().trim().min(3).max(300).optional(),
  })
  .strict()
  .refine((v) => v.decision === 'APPROVE' || v.reason, {
    message: 'a reason is required',
    path: ['reason'],
  });
export const payoutListQuerySchema = paginationSchema.extend({
  status: z.enum(PayoutStatuses).optional(),
  driverId: objectId.optional(),
});

export type PayoutAccountInput = z.infer<typeof payoutAccountSchema>;
export type ReviewAccountInput = z.infer<typeof reviewAccountSchema>;
export type PayoutListQuery = z.infer<typeof payoutListQuerySchema>;

type PayoutDoc = {
  _id: Types.ObjectId;
  publicId: string;
  settlementPublicId: string;
  driverId: Types.ObjectId;
  amountPaise: number;
  attempt: number;
  status: string;
  idempotencyKey: string;
  fundAccountId: string;
  providerPayoutId?: string | null;
  utr?: string | null;
  failureReason?: string | null;
  createdAt: Date;
  paidAt?: Date | null;
};

const view = (p: PayoutDoc) => ({
  payoutId: p.publicId,
  settlementId: p.settlementPublicId,
  driverId: p.driverId.toString(),
  amountPaise: p.amountPaise,
  attempt: p.attempt,
  status: p.status,
  utr: p.utr ?? null,
  failureReason: p.failureReason ?? null,
  createdAt: p.createdAt,
  paidAt: p.paidAt ?? null,
});

const maskUpi = (vpa: string) => {
  const [name = '', handle = ''] = vpa.split('@');
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}@${handle}`;
};

/**
 * Sending drivers their money. A payout is one attempt to pay one approved settlement to the
 * driver's verified account. The provider decides the outcome (and tells us by webhook); a repair
 * job re-sends what never got an answer, using the same idempotency key so nothing is paid twice.
 */
export function createPayoutsService(deps: {
  provider: PayoutsProvider;
  settlements: Pick<SettlementsService, 'completeByPayout' | 'reverseByPayout'>;
  notifications: Pick<NotificationsService, 'notify'>;
  audit: AuditService;
  now: () => Date;
  logger: Logger;
  config: FinanceConfig;
}) {
  const { provider, settlements, notifications, audit, now, logger, config } = deps;

  /* ---------------- the driver's payout account ---------------- */

  const accountView = (a: {
    type: string;
    holderName: string;
    maskedNumber: string;
    ifsc?: string | null;
    status: string;
    rejectionReason?: string | null;
    reviewedAt?: Date | null;
    updatedAt?: Date;
  }) => ({
    type: a.type,
    holderName: a.holderName,
    maskedNumber: a.maskedNumber,
    ifsc: a.ifsc ?? null,
    status: a.status,
    rejectionReason: a.rejectionReason ?? null,
    reviewedAt: a.reviewedAt ?? null,
    updatedAt: a.updatedAt ?? null,
  });

  /** A payout lands (or fails). Moves the payout and, when it is paid, the settlement. Safe to repeat. */
  async function applyResult(payout: PayoutDoc, result: PayoutResult): Promise<void> {
    if (result.payoutId && !payout.providerPayoutId) {
      await Payout.updateOne(
        { _id: payout._id, providerPayoutId: { $exists: false } },
        { providerPayoutId: result.payoutId },
      );
    }
    if (result.status === 'processed') {
      const paid = await Payout.findOneAndUpdate(
        { _id: payout._id, status: { $in: ['CREATED', 'PROCESSING'] } },
        { status: 'PAID', paidAt: now(), ...(result.utr ? { utr: result.utr } : {}) },
        { returnDocument: 'after' },
      );
      const current = paid ?? (await Payout.findById(payout._id));
      // Even if it was already marked paid, make sure the settlement and the books caught up.
      if (current?.status === 'PAID') {
        await settlements.completeByPayout(
          payout.settlementPublicId,
          current.utr ?? result.utr ?? current.publicId,
        );
        if (paid) {
          const driver = await DriverProfile.findById(payout.driverId).select('userId').lean();
          if (driver) {
            await notifications
              .notify(driver.userId.toString(), {
                type: 'payout.sent',
                title: 'Your payout was sent',
                body: `₹${(payout.amountPaise / 100).toFixed(2)} is on its way to your account.`,
                data: { settlementId: payout.settlementPublicId },
                dedupeKey: `payout:${payout.publicId}`,
              })
              .catch((err) => logger.error({ err }, 'could not tell the driver about a payout'));
          }
        }
      }
      return;
    }
    if (result.status === 'processing') {
      await Payout.updateOne({ _id: payout._id, status: 'CREATED' }, { status: 'PROCESSING' });
      return;
    }
    if (result.status === 'failed') {
      await Payout.updateOne(
        { _id: payout._id, status: { $in: ['CREATED', 'PROCESSING'] } },
        { status: 'FAILED', failureReason: result.failureReason ?? 'The payout failed' },
      );
      return;
    }
    // reversed: the money went out and came back
    const was = await Payout.findOneAndUpdate(
      { _id: payout._id, status: { $in: ['CREATED', 'PROCESSING', 'PAID'] } },
      { status: 'REVERSED', failureReason: result.failureReason ?? 'The payout was reversed' },
      { returnDocument: 'before' },
    );
    if (was?.status === 'PAID') {
      await settlements.reverseByPayout(payout.settlementPublicId, payout.publicId);
      logger.error(
        { payoutId: payout.publicId },
        'a paid payout was reversed by the bank: finance must follow up',
      );
    }
  }

  /** Ask the provider to send (or, if it already has the request, return what it did). */
  async function submit(payout: PayoutDoc, narration: string): Promise<void> {
    const driverAccountMode = await PayoutAccount.findOne({ driverId: payout.driverId })
      .select('type')
      .lean();
    const result = await provider.createPayout({
      fundAccountId: payout.fundAccountId,
      amountPaise: payout.amountPaise,
      referenceId: payout.publicId,
      narration,
      mode: driverAccountMode?.type === 'UPI' ? 'UPI' : 'IMPS',
      idempotencyKey: payout.idempotencyKey,
    });
    await applyResult(payout, result);
  }

  async function sendFor(actor: Actor | null, settlementPublicId: string) {
    const settlement = await Settlement.findOne({ publicId: settlementPublicId });
    if (!settlement) throw new AppError('NOT_FOUND', 'Settlement not found.');
    if (settlement.status !== 'APPROVED') {
      throw new AppError('CONFLICT', 'Only an approved settlement can be paid out.');
    }
    if (settlement.payoutPaise <= 0) {
      throw new AppError('UNPROCESSABLE', 'This settlement has nothing to pay out.');
    }
    const account = await PayoutAccount.findOne({ driverId: settlement.driverId });
    if (!account || account.status !== 'ACTIVE') {
      throw new AppError('UNPROCESSABLE', 'This driver has no verified payout account.');
    }

    const live = await Payout.findOne({
      settlementId: settlement._id,
      status: { $in: LIVE } as never,
    });
    if (live) {
      if (live.status === 'PAID')
        throw new AppError('CONFLICT', 'This settlement has already been paid out.');
      if (live.status === 'CREATED') {
        // Never got an answer last time: ask again with the same key (safe, it cannot pay twice).
        await submit(live as unknown as PayoutDoc, `Settlement ${settlement.publicId}`).catch(
          (err) => {
            logger.error({ err, payoutId: live.publicId }, 'payout re-send failed');
            throw new AppError(
              'PROVIDER_ERROR',
              'The payout could not be sent. It will be retried.',
            );
          },
        );
      }
      return view((await Payout.findById(live._id))! as unknown as PayoutDoc);
    }

    const attempt = (await Payout.countDocuments({ settlementId: settlement._id })) + 1;
    let created;
    try {
      created = await Payout.create({
        publicId: publicId('pyo'),
        settlementId: settlement._id,
        settlementPublicId: settlement.publicId,
        driverId: settlement.driverId,
        amountPaise: settlement.payoutPaise,
        attempt,
        idempotencyKey: `payout:${settlement.publicId}:${attempt}`,
        fundAccountId: account.providerFundAccountId,
        ...(actor ? { createdBy: actor.userId } : {}),
      });
    } catch (err) {
      if ((err as { code?: number }).code === DUPLICATE_KEY) {
        throw new AppError('CONFLICT', 'A payout for this settlement is already in progress.');
      }
      throw err;
    }
    if (actor) {
      await audit.record(actor, {
        action: 'finance.payout.send',
        targetType: 'Settlement',
        targetId: settlement.publicId,
        metadata: { payoutId: created.publicId, amountPaise: created.amountPaise, attempt },
      });
    }
    try {
      await submit(created as unknown as PayoutDoc, `Settlement ${settlement.publicId}`);
    } catch (err) {
      // No answer: the payout stays CREATED and is re-sent (same key) by the repair job.
      logger.error({ err, payoutId: created.publicId }, 'payout request failed');
      throw new AppError('PROVIDER_ERROR', 'The payout could not be sent. It will be retried.');
    }
    return view((await Payout.findById(created._id))! as unknown as PayoutDoc);
  }

  return {
    /* ---- driver ---- */

    async getOwnAccount(userId: string) {
      const profile = await requireDriverProfile(userId);
      const a = await PayoutAccount.findOne({ driverId: profile._id }).lean();
      return { account: a ? accountView(a) : null };
    },

    /** Save (or replace) where to send the money. It must be verified by finance before it is used. */
    async setOwnAccount(userId: string, input: PayoutAccountInput) {
      const profile = await requireDriverProfile(userId);
      let refs;
      try {
        refs = await provider.createFundAccount({
          referenceId: profile._id.toString(),
          name: input.holderName,
          destination:
            input.type === 'BANK'
              ? { type: 'BANK', accountNumber: input.accountNumber, ifsc: input.ifsc }
              : { type: 'UPI', vpa: input.vpa },
        });
      } catch (err) {
        logger.error({ err }, 'could not register a payout account');
        throw new AppError(
          'PROVIDER_ERROR',
          'Could not save the account. Check the details and try again.',
        );
      }
      // A changed account is checked again; a UPI id has no IFSC, so a leftover one is removed.
      const clear: Record<string, 1> = { reviewedBy: 1, reviewedAt: 1, rejectionReason: 1 };
      if (input.type === 'UPI') clear['ifsc'] = 1;
      const saved = await PayoutAccount.findOneAndUpdate(
        { driverId: profile._id },
        {
          $set: {
            type: input.type,
            holderName: input.holderName,
            maskedNumber:
              input.type === 'BANK' ? `••••${input.accountNumber.slice(-4)}` : maskUpi(input.vpa),
            ...(input.type === 'BANK' ? { ifsc: input.ifsc } : {}),
            providerContactId: refs.contactId,
            providerFundAccountId: refs.fundAccountId,
            status: 'PENDING',
          },
          $unset: clear,
        },
        { upsert: true, returnDocument: 'after' },
      );
      return { account: accountView(saved!) };
    },

    /* ---- finance ---- */

    async accountForDriver(driverId: string) {
      const a = await PayoutAccount.findOne({ driverId }).lean();
      if (!a) throw new AppError('NOT_FOUND', 'This driver has not added a payout account.');
      return { account: accountView(a) };
    },

    async reviewAccount(actor: Actor, driverId: string, input: ReviewAccountInput) {
      const a = await PayoutAccount.findOneAndUpdate(
        { driverId, status: 'PENDING' },
        input.decision === 'APPROVE'
          ? {
              status: 'ACTIVE',
              reviewedBy: actor.userId,
              reviewedAt: now(),
              $unset: { rejectionReason: 1 },
            }
          : {
              status: 'REJECTED',
              reviewedBy: actor.userId,
              reviewedAt: now(),
              rejectionReason: input.reason,
            },
        { returnDocument: 'after' },
      );
      if (!a) {
        if (!(await PayoutAccount.exists({ driverId }))) throw new AppError('NOT_FOUND');
        throw new AppError('CONFLICT', 'Only an account waiting for review can be decided.');
      }
      await audit.record(actor, {
        action:
          input.decision === 'APPROVE'
            ? 'finance.payout_account.approve'
            : 'finance.payout_account.reject',
        targetType: 'PayoutAccount',
        targetId: driverId,
        ...(input.reason ? { metadata: { reason: input.reason } } : {}),
      });
      return { account: accountView(a) };
    },

    send: sendFor,

    async forSettlement(settlementPublicId: string) {
      const rows = await Payout.find({ settlementPublicId }).sort({ attempt: 1 }).lean();
      return rows.map((p) => view(p as unknown as PayoutDoc));
    },

    async list(query: PayoutListQuery) {
      const filter: Record<string, unknown> = {};
      if (query.status) filter['status'] = query.status;
      if (query.driverId) filter['driverId'] = query.driverId;
      const [total, rows] = await Promise.all([
        Payout.countDocuments(filter),
        Payout.find(filter)
          .sort({ createdAt: -1 })
          .skip((query.page - 1) * query.limit)
          .limit(query.limit)
          .lean(),
      ]);
      return {
        items: rows.map((p) => view(p as unknown as PayoutDoc)),
        meta: pageMeta(query.page, query.limit, total),
      };
    },

    /* ---- the provider tells us ---- */

    async handleWebhook(rawBody: Buffer, signature: string, eventIdHeader?: string) {
      if (!provider.verifyWebhookSignature(rawBody, signature)) {
        throw new AppError('PAYMENT_SIGNATURE_INVALID');
      }
      let body: { event?: string; payload?: { payout?: { entity?: Record<string, unknown> } } };
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        throw new AppError('VALIDATION_ERROR', 'Malformed webhook body.');
      }
      const eventId = eventIdHeader || createHash('sha256').update(rawBody).digest('hex');
      try {
        await WebhookEvent.create({ eventId, type: body.event ?? 'unknown', receivedAt: now() });
      } catch (err) {
        if ((err as { code?: number }).code === DUPLICATE_KEY)
          return { duplicate: true, outcome: 'DUPLICATE' };
        throw err;
      }
      try {
        const entity = body.payload?.payout?.entity;
        const providerId = typeof entity?.['id'] === 'string' ? entity['id'] : undefined;
        const event = body.event ?? '';
        let outcome = 'IGNORED';
        if (providerId && event.startsWith('payout.')) {
          const payout = await Payout.findOne({ providerPayoutId: providerId });
          if (!payout) {
            outcome = 'UNKNOWN_PAYOUT';
          } else {
            const status =
              event === 'payout.processed'
                ? 'processed'
                : event === 'payout.reversed'
                  ? 'reversed'
                  : ['payout.failed', 'payout.rejected', 'payout.cancelled'].includes(event)
                    ? 'failed'
                    : 'processing';
            await applyResult(payout as unknown as PayoutDoc, {
              payoutId: providerId,
              status,
              ...(typeof entity?.['utr'] === 'string' ? { utr: entity['utr'] } : {}),
              ...(typeof entity?.['failure_reason'] === 'string'
                ? { failureReason: entity['failure_reason'].slice(0, 200) }
                : {}),
            });
            outcome = status.toUpperCase();
          }
        }
        await WebhookEvent.updateOne({ eventId }, { outcome });
        return { duplicate: false, outcome };
      } catch (err) {
        await WebhookEvent.deleteOne({ eventId });
        throw err;
      }
    },

    /** DEVELOPMENT ONLY (mock payouts): pretend the bank confirmed the transfer. */
    async devComplete(payoutPublicId: string) {
      const p = await Payout.findOne({ publicId: payoutPublicId });
      if (!p) throw new AppError('NOT_FOUND', 'Payout not found.');
      await applyResult(p as unknown as PayoutDoc, {
        payoutId: p.providerPayoutId ?? `dev_${p.publicId}`,
        status: 'processed',
        utr: `DEVUTR${p.publicId.slice(-6)}`,
      });
      return view((await Payout.findById(p._id))! as unknown as PayoutDoc);
    },

    /**
     * Repair and automation, run by the finance job: re-send payouts that got no answer, ask the
     * provider about ones that have been "on their way" a while (in case a webhook was missed),
     * finish settlements whose payout is paid, and (if switched on) pay approved settlements.
     */
    async reconcile(): Promise<{
      resent: number;
      polled: number;
      finished: number;
      started: number;
    }> {
      const t = now().getTime();
      let resent = 0;
      let polled = 0;
      let finished = 0;
      let started = 0;

      const unanswered = await Payout.find({
        status: 'CREATED',
        updatedAt: { $lte: new Date(t - config.reconcileGraceMs) },
      }).limit(20);
      for (const p of unanswered) {
        try {
          await submit(p as unknown as PayoutDoc, `Settlement ${p.settlementPublicId}`);
          resent += 1;
        } catch (err) {
          logger.error({ err, payoutId: p.publicId }, 'payout re-send failed');
        }
      }

      const waiting = await Payout.find({
        status: 'PROCESSING',
        providerPayoutId: { $exists: true },
        updatedAt: { $lte: new Date(t - 10 * 60_000) },
      }).limit(20);
      for (const p of waiting) {
        try {
          await applyResult(
            p as unknown as PayoutDoc,
            await provider.getPayout(p.providerPayoutId!),
          );
          // Touch it, so a payout still on its way is asked about every 10 minutes, not every minute.
          await Payout.updateOne(
            { _id: p._id, status: 'PROCESSING' },
            { $set: { updatedAt: now() } },
          );
          polled += 1;
        } catch (err) {
          logger.error({ err, payoutId: p.publicId }, 'payout status check failed');
        }
      }

      const paid = await Payout.find({ status: 'PAID' }).sort({ paidAt: -1 }).limit(20);
      for (const p of paid) {
        const s = await Settlement.findOne({
          publicId: p.settlementPublicId,
          status: 'APPROVED',
        }).lean();
        if (s) {
          await settlements.completeByPayout(p.settlementPublicId, p.utr ?? p.publicId);
          finished += 1;
        }
      }

      if (config.autoPayouts) {
        const ready = await Settlement.find({ status: 'APPROVED', payoutPaise: { $gt: 0 } })
          .sort({ approvedAt: 1 })
          .limit(20)
          .lean();
        for (const s of ready) {
          const busy = await Payout.exists({ settlementId: s._id, status: { $in: LIVE } as never });
          const failedTwice =
            (await Payout.countDocuments({ settlementId: s._id, status: 'FAILED' })) >= 3;
          if (busy || failedTwice) continue; // a person looks at a payout that keeps failing
          try {
            await sendFor(null, s.publicId);
            started += 1;
          } catch (err) {
            if (!(err instanceof AppError))
              logger.error({ err, settlementId: s.publicId }, 'automatic payout failed');
          }
        }
      }
      return { resent, polled, finished, started };
    },
  };
}

export type PayoutsService = ReturnType<typeof createPayoutsService>;
