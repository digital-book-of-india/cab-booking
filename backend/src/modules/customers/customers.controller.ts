import type { RequestHandler } from 'express';
import { actorFrom } from '../../common/actor';
import { ok } from '../../common/response';
import {
  createSavedPlaceSchema,
  updateCustomerSchema,
  updateSavedPlaceSchema,
} from './customers.schemas';
import type { CustomersService } from './customers.service';

export function createCustomersController(service: CustomersService) {
  const getMe: RequestHandler = async (req, res) => {
    ok(res, await service.getProfile(actorFrom(req).userId));
  };

  const updateMe: RequestHandler = async (req, res) => {
    const input = updateCustomerSchema.parse(req.body);
    ok(res, await service.updateProfile(actorFrom(req).userId, input));
  };

  const listPlaces: RequestHandler = async (req, res) => {
    ok(res, await service.listSavedPlaces(actorFrom(req).userId));
  };

  const createPlace: RequestHandler = async (req, res) => {
    const input = createSavedPlaceSchema.parse(req.body);
    ok(res, await service.createSavedPlace(actorFrom(req).userId, input), 201);
  };

  const updatePlace: RequestHandler = async (req, res) => {
    const input = updateSavedPlaceSchema.parse(req.body);
    ok(res, await service.updateSavedPlace(actorFrom(req).userId, String(req.params['placeId']), input));
  };

  const deletePlace: RequestHandler = async (req, res) => {
    ok(res, await service.deleteSavedPlace(actorFrom(req).userId, String(req.params['placeId'])));
  };

  return { getMe, updateMe, listPlaces, createPlace, updatePlace, deletePlace };
}
