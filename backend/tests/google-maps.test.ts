import { describe, expect, it, vi } from 'vitest';
import { encodePolyline } from '../src/common/geo';
import { createGoogleMaps } from '../src/providers/google';
import { createMockProviders } from '../src/providers/mock';

const KEY = 'AIza-secret-key-for-tests';
const CP = { lat: 28.6315, lng: 77.2167 };
const IGI = { lat: 28.5562, lng: 77.1 };

type Call = { url: string; init: RequestInit };
type Answer = { status?: number; body?: unknown } | 'network';

function fakeFetch(handler: (call: Call, n: number) => Answer) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    const answer = handler(call, calls.length);
    if (answer === 'network') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status ?? 200 });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const routeOk = {
  routes: [
    { distanceMeters: 17_432, duration: '1860s', polyline: { encodedPolyline: '_p~iF~ps|U' } },
  ],
};
const make = (f: ReturnType<typeof fakeFetch>, extra: object = {}) =>
  createGoogleMaps({ apiKey: KEY, fetchFn: f.fn, retryDelayMs: 1, ...extra });
const headerOf = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];

describe('Google Maps adapter: routes', () => {
  it('asks the Routes API for a driving route and reads distance, time and path', async () => {
    const f = fakeFetch(() => ({ body: routeOk }));
    const r = await make(f).route(CP, IGI);
    expect(r).toEqual({ distanceMeters: 17_432, durationSeconds: 1860, polyline: '_p~iF~ps|U' });
    expect(f.calls[0]!.url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    expect(headerOf(f.calls[0]!, 'x-goog-api-key')).toBe(KEY);
    expect(headerOf(f.calls[0]!, 'x-goog-fieldmask')).toContain('routes.distanceMeters');
    const sent = JSON.parse(String(f.calls[0]!.init.body));
    expect(sent.origin.location.latLng).toEqual({ latitude: CP.lat, longitude: CP.lng });
    expect(sent.destination.location.latLng).toEqual({ latitude: IGI.lat, longitude: IGI.lng });
    expect(sent.travelMode).toBe('DRIVE');
    // The key travels in a header, never in the address.
    expect(f.calls[0]!.url).not.toContain(KEY);
  });

  it('reuses an answer for the same places, and shares one request between simultaneous callers', async () => {
    const f = fakeFetch(() => ({ body: routeOk }));
    const maps = make(f);
    const [a, b] = await Promise.all([maps.route(CP, IGI), maps.route(CP, IGI)]);
    expect(a).toEqual(b);
    // About 1 m away is the same cache entry.
    await maps.route({ lat: CP.lat + 0.00001, lng: CP.lng }, IGI);
    expect(f.calls).toHaveLength(1);
  });

  it('forgets an answer after the cache time', async () => {
    let now = 1_000_000;
    const f = fakeFetch(() => ({ body: routeOk }));
    const maps = make(f, { cacheTtlMs: 60_000, now: () => now });
    await maps.route(CP, IGI);
    now += 61_000;
    await maps.route(CP, IGI);
    expect(f.calls).toHaveLength(2);
  });

  it('does not call Google for two points that are the same place', async () => {
    const f = fakeFetch(() => ({ body: routeOk }));
    const r = await make(f).route(CP, { lat: CP.lat + 0.00002, lng: CP.lng });
    expect(r).toEqual({ distanceMeters: 0, durationSeconds: 0 });
    expect(f.calls).toHaveLength(0);
  });

  it('tries once more after a network error or a 5xx, then succeeds', async () => {
    const f = fakeFetch((_c, n) =>
      n === 1 ? 'network' : n === 2 ? { status: 503 } : { body: routeOk },
    );
    const maps = make(f, { retries: 2 });
    expect((await maps.route(CP, IGI)).distanceMeters).toBe(17_432);
    expect(f.calls).toHaveLength(3);
  });

  it('fails clearly, with no invented distance and no key in the message, when Google keeps failing', async () => {
    const f = fakeFetch(() => ({ status: 500 }));
    const err = await make(f)
      .route(CP, IGI)
      .catch((e) => e);
    expect(err).toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(String(err.message)).not.toContain(KEY);
    expect(f.calls).toHaveLength(2); // one try + one retry
    // A failure is not cached: the next call asks again.
    const g = fakeFetch(() => ({ body: routeOk }));
    expect((await make(g).route(CP, IGI)).distanceMeters).toBe(17_432);
  });

  it('treats a refused key (403) as a provider error and does not retry it', async () => {
    const f = fakeFetch(() => ({ status: 403, body: { error: { status: 'PERMISSION_DENIED' } } }));
    await expect(make(f).route(CP, IGI)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(f.calls).toHaveLength(1);
  });

  it('says so when there is no road between the points', async () => {
    const f = fakeFetch(() => ({ body: {} }));
    await expect(make(f).route(CP, IGI)).rejects.toMatchObject({ code: 'UNPROCESSABLE' });
  });

  it('refuses an answer it cannot read rather than guessing', async () => {
    const f = fakeFetch(() => ({ body: { routes: [{ distanceMeters: 100, duration: 'soon' }] } }));
    await expect(make(f).route(CP, IGI)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
  });
});

describe('Google Maps adapter: addresses', () => {
  it('turns an address into coordinates, limited to India', async () => {
    const f = fakeFetch(() => ({
      body: { status: 'OK', results: [{ geometry: { location: { lat: 28.6, lng: 77.2 } } }] },
    }));
    const point = await make(f).geocode('  India Gate ');
    expect(point).toEqual({ lat: 28.6, lng: 77.2 });
    const url = new URL(f.calls[0]!.url);
    expect(url.searchParams.get('address')).toBe('India Gate');
    expect(url.searchParams.get('components')).toBe('country:IN');
  });

  it('returns null for an unknown address, and an error when Google refuses', async () => {
    const none = fakeFetch(() => ({ body: { status: 'ZERO_RESULTS', results: [] } }));
    expect(await make(none).geocode('zzzzzz')).toBeNull();
    const denied = fakeFetch(() => ({
      body: { status: 'REQUEST_DENIED', error_message: `The provided API key ${KEY} is invalid` },
    }));
    const err = await make(denied)
      .geocode('x')
      .catch((e) => e);
    expect(err).toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(String(err.message)).not.toContain(KEY);
    expect(await make(fakeFetch(() => ({ body: {} }))).geocode('   ')).toBeNull();
  });

  it('turns coordinates into an address', async () => {
    const f = fakeFetch(() => ({
      body: { status: 'OK', results: [{ formatted_address: 'Rajpath, New Delhi, India' }] },
    }));
    expect(await make(f).reverseGeocode(CP)).toBe('Rajpath, New Delhi, India');
    expect(new URL(f.calls[0]!.url).searchParams.get('latlng')).toBe(`${CP.lat},${CP.lng}`);
    const none = fakeFetch(() => ({ body: { status: 'ZERO_RESULTS', results: [] } }));
    expect(await make(none).reverseGeocode(CP)).toBeNull();
  });
});

describe('Google Maps adapter: place search', () => {
  it('returns suggestions, skips ones without a place, and sends the session and region', async () => {
    const f = fakeFetch(() => ({
      body: {
        suggestions: [
          {
            placePrediction: {
              placeId: 'ChIJabc',
              text: { text: 'Connaught Place, New Delhi, Delhi, India' },
              structuredFormat: {
                mainText: { text: 'Connaught Place' },
                secondaryText: { text: 'New Delhi, Delhi, India' },
              },
            },
          },
          { queryPrediction: { text: { text: 'connaught place hotels' } } },
        ],
      },
    }));
    const out = await make(f).autocomplete('connaught', { sessionToken: 'sess-1', near: CP });
    expect(out).toEqual([
      {
        placeId: 'ChIJabc',
        description: 'Connaught Place, New Delhi, Delhi, India',
        mainText: 'Connaught Place',
        secondaryText: 'New Delhi, Delhi, India',
      },
    ]);
    const sent = JSON.parse(String(f.calls[0]!.init.body));
    expect(sent).toMatchObject({
      input: 'connaught',
      includedRegionCodes: ['in'],
      sessionToken: 'sess-1',
    });
    expect(sent.locationBias.circle.center).toEqual({ latitude: CP.lat, longitude: CP.lng });
    expect(headerOf(f.calls[0]!, 'x-goog-api-key')).toBe(KEY);
  });

  it('does not call Google for an empty search', async () => {
    const f = fakeFetch(() => ({ body: {} }));
    expect(await make(f).autocomplete('   ')).toEqual([]);
    expect(f.calls).toHaveLength(0);
  });

  it('reads the coordinates and address of a chosen place', async () => {
    const f = fakeFetch(() => ({
      body: {
        location: { latitude: 28.6315, longitude: 77.2167 },
        formattedAddress: 'Connaught Place, New Delhi, Delhi 110001, India',
        displayName: { text: 'Connaught Place' },
      },
    }));
    const p = await make(f).place('ChIJabc', { sessionToken: 'sess-1' });
    expect(p).toEqual({
      point: { lat: 28.6315, lng: 77.2167 },
      address: 'Connaught Place, New Delhi, Delhi 110001, India',
      name: 'Connaught Place',
    });
    const url = new URL(f.calls[0]!.url);
    expect(url.pathname).toBe('/v1/places/ChIJabc');
    expect(url.searchParams.get('sessionToken')).toBe('sess-1');
    expect(headerOf(f.calls[0]!, 'x-goog-fieldmask')).toBe('location,formattedAddress,displayName');
  });

  it('returns null for an unknown place and never lets a place id change the address', async () => {
    const f = fakeFetch(() => ({ status: 404, body: {} }));
    expect(await make(f).place('ChIJnope')).toBeNull();
    const g = fakeFetch(() => ({ body: {} }));
    expect(await make(g).place('../../v1/places:autocomplete?x=')).toBeNull();
    expect(g.calls).toHaveLength(0);
  });
});

describe('mock maps (development)', () => {
  const maps = createMockProviders().maps;
  it('answers the same questions as the real one', async () => {
    const r = await maps.route(CP, IGI);
    expect(r.distanceMeters).toBeGreaterThan(0);
    expect(r.polyline).toBe(encodePolyline([CP, IGI]));
    const [s] = await maps.autocomplete('Connaught');
    expect(s!.placeId).toBe('mock-place-1');
    expect((await maps.place(s!.placeId))!.point.lat).toBeGreaterThan(28);
    expect(await maps.place('other')).toBeNull();
    expect(await maps.autocomplete('  ')).toEqual([]);
  });

  it('encodes a polyline the way Google documents it', () => {
    // The example from Google's polyline documentation.
    expect(
      encodePolyline([
        { lat: 38.5, lng: -120.2 },
        { lat: 40.7, lng: -120.95 },
        { lat: 43.252, lng: -126.453 },
      ]),
    ).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });
});
