import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginAs, loginAsAdmin, nextPhone, startTestEnv, type TestEnv } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv({}, { locationsPerMinute: 8 });
});
afterAll(() => env.stop());
const api = () => request(env.app);

const CP = { lat: 28.6315, lng: 77.2167 };
const IGI = { lat: 28.5562, lng: 77.1 };

describe('location endpoints', () => {
  it('a rider searches an address, picks a place and gets its coordinates', async () => {
    const rider = await loginAs(env, nextPhone(), 'CUSTOMER');
    const found = await api()
      .post('/api/v1/locations/autocomplete')
      .set(rider.auth)
      .send({ input: 'connaught', sessionToken: 'search-0001-abcdef', near: CP });
    expect(found.status, JSON.stringify(found.body)).toBe(200);
    const [first] = found.body.data.suggestions;
    expect(first).toMatchObject({ placeId: expect.any(String), mainText: 'connaught' });

    const picked = await api()
      .post('/api/v1/locations/place')
      .set(rider.auth)
      .send({ placeId: first.placeId, sessionToken: 'search-0001-abcdef' });
    expect(picked.status).toBe(200);
    expect(picked.body.data.point).toEqual({ lat: expect.any(Number), lng: expect.any(Number) });
    expect(picked.body.data.address).toEqual(expect.any(String));
  });

  it('a driver can use them too', async () => {
    const driver = await loginAs(env, nextPhone(), 'DRIVER');
    const res = await api().post('/api/v1/locations/reverse-geocode').set(driver.auth).send(CP);
    expect(res.status).toBe(200);
    expect(res.body.data.address).toEqual(expect.any(String));
  });

  it('gives a route preview with distance, time and a path, and no price', async () => {
    const rider = await loginAs(env, nextPhone(), 'CUSTOMER');
    const res = await api()
      .post('/api/v1/routes/estimate')
      .set(rider.auth)
      .send({ origin: CP, destination: IGI });
    expect(res.status).toBe(200);
    expect(res.body.data.distanceMeters).toBeGreaterThan(5000);
    expect(res.body.data.durationSeconds).toBeGreaterThan(0);
    expect(res.body.data.polyline).toEqual(expect.any(String));
    expect(Object.keys(res.body.data).sort()).toEqual([
      'distanceMeters',
      'durationSeconds',
      'polyline',
    ]);
  });

  it('is closed to staff and to people who are not signed in', async () => {
    const staff = await loginAsAdmin(env, nextPhone(), 'OPS');
    expect(
      (await api().post('/api/v1/locations/autocomplete').set(staff.auth).send({ input: 'x' }))
        .status,
    ).toBe(403);
    expect((await api().post('/api/v1/routes/estimate').send({})).status).toBe(401);
  });

  it('refuses bad input', async () => {
    const rider = await loginAs(env, nextPhone(), 'CUSTOMER');
    const post = (path: string, body: object) => api().post(path).set(rider.auth).send(body);
    expect((await post('/api/v1/locations/autocomplete', { input: '   ' })).status).toBe(400);
    expect((await post('/api/v1/locations/autocomplete', { input: 'x'.repeat(201) })).status).toBe(
      400,
    );
    expect(
      (await post('/api/v1/locations/autocomplete', { input: 'ok', sessionToken: 'short' })).status,
    ).toBe(400);
    expect((await post('/api/v1/locations/autocomplete', { input: 'ok', extra: 1 })).status).toBe(
      400,
    );
    expect((await post('/api/v1/locations/place', { placeId: '../../x' })).status).toBe(400);
    expect((await post('/api/v1/locations/reverse-geocode', { lat: 91, lng: 0 })).status).toBe(400);
    expect(
      (await post('/api/v1/routes/estimate', { origin: CP, destination: { lat: 0, lng: 400 } }))
        .status,
    ).toBe(400);
  });

  it('says 404 for an unknown place and 422 for a preview across the world', async () => {
    const rider = await loginAs(env, nextPhone(), 'CUSTOMER');
    const unknown = await api()
      .post('/api/v1/locations/place')
      .set(rider.auth)
      .send({ placeId: 'does-not-exist' });
    expect(unknown.status).toBe(404);
    const far = await api()
      .post('/api/v1/routes/estimate')
      .set(rider.auth)
      .send({ origin: CP, destination: { lat: 40.7128, lng: -74.006 } });
    expect(far.status).toBe(422);
  });

  it('limits how often one user can search, without affecting other users', async () => {
    const heavy = await loginAs(env, nextPhone(), 'CUSTOMER');
    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      codes.push(
        (await api().post('/api/v1/locations/autocomplete').set(heavy.auth).send({ input: 'a' }))
          .status,
      );
    }
    expect(codes.filter((c) => c === 200).length).toBe(8);
    expect(codes.filter((c) => c === 429).length).toBe(4);
    expect(
      (await api().post('/api/v1/locations/autocomplete').set(other.auth).send({ input: 'a' }))
        .status,
    ).toBe(200);
  });
});
