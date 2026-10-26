import { z } from 'zod';
import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import { Booking } from '../bookings/booking.model';
import { DriverProfile } from '../drivers/driverProfile.model';
import { requireDriverProfile } from '../drivers/drivers.service';
import type { AuditService } from '../audit/audit.service';
import { Accounts } from '../ledger/accounts';
import type { FinanceConfig } from '../ledger/finance.config';
import type { LedgerService } from '../ledger/ledger.service';
import { Ride } from '../rides/ride.model';

export const cashCollectedSchema = z
  .object({ amountPaise: z.number().int().min(1).max(10_000_000) })
  .strict();

/** The rider's side of a cash payment: how much they say they handed to the driver. */
export const customerCashConfirmSchema = z
  .object({ amountPaise: z.number().int().min(1).max(10_000_000) })
  .strict();

export const cashDepositSchema = z
  .object({
    amountPaise: z.number().int().min(1).max(100_000_000),
    reference: z.string().trim().max(100).optional(),
  })
  .strict();

export type CashCollectedInput = z.infer<typeof cashCollectedSchema>;
export type CustomerCashConfirmInput = z.infer<typeof customerCashConfirmSchema>;
export type CashDepositInput = z.infer<typeof cashDepositSchema>;

/** A rider may acknowledge cash for a week after the ride. */
const CONFIRM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function createCashService(deps: {
  ledger: LedgerService;
  audit: AuditService;
  now: () => Date;
  config: FinanceConfig;
}) {
  const { ledger, audit, now, config } = deps;

  /** Record the cash in the ledger. Idempotent; also used to repair a crash after the booking was marked paid. */
  async function recordCash(
    booking: {
      _id: import('mongoose').Types.ObjectId;
      publicId: string;
      customerId: import('mongoose').Types.ObjectId;
      finalFarePaise?: number | null;
      paidAt?: Date | null;
    },
    driverId: string,
  ) {
    const amount = booking.finalFarePaise!;
    await ledger.accrueRide(booking._id); // the fare must be owed before it can be paid
    await ledger.post({
      kind: 'CASH_COLLECTED',
      idempotencyKey: `cash:${booking.publicId}`,
      entries: [
        { account: Accounts.driverCash(driverId), amountPaise: amount },
        { account: Accounts.riderReceivable(booking.customerId.toString()), amountPaise: -amount },
      ],
      bookingId: booking._id,
      bookingPublicId: booking.publicId,
      driverId,
      customerId: booking.customerId,
      description: 'Cash collected by driver',
      at: booking.paidAt ?? now(),
    });
    await Booking.updateOne(
      { _id: booking._id, cashRecordedAt: { $exists: false } },
      { cashRecordedAt: now() },
    );
  }

  /** Too much cash in hand: no new rides until they hand some over. */
  async function enforceCashLimit(driverId: string) {
    const position = await ledger.driverPosition(driverId);
    const over = position.netOwedByDriverPaise > config.driverCashLimitPaise;
    if (over) {
      await DriverProfile.updateOne(
        { _id: driverId, onlineStatus: 'ONLINE', activeRideId: null },
        { onlineStatus: 'OFFLINE', $unset: { currentLocation: 1, currentVehicleId: 1 } },
      );
    }
    return { ...position, limitPaise: config.driverCashLimitPaise, overLimit: over };
  }

  return {
    /** The driver confirms the rider handed over the exact fare in cash. */
    async collect(userId: string, ridePublicId: string, input: CashCollectedInput) {
      const profile = await requireDriverProfile(userId);
      const ride = await Ride.findOne({ publicId: ridePublicId, driverUserId: userId }).lean();
      if (!ride) throw new AppError('NOT_FOUND', 'Ride not found.');
      const booking = await Booking.findById(ride.bookingId);
      if (!booking || !booking.assignedDriverId?.equals(profile._id)) {
        throw new AppError('NOT_FOUND', 'Ride not found.');
      }
      if (booking.status !== 'COMPLETED' || !booking.finalFarePaise) {
        throw new AppError(
          'RIDE_INVALID_STATE',
          'Cash can only be collected once the ride is completed.',
        );
      }
      if (booking.paymentMethod !== 'CASH') {
        throw new AppError('CONFLICT', 'This ride is paid online, not in cash.');
      }
      if (input.amountPaise !== booking.finalFarePaise) {
        throw new AppError('UNPROCESSABLE', undefined, [
          {
            field: 'amountPaise',
            message: `Must be exactly the fare: ${booking.finalFarePaise} paise`,
          },
        ]);
      }

      const t = now();
      const settled = await Booking.findOneAndUpdate(
        {
          _id: booking._id,
          status: 'COMPLETED',
          paymentStatus: { $in: ['DUE', 'FAILED'] },
          assignedDriverId: profile._id,
        },
        { paymentStatus: 'PAID', paidBy: `CASH:${profile._id}`, paidAt: t },
        { returnDocument: 'after' },
      );
      const mine = settled ?? (booking.paidBy === `CASH:${profile._id}` ? booking : null);
      if (!mine) {
        // Paid online, in progress online, written off...: never take cash for it.
        throw new AppError('CONFLICT', 'This ride is not waiting for a cash payment.');
      }
      await recordCash(mine, profile._id.toString());
      const standing = await enforceCashLimit(profile._id.toString());
      return {
        rideId: ride.publicId,
        bookingId: booking.publicId,
        paymentStatus: 'PAID' as const,
        amountPaise: booking.finalFarePaise,
        cashHeldPaise: standing.cashHeldPaise,
        netOwedToPlatformPaise: standing.netOwedByDriverPaise,
        limitPaise: standing.limitPaise,
        overLimit: standing.overLimit,
      };
    },

    /**
     * The rider acknowledges the cash they handed over. This never moves money: the driver's
     * confirmation is what settles the ride. If the rider's amount differs from the fare, the
     * difference is recorded as a cash dispute (and audited) for staff to look at.
     * Repeating the same amount is safe; a different amount after that is refused.
     */
    async customerConfirm(actor: Actor, ridePublicId: string, input: CustomerCashConfirmInput) {
      const ride = await Ride.findOne({ publicId: ridePublicId, customerId: actor.userId }).lean();
      if (!ride) throw new AppError('NOT_FOUND', 'Ride not found.');
      const booking = await Booking.findById(ride.bookingId);
      if (!booking || !booking.customerId.equals(actor.userId)) {
        throw new AppError('NOT_FOUND', 'Ride not found.');
      }
      if (booking.status !== 'COMPLETED' || !booking.finalFarePaise) {
        throw new AppError(
          'RIDE_INVALID_STATE',
          'Cash can only be confirmed once the ride is completed.',
        );
      }
      if (booking.paymentMethod !== 'CASH') {
        throw new AppError('CONFLICT', 'This ride is paid online, not in cash.');
      }
      const completedAt = booking.completedAt ?? ride.completedAt;
      if (completedAt && now().getTime() - completedAt.getTime() > CONFIRM_WINDOW_MS) {
        throw new AppError('UNPROCESSABLE', 'This ride ended too long ago to confirm cash.');
      }

      const matchesFare = input.amountPaise === booking.finalFarePaise;
      const t = now();
      const first = await Booking.findOneAndUpdate(
        { _id: booking._id, customerCashConfirmation: { $exists: false } },
        { customerCashConfirmation: { amountPaise: input.amountPaise, at: t, matchesFare } },
        { returnDocument: 'after' },
      );
      const current = first?.customerCashConfirmation ?? booking.customerCashConfirmation;
      if (!first) {
        if (!current || current.amountPaise !== input.amountPaise) {
          throw new AppError('CONFLICT', 'You have already confirmed a different amount.');
        }
      } else if (!matchesFare) {
        await audit.record(actor, {
          action: 'cash.customer_mismatch',
          targetType: 'Booking',
          targetId: booking.id,
          metadata: {
            ridePublicId,
            farePaise: booking.finalFarePaise,
            riderSaysPaise: input.amountPaise,
          },
        });
      }
      return {
        rideId: ride.publicId,
        bookingId: booking.publicId,
        farePaise: booking.finalFarePaise,
        confirmedPaise: current!.amountPaise,
        matchesFare: current!.matchesFare,
        // Has the driver recorded the cash yet? Until then the ride is still unpaid.
        driverRecordedCash: booking.paymentStatus === 'PAID' && /^CASH:/.test(booking.paidBy ?? ''),
      };
    },

    /** Finance records that a driver handed cash over (bank deposit). Reduces what they hold. */
    async deposit(actor: Actor, driverId: string, input: CashDepositInput, idempotencyKey: string) {
      const profile = await DriverProfile.findById(driverId).select('_id').lean();
      if (!profile) throw new AppError('NOT_FOUND', 'Driver not found.');
      const key = `deposit:${driverId}:${idempotencyKey}`;

      // A retry of a deposit that is already recorded returns it, instead of failing the
      // "enough cash" check against the now-smaller balance.
      const existing = await ledger.findByKey(key);
      if (!existing) {
        const before = await ledger.driverPosition(driverId);
        if (before.cashHeldPaise < input.amountPaise) {
          throw new AppError('UNPROCESSABLE', undefined, [
            { field: 'amountPaise', message: 'More than the cash this driver is holding' },
          ]);
        }
      }
      const posted = await ledger.post({
        kind: 'CASH_DEPOSIT',
        idempotencyKey: key,
        entries: [
          { account: Accounts.driverCash(driverId), amountPaise: -input.amountPaise },
          { account: Accounts.bank, amountPaise: input.amountPaise },
        ],
        driverId,
        description: input.reference ? `Cash deposit ${input.reference}` : 'Cash deposit',
        metadata: input.reference ? { reference: input.reference } : undefined,
        createdBy: actor.userId,
        at: now(),
      });
      if (posted.created) {
        await audit.record(actor, {
          action: 'finance.cash_deposit',
          targetType: 'DriverProfile',
          targetId: driverId,
          metadata: { amountPaise: input.amountPaise, reference: input.reference },
        });
      }
      const after = await ledger.driverPosition(driverId);
      return {
        txnId: posted.txnId,
        recorded: posted.created,
        ...after,
        limitPaise: config.driverCashLimitPaise,
      };
    },

    /** Repair: a ride marked cash-paid whose ledger entry never got written. */
    async reconcile(): Promise<{ recorded: number }> {
      const cutoff = new Date(now().getTime() - config.reconcileGraceMs);
      const rows = await Booking.find({
        paymentStatus: 'PAID',
        paidBy: /^CASH:/,
        cashRecordedAt: { $exists: false },
        paidAt: { $lte: cutoff },
      }).limit(100);
      for (const b of rows) await recordCash(b, b.paidBy!.slice('CASH:'.length));
      return { recorded: rows.length };
    },
  };
}

export type CashService = ReturnType<typeof createCashService>;
