import type { Types } from 'mongoose';
import type { Logger } from 'pino';
import { publicId } from '../../common/ids';
import { Booking } from '../bookings/booking.model';
import { Accounts } from './accounts';
import type { FinanceConfig } from './finance.config';
import { LedgerTransaction, type LedgerKind } from './ledgerTransaction.model';

const DUPLICATE_KEY = 11000;

export type LedgerEntry = { account: string; amountPaise: number };

export type PostInput = {
  kind: LedgerKind;
  /** The business event. Posting the same one again changes nothing. */
  idempotencyKey: string;
  entries: LedgerEntry[];
  bookingId?: Types.ObjectId | string;
  bookingPublicId?: string;
  driverId?: Types.ObjectId | string;
  customerId?: Types.ObjectId | string;
  description?: string;
  metadata?: Record<string, unknown>;
  createdBy?: string;
  at: Date;
};

/** The platform's cut, rounded once, and the driver's share is exactly what is left. */
export function splitAmount(amountPaise: number, rateBp: number) {
  const commissionPaise = Math.round((amountPaise * rateBp) / 10_000);
  return { commissionPaise, driverSharePaise: amountPaise - commissionPaise };
}

export function createLedgerService(deps: {
  now: () => Date;
  logger: Logger;
  config: FinanceConfig;
}) {
  const { now, logger, config } = deps;

  /**
   * Record one transaction. Idempotent on `idempotencyKey`: a second call with the same key returns
   * the first transaction. A key reused for DIFFERENT entries is a programming error and throws.
   */
  async function post(input: PostInput): Promise<{ txnId: string; created: boolean }> {
    const doc = {
      txnId: publicId('txn'),
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      entries: input.entries,
      bookingId: input.bookingId,
      bookingPublicId: input.bookingPublicId,
      driverId: input.driverId,
      customerId: input.customerId,
      description: input.description,
      metadata: input.metadata,
      createdBy: input.createdBy,
      at: input.at,
    };
    try {
      const created = await LedgerTransaction.create(doc);
      return { txnId: created.txnId, created: true };
    } catch (err) {
      if ((err as { code?: number }).code !== DUPLICATE_KEY) throw err;
      const existing = await LedgerTransaction.findOne({
        idempotencyKey: input.idempotencyKey,
      }).lean();
      if (!existing) throw err;
      const same =
        existing.entries.length === input.entries.length &&
        existing.entries.every(
          (e, i) =>
            e.account === input.entries[i]!.account &&
            e.amountPaise === input.entries[i]!.amountPaise,
        );
      if (!same) {
        throw new Error(`Ledger key "${input.idempotencyKey}" was reused with different entries`, {
          cause: err,
        });
      }
      return { txnId: existing.txnId, created: false };
    }
  }

  async function findByKey(idempotencyKey: string) {
    return LedgerTransaction.findOne({ idempotencyKey }).lean();
  }

  /** Sum of entries per account, in one pass. Accounts with no entries are 0. */
  async function balances(accounts: string[]): Promise<Record<string, number>> {
    const rows = await LedgerTransaction.aggregate<{ _id: string; total: number }>([
      { $match: { 'entries.account': { $in: accounts } } },
      { $unwind: '$entries' },
      { $match: { 'entries.account': { $in: accounts } } },
      { $group: { _id: '$entries.account', total: { $sum: '$entries.amountPaise' } } },
    ]);
    const out: Record<string, number> = Object.fromEntries(accounts.map((a) => [a, 0]));
    for (const r of rows) out[r._id] = r.total;
    return out;
  }

  /** Where a driver stands: cash in hand, what we owe them, and the net. */
  async function driverPosition(driverId: string) {
    const cashAccount = Accounts.driverCash(driverId);
    const payableAccount = Accounts.driverPayable(driverId);
    const b = await balances([cashAccount, payableAccount]);
    const cashHeldPaise = b[cashAccount]!;
    const payablePaise = 0 - b[payableAccount]!; // stored as a credit (negative); 0 - 0 keeps +0
    return {
      cashHeldPaise,
      payablePaise,
      // > 0: the driver owes the platform. < 0: the platform owes the driver.
      netOwedByDriverPaise: cashHeldPaise - payablePaise,
    };
  }

  async function riderOwedPaise(customerId: string): Promise<number> {
    const account = Accounts.riderReceivable(customerId);
    return (await balances([account]))[account]!;
  }

  /** Who owes the money for a booking: the rider, or the company it is billed to. */
  const receivableOf = (b: { customerId: Types.ObjectId; corporateId?: Types.ObjectId | null }) =>
    b.corporateId
      ? Accounts.corporateReceivable(b.corporateId.toString())
      : Accounts.riderReceivable(b.customerId.toString());

  /* ---------------- accruals: a ride or a fee becomes money owed ---------------- */

  async function markAccrued(
    bookingId: Types.ObjectId,
    accrual: {
      kind: 'RIDE' | 'FEE';
      amountPaise: number;
      grossPaise?: number;
      discountPaise?: number;
      commissionPaise: number;
      driverSharePaise: number;
      /** Tax charged to the rider on top of the fare, and tax on the commission taken from the driver. */
      taxPaise?: number;
      commissionTaxPaise?: number;
    },
  ) {
    await Booking.updateOne(
      { _id: bookingId, 'accrual.at': { $exists: false } },
      { $set: { accrual: { ...accrual, at: now() } } },
    );
  }

  /** A completed ride: the rider owes the fare; the driver is owed their share; we keep the commission. */
  async function accrueRide(bookingId: Types.ObjectId): Promise<boolean> {
    const b = await Booking.findById(bookingId).lean();
    if (!b || b.status !== 'COMPLETED' || !b.assignedDriverId || !b.finalFarePaise) return false;
    if (b.accrual?.at) return false;
    // The driver's share and the commission are worked out on the FULL fare before tax; the rider
    // owes the fare plus tax less any coupon discount, which the platform pays for (PROMOTIONS).
    const grossPaise = b.grossFarePaise ?? b.finalFarePaise;
    const discountPaise = b.discountPaise ?? 0;
    const taxPaise = b.taxPaise ?? 0;
    if (b.finalFarePaise + discountPaise !== grossPaise) {
      throw new Error(
        `Fare does not add up for ${b.publicId}: ${b.finalFarePaise} + ${discountPaise} != ${grossPaise}`,
      );
    }
    const { commissionPaise, driverSharePaise: shareBeforeTax } = splitAmount(
      grossPaise - taxPaise,
      b.commission?.rateBp ?? config.defaultCommissionBp,
    );
    // Tax on the commission is the driver's to bear: it comes out of their share and is held for the tax office.
    const commissionTaxPaise = Math.min(
      shareBeforeTax,
      Math.round((commissionPaise * config.commissionTaxBp) / 10_000),
    );
    const driverSharePaise = shareBeforeTax - commissionTaxPaise;
    const taxHeldPaise = taxPaise + commissionTaxPaise;
    const entries: LedgerEntry[] = [
      { account: receivableOf(b), amountPaise: b.finalFarePaise },
      {
        account: Accounts.driverPayable(b.assignedDriverId.toString()),
        amountPaise: -driverSharePaise,
      },
      ...(commissionPaise > 0
        ? [{ account: Accounts.commission, amountPaise: -commissionPaise }]
        : []),
      ...(taxHeldPaise > 0 ? [{ account: Accounts.taxPayable, amountPaise: -taxHeldPaise }] : []),
      ...(discountPaise > 0 ? [{ account: Accounts.promotions, amountPaise: discountPaise }] : []),
    ];
    await post({
      kind: 'RIDE_ACCRUAL',
      idempotencyKey: `accrue-ride:${b.publicId}`,
      entries,
      bookingId: b._id,
      bookingPublicId: b.publicId,
      driverId: b.assignedDriverId,
      customerId: b.customerId,
      description: 'Ride completed',
      at: b.completedAt ?? now(),
    });
    await markAccrued(b._id, {
      kind: 'RIDE',
      amountPaise: b.finalFarePaise,
      grossPaise,
      discountPaise,
      commissionPaise,
      driverSharePaise,
      ...(taxPaise > 0 ? { taxPaise } : {}),
      ...(commissionTaxPaise > 0 ? { commissionTaxPaise } : {}),
    });
    return true;
  }

  /** A late-cancel or no-show fee works like a fare: owed by the rider, shared with the driver. */
  async function accrueFee(bookingId: Types.ObjectId): Promise<boolean> {
    const b = await Booking.findById(bookingId).lean();
    if (!b || !b.fee || !b.assignedDriverId) return false;
    if (!['CANCELLED', 'NO_SHOW'].includes(b.status) || b.accrual?.at) return false;
    const { commissionPaise, driverSharePaise } = splitAmount(
      b.fee.amountPaise,
      b.commission?.rateBp ?? config.defaultCommissionBp,
    );
    const entries: LedgerEntry[] = [
      { account: receivableOf(b), amountPaise: b.fee.amountPaise },
      ...(driverSharePaise > 0
        ? [
            {
              account: Accounts.driverPayable(b.assignedDriverId.toString()),
              amountPaise: -driverSharePaise,
            },
          ]
        : []),
      ...(commissionPaise > 0
        ? [{ account: Accounts.commission, amountPaise: -commissionPaise }]
        : []),
    ];
    await post({
      kind: 'FEE_ACCRUAL',
      idempotencyKey: `accrue-fee:${b.publicId}`,
      entries,
      bookingId: b._id,
      bookingPublicId: b.publicId,
      driverId: b.assignedDriverId,
      customerId: b.customerId,
      description: b.fee.type === 'NO_SHOW' ? 'No-show fee' : 'Late cancellation fee',
      at: b.fee.at,
    });
    await markAccrued(b._id, {
      kind: 'FEE',
      amountPaise: b.fee.amountPaise,
      commissionPaise,
      driverSharePaise,
    });
    return true;
  }

  /**
   * Staff waived a fee. The rider no longer owes it, but the driver was already promised their
   * share, so the platform absorbs the cost (it is not taken back from the driver).
   */
  async function waiveFee(bookingId: Types.ObjectId): Promise<void> {
    await accrueFee(bookingId); // make sure there is something to waive
    const b = await Booking.findById(bookingId).lean();
    if (!b || !b.fee) return;
    await post({
      kind: 'FEE_WAIVER',
      idempotencyKey: `waive-fee:${b.publicId}`,
      entries: [
        { account: receivableOf(b), amountPaise: -b.fee.amountPaise },
        { account: Accounts.waivedFees, amountPaise: b.fee.amountPaise },
      ],
      bookingId: b._id,
      bookingPublicId: b.publicId,
      customerId: b.customerId,
      description: 'Fee waived',
      at: b.fee.waivedAt ?? now(),
    });
    await Booking.updateOne(
      { _id: b._id, feeWaiverRecordedAt: { $exists: false } },
      { feeWaiverRecordedAt: now() },
    );
  }

  /** Used on the request path: a failure is logged and repaired later, never shown to the user. */
  const safely =
    (what: string, fn: (id: Types.ObjectId) => Promise<unknown>) => async (id: Types.ObjectId) => {
      try {
        await fn(id);
      } catch (err) {
        logger.error({ err, bookingId: id.toString() }, `ledger: ${what} failed (will be retried)`);
      }
    };

  /** Repairs accruals that were missed (a crash between completing a ride and recording it). */
  async function reconcile(): Promise<{ accrued: number }> {
    const cutoff = new Date(now().getTime() - config.reconcileGraceMs);
    let accrued = 0;
    const rides = await Booking.find({
      status: 'COMPLETED',
      'accrual.at': { $exists: false },
      completedAt: { $lte: cutoff },
    })
      .select('_id')
      .limit(100)
      .lean();
    for (const r of rides) if (await accrueRide(r._id)) accrued += 1;
    const fees = await Booking.find({
      status: { $in: ['CANCELLED', 'NO_SHOW'] },
      fee: { $exists: true },
      'accrual.at': { $exists: false },
      'fee.at': { $lte: cutoff },
    })
      .select('_id')
      .limit(100)
      .lean();
    for (const f of fees) if (await accrueFee(f._id)) accrued += 1;
    const waivers = await Booking.find({
      'fee.status': 'WAIVED',
      feeWaiverRecordedAt: { $exists: false },
      'fee.waivedAt': { $lte: cutoff },
    })
      .select('_id')
      .limit(100)
      .lean();
    for (const w of waivers) {
      await waiveFee(w._id);
      accrued += 1;
    }
    if (accrued > 0) logger.warn({ accrued }, 'recorded money events that were missing');
    return { accrued };
  }

  /** The books must always balance. Cheap enough to run on demand. */
  async function checkBalance() {
    const [totalRow, unbalanced, missingAccruals] = await Promise.all([
      LedgerTransaction.aggregate<{ total: number }>([
        { $unwind: '$entries' },
        { $group: { _id: null, total: { $sum: '$entries.amountPaise' } } },
      ]),
      LedgerTransaction.aggregate<{ txnId: string; sum: number }>([
        { $project: { txnId: 1, sum: { $sum: '$entries.amountPaise' } } },
        { $match: { sum: { $ne: 0 } } },
        { $limit: 20 },
      ]),
      Booking.countDocuments({
        status: 'COMPLETED',
        'accrual.at': { $exists: false },
        completedAt: { $lte: new Date(now().getTime() - config.reconcileGraceMs) },
      }),
    ]);
    return {
      ledgerTotalPaise: totalRow[0]?.total ?? 0,
      unbalancedTransactions: unbalanced.map((u) => u.txnId),
      completedRidesWithoutAccrual: missingAccruals,
    };
  }

  return {
    accrueRideSafe: safely('ride accrual', accrueRide),
    accrueFeeSafe: safely('fee accrual', accrueFee),
    waiveFeeSafe: safely('fee waiver', waiveFee),
    post,
    findByKey,
    balances,
    driverPosition,
    riderOwedPaise,
    accrueRide,
    accrueFee,
    waiveFee,
    reconcile,
    checkBalance,
  };
}

export type LedgerService = ReturnType<typeof createLedgerService>;
