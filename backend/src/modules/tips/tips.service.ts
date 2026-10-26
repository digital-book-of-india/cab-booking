import type { Types } from 'mongoose';
import { z } from 'zod';
import type { Logger } from 'pino';
import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import { publicId } from '../../common/ids';
import { Booking } from '../bookings/booking.model';
import type { FlagsService } from '../flags/flags.service';
import type { FinanceConfig } from '../ledger/finance.config';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PaymentDoc, PaymentsService } from '../payments/payments.service';
import { Ride } from '../rides/ride.model';
import { Tip, TipSources } from './tip.model';

const DUPLICATE_KEY = 11000;

export const tipSchema = z
  .object({
    amountPaise: z.number().int().min(1).max(100_000_000),
    source: z.enum(TipSources).default('ONLINE'),
  })
  .strict();
export type TipInput = z.infer<typeof tipSchema>;

type TipDoc = {
  _id: Types.ObjectId;
  publicId: string;
  ridePublicId: string;
  amountPaise: number;
  source: string;
  status: string;
  createdAt: Date;
  paidAt?: Date | null;
};

/** A tip is money from the rider to the driver, after the ride. No commission is taken. */
export function createTipsService(deps: {
  payments: PaymentsService;
  flags: FlagsService;
  notifications: Pick<NotificationsService, 'notify'>;
  now: () => Date;
  config: FinanceConfig;
  logger: Logger;
}) {
  const { payments, flags, notifications, now, config, logger } = deps;

  const view = (t: TipDoc, payment?: unknown) => ({
    tipId: t.publicId,
    rideId: t.ridePublicId,
    amountPaise: t.amountPaise,
    currency: 'INR',
    source: t.source,
    status: t.status,
    createdAt: t.createdAt,
    paidAt: t.paidAt ?? null,
    // For an online tip that still needs paying: what the checkout screen needs.
    ...(payment === undefined ? {} : { payment }),
  });

  /** A payment of ours that lands: the tip is paid and the driver is told. Safe to repeat. */
  async function onPaid(p: PaymentDoc): Promise<void> {
    if (!p.refPublicId) return;
    let tip;
    try {
      tip = await Tip.findOneAndUpdate(
        { publicId: p.refPublicId, status: { $in: ['PENDING', 'FAILED'] } },
        { status: 'PAID', paidAt: p.paidAt ?? now(), paymentPublicId: p.publicId },
        { returnDocument: 'after' },
      );
    } catch (err) {
      if ((err as { code?: number }).code === DUPLICATE_KEY) {
        // A second tip for the same ride was paid late. The driver is still credited in the ledger.
        logger.error(
          { paymentId: p.publicId, tip: p.refPublicId },
          'a second tip was paid for one ride',
        );
        return;
      }
      throw err;
    }
    if (!tip) return; // already marked paid by an earlier run
    await notifications
      .notify(tip.driverUserId.toString(), {
        type: 'tip.received',
        title: 'You received a tip',
        body: `Your rider tipped ₹${(tip.amountPaise / 100).toFixed(0)}. Thank you for the great ride.`,
        data: { rideId: tip.ridePublicId },
        dedupeKey: `tip:${tip.publicId}`,
      })
      .catch((err) => logger.error({ err }, 'could not tell the driver about a tip'));
  }

  return {
    onPaid,

    async tip(customerId: string, ridePublicId: string, input: TipInput, idempotencyKey: string) {
      await flags.assertEnabled('TIPS', 'CUSTOMER');
      if (input.source === 'WALLET') await flags.assertEnabled('WALLET', 'CUSTOMER');
      if (input.amountPaise < config.tipMinPaise || input.amountPaise > config.tipMaxPaise) {
        throw new AppError('UNPROCESSABLE', undefined, [
          {
            field: 'amountPaise',
            message: `A tip is between ₹${config.tipMinPaise / 100} and ₹${config.tipMaxPaise / 100}`,
          },
        ]);
      }
      const ride = await Ride.findOne({ publicId: ridePublicId, customerId });
      if (!ride) throw new AppError('NOT_FOUND', 'Ride not found.');
      const booking = await Booking.findById(ride.bookingId);
      if (!booking || booking.status !== 'COMPLETED' || !booking.completedAt) {
        throw new AppError('RIDE_INVALID_STATE', 'You can tip once the ride is completed.');
      }

      const sameKey = await Tip.findOne({ customerId, idempotencyKey });
      if (sameKey) {
        if (sameKey.bookingId.toString() !== booking._id.toString()) {
          throw new AppError('IDEMPOTENCY_KEY_REUSED');
        }
        return view(sameKey, await payments.viewByRef(sameKey.publicId));
      }
      if (now().getTime() - booking.completedAt.getTime() > config.tipWindowMs) {
        throw new AppError('UNPROCESSABLE', 'The time to tip for this ride has passed.');
      }

      const live = await Tip.findOne({
        bookingId: booking._id,
        status: { $in: ['PENDING', 'PAID'] },
      });
      if (live?.status === 'PAID')
        throw new AppError('CONFLICT', 'You have already tipped for this ride.');
      if (live) {
        const pay = await payments.viewByRef(live.publicId);
        if (pay && pay.status === 'CREATED') {
          throw new AppError('CONFLICT', 'A tip payment for this ride is already in progress.');
        }
        await Tip.updateOne({ _id: live._id, status: 'PENDING' }, { status: 'FAILED' });
      }

      let created;
      try {
        created = await Tip.create({
          ...(input.source === 'CASH' ? { status: 'PAID', paidAt: now() } : {}),
          publicId: publicId('tip'),
          bookingId: booking._id,
          bookingPublicId: booking.publicId,
          ridePublicId: ride.publicId,
          customerId,
          driverId: ride.driverId,
          driverUserId: ride.driverUserId,
          amountPaise: input.amountPaise,
          source: input.source,
          idempotencyKey,
        });
      } catch (err) {
        if ((err as { code?: number }).code === DUPLICATE_KEY) {
          const raced = await Tip.findOne({ customerId, idempotencyKey });
          if (raced) return view(raced, await payments.viewByRef(raced.publicId));
          throw new AppError('CONFLICT', 'A tip for this ride is already in progress.');
        }
        throw err;
      }

      if (input.source === 'CASH') {
        // Nothing to pay through us: record it and tell the driver.
        await notifications
          .notify(created.driverUserId.toString(), {
            type: 'tip.received',
            title: 'Your rider says they tipped you in cash',
            body: `Your rider says they gave you a ₹${(created.amountPaise / 100).toFixed(0)} tip in cash. Thank you for the great ride.`,
            data: { rideId: created.ridePublicId },
            dedupeKey: `tip:${created.publicId}`,
          })
          .catch((err) => logger.error({ err }, 'could not tell the driver about a cash tip'));
        return view(created);
      }

      try {
        const target = { _id: booking._id, publicId: booking.publicId };
        const payment =
          input.source === 'WALLET'
            ? await payments.payTipFromWallet(customerId, {
                amountPaise: input.amountPaise,
                idempotencyKey,
                booking: target,
                payeeDriverId: ride.driverId,
                refPublicId: created.publicId,
              })
            : await payments.startAux(customerId, {
                purpose: 'TIP',
                amountPaise: input.amountPaise,
                idempotencyKey,
                booking: target,
                payeeDriverId: ride.driverId,
                refPublicId: created.publicId,
              });
        await Tip.updateOne({ _id: created._id }, { paymentPublicId: payment.paymentId });
        return view((await Tip.findById(created._id))!, payment);
      } catch (err) {
        await Tip.updateOne({ _id: created._id, status: 'PENDING' }, { status: 'FAILED' });
        throw err;
      }
    },

    /** The rider sees their own tip (and can finish paying it); the driver sees it once it is paid. */
    async forRide(actor: Actor, ridePublicId: string) {
      const ride = await Ride.findOne({ publicId: ridePublicId });
      const isRider = ride?.customerId.toString() === actor.userId;
      const isDriver = ride?.driverUserId.toString() === actor.userId;
      if (!ride || (!isRider && !isDriver)) throw new AppError('NOT_FOUND', 'Ride not found.');
      const tip = await Tip.findOne({
        bookingId: ride.bookingId,
        status: isDriver ? 'PAID' : { $in: ['PENDING', 'PAID'] },
      }).sort({ createdAt: -1 });
      if (!tip) return { tip: null };
      return {
        tip: view(tip, isRider ? await payments.viewByRef(tip.publicId) : undefined),
      };
    },
  };
}

export type TipsService = ReturnType<typeof createTipsService>;
