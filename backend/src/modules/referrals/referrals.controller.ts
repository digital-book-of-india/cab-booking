import type { RequestHandler } from 'express';
import { actorFrom } from '../../common/actor';
import { ok } from '../../common/response';
import { claimReferralSchema } from './referrals.schemas';
import type { ReferralsService } from './referrals.service';

export function createReferralsController(service: ReferralsService) {
  const getMe: RequestHandler = async (req, res) => {
    ok(res, await service.getSummary(actorFrom(req).userId));
  };

  const claim: RequestHandler = async (req, res) => {
    const input = claimReferralSchema.parse(req.body);
    ok(res, await service.applyReferralCode(actorFrom(req).userId, input.code));
  };

  return { getMe, claim };
}
