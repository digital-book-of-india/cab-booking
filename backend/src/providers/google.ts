import { AppError } from '../common/errors';
import { haversineMeters } from '../common/geo';
import type { LatLng, MapsProvider, PlaceSuggestion, RouteResult } from './types';

/**
 * Routes, addresses and place search through Google Maps Platform, with a server-side key.
 *  - Routes API (computeRoutes) for road distance, time and the path.
 *  - Geocoding API for address <-> coordinates.
 *  - Places API (New) for autocomplete and place details.
 *
 * NOT verified against the real service yet: the unit tests drive it with a fake `fetch`. The first
 * live check is one route, one geocode, one autocomplete and one place lookup with a restricted key.
 *
 * Behaviour that protects the money and the bill:
 *  - A call that fails (network, timeout, quota, 5xx) is retried once, then becomes PROVIDER_ERROR.
 *    It never returns a made-up distance, so a Maps outage can stop a quote but cannot misprice one.
 *  - Routes are cached for a few minutes by coordinates rounded to ~11 m, and identical calls in
 *    flight share one request. Dispatch asks for many pickup ETAs, so this keeps the bill down.
 *  - Errors never contain the request URL: the Geocoding API carries the key in the query string.
 */
export type GoogleMapsOptions = {
  apiKey: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  /** How many times a failed call is repeated. Default 1. */
  retries?: number;
  /** Wait before a retry. Default 250 ms. */
  retryDelayMs?: number;
  /** How long a route / address answer is reused. Default 5 minutes. 0 = no cache. */
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  /** Country the searches are limited to (ISO 3166-1 alpha-2). Default 'in'. */
  region?: string;
  now?: () => number;
};

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const PLACES_URL = 'https://places.googleapis.com/v1';

/** Same point for routing purposes: nothing to ask Google. */
const SAME_PLACE_METERS = 10;

