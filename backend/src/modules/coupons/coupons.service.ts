import type { Types } from 'mongoose';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { Actor } from '../../common/actor';
import { AppError } from '../../common/errors';
import { pageMeta, paginationSchema } from '../../common/pagination';
import { objectId } from '../../common/zod';
import type { AuditService } from '../audit/audit.service';
import { Booking } from '../bookings/booking.model';
import type { FlagsService } from '../flags/flags.service';
import { Coupon, CouponTypes, CouponUsage } from './coupon.model';

const DUPLICATE_KEY = 11000;
/** A ride never ends up costing less than this after a discount. */
export const MIN_PAYABLE_PAISE = 100;

export type CouponRule = {
  type: 'PERCENT' | 'FLAT';
  value: number;
  maxDiscountPaise?: number | null;
  minFarePaise?: number | null;
};

/** Pure: the discount a rule gives on a fare. Zero when the fare is below the minimum. */
export function computeDiscount(rule: CouponRule, grossFarePaise: number): number {
  if (grossFarePaise < (rule.minFarePaise ?? 0)) return 0;
  const raw =
    rule.type === 'FLAT' ? rule.value : Math.round((grossFarePaise * rule.value) / 10_000);
  const capped = rule.maxDiscountPaise ? Math.min(raw, rule.maxDiscountPaise) : raw;
  return Math.max(0, Math.min(capped, grossFarePaise - MIN_PAYABLE_PAISE));
}

export const normalizeCode = (code: string) => code.trim().toUpperCase();

export const createCouponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(30)
      .regex(/^[A-Za-z0-9_-]+$/),
    description: z.string().trim().max(200).optional(),
    type: z.enum(CouponTypes),
    value: z.number().int().min(1).max(10_000_000),
    maxDiscountPaise: z.number().int().min(1).max(10_000_000).optional(),
    minFarePaise: z.number().int().min(0).max(10_000_000).default(0),
    validFrom: z.coerce.date(),
    validTo: z.coerce.date(),
    maxRedemptions: z.number().int().min(1).max(10_000_000).optional(),
    perUserLimit: z.number().int().min(1).max(1000).default(1),
    zoneIds: z.array(objectId).max(50).default([]),
    categoryIds: z.array(objectId).max(50).default([]),
  })
  .strict()
  .refine((v) => v.validTo.getTime() > v.validFrom.getTime(), {
    message: 'validTo must be after validFrom',
    path: ['validTo'],
  })
  .refine((v) => v.type !== 'PERCENT' || v.value <= 10_000, {
    message: 'A percent coupon is at most 100% (10000)',
    path: ['value'],
  });
export const updateCouponSchema = z
  .object({
    active: z.boolean().optional(),
    validTo: z.coerce.date().optional(),
    maxRedemptions: z.number().int().min(1).max(10_000_000).optional(),
    description: z.string().trim().max(200).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });
