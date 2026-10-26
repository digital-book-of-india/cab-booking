import { z } from 'zod';
import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import { publicId } from '../../common/ids';
import { pageMeta, paginationSchema } from '../../common/pagination';
import { objectId } from '../../common/zod';
import type { AuditService } from '../audit/audit.service';
import { DriverProfile } from '../drivers/driverProfile.model';
import { requireDriverProfile } from '../drivers/drivers.service';
import { Accounts } from '../ledger/accounts';
import type { FinanceConfig } from '../ledger/finance.config';
import type { LedgerService } from '../ledger/ledger.service';
import { LedgerTransaction } from '../ledger/ledgerTransaction.model';
import { Payout } from '../payouts/payout.model';
import { Settlement, SettlementStatuses } from './settlement.model';

const DUPLICATE_KEY = 11000;

export const generateSettlementSchema = z
  .object({ driverId: objectId.optional(), all: z.literal(true).optional() })
  .strict()
  .refine((v) => Boolean(v.driverId) !== Boolean(v.all), {
    message: 'send either driverId or all: true',
    path: ['driverId'],
  });

export const markPaidSchema = z
  .object({ payoutReference: z.string().trim().min(3).max(100) })
  .strict();

export const settlementListQuerySchema = paginationSchema.extend({
  status: z.enum(SettlementStatuses).optional(),
  driverId: objectId.optional(),
});

export type GenerateSettlementInput = z.infer<typeof generateSettlementSchema>;
export type MarkPaidInput = z.infer<typeof markPaidSchema>;
export type SettlementListQuery = z.infer<typeof settlementListQuerySchema>;

type SettlementDoc = {
  _id: import('mongoose').Types.ObjectId;
  publicId: string;
  driverId: import('mongoose').Types.ObjectId;
  status: string;
  payablePaise: number;
  cashHeldPaise: number;
  nettedPaise: number;
  payoutPaise: number;
  depositDuePaise: number;
  periodTo: Date;
  payoutReference?: string | null;
  approvedAt?: Date | null;
  paidAt?: Date | null;
  createdAt: Date;
};

const view = (s: SettlementDoc) => ({
  settlementId: s.publicId,
  driverId: s.driverId.toString(),
  status: s.status,
  payablePaise: s.payablePaise,
  cashHeldPaise: s.cashHeldPaise,
  nettedPaise: s.nettedPaise,
  payoutPaise: s.payoutPaise,
  depositDuePaise: s.depositDuePaise,
  periodTo: s.periodTo,
  payoutReference: s.payoutReference ?? null,
  approvedAt: s.approvedAt ?? null,
  paidAt: s.paidAt ?? null,
  createdAt: s.createdAt,
});

