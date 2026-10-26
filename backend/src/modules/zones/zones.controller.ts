import type { RequestHandler } from 'express';
import { actorFrom } from '../../common/actor';
import { ok } from '../../common/response';
import { objectId } from '../../common/zod';
import { createZoneSchema, updateZoneSchema } from './zones.schemas';
import type { ZonesService } from './zones.service';

export function createZonesController(service: ZonesService) {
  const list: RequestHandler = async (_req, res) => {
    ok(res, await service.list());
  };

  const create: RequestHandler = async (req, res) => {
    const input = createZoneSchema.parse(req.body);
    ok(res, await service.create(actorFrom(req), input), 201);
  };

  const update: RequestHandler = async (req, res) => {
    const id = objectId.parse(req.params['zoneId']);
    const input = updateZoneSchema.parse(req.body);
    ok(res, await service.update(actorFrom(req), id, input));
  };

  return { list, create, update };
}
