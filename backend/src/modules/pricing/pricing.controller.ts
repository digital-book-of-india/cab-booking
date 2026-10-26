import type { RequestHandler } from 'express';
import { actorFrom } from '../../common/actor';
import { ok } from '../../common/response';
import {
  activeFareConfigQuerySchema,
  createFareConfigSchema,
  listFareConfigsQuerySchema,
} from './pricing.schemas';
import type { PricingService } from './pricing.service';

export function createPricingController(service: PricingService) {
  const create: RequestHandler = async (req, res) => {
    const input = createFareConfigSchema.parse(req.body);
    ok(res, await service.createConfig(actorFrom(req), input), 201);
  };

  const list: RequestHandler = async (req, res) => {
    const { items, meta } = await service.listConfigs(listFareConfigsQuerySchema.parse(req.query));
    ok(res, items, 200, meta);
  };

  const active: RequestHandler = async (req, res) => {
    const { zoneId, categoryId } = activeFareConfigQuerySchema.parse(req.query);
    ok(res, await service.previewActive(zoneId, categoryId));
  };

  return { create, list, active };
}
