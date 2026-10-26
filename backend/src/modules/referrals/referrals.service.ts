import { randomBytes } from 'node:crypto';
import type { Types } from 'mongoose';
import { AppError } from '../../common/errors';
import type { AuditService } from '../audit/audit.service';
import { Coupon } from '../coupons/coupon.model';
import type { FlagsService } from '../flags/flags.service';
import { ReferralClaim, ReferralProfile } from './referral.model';

export const DEFAULT_REFERRAL_REWARD_PAISE = 5000; // Rs 50 flat discount
export const MAX_REFERRALS_PER_USER = 10;
const DUPLICATE_KEY = 11000;

export function createReferralsService(deps: {
  flags: FlagsService;
  audit: AuditService;
  now: () => Date;
  rewardPaise?: number;
  maxReferrals?: number;
}) {
  const { flags, audit, now } = deps;
  const rewardPaise = deps.rewardPaise ?? DEFAULT_REFERRAL_REWARD_PAISE;
  const maxReferrals = deps.maxReferrals ?? MAX_REFERRALS_PER_USER;

  async function getOrCreateProfile(userId: string) {
    let profile = await ReferralProfile.findOne({ userId });
    if (!profile) {
      // Deterministic fallback derived from userId or random uppercase string
      const randomSuffix = randomBytes(4).toString('hex').toUpperCase();
      const code = `REF-${randomSuffix.slice(0, 6)}`;
      try {
        profile = await ReferralProfile.create({
          userId,
          code,
        });
      } catch (err: unknown) {
        if ((err as { code?: number }).code === DUPLICATE_KEY) {
          profile = await ReferralProfile.findOne({ userId });
        } else {
          throw err;
        }
      }
    }
    return profile!;
  }

  async function issueRewardCoupon(userId: string, prefix: string): Promise<string> {
    const couponCode = `${prefix}_${randomBytes(4).toString('hex').toUpperCase()}`;
    const t = now();
    const validTo = new Date(t.getTime() + 30 * 86_400_000); // 30 days validity
    await Coupon.create({
      code: couponCode,
      description: 'Referral reward discount',
      type: 'FLAT',
      value: rewardPaise,
      minFarePaise: rewardPaise * 2, // minimum fare e.g. Rs 100
      validFrom: t,
      validTo,
      active: true,
      maxRedemptions: 1,
      perUserLimit: 1,
      createdBy: userId as unknown as Types.ObjectId,
    });
    return couponCode;
  }

  return {
    async getSummary(userId: string) {
      const isEnabled = await flags.isEnabled('REFERRALS', 'CUSTOMER');
      if (!isEnabled) {
        throw new AppError('FEATURE_DISABLED', 'Referral program is currently inactive.');
      }

      const profile = await getOrCreateProfile(userId);
      const claims = await ReferralClaim.find({ referrerId: profile.userId })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      const history = claims.map((c) => ({
        refereeId: c.refereeId.toString(),
        status: c.status,
        rewardCouponCode: c.rewardCouponCode ?? null,
        rewardedAt: c.rewardedAt ?? null,
        createdAt: c.createdAt,
      }));

      return {
        active: true,
        code: profile.code,
        referralCode: profile.code,
        shareUrl: `https://cab.app/r/${profile.code}`,
        referralLink: `https://cab.app/r/${profile.code}`,
        rewardAmountPaise: rewardPaise,
        totalReferred: profile.rewardedCount,
        referralsCount: profile.rewardedCount,
        totalEarnedPaise: profile.rewardEarnedPaise,
        cap: maxReferrals,
        rewardHistory: history,
        referrals: history,
      };
    },

    async applyReferralCode(refereeId: string, rawCode: string) {
      const isEnabled = await flags.isEnabled('REFERRALS', 'CUSTOMER');
      if (!isEnabled) {
        throw new AppError('FEATURE_DISABLED', 'Referral program is currently inactive.');
      }

      const code = rawCode.trim().toUpperCase();
      const referrerProfile = await ReferralProfile.findOne({ code });
      if (!referrerProfile) {
        throw new AppError('NOT_FOUND', 'Referral code not found.');
      }

      if (referrerProfile.userId.toString() === refereeId) {
        throw new AppError('UNPROCESSABLE', 'You cannot use your own referral code.');
      }

      const existingClaim = await ReferralClaim.findOne({ refereeId });
      if (existingClaim) {
        throw new AppError('CONFLICT', 'You have already claimed a referral code.');
      }

      if (referrerProfile.rewardedCount >= maxReferrals) {
        throw new AppError(
          'UNPROCESSABLE',
          `This referral code limit reached (max ${maxReferrals}).`,
        );
      }

      // Safe reward issuance: create coupon for referee
      const couponCode = await issueRewardCoupon(refereeId, 'REF');
      // Also issue reward coupon for referrer
      await issueRewardCoupon(referrerProfile.userId.toString(), 'REFR');

      try {
        await ReferralClaim.create({
          referrerId: referrerProfile.userId,
          refereeId,
          referralCode: code,
          status: 'REWARDED',
          rewardCouponCode: couponCode,
          rewardedAt: now(),
        });
      } catch (err: unknown) {
        if ((err as { code?: number }).code === DUPLICATE_KEY) {
          throw new AppError('CONFLICT', 'You have already claimed a referral code.');
        }
        throw err;
      }

      await ReferralProfile.updateOne(
        { _id: referrerProfile._id },
        {
          $inc: {
            totalReferred: 1,
            rewardedCount: 1,
            rewardEarnedPaise: rewardPaise,
          },
        },
      );

      await audit.record(
        { userId: refereeId, role: 'CUSTOMER', requestId: 'referral' },
        {
          action: 'referral.claimed',
          targetType: 'User',
          targetId: referrerProfile.userId.toString(),
          metadata: { code, rewardCouponCode: couponCode },
        },
      );

      return {
        success: true,
        status: 'CLAIMED',
        rewardPaise: rewardPaise,
        rewardAmountPaise: rewardPaise,
        couponCode: couponCode,
        rewardCouponCode: couponCode,
      };
    },
  };
}

export type ReferralsService = ReturnType<typeof createReferralsService>;
