import type { RequestHandler } from 'express';
import { actorFrom } from '../../common/actor';
import { ok } from '../../common/response';
import { bookingIdSchema, offerIdSchema, rejectOfferSchema } from './dispatch.schemas';
import type { DispatchService } from './dispatch.service';

export function createDispatchController(service: DispatchService) {
  const listOffers: RequestHandler = async (req, res) => {
    ok(res, await service.listOffers(actorFrom(req).userId));
  };

  const accept: RequestHandler = async (req, res) => {
    const offerId = offerIdSchema.parse(req.params['offerId']);
    ok(res, await service.accept(actorFrom(req).userId, offerId));
  };

  const reject: RequestHandler = async (req, res) => {
    const offerId = offerIdSchema.parse(req.params['offerId']);
    const body = rejectOfferSchema.parse(req.body ?? {});
    ok(res, await service.reject(actorFrom(req).userId, offerId, body.reason));
  };

  const retry: RequestHandler = async (req, res) => {
    const bookingId = bookingIdSchema.parse(req.params['bookingId']);
    ok(res, await service.retry(actorFrom(req), bookingId), 202);
  };

  return { listOffers, accept, reject, retry };
}
