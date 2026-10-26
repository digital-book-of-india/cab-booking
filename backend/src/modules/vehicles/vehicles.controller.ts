import type { RequestHandler } from 'express';
import { actorFrom } from '../../common/actor';
import { ok } from '../../common/response';
import { objectId } from '../../common/zod';
import { createVehicleSchema, updateVehicleSchema, verificationSchema } from './vehicles.schemas';
import type { VehiclesService } from './vehicles.service';

export function createVehiclesController(service: VehiclesService) {
  const create: RequestHandler = async (req, res) => {
    const input = createVehicleSchema.parse(req.body);
    ok(res, await service.create(actorFrom(req).userId, input), 201);
  };

  const listOwn: RequestHandler = async (req, res) => {
    ok(res, await service.listOwn(actorFrom(req).userId));
  };

  const updateOwn: RequestHandler = async (req, res) => {
    const vehicleId = objectId.parse(req.params['vehicleId']);
    const input = updateVehicleSchema.parse(req.body);
    ok(res, await service.updateOwn(actorFrom(req).userId, vehicleId, input));
  };

  const verify: RequestHandler = async (req, res) => {
    const vehicleId = objectId.parse(req.params['vehicleId']);
    const input = verificationSchema.parse(req.body);
    ok(res, await service.verify(actorFrom(req), vehicleId, input));
  };

  return { create, listOwn, updateOwn, verify };
}