export function createSettlementsService(deps: {
  ledger: LedgerService;
  audit: AuditService;
  now: () => Date;
  config: FinanceConfig;
}) {
  const { ledger, audit, now, config } = deps;

  async function draftFor(actor: Actor, driverId: string) {
    const position = await ledger.driverPosition(driverId);
    const { payablePaise, cashHeldPaise } = position;
    if (payablePaise <= 0 && cashHeldPaise <= 0) {
      throw new AppError('UNPROCESSABLE', 'This driver has nothing to settle.');
    }
    const netted = Math.max(0, Math.min(payablePaise, cashHeldPaise));
    try {
      const created = await Settlement.create({
        publicId: publicId('stl'),
        driverId,
        payablePaise: Math.max(0, payablePaise),
        cashHeldPaise: Math.max(0, cashHeldPaise),
        nettedPaise: netted,
        payoutPaise: Math.max(0, payablePaise - netted),
        depositDuePaise: Math.max(0, cashHeldPaise - netted),
        periodTo: now(),
        createdBy: actor.userId,
      });
      return created;
    } catch (err) {
      if ((err as { code?: number }).code === DUPLICATE_KEY) {
        throw new AppError('CONFLICT', 'This driver already has an open settlement.');
      }
      throw err;
    }
  }

  async function recordNet(s: SettlementDoc) {
    if (s.nettedPaise > 0) {
      await ledger.post({
        kind: 'SETTLEMENT_NET',
        idempotencyKey: `settle-net:${s.publicId}`,
        entries: [
          { account: Accounts.driverCash(s.driverId.toString()), amountPaise: -s.nettedPaise },
          { account: Accounts.driverPayable(s.driverId.toString()), amountPaise: s.nettedPaise },
        ],
        driverId: s.driverId,
        description: `Settlement ${s.publicId}: cash netted against earnings`,
        at: s.approvedAt ?? now(),
      });
    }
    await Settlement.updateOne(
      { _id: s._id, netRecordedAt: { $exists: false } },
      { netRecordedAt: now() },
    );
  }

  async function recordPayout(s: SettlementDoc) {
    if (s.payoutPaise > 0) {
      await ledger.post({
        kind: 'SETTLEMENT_PAYOUT',
        idempotencyKey: `settle-pay:${s.publicId}`,
        entries: [
          { account: Accounts.driverPayable(s.driverId.toString()), amountPaise: s.payoutPaise },
          { account: Accounts.bank, amountPaise: -s.payoutPaise },
        ],
        driverId: s.driverId,
        description: `Settlement ${s.publicId}: paid to driver (${s.payoutReference ?? ''})`,
        at: s.paidAt ?? now(),
      });
    }
    await Settlement.updateOne(
      { _id: s._id, payoutRecordedAt: { $exists: false } },
      { payoutRecordedAt: now() },
    );
  }

  return {
    async generate(actor: Actor, input: GenerateSettlementInput) {
      if (input.driverId) {
        if (!(await DriverProfile.exists({ _id: input.driverId })))
          throw new AppError('NOT_FOUND', 'Driver not found.');
        const s = await draftFor(actor, input.driverId);
        await audit.record(actor, {
          action: 'finance.settlement.generate',
          targetType: 'Settlement',
          targetId: s.publicId,
          metadata: {
            driverId: input.driverId,
            payoutPaise: s.payoutPaise,
            depositDuePaise: s.depositDuePaise,
          },
        });
        return { created: [view(s as unknown as SettlementDoc)], skipped: [] as string[] };
      }
      // Everyone who has any money activity and nothing open or nothing to settle is skipped.
      const ids = (await LedgerTransaction.distinct('driverId', {
        driverId: { $exists: true },
      })) as import('mongoose').Types.ObjectId[];
      const created: ReturnType<typeof view>[] = [];
      const skipped: string[] = [];
      for (const id of ids) {
        try {
          const s = await draftFor(actor, id.toString());
          created.push(view(s as unknown as SettlementDoc));
        } catch (err) {
          if (!(err instanceof AppError)) throw err;
          skipped.push(id.toString());
        }
      }
      await audit.record(actor, {
        action: 'finance.settlement.generate_all',
        targetType: 'Settlement',
        targetId: 'all',
        metadata: { created: created.length, skipped: skipped.length },
      });
      return { created, skipped };
    },

    async list(query: SettlementListQuery) {
      const { page, limit, status, driverId } = query;
      const filter: Record<string, unknown> = {};
      if (status) filter['status'] = status;
      if (driverId) filter['driverId'] = driverId;
      const [total, rows] = await Promise.all([
        Settlement.countDocuments(filter),
        Settlement.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);
      return {
        items: rows.map((r) => view(r as unknown as SettlementDoc)),
        meta: pageMeta(page, limit, total),
      };
    },

    async detail(settlementPublicId: string) {
      const s = await Settlement.findOne({ publicId: settlementPublicId }).lean();
      if (!s) throw new AppError('NOT_FOUND');
      return view(s as unknown as SettlementDoc);
    },

    async listOwn(userId: string, query: SettlementListQuery) {
      const profile = await requireDriverProfile(userId);
      return this.list({ ...query, driverId: profile._id.toString() });
    },

    /** Lock the figures and net the cash against the earnings. Refuses if the balances have moved. */
    async approve(actor: Actor, settlementPublicId: string) {
      const draft = await Settlement.findOne({ publicId: settlementPublicId, status: 'DRAFT' });
      if (!draft) {
        const any = await Settlement.exists({ publicId: settlementPublicId });
        if (!any) throw new AppError('NOT_FOUND');
        throw new AppError('CONFLICT', 'Only a draft settlement can be approved.');
      }
      const now_ = await ledger.driverPosition(draft.driverId.toString());
      if (now_.cashHeldPaise < draft.nettedPaise || now_.payablePaise < draft.nettedPaise) {
        throw new AppError(
          'CONFLICT',
          'Balances changed since this draft was made. Cancel it and generate a new one.',
        );
      }
      const approved = await Settlement.findOneAndUpdate(
        { _id: draft._id, status: 'DRAFT' },
        { status: 'APPROVED', approvedBy: actor.userId, approvedAt: now() },
        { returnDocument: 'after' },
      );
      if (!approved) throw new AppError('CONFLICT', 'Only a draft settlement can be approved.');
      await recordNet(approved as unknown as SettlementDoc);
      await audit.record(actor, {
        action: 'finance.settlement.approve',
        targetType: 'Settlement',
        targetId: settlementPublicId,
        metadata: { nettedPaise: approved.nettedPaise },
      });
      return view(approved as unknown as SettlementDoc);
    },

    /** The payout was sent outside the system (bank transfer): record it with its reference. */
    async markPaid(actor: Actor, settlementPublicId: string, input: MarkPaidInput) {
      // A payout through the payout service is on its way or done: paying by hand too would pay twice.
      if (
        await Payout.exists({
          settlementPublicId,
          status: { $in: ['CREATED', 'PROCESSING', 'PAID'] },
        })
      ) {
        throw new AppError('CONFLICT', 'A payout is already in progress for this settlement.');
      }
      const paid = await Settlement.findOneAndUpdate(
        { publicId: settlementPublicId, status: 'APPROVED' },
        {
          status: 'PAID',
          paidBy: actor.userId,
          paidAt: now(),
          payoutReference: input.payoutReference,
          open: false,
        },
        { returnDocument: 'after' },
      );
      if (!paid) {
        const any = await Settlement.exists({ publicId: settlementPublicId });
        if (!any) throw new AppError('NOT_FOUND');
        throw new AppError('CONFLICT', 'Only an approved settlement can be marked paid.');
      }
      await recordPayout(paid as unknown as SettlementDoc);
      await audit.record(actor, {
        action: 'finance.settlement.paid',
        targetType: 'Settlement',
        targetId: settlementPublicId,
        metadata: { payoutPaise: paid.payoutPaise, reference: input.payoutReference },
      });
      return view(paid as unknown as SettlementDoc);
    },

    /**
     * The payout service confirmed the money was sent (called by the payouts service, never by a
     * person). Safe to repeat. `reference` is the bank's reference number.
     */
    async completeByPayout(settlementPublicId: string, reference: string) {
      const paid = await Settlement.findOneAndUpdate(
        { publicId: settlementPublicId, status: 'APPROVED' },
        { status: 'PAID', paidAt: now(), payoutReference: reference, open: false },
        { returnDocument: 'after' },
      );
      const s =
        paid ?? (await Settlement.findOne({ publicId: settlementPublicId, status: 'PAID' }));
      if (s) await recordPayout(s as unknown as SettlementDoc);
    },

    /** The bank sent a paid payout back: owe the driver that money again, and flag it for finance. */
    async reverseByPayout(settlementPublicId: string, payoutPublicId: string) {
      const s = await Settlement.findOne({ publicId: settlementPublicId });
      if (!s || s.payoutPaise <= 0) return;
      await ledger.post({
        kind: 'PAYOUT_REVERSAL',
        idempotencyKey: `settle-pay-reverse:${payoutPublicId}`,
        entries: [
          { account: Accounts.driverPayable(s.driverId.toString()), amountPaise: -s.payoutPaise },
          { account: Accounts.bank, amountPaise: s.payoutPaise },
        ],
        driverId: s.driverId,
        description: `Settlement ${s.publicId}: payout sent back by the bank`,
        at: now(),
      });
      await Settlement.updateOne(
        { _id: s._id, payoutReversedAt: { $exists: false } },
        { payoutReversedAt: now() },
      );
    },

    async cancel(actor: Actor, settlementPublicId: string) {
      const cancelled = await Settlement.findOneAndUpdate(
        { publicId: settlementPublicId, status: 'DRAFT' },
        { status: 'CANCELLED', open: false },
        { returnDocument: 'after' },
      );
      if (!cancelled) {
        const any = await Settlement.exists({ publicId: settlementPublicId });
        if (!any) throw new AppError('NOT_FOUND');
        throw new AppError('CONFLICT', 'Only a draft settlement can be cancelled.');
      }
      await audit.record(actor, {
        action: 'finance.settlement.cancel',
        targetType: 'Settlement',
        targetId: settlementPublicId,
      });
      return view(cancelled as unknown as SettlementDoc);
    },

    /** Repair: a status change whose ledger entry was never written. */
    async reconcile(): Promise<{ recorded: number }> {
      const cutoff = new Date(now().getTime() - config.reconcileGraceMs);
      let recorded = 0;
      const needNet = await Settlement.find({
        status: { $in: ['APPROVED', 'PAID'] },
        netRecordedAt: { $exists: false },
        approvedAt: { $lte: cutoff },
      }).limit(50);
      for (const s of needNet) {
        await recordNet(s as unknown as SettlementDoc);
        recorded += 1;
      }
      const needPay = await Settlement.find({
        status: 'PAID',
        payoutRecordedAt: { $exists: false },
        paidAt: { $lte: cutoff },
      }).limit(50);
      for (const s of needPay) {
        await recordPayout(s as unknown as SettlementDoc);
        recorded += 1;
      }
      return { recorded };
    },
  };
}

export type SettlementsService = ReturnType<typeof createSettlementsService>;
