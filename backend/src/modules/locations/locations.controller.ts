import type { RequestHandler } from 'express';
import { ok } from '../../common/response';
import {
  autocompleteSchema,
  placeSchema,
  reverseGeocodeSchema,
  routeEstimateSchema,
} from './locations.schemas';
import type { LocationsService } from './locations.service';

export function createLocationsController(service: LocationsService) {
  const autocomplete: RequestHandler = async (req, res) => {
    ok(res, await service.autocomplete(autocompleteSchema.parse(req.body)));
  };
  const place: RequestHandler = async (req, res) => {
    ok(res, await service.place(placeSchema.parse(req.body)));
  };
  const reverseGeocode: RequestHandler = async (req, res) => {
    ok(res, await service.reverseGeocode(reverseGeocodeSchema.parse(req.body)));
  };
  const estimateRoute: RequestHandler = async (req, res) => {
    ok(res, await service.estimateRoute(routeEstimateSchema.parse(req.body)));
  };
  return { autocomplete, place, reverseGeocode, estimateRoute };
}
