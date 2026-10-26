import { createHash } from 'node:crypto';
import type { Types } from 'mongoose';
import { z } from 'zod';
import type { Logger } from 'pino';
import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import { publicId } from '../../common/ids';
import { pageMeta, paginationSchema } from '../../common/pagination';
import type { PaymentsProvider } from '../../providers';
import type { AuditService } from '../audit/audit.service';
import { Booking } from '../bookings/booking.model';
import { Accounts } from '../ledger/accounts';
import type { FinanceConfig } from '../ledger/finance.config';
import type { LedgerService } from '../ledger/ledger.service';
import type { WalletService } from '../wallet/wallet.service';
import { amountDue } from './amountDue';
import { Payment } from './payment.model';
import { Refund } from './refund.model';
import { WebhookEvent } from './webhookEvent.model';

const DUPLICATE_KEY = 11000;

export const verifyPaymentSchema = z
  .object({
    orderId: z.string().trim().min(3).max(100),
    paymentId: z.string().trim().min(3).max(100),
    signature: z.string().trim().min(10).max(200),
  })
  .strict();

export const refundSchema = z
  .object({
    amountPaise: z.number().int().min(1).max(10_000_000),
    reason: z.string().trim().min(3).max(300),
    // ORIGINAL = back through the gateway (the default); WALLET = credited to the rider's wallet at once.
    destination: z.enum(['ORIGINAL', 'WALLET']).default('ORIGINAL'),
  })
  .strict();

export const paymentListQuerySchema = paginationSchema.extend({
  status: z.enum(['CREATED', 'PAID', 'FAILED', 'EXPIRED']).optional(),
  bookingId: z
    .string()
    .regex(/^bk_[0-9a-f]{12}$/)
    .optional(),
});

export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;
export type RefundInput = z.infer<typeof refundSchema>;
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;

type PaymentDoc = {
  _id: Types.ObjectId;
  publicId: string;
  bookingId?: Types.ObjectId | null | undefined;
  bookingPublicId?: string | null | undefined;
  customerId: Types.ObjectId;
  amountPaise: number;
  purpose: string;
  method?: string | null | undefined;
  payeeDriverId?: Types.ObjectId | null | undefined;
  refPublicId?: string | null | undefined;
  status: string;
  providerOrderId: string;
  providerPaymentId?: string | null;
  refundedPaise?: number | null;
  paidAt?: Date | null;
  expiresAt: Date;
  createdAt: Date;
};

