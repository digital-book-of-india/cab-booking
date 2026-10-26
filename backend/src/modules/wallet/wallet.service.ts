import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../common/errors';
import { Accounts } from '../ledger/accounts';
import type { FinanceConfig } from '../ledger/finance.config';
import type { LedgerService } from '../ledger/ledger.service';
import { LedgerTransaction } from '../ledger/ledgerTransaction.model';
import { objectId } from '../../common/zod';
import { Wallet } from './wallet.model';

const DUPLICATE_KEY = 11000;
const LOCK_MS = 15_000;

export const topupSchema = z
  .object({ amountPaise: z.number().int().min(1).max(100_000_000) })
  .strict();
export const walletEntriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const walletOwnerSchema = objectId;

/**
 * The rider's wallet. Money in: a paid top-up, or a refund sent to the wallet. Money out: paying a
 * ride, a fee or a tip. Never paid out to a bank (a closed wallet). The balance is read from the
 * ledger; the lock only keeps two spends from using the same money.
 */
export function createWalletService(deps: {
  ledger: Pick<LedgerService, 'balances'>;
  now: () => Date;
  config: FinanceConfig;
}) {
  const { ledger, now, config } = deps;

  /** What the rider holds with us. The account is stored as a credit (negative), hence the flip. */
  async function balancePaise(customerId: string): Promise<number> {
    const account = Accounts.wallet(customerId);
    const sum = (await ledger.balances([account]))[account]!;
    return 0 - sum; // 0 - x keeps +0 instead of -0
  }

  /**
   * Run `fn` while holding this rider's spend lock. A lock left behind by a crash expires on its
   * own after 15 seconds. If someone else holds it right now the caller is told to retry.
   */
  async function withLock<T>(customerId: string, fn: () => Promise<T>): Promise<T> {
    const token = randomUUID();
    const t = now();
    try {
      await Wallet.findOneAndUpdate(
        {
          customerId,
          $or: [{ lockedUntil: { $lte: t } }, { lockedUntil: { $exists: false } }],
        },
        { lockToken: token, lockedUntil: new Date(t.getTime() + LOCK_MS) },
        { upsert: true },
      );
    } catch (err) {
      if ((err as { code?: number }).code === DUPLICATE_KEY) {
        throw new AppError('CONFLICT', 'Your wallet is busy with another payment. Try again.');
      }
      throw err;
    }
    try {
      return await fn();
    } finally {
      await Wallet.updateOne(
        { customerId, lockToken: token },
        { $unset: { lockToken: 1, lockedUntil: 1 } },
      );
    }
  }

  async function entries(customerId: string, limit: number) {
    const account = Accounts.wallet(customerId);
    const rows = await LedgerTransaction.find({ 'entries.account': account })
      .sort({ at: -1 })
      .limit(limit)
      .lean();
    return rows.map((t) => {
      const mine = t.entries
        .filter((e) => e.account === account)
        .reduce((n, e) => n + e.amountPaise, 0);
      return {
        at: t.at,
        kind: t.kind,
        // From the rider's side: money in is positive, money out is negative.
        amountPaise: 0 - mine,
        description: t.description ?? null,
        bookingId: t.bookingPublicId ?? null,
      };
    });
  }

  return {
    balancePaise,
    withLock,

    async view(customerId: string, limit = 20) {
      return {
        balancePaise: await balancePaise(customerId),
        currency: 'INR',
        limits: {
          minTopupPaise: config.walletMinTopupPaise,
          maxTopupPaise: config.walletMaxTopupPaise,
          maxBalancePaise: config.walletMaxBalancePaise,
        },
        entries: await entries(customerId, limit),
      };
    },

    /** Checked when a top-up is started: the amount is in range and the wallet would not overflow. */
    async assertCanTopUp(customerId: string, amountPaise: number) {
      if (amountPaise < config.walletMinTopupPaise || amountPaise > config.walletMaxTopupPaise) {
        throw new AppError('UNPROCESSABLE', undefined, [
          {
            field: 'amountPaise',
            message: `A top-up is between ₹${config.walletMinTopupPaise / 100} and ₹${config.walletMaxTopupPaise / 100}`,
          },
        ]);
      }
      const balance = await balancePaise(customerId);
      if (balance + amountPaise > config.walletMaxBalancePaise) {
        throw new AppError('UNPROCESSABLE', undefined, [
          {
            field: 'amountPaise',
            message: `The wallet can hold at most ₹${config.walletMaxBalancePaise / 100}`,
          },
        ]);
      }
    },

    /** Must be called while holding the lock. */
    async assertCanSpend(customerId: string, amountPaise: number) {
      if ((await balancePaise(customerId)) < amountPaise) {
        throw new AppError('INSUFFICIENT_WALLET_BALANCE');
      }
    },
  };
}

export type WalletService = ReturnType<typeof createWalletService>;