export function createGoogleMaps(options: GoogleMapsOptions): MapsProvider {
  const doFetch = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  const retries = options.retries ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const ttl = options.cacheTtlMs ?? 5 * 60_000;
  const maxEntries = options.cacheMaxEntries ?? 2000;
  const region = (options.region ?? 'in').toLowerCase();
  const clock = options.now ?? Date.now;

  const cache = new Map<string, { at: number; value: unknown }>();
  const inFlight = new Map<string, Promise<unknown>>();

  /** Answer from the cache, or from a request already running, or by asking Google once. */
  async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (ttl > 0) {
      const hit = cache.get(key);
      if (hit && clock() - hit.at < ttl) return hit.value as T;
      cache.delete(key);
    }
    const running = inFlight.get(key);
    if (running) return running as Promise<T>;
    const p = load()
      .then((value) => {
        if (ttl > 0) {
          if (cache.size >= maxEntries) cache.delete(cache.keys().next().value as string);
          cache.set(key, { at: clock(), value });
        }
        return value;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  }

  /** One HTTP call with a timeout, repeated on network trouble, 429 and 5xx. Returns parsed JSON. */
  async function call(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
      try {
        const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
        if (res.status === 429 || res.status >= 500) continue;
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        return { status: res.status, body };
      } catch {
        // timeout or network error: try again, then give up below
      }
    }
    throw new AppError('PROVIDER_ERROR', 'The maps service could not be reached.');
  }

  const refused = () => new AppError('PROVIDER_ERROR', 'The maps service refused the request.');
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const roundKey = (p: LatLng) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;

  return {
    async route(origin, destination): Promise<RouteResult> {
      if (haversineMeters(origin, destination) < SAME_PLACE_METERS) {
        return { distanceMeters: 0, durationSeconds: 0 };
      }
      return cached(`route:${roundKey(origin)}>${roundKey(destination)}`, async () => {
        const { status, body } = await call(ROUTES_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': options.apiKey,
            'x-goog-fieldmask':
              'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
          },
          body: JSON.stringify({
            origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
            destination: {
              location: { latLng: { latitude: destination.lat, longitude: destination.lng } },
            },
            travelMode: 'DRIVE',
            // Cheaper tier; the time is the usual road time, not live traffic.
            routingPreference: 'TRAFFIC_UNAWARE',
            units: 'METRIC',
          }),
        });
        if (status !== 200) throw refused();
        const route = (body as { routes?: Record<string, unknown>[] } | null)?.routes?.[0];
        if (!route)
          throw new AppError('UNPROCESSABLE', 'No road route was found between these points.');
        const distanceMeters = num(route['distanceMeters']);
        // Google sends the duration as a string like "1234s".
        const durationSeconds = /^(\d+)s$/.exec(String(route['duration'] ?? ''))?.[1];
        if (distanceMeters === null || durationSeconds === undefined) throw refused();
        const polyline = (route['polyline'] as { encodedPolyline?: unknown } | undefined)
          ?.encodedPolyline;
        return {
          distanceMeters: Math.round(distanceMeters),
          durationSeconds: Number(durationSeconds),
          ...(typeof polyline === 'string' ? { polyline } : {}),
        };
      });
    },

    async geocode(address): Promise<LatLng | null> {
      const text = address.trim();
      if (!text) return null;
      return cached(`geo:${text.toLowerCase()}`, async () => {
        const url = new URL(GEOCODE_URL);
        url.search = new URLSearchParams({
          address: text,
          components: `country:${region.toUpperCase()}`,
          key: options.apiKey,
        }).toString();
        const { status, body } = await call(url.toString(), { method: 'GET' });
        const state = (body as { status?: string } | null)?.status;
        if (status !== 200 || (state !== 'OK' && state !== 'ZERO_RESULTS')) throw refused();
        const loc = (
          body as { results?: { geometry?: { location?: { lat?: unknown; lng?: unknown } } }[] }
        ).results?.[0]?.geometry?.location;
        const lat = num(loc?.lat);
        const lng = num(loc?.lng);
        return lat === null || lng === null ? null : { lat, lng };
      });
    },

    async reverseGeocode(point): Promise<string | null> {
      return cached(`rev:${roundKey(point)}`, async () => {
        const url = new URL(GEOCODE_URL);
        url.search = new URLSearchParams({
          latlng: `${point.lat},${point.lng}`,
          key: options.apiKey,
        }).toString();
        const { status, body } = await call(url.toString(), { method: 'GET' });
        const state = (body as { status?: string } | null)?.status;
        if (status !== 200 || (state !== 'OK' && state !== 'ZERO_RESULTS')) throw refused();
        const address = (body as { results?: { formatted_address?: unknown }[] }).results?.[0]
          ?.formatted_address;
        return typeof address === 'string' ? address : null;
      });
    },

    // Typing is never cached: each keystroke is a different input, and a session groups them for billing.
    async autocomplete(input, opts = {}): Promise<PlaceSuggestion[]> {
      const text = input.trim();
      if (!text) return [];
      const { status, body } = await call(`${PLACES_URL}/places:autocomplete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
        body: JSON.stringify({
          input: text,
          includedRegionCodes: [region],
          ...(opts.sessionToken ? { sessionToken: opts.sessionToken } : {}),
          ...(opts.near
            ? {
                locationBias: {
                  circle: {
                    center: { latitude: opts.near.lat, longitude: opts.near.lng },
                    radius: 50_000,
                  },
                },
              }
            : {}),
        }),
      });
      if (status !== 200) throw refused();
      const suggestions =
        (body as { suggestions?: { placePrediction?: Record<string, unknown> }[] } | null)
          ?.suggestions ?? [];
      const out: PlaceSuggestion[] = [];
      for (const s of suggestions) {
        const p = s.placePrediction as
          | {
              placeId?: string;
              text?: { text?: string };
              structuredFormat?: {
                mainText?: { text?: string };
                secondaryText?: { text?: string };
              };
            }
          | undefined;
        if (!p?.placeId || !p.text?.text) continue; // query predictions have no place id
        out.push({
          placeId: p.placeId,
          description: p.text.text,
          mainText: p.structuredFormat?.mainText?.text ?? p.text.text,
          secondaryText: p.structuredFormat?.secondaryText?.text ?? '',
        });
      }
      return out;
    },

    async place(placeId, opts = {}) {
      if (!/^[A-Za-z0-9_-]{1,300}$/.test(placeId)) return null;
      const url = new URL(`${PLACES_URL}/places/${placeId}`);
      if (opts.sessionToken) url.searchParams.set('sessionToken', opts.sessionToken);
      const { status, body } = await call(url.toString(), {
        method: 'GET',
        headers: {
          'x-goog-api-key': options.apiKey,
          'x-goog-fieldmask': 'location,formattedAddress,displayName',
        },
      });
      if (status === 404) return null;
      if (status !== 200) throw refused();
      const place = body as {
        location?: { latitude?: unknown; longitude?: unknown };
        formattedAddress?: string;
        displayName?: { text?: string };
      } | null;
      const lat = num(place?.location?.latitude);
      const lng = num(place?.location?.longitude);
      if (lat === null || lng === null) return null;
      return {
        point: { lat, lng },
        address: place?.formattedAddress ?? '',
        name: place?.displayName?.text ?? '',
      };
    },
  };
}