export function createPaymentsService(deps: {
  provider: PaymentsProvider;
  ledger: LedgerService;
  audit: AuditService;
  now: () => Date;
  logger: Logger;
  config: FinanceConfig;
  wallet: WalletService;
}) {
  const { provider, ledger, audit, now, logger, config, wallet } = deps;
  /** Told when a tip is paid (set by the tips service, which depends on this one). */
  let paidHook: ((p: PaymentDoc) => Promise<void>) | null = null;

  const view = (p: PaymentDoc) => ({
    paymentId: p.publicId,
    bookingId: p.bookingPublicId ?? null,
    method: p.method ?? 'GATEWAY',
    orderId: p.providerOrderId,
    amountPaise: p.amountPaise,
    currency: 'INR',
    purpose: p.purpose,
    status: p.status,
    refundedPaise: p.refundedPaise ?? 0,
    paidAt: p.paidAt ?? null,
    expiresAt: p.expiresAt,
    createdAt: p.createdAt,
    // What the app's checkout screen needs. The secret key never leaves the server.
    // (Nothing to check out when it was paid from the wallet.)
    checkout:
      p.method === 'WALLET'
        ? null
        : { key: provider.checkoutKey, orderId: p.providerOrderId, amountPaise: p.amountPaise },
  });

  /* ---------------- paying ---------------- */

  /**
   * Begin paying a booking online. The server decides the amount. Safe to repeat: the same
   * Idempotency-Key, or a payment already in progress for this booking, returns the same order.
   */
  async function start(customerId: string, bookingPublicId: string, idempotencyKey: string) {
    const booking = await Booking.findOne({ publicId: bookingPublicId, customerId });
    if (!booking) throw new AppError('NOT_FOUND', 'Booking not found.');

    const sameKey = await Payment.findOne({ customerId, idempotencyKey });
    if (sameKey) {
      if (sameKey.bookingId?.toString() !== booking._id.toString()) {
        throw new AppError('IDEMPOTENCY_KEY_REUSED');
      }
      return view(sameKey);
    }
    const open = await Payment.findOne({
      bookingId: booking._id,
      purpose: { $in: ['FARE', 'FEE'] },
      method: { $ne: 'WALLET' },
      status: 'CREATED',
      expiresAt: { $gt: now() },
    });
    if (open) return view(open); // a payment is already under way: carry on with it

    const due = amountDue(booking);
    if (!due) {
      throw new AppError(
        'CONFLICT',
        booking.paymentStatus === 'PAID'
          ? 'This booking is already paid.'
          : 'There is nothing to pay on this booking.',
      );
    }

    // Reserve the booking so cash and online cannot both settle it.
    const reserved = await Booking.findOneAndUpdate(
      { _id: booking._id, paymentStatus: { $in: ['DUE', 'FAILED'] } },
      { paymentStatus: 'PROCESSING' },
      { returnDocument: 'after' },
    );
    if (!reserved)
      throw new AppError('CONFLICT', 'A payment for this booking is already in progress.');

    const id = publicId('pay');
    let orderId: string;
    try {
      ({ orderId } = await provider.createOrder({
        amountPaise: due.amountPaise,
        receipt: id,
        notes: { bookingId: booking.publicId },
      }));
    } catch (err) {
      await Booking.updateOne(
        { _id: booking._id, paymentStatus: 'PROCESSING' },
        { paymentStatus: booking.paymentStatus },
      );
      logger.error({ err, bookingId: booking.publicId }, 'could not create payment order');
      throw new AppError('PROVIDER_ERROR', 'Could not start the payment. Please try again.');
    }

    try {
      const created = await Payment.create({
        publicId: id,
        bookingId: booking._id,
        bookingPublicId: booking.publicId,
        customerId,
        amountPaise: due.amountPaise,
        purpose: due.purpose,
        providerOrderId: orderId,
        idempotencyKey,
        expiresAt: new Date(now().getTime() + config.paymentOrderTtlMs),
      });
      return view(created);
    } catch (err) {
      if ((err as { code?: number }).code === DUPLICATE_KEY) {
        const raced = await Payment.findOne({ customerId, idempotencyKey });
        if (raced) return view(raced);
      }
      throw err;
    }
  }

  const markLedgerRecorded = (p: PaymentDoc) =>
    Payment.updateOne(
      { _id: (p as unknown as { _id: Types.ObjectId })._id, ledgerRecordedAt: { $exists: false } },
      { ledgerRecordedAt: now() },
    );

  /** The payment is confirmed: settle what it was for and record the money. Safe to run repeatedly. */
  async function finishPaid(p: PaymentDoc): Promise<void> {
    const at = p.paidAt ?? now();
    const customer = p.customerId.toString();
    // Where the money came from: Razorpay's balance, or the rider's wallet.
    const source = p.method === 'WALLET' ? Accounts.wallet(customer) : Accounts.gateway;

    if (p.purpose === 'TOPUP') {
      await ledger.post({
        kind: 'WALLET_TOPUP',
        idempotencyKey: `pay:${p.publicId}`,
        entries: [
          { account: Accounts.gateway, amountPaise: p.amountPaise },
          { account: Accounts.wallet(customer), amountPaise: -p.amountPaise },
        ],
        customerId: p.customerId,
        description: 'Wallet top-up',
        at,
      });
      // A bonus for topping up (when switched on): the platform pays it, from promotions.
      const bonus =
        config.walletBonusBp > 0 && p.amountPaise >= config.walletBonusMinTopupPaise
          ? Math.min(
              Math.round((p.amountPaise * config.walletBonusBp) / 10_000),
              config.walletBonusMaxPaise,
            )
          : 0;
      if (bonus > 0) {
        await ledger.post({
          kind: 'WALLET_BONUS',
          idempotencyKey: `bonus:${p.publicId}`,
          entries: [
            { account: Accounts.promotions, amountPaise: bonus },
            { account: Accounts.wallet(customer), amountPaise: -bonus },
          ],
          customerId: p.customerId,
          description: 'Top-up bonus',
          at,
        });
      }
      await markLedgerRecorded(p);
      return;
    }

    if (p.purpose === 'TIP') {
      // The driver gets the whole tip: no commission.
      await ledger.post({
        kind: 'TIP_PAYMENT',
        idempotencyKey: `pay:${p.publicId}`,
        entries: [
          { account: source, amountPaise: p.amountPaise },
          {
            account: Accounts.driverPayable(p.payeeDriverId!.toString()),
            amountPaise: -p.amountPaise,
          },
        ],
        ...(p.bookingId ? { bookingId: p.bookingId } : {}),
        ...(p.bookingPublicId ? { bookingPublicId: p.bookingPublicId } : {}),
        driverId: p.payeeDriverId!,
        customerId: p.customerId,
        description: 'Tip',
        at,
      });
      await markLedgerRecorded(p);
      await paidHook?.(p);
      return;
    }

    // The booking is marked with the payment that settled it, so a re-run can tell "ours" from
    // "someone else already settled this" (cash, write-off).
    const settled = await Booking.findOneAndUpdate(
      { _id: p.bookingId, paymentStatus: { $in: ['PROCESSING', 'DUE', 'FAILED'] } },
      { paymentStatus: 'PAID', paidBy: p.publicId, paidAt: at },
      { returnDocument: 'after' },
    );
    const booking = settled ?? (await Booking.findById(p.bookingId).lean());
    const ours = booking?.paidBy === p.publicId;
    const duplicate = !ours;

    await ledger.post({
      kind: p.method === 'WALLET' ? 'WALLET_PAYMENT' : 'ONLINE_PAYMENT',
      idempotencyKey: `pay:${p.publicId}`,
      entries: [
        { account: source, amountPaise: p.amountPaise },
        { account: Accounts.riderReceivable(customer), amountPaise: -p.amountPaise },
      ],
      bookingId: p.bookingId!,
      bookingPublicId: p.bookingPublicId!,
      customerId: p.customerId,
      description: duplicate
        ? 'Payment (booking already settled)'
        : p.method === 'WALLET'
          ? 'Paid from wallet'
          : 'Online payment',
      at,
    });
    await markLedgerRecorded(p);

    // Paid twice (e.g. cash was taken while the rider's online payment was still in flight):
    // the second payment goes straight back (to the wallet if that is where it came from).
    if (duplicate) {
      await refundInternal(
        null,
        (p as unknown as { _id: Types.ObjectId })._id,
        p.amountPaise,
        'Duplicate payment: booking was already settled',
        `auto-refund:${p.publicId}`,
        p.method === 'WALLET' ? 'WALLET' : 'ORIGINAL',
      ).catch((err) => logger.error({ err, paymentId: p.publicId }, 'automatic refund failed'));
    }
  }

  async function markPaid(payment: PaymentDoc, providerPaymentId: string): Promise<PaymentDoc> {
    const paid = await Payment.findOneAndUpdate(
      { _id: payment._id, status: { $in: ['CREATED', 'FAILED', 'EXPIRED'] } },
      { status: 'PAID', providerPaymentId, paidAt: now() },
      { returnDocument: 'after' },
    );
    // Not changed: it was already paid (a repeat of verify / webhook). Make sure it is finished.
    const current = (paid ?? (await Payment.findById(payment._id))) as unknown as PaymentDoc;
    await finishPaid(current);
    return (await Payment.findById(payment._id)) as unknown as PaymentDoc;
  }

  async function markFailed(payment: PaymentDoc, reason: string): Promise<void> {
    const failed = await Payment.findOneAndUpdate(
      { _id: payment._id, status: 'CREATED' },
      { status: 'FAILED', failureReason: reason.slice(0, 200) },
    );
    if (!failed) return;
    if (payment.bookingId && ['FARE', 'FEE'].includes(payment.purpose)) {
      await releaseBooking(payment.bookingId);
    }
  }

  /** Put a booking back to "payable" if no other payment attempt is still open for it. */
  async function releaseBooking(bookingId: Types.ObjectId) {
    const stillOpen = await Payment.exists({
      bookingId,
      purpose: { $in: ['FARE', 'FEE'] },
      status: 'CREATED',
      expiresAt: { $gt: now() },
    });
    if (stillOpen) return;
    await Booking.updateOne(
      { _id: bookingId, paymentStatus: 'PROCESSING' },
      { paymentStatus: 'DUE' },
    );
  }

  /** The app says it paid. We believe only the signature, which only Razorpay and we can make. */
  async function verify(customerId: string, input: VerifyPaymentInput) {
    const payment = await Payment.findOne({ providerOrderId: input.orderId, customerId });
    if (!payment) throw new AppError('NOT_FOUND', 'Payment not found.');
    if (!provider.verifyPaymentSignature(input)) throw new AppError('PAYMENT_SIGNATURE_INVALID');
    const done = await markPaid(payment as unknown as PaymentDoc, input.paymentId);
    return view(done);
  }

  /** The latest payment attempt made for something else (e.g. a tip), if there is one. */
  async function viewByRef(refPublicId: string) {
    const p = await Payment.findOne({ refPublicId }).sort({ createdAt: -1 });
    return p ? view(p as unknown as PaymentDoc) : null;
  }

  async function get(actor: Actor, paymentPublicId: string) {
    const payment = await Payment.findOne({ publicId: paymentPublicId });
    const staff = ['SUPPORT', 'OPS', 'FINANCE', 'SUPER_ADMIN'].includes(actor.role);
    if (!payment || (!staff && payment.customerId.toString() !== actor.userId)) {
      throw new AppError('NOT_FOUND', 'Payment not found.');
    }
    return view(payment as unknown as PaymentDoc);
  }

  async function list(query: PaymentListQuery) {
    const { page, limit, status, bookingId } = query;
    const filter: Record<string, unknown> = {};
    if (status) filter['status'] = status;
    if (bookingId) filter['bookingPublicId'] = bookingId;
    const [total, rows] = await Promise.all([
      Payment.countDocuments(filter),
      Payment.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);
    return {
      items: rows.map((p) => view(p as unknown as PaymentDoc)),
      meta: pageMeta(page, limit, total),
    };
  }

  /* ---------------- tips and wallet top-ups (not about a booking's fare) ---------------- */

  /** Start a gateway payment for a tip or a wallet top-up. The amount was already checked by the caller. */
  async function startAux(
    customerId: string,
    input: {
      purpose: 'TIP' | 'TOPUP';
      amountPaise: number;
      idempotencyKey: string;
      booking?: { _id: Types.ObjectId; publicId: string };
      payeeDriverId?: Types.ObjectId;
      refPublicId?: string;
    },
  ) {
    const sameKey = await Payment.findOne({ customerId, idempotencyKey: input.idempotencyKey });
    if (sameKey) return view(sameKey);
    const id = publicId('pay');
    let orderId: string;
    try {
      ({ orderId } = await provider.createOrder({
        amountPaise: input.amountPaise,
        receipt: id,
        notes: {
          purpose: input.purpose,
          ...(input.booking ? { bookingId: input.booking.publicId } : {}),
        },
      }));
    } catch (err) {
      logger.error({ err, purpose: input.purpose }, 'could not create payment order');
      throw new AppError('PROVIDER_ERROR', 'Could not start the payment. Please try again.');
    }
    try {
      const created = await Payment.create({
        publicId: id,
        ...(input.booking
          ? { bookingId: input.booking._id, bookingPublicId: input.booking.publicId }
          : {}),
        customerId,
        amountPaise: input.amountPaise,
        purpose: input.purpose,
        providerOrderId: orderId,
        idempotencyKey: input.idempotencyKey,
        ...(input.payeeDriverId ? { payeeDriverId: input.payeeDriverId } : {}),
        ...(input.refPublicId ? { refPublicId: input.refPublicId } : {}),
        expiresAt: new Date(now().getTime() + config.paymentOrderTtlMs),
      });
      return view(created);
    } catch (err) {
      if ((err as { code?: number }).code === DUPLICATE_KEY) {
        const raced = await Payment.findOne({ customerId, idempotencyKey: input.idempotencyKey });
        if (raced) return view(raced);
      }
      throw err;
    }
  }

  /** Pay a booking's fare or fee from the rider's wallet balance. Instant; no gateway involved. */
  async function payBookingFromWallet(
    customerId: string,
    bookingPublicId: string,
    idempotencyKey: string,
  ) {
    const booking = await Booking.findOne({ publicId: bookingPublicId, customerId });
    if (!booking) throw new AppError('NOT_FOUND', 'Booking not found.');
    const sameKey = await Payment.findOne({ customerId, idempotencyKey });
    if (sameKey) {
      if (sameKey.bookingId?.toString() !== booking._id.toString()) {
        throw new AppError('IDEMPOTENCY_KEY_REUSED');
      }
      return view(sameKey);
    }
    const due = amountDue(booking);
    if (!due) {
      throw new AppError(
        'CONFLICT',
        booking.paymentStatus === 'PAID'
          ? 'This booking is already paid.'
          : 'There is nothing to pay on this booking.',
      );
    }
    // Reserve the booking so cash, card and wallet cannot all settle it.
    const reserved = await Booking.findOneAndUpdate(
      { _id: booking._id, paymentStatus: { $in: ['DUE', 'FAILED'] } },
      { paymentStatus: 'PROCESSING' },
      { returnDocument: 'after' },
    );
    if (!reserved)
      throw new AppError('CONFLICT', 'A payment for this booking is already in progress.');

    const state = { charged: false };
    try {
      return await wallet.withLock(customerId, async () => {
        await wallet.assertCanSpend(customerId, due.amountPaise);
        const id = publicId('pay');
        const at = now();
        const doc = await Payment.create({
          publicId: id,
          bookingId: booking._id,
          bookingPublicId: booking.publicId,
          customerId,
          amountPaise: due.amountPaise,
          purpose: due.purpose,
          method: 'WALLET',
          status: 'PAID',
          providerOrderId: `wallet_${id}`,
          providerPaymentId: `wallet_${id}`,
          idempotencyKey,
          expiresAt: at,
          paidAt: at,
        });
        state.charged = true;
        await finishPaid(doc as unknown as PaymentDoc);
        return view((await Payment.findById(doc._id)) as unknown as PaymentDoc);
      });
    } catch (err) {
      // Nothing was charged: put the booking back so the rider can pay another way.
      if (!state.charged) {
        await Booking.updateOne(
          { _id: booking._id, paymentStatus: 'PROCESSING' },
          { paymentStatus: booking.paymentStatus },
        );
      }
      throw err;
    }
  }

  /** Pay a tip from the wallet balance. */
  async function payTipFromWallet(
    customerId: string,
    input: {
      amountPaise: number;
      idempotencyKey: string;
      booking: { _id: Types.ObjectId; publicId: string };
      payeeDriverId: Types.ObjectId;
      refPublicId: string;
    },
  ) {
    return wallet.withLock(customerId, async () => {
      await wallet.assertCanSpend(customerId, input.amountPaise);
      const id = publicId('pay');
      const at = now();
      const doc = await Payment.create({
        publicId: id,
        bookingId: input.booking._id,
        bookingPublicId: input.booking.publicId,
        customerId,
        amountPaise: input.amountPaise,
        purpose: 'TIP',
        method: 'WALLET',
        status: 'PAID',
        providerOrderId: `wallet_${id}`,
        providerPaymentId: `wallet_${id}`,
        idempotencyKey: input.idempotencyKey,
        payeeDriverId: input.payeeDriverId,
        refPublicId: input.refPublicId,
        expiresAt: at,
        paidAt: at,
      });
      await finishPaid(doc as unknown as PaymentDoc);
      return view((await Payment.findById(doc._id)) as unknown as PaymentDoc);
    });
  }

  /* ---------------- refunds ---------------- */

  /**
   * The ride GST that goes back with a refund: the refunded share of the payment, of the tax charged on
   * the ride. Only fare payments carry ride tax (fees, tips and top-ups do not). Worked out once and kept
   * on the refund, and never more than the tax still held, so the refunds of one payment add up to at most
   * the tax charged.
   */
  async function taxReversedBy(
    refund: {
      _id: Types.ObjectId;
      bookingId: Types.ObjectId;
      paymentId: Types.ObjectId;
      amountPaise: number;
      taxReversedPaise?: number | null;
    },
    payment: { purpose: string; amountPaise: number },
  ): Promise<number> {
    if (refund.taxReversedPaise !== undefined && refund.taxReversedPaise !== null) {
      return refund.taxReversedPaise;
    }
    let taxBack = 0;
    if (payment.purpose === 'FARE') {
      const booking = await Booking.findById(refund.bookingId).select('taxPaise').lean();
      const charged = booking?.taxPaise ?? 0;
      if (charged > 0) {
        const [already] = await Refund.aggregate<{ total: number }>([
          {
            $match: { paymentId: refund.paymentId, status: 'PROCESSED', _id: { $ne: refund._id } },
          },
          { $group: { _id: null, total: { $sum: { $ifNull: ['$taxReversedPaise', 0] } } } },
        ]);
        const left = Math.max(0, charged - (already?.total ?? 0));
        taxBack = Math.min(left, Math.round((refund.amountPaise * charged) / payment.amountPaise));
      }
    }
    const stored = await Refund.findOneAndUpdate(
      { _id: refund._id, taxReversedPaise: { $exists: false } },
      { taxReversedPaise: taxBack },
      { returnDocument: 'after' },
    );
    return (stored ?? (await Refund.findById(refund._id)))?.taxReversedPaise ?? taxBack;
  }

  async function markRefundProcessed(refundId: Types.ObjectId): Promise<void> {
    const done = await Refund.findOneAndUpdate(
      { _id: refundId, status: 'REQUESTED' },
      { status: 'PROCESSED', processedAt: now() },
      { returnDocument: 'after' },
    );
    const refund = done ?? (await Refund.findById(refundId));
    if (!refund || refund.status !== 'PROCESSED') return;
    const payment = await Payment.findById(refund.paymentId).lean();
    if (!payment) return;
    // Platform bears the refund: the driver's share is untouched. The money either leaves the
    // gateway, or stays with us and is credited to the rider's wallet.
    const toWallet = refund.destination === 'WALLET';
    const taxBack = await taxReversedBy(refund, payment);
    await ledger.post({
      kind: 'REFUND',
      idempotencyKey: `refund:${refund.publicId}`,
      entries: [
        {
          account: toWallet ? Accounts.wallet(payment.customerId.toString()) : Accounts.gateway,
          amountPaise: -refund.amountPaise,
        },
        { account: Accounts.refunds, amountPaise: refund.amountPaise - taxBack },
        ...(taxBack > 0 ? [{ account: Accounts.taxPayable, amountPaise: taxBack }] : []),
      ],
      bookingId: refund.bookingId,
      bookingPublicId: payment.bookingPublicId!,
      customerId: payment.customerId,
      description: toWallet ? `Refund to wallet: ${refund.reason}` : refund.reason,
      at: refund.processedAt ?? now(),
    });
    await syncBookingAfterRefund(refund.bookingId, refund.paymentId);
  }

  async function markRefundFailed(refundId: Types.ObjectId): Promise<void> {
    const failed = await Refund.findOneAndUpdate(
      { _id: refundId, status: 'REQUESTED' },
      { status: 'FAILED' },
    );
    if (!failed) return;
    // Give the reserved amount back so the refund can be tried again.
    await Payment.updateOne(
      { _id: failed.paymentId },
      { $inc: { refundedPaise: -failed.amountPaise } },
    );
    await syncBookingAfterRefund(failed.bookingId, failed.paymentId);
  }

  /** REFUNDED once everything is refunded; back to PAID when nothing is pending any more. */
  async function syncBookingAfterRefund(bookingId: Types.ObjectId, paymentId: Types.ObjectId) {
    const payment = await Payment.findById(paymentId).lean();
    if (!payment) return;
    const [processed, pending] = await Promise.all([
      Refund.aggregate<{ total: number }>([
        { $match: { paymentId, status: 'PROCESSED' } },
        { $group: { _id: null, total: { $sum: '$amountPaise' } } },
      ]),
      Refund.exists({ paymentId, status: 'REQUESTED' }),
    ]);
    const refunded = processed[0]?.total ?? 0;
    // Only the payment that actually settled the booking moves its status (refunding a DUPLICATE
    // payment leaves a cash-paid booking alone).
    const settledByThis = { _id: bookingId, paidBy: payment.publicId };
    if (refunded >= payment.amountPaise) {
      await Booking.updateOne(settledByThis, { paymentStatus: 'REFUNDED' });
    } else if (!pending) {
      await Booking.updateOne(
        { ...settledByThis, paymentStatus: 'REFUND_PENDING' },
        { paymentStatus: 'PAID' },
      );
    }
  }

  /**
   * Ask Razorpay for a refund. The amount is reserved first (conditionally), so two refunds can
   * never add up to more than was paid. `actor` is null for automatic refunds.
   */
  async function refundInternal(
    actor: Actor | null,
    paymentId: Types.ObjectId,
    amountPaise: number,
    reason: string,
    idempotencyKey: string,
    requestedDestination: 'ORIGINAL' | 'WALLET' = 'ORIGINAL',
  ) {
    const existing = await Refund.findOne({ idempotencyKey });
    if (existing) return existing;

    const original = await Payment.findById(paymentId).select('purpose method').lean();
    if (!original) throw new AppError('NOT_FOUND', 'Payment not found.');
    if (!['FARE', 'FEE'].includes(original.purpose)) {
      throw new AppError('UNPROCESSABLE', 'Tips and wallet top-ups cannot be refunded here.');
    }
    // Money that came from the wallet can only go back to the wallet.
    const destination = original.method === 'WALLET' ? 'WALLET' : requestedDestination;

    const reserved = await Payment.findOneAndUpdate(
      {
        _id: paymentId,
        status: 'PAID',
        providerPaymentId: { $exists: true },
        $expr: {
          $lte: [{ $add: [{ $ifNull: ['$refundedPaise', 0] }, amountPaise] }, '$amountPaise'],
        },
      },
      { $inc: { refundedPaise: amountPaise } },
      { returnDocument: 'after' },
    );
    if (!reserved) {
      throw new AppError('UNPROCESSABLE', undefined, [
        { field: 'amountPaise', message: 'More than is left to refund on this payment' },
      ]);
    }
    let refund;
    try {
      refund = await Refund.create({
        publicId: publicId('rfd'),
        paymentId,
        bookingId: reserved.bookingId!,
        amountPaise,
        reason,
        destination,
        idempotencyKey,
        ...(actor ? { createdBy: actor.userId } : {}),
      });
    } catch (err) {
      await Payment.updateOne({ _id: paymentId }, { $inc: { refundedPaise: -amountPaise } });
      if ((err as { code?: number }).code === DUPLICATE_KEY) {
        const raced = await Refund.findOne({ idempotencyKey });
        if (raced) return raced;
      }
      throw err;
    }
    await Booking.updateOne(
      { _id: reserved.bookingId, paymentStatus: 'PAID', paidBy: reserved.publicId },
      { paymentStatus: 'REFUND_PENDING' },
    );

    if (destination === 'WALLET') {
      // Nothing to ask the gateway: the money is simply credited to the wallet.
      await markRefundProcessed(refund._id);
    } else
      try {
        const res = await provider.createRefund({
          paymentId: reserved.providerPaymentId!,
          amountPaise,
          receipt: refund.publicId,
        });
        await Refund.updateOne({ _id: refund._id }, { providerRefundId: res.refundId });
        if (res.status === 'processed') await markRefundProcessed(refund._id);
        else if (res.status === 'failed') await markRefundFailed(refund._id);
      } catch (err) {
        logger.error({ err, refundId: refund.publicId }, 'refund request failed');
        await markRefundFailed(refund._id);
        throw new AppError('PROVIDER_ERROR', 'The refund could not be started. Please try again.');
      }
    if (actor) {
      await audit.record(actor, {
        action: 'finance.refund',
        targetType: 'Refund',
        targetId: refund.publicId,
        metadata: { paymentId: reserved.publicId, amountPaise, reason, destination },
      });
    }
    return (await Refund.findById(refund._id))!;
  }

  const refundView = (r: {
    publicId: string;
    amountPaise: number;
    status: string;
    reason: string;
    destination?: string | null;
    providerRefundId?: string | null;
    createdAt: Date;
  }) => ({
    refundId: r.publicId,
    amountPaise: r.amountPaise,
    status: r.status,
    destination: r.destination ?? 'ORIGINAL',
    reason: r.reason,
    providerRefundId: r.providerRefundId ?? null,
    createdAt: r.createdAt,
  });

  async function refund(
    actor: Actor,
    bookingPublicId: string,
    input: RefundInput,
    idempotencyKey: string,
  ) {
    const booking = await Booking.findOne({ publicId: bookingPublicId }).select('_id').lean();
    if (!booking) throw new AppError('NOT_FOUND', 'Booking not found.');
    const payment = await Payment.findOne({
      bookingId: booking._id,
      purpose: { $in: ['FARE', 'FEE'] },
      status: 'PAID',
    }).sort({ paidAt: -1 });
    if (!payment) {
      throw new AppError(
        'UNPROCESSABLE',
        'This booking has no online or wallet payment to refund.',
      );
    }
    const r = await refundInternal(
      actor,
      payment._id,
      input.amountPaise,
      input.reason,
      `refund-req:${idempotencyKey}`,
      input.destination,
    );
    return refundView(r);
  }

  /* ---------------- webhook ---------------- */

  type WebhookBody = {
    event?: string;
    payload?: {
      payment?: {
        entity?: { id?: string; order_id?: string; amount?: number; error_description?: string };
      };
      refund?: { entity?: { id?: string } };
    };
  };

  /**
   * Razorpay tells us what really happened. The signature is checked on the exact bytes received,
   * and every delivery is recorded once, so a redelivery does nothing.
   */
  async function handleWebhook(rawBody: Buffer, signature: string, eventIdHeader?: string) {
    if (!provider.verifyWebhookSignature(rawBody, signature)) {
      throw new AppError('PAYMENT_SIGNATURE_INVALID');
    }
    let body: WebhookBody;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as WebhookBody;
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
      const outcome = await applyWebhook(body);
      await WebhookEvent.updateOne({ eventId }, { outcome });
      return { duplicate: false, outcome };
    } catch (err) {
      // Forget it, so Razorpay's retry is processed instead of being taken for a duplicate.
      await WebhookEvent.deleteOne({ eventId });
      throw err;
    }
  }

  async function applyWebhook(body: WebhookBody): Promise<string> {
    const entity = body.payload?.payment?.entity;
    switch (body.event) {
      case 'payment.captured':
      case 'order.paid': {
        if (!entity?.order_id || !entity.id) return 'IGNORED_INCOMPLETE';
        const payment = await Payment.findOne({ providerOrderId: entity.order_id });
        if (!payment) return 'UNKNOWN_ORDER';
        if (entity.amount !== undefined && entity.amount !== payment.amountPaise) {
          logger.error(
            { paymentId: payment.publicId, got: entity.amount },
            'webhook amount mismatch',
          );
          return 'AMOUNT_MISMATCH';
        }
        await markPaid(payment as unknown as PaymentDoc, entity.id);
        return 'PAID';
      }
      case 'payment.failed': {
        if (!entity?.order_id) return 'IGNORED_INCOMPLETE';
        const payment = await Payment.findOne({ providerOrderId: entity.order_id });
        if (!payment) return 'UNKNOWN_ORDER';
        await markFailed(
          payment as unknown as PaymentDoc,
          entity.error_description ?? 'Payment failed',
        );
        return 'FAILED';
      }
      case 'refund.processed':
      case 'refund.failed': {
        const refundEntityId = body.payload?.refund?.entity?.id;
        if (!refundEntityId) return 'IGNORED_INCOMPLETE';
        const r = await Refund.findOne({ providerRefundId: refundEntityId });
        if (!r) return 'UNKNOWN_REFUND';
        if (body.event === 'refund.processed') await markRefundProcessed(r._id);
        else await markRefundFailed(r._id);
        return body.event === 'refund.processed' ? 'REFUND_PROCESSED' : 'REFUND_FAILED';
      }
      default:
        return 'IGNORED';
    }
  }

  /* ---------------- repair ---------------- */

  /** Close abandoned payment attempts and finish ones that were paid but not fully recorded. */
  async function reconcile(): Promise<{ expired: number; finished: number }> {
    const t = now();
    let expired = 0;
    let finished = 0;
    const stale = await Payment.find({ status: 'CREATED', expiresAt: { $lte: t } }).limit(100);
    for (const p of stale) {
      const closed = await Payment.findOneAndUpdate(
        { _id: p._id, status: 'CREATED' },
        { status: 'EXPIRED' },
      );
      if (closed) {
        expired += 1;
        if (p.bookingId && ['FARE', 'FEE'].includes(p.purpose)) await releaseBooking(p.bookingId);
      }
    }
    const cutoff = new Date(t.getTime() - config.reconcileGraceMs);
    const unfinished = await Payment.find({
      status: 'PAID',
      ledgerRecordedAt: { $exists: false },
      paidAt: { $lte: cutoff },
    }).limit(100);
    for (const p of unfinished) {
      await finishPaid(p as unknown as PaymentDoc);
      finished += 1;
    }
    return { expired, finished };
  }

  /** DEVELOPMENT ONLY (mock payments): pretend the rider paid, through the same path as a real capture. */
  async function devComplete(customerId: string, paymentPublicId: string) {
    const payment = await Payment.findOne({ publicId: paymentPublicId, customerId });
    if (!payment) throw new AppError('NOT_FOUND', 'Payment not found.');
    return view(await markPaid(payment as unknown as PaymentDoc, `pay_dev_${payment.publicId}`));
  }

  return {
    start,
    verify,
    get,
    list,
    refund,
    handleWebhook,
    reconcile,
    devComplete,
    refundView,
    viewByRef,
    startAux,
    payBookingFromWallet,
    payTipFromWallet,
    setPaidHook(fn: (p: PaymentDoc) => Promise<void>) {
      paidHook = fn;
    },
  };
}

export type PaymentsService = ReturnType<typeof createPaymentsService>;
export type { PaymentDoc };
