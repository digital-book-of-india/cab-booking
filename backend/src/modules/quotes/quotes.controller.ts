import type { RequestHandler } from 'express';
import { actorFrom } from '../../common/actor';
import { ok } from '../../common/response';
import { createQuoteSchema, serviceabilityQuerySchema } from './quotes.schemas';
import type { QuotesService } from './quotes.service';

export function createQuotesController(service: QuotesService) {
  const serviceability: RequestHandler = async (req, res) => {
    ok(res, await service.serviceability(serviceabilityQuerySchema.parse(req.query)));
  };

  const create: RequestHandler = async (req, res) => {
    const input = createQuoteSchema.parse(req.body);
    ok(res, await service.createQuote(actorFrom(req).userId, input), 201);
  };

  const get: RequestHandler = async (req, res) => {
    ok(res, await service.getQuote(actorFrom(req).userId, String(req.params['quoteId'])));
  };

  const refresh: RequestHandler = async (req, res) => {
    ok(res, await service.refreshQuote(actorFrom(req).userId, String(req.params['quoteId'])), 201);
  };

  return { serviceability, create, get, refresh };
}