export const couponListQuerySchema = paginationSchema.extend({
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export type CreateCouponInput = z.infer<typeof createCouponSchema>;
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;
export type CouponListQuery = z.infer<typeof couponListQuerySchema>;

/** What a quote and a booking keep of the coupon: the rule as it was when the rider saw the price. */
export type CouponSnapshot = {
  couponId: Types.ObjectId;
  code: string;
  type: 'PERCENT' | 'FLAT';
  value: number;
  maxDiscountPaise?: number | null;
  minFarePaise?: number | null;
};

const reason = (message: string) =>
  new AppError('UNPROCESSABLE', undefined, [{ field: 'couponCode', message }]);

export function createCouponsService(deps: {
  flags: FlagsService;
  audit: AuditService;
  now: () => Date;
  logger: Logger;
}) {
  const { flags, audit, now, logger } = deps;

  const view = (c: {
    _id: { toString(): string };
    code: string;
    description?: string | null;
    type: string;
    value: number;
    maxDiscountPaise?: number | null;
    minFarePaise?: number | null;
    validFrom: Date;
    validTo: Date;
    active: boolean;
    maxRedemptions?: number | null;
    perUserLimit: number;
    zoneIds: { toString(): string }[];
    categoryIds: { toString(): string }[];
    redemptionsCount: number;
  }) => ({
    id: c._id.toString(),
    code: c.code,
    description: c.description ?? null,
    type: c.type,
    value: c.value,
    maxDiscountPaise: c.maxDiscountPaise ?? null,
    minFarePaise: c.minFarePaise ?? 0,
    validFrom: c.validFrom,
    validTo: c.validTo,
    active: c.active,
    maxRedemptions: c.maxRedemptions ?? null,
    perUserLimit: c.perUserLimit,
    zoneIds: c.zoneIds.map(String),
    categoryIds: c.categoryIds.map(String),
    redemptionsCount: c.redemptionsCount,
  });

  return {
    /**
     * Can this rider use this code for this trip? Used when a quote is made. Nothing is reserved yet:
     * that happens when the booking is created. Returns the rule to freeze and the discount it gives
     * on the estimated fare.
     */
    async evaluate(
      role: Actor['role'],
      input: {
        code: string;
        userId: string;
        zoneId: Types.ObjectId | string;
        categoryId: Types.ObjectId | string;
        estimatedFarePaise: number;
      },
    ): Promise<{ snapshot: CouponSnapshot; discountPaise: number }> {
      await flags.assertEnabled('COUPONS', role);
      const code = normalizeCode(input.code);
      const c = await Coupon.findOne({ code }).lean();
      if (!c) throw reason('This coupon code does not exist.');
      const t = now().getTime();
      if (!c.active) throw reason('This coupon is no longer active.');
      if (t < c.validFrom.getTime()) throw reason('This coupon is not valid yet.');
      if (t > c.validTo.getTime()) throw reason('This coupon has expired.');
      if (
        c.zoneIds.length > 0 &&
        !c.zoneIds.some((z) => z.toString() === input.zoneId.toString())
      ) {
        throw reason('This coupon is not valid in this area.');
      }
      if (
        c.categoryIds.length > 0 &&
        !c.categoryIds.some((z) => z.toString() === input.categoryId.toString())
      ) {
        throw reason('This coupon is not valid for this cab type.');
      }
      if (input.estimatedFarePaise < (c.minFarePaise ?? 0)) {
        throw reason(
          `This coupon needs a fare of at least ₹${((c.minFarePaise ?? 0) / 100).toFixed(0)}.`,
        );
      }
      if (c.maxRedemptions && c.redemptionsCount >= c.maxRedemptions) {
        throw reason('This coupon has been fully used.');
      }
      const used = await CouponUsage.findOne({ couponId: c._id, userId: input.userId }).lean();
      if ((used?.count ?? 0) >= c.perUserLimit) throw reason('You have already used this coupon.');

      const snapshot: CouponSnapshot = {
        couponId: c._id,
        code: c.code,
        type: c.type as 'PERCENT' | 'FLAT',
        value: c.value,
        maxDiscountPaise: c.maxDiscountPaise ?? null,
        minFarePaise: c.minFarePaise ?? 0,
      };
      return { snapshot, discountPaise: computeDiscount(snapshot, input.estimatedFarePaise) };
    },

    /**
     * Take one use for this rider when their booking is created. Both limits are enforced with
     * conditional updates, so two bookings at once cannot both take the last use.
     */
    async reserve(couponId: Types.ObjectId | string, userId: string): Promise<void> {
      const global = await Coupon.findOneAndUpdate(
        {
          _id: couponId,
          active: true,
          $or: [
            { maxRedemptions: { $exists: false } },
            { maxRedemptions: null },
            { $expr: { $lt: ['$redemptionsCount', '$maxRedemptions'] } },
          ],
        },
        { $inc: { redemptionsCount: 1 } },
        { returnDocument: 'after' },
      );
      if (!global) throw reason('This coupon has been fully used.');
      try {
        // The unique (coupon, rider) key turns "already at the limit" into a duplicate error.
        await CouponUsage.updateOne(
          { couponId, userId, count: { $lt: global.perUserLimit } },
          { $inc: { count: 1 } },
          { upsert: true },
        );
      } catch (err) {
        await Coupon.updateOne(
          { _id: couponId, redemptionsCount: { $gt: 0 } },
          { $inc: { redemptionsCount: -1 } },
        );
        if ((err as { code?: number }).code === DUPLICATE_KEY)
          throw reason('You have already used this coupon.');
        throw err;
      }
    },

    /** Give a reserved use back (the ride never happened). Never goes below zero. */
    async release(couponId: Types.ObjectId | string, userId: string): Promise<void> {
      await Coupon.updateOne(
        { _id: couponId, redemptionsCount: { $gt: 0 } },
        { $inc: { redemptionsCount: -1 } },
      );
      await CouponUsage.updateOne({ couponId, userId, count: { $gt: 0 } }, { $inc: { count: -1 } });
    },

    /** Uses reserved for bookings that ended without a ride are given back, once each. */
    async reconcile(): Promise<{ released: number }> {
      const stranded = await Booking.find({
        'coupon.code': { $exists: true },
        'coupon.releasedAt': { $exists: false },
        status: { $in: ['CANCELLED', 'NO_DRIVER_FOUND', 'NO_SHOW'] },
      })
        .select('_id customerId coupon')
        .limit(100)
        .lean();
      let released = 0;
      for (const b of stranded) {
        // Mark first, conditionally: only one instance releases a given booking's use.
        const marked = await Booking.updateOne(
          { _id: b._id, 'coupon.releasedAt': { $exists: false } },
          { 'coupon.releasedAt': now() },
        );
        if (marked.modifiedCount !== 1) continue;
        await this.release(b.coupon!.couponId, b.customerId.toString());
        released += 1;
      }
      if (released > 0)
        logger.info({ released }, 'gave back coupon uses for rides that did not happen');
      return { released };
    },

    /* ---------------- staff ---------------- */

    async create(actor: Actor, input: CreateCouponInput) {
      try {
        const c = await Coupon.create({
          ...input,
          code: normalizeCode(input.code),
          createdBy: actor.userId,
        });
        await audit.record(actor, {
          action: 'coupon.create',
          targetType: 'Coupon',
          targetId: c.id,
          metadata: { code: c.code, type: c.type, value: c.value },
        });
        return view(c.toObject());
      } catch (err) {
        if ((err as { code?: number }).code === DUPLICATE_KEY) {
          throw new AppError('CONFLICT', 'A coupon with this code already exists.');
        }
        throw err;
      }
    },

    async update(actor: Actor, couponId: string, input: UpdateCouponInput) {
      const current = await Coupon.findById(couponId).lean();
      if (!current) throw new AppError('NOT_FOUND');
      if (input.validTo && input.validTo.getTime() <= current.validFrom.getTime()) {
        throw new AppError('UNPROCESSABLE', undefined, [
          { field: 'validTo', message: 'Must be after validFrom' },
        ]);
      }
      // A limit can be raised, never cut below what has already been used.
      if (input.maxRedemptions !== undefined && input.maxRedemptions < current.redemptionsCount) {
        throw new AppError('UNPROCESSABLE', undefined, [
          { field: 'maxRedemptions', message: `Already used ${current.redemptionsCount} times` },
        ]);
      }
      const c = await Coupon.findByIdAndUpdate(couponId, input, { returnDocument: 'after' });
      await audit.record(actor, {
        action: 'coupon.update',
        targetType: 'Coupon',
        targetId: couponId,
        metadata: { ...input },
      });
      return view(c!.toObject());
    },

    async list(query: CouponListQuery) {
      const filter = query.active === undefined ? {} : { active: query.active };
      const [total, rows] = await Promise.all([
        Coupon.countDocuments(filter),
        Coupon.find(filter)
          .sort({ createdAt: -1 })
          .skip((query.page - 1) * query.limit)
          .limit(query.limit)
          .lean(),
      ]);
      return { items: rows.map(view), meta: pageMeta(query.page, query.limit, total) };
    },
  };
}

export type CouponsService = ReturnType<typeof createCouponsService>;
