import { AppError } from '../../common/errors';
import { haversineMeters } from '../../common/geo';
import type { MapsProvider } from '../../providers';

/** A preview is for a city trip or an outstation trip, not for the other side of the world. */
export const MAX_ESTIMATE_STRAIGHT_LINE_METERS = 2_500_000;

/**
 * What the apps need around the maps provider: address search, picking a place, naming a spot on
 * the map, and a route preview. The provider key stays on the server. The price of a trip is never
 * taken from here: quotes work out their own distance on the server.
 */
export function createLocationsService(deps: { maps: MapsProvider }) {
  const { maps } = deps;
  return {
    async autocomplete(input: {
      input: string;
      sessionToken?: string | undefined;
      near?: { lat: number; lng: number } | undefined;
    }) {
      const suggestions = await maps.autocomplete(input.input, {
        sessionToken: input.sessionToken,
        near: input.near,
      });
      return { suggestions };
    },

    async place(input: { placeId: string; sessionToken?: string | undefined }) {
      const place = await maps.place(input.placeId, { sessionToken: input.sessionToken });
      if (!place) throw new AppError('NOT_FOUND', 'We could not find that place.');
      return place;
    },

    async reverseGeocode(point: { lat: number; lng: number }) {
      return { address: await maps.reverseGeocode(point) };
    },

    async estimateRoute(input: {
      origin: { lat: number; lng: number };
      destination: { lat: number; lng: number };
    }) {
      if (haversineMeters(input.origin, input.destination) > MAX_ESTIMATE_STRAIGHT_LINE_METERS) {
        throw new AppError('UNPROCESSABLE', 'These two places are too far apart.');
      }
      const r = await maps.route(input.origin, input.destination);
      return {
        distanceMeters: r.distanceMeters,
        durationSeconds: r.durationSeconds,
        polyline: r.polyline ?? null,
      };
    },
  };
}

export type LocationsService = ReturnType<typeof createLocationsService>;
