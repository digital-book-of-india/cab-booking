import type { RequestHandler } from 'express';
import { actorFrom } from '../../common/actor';
import { ok } from '../../common/response';
import { locationUpdateSchema, presenceSchema } from './presence.schemas';
import type { PresenceService } from './presence.service';

export function createPresenceController(service: PresenceService) {
  const setPresence: RequestHandler = async (req, res) => {
    const input = presenceSchema.parse(req.body);
    ok(res, await service.setPresence(actorFrom(req).userId, input));
  };

  const getPresence: RequestHandler = async (req, res) => {
    ok(res, await service.getPresence(actorFrom(req).userId));
  };

  const updateLocation: RequestHandler = async (req, res) => {
    const input = locationUpdateSchema.parse(req.body);
    ok(res, await service.updateLocation(actorFrom(req).userId, input));
  };

  return { setPresence, getPresence, updateLocation };
}
