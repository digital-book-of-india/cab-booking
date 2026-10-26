import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SavedPlace } from '../src/modules/customers/savedPlace.model';
import { User } from '../src/modules/users/user.model';
import { loginAs, nextPhone, startTestEnv, type Session, type TestEnv } from './helpers';

let env: TestEnv;
let rider1: Session;
let rider2: Session;

beforeAll(async () => {
  env = await startTestEnv();
});

afterAll(() => env.stop());

beforeEach(async () => {
  await env.reset();
  rider1 = await loginAs(env, nextPhone(), 'CUSTOMER');
  rider2 = await loginAs(env, nextPhone(), 'CUSTOMER');
});

const api = () => request(env.app);

describe('Customer Saved Places (CRUD & Security)', () => {
  it('denies unauthenticated access to saved places', async () => {
    const res = await api().get('/api/v1/customers/me/places');
    expect(res.status).toBe(401);
  });

  it('allows a customer to create and list saved places with supported types', async () => {
    // 1. Create home place
    const homeRes = await api()
      .post('/api/v1/customers/me/places')
      .set(rider1.auth)
      .send({
        name: 'Home',
        type: 'home',
        address: '123 Main St, New Delhi',
        lat: 28.6139,
        lng: 77.209,
      });
    expect(homeRes.status).toBe(201);
    expect(homeRes.body.data).toMatchObject({
      name: 'Home',
      type: 'home',
      address: '123 Main St, New Delhi',
      lat: 28.6139,
      lng: 77.209,
    });
    const placeId = homeRes.body.data.id;
    expect(placeId).toBeTruthy();

    // 2. Create work place
    const workRes = await api()
      .post('/api/v1/customers/me/places')
      .set(rider1.auth)
      .send({
        name: 'Office HQ',
        type: 'WORK',
        address: 'Cyber Hub, Gurgaon',
        lat: 28.495,
        lng: 77.089,
      });
    expect(workRes.status).toBe(201);
    expect(workRes.body.data.type).toBe('work');

    // 3. List places (newest first)
    const listRes = await api().get('/api/v1/customers/me/places').set(rider1.auth);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(2);
    expect(listRes.body.data[0].id).toBe(workRes.body.data.id);
    expect(listRes.body.data[1].id).toBe(placeId);
  });

  it('rejects invalid types and coordinates', async () => {
    // Invalid type
    const res1 = await api()
      .post('/api/v1/customers/me/places')
      .set(rider1.auth)
      .send({
        name: 'Vacation',
        type: 'beach_resort',
        address: 'Goa',
        lat: 15.2993,
        lng: 74.124,
      });
    expect(res1.status).toBe(400);

    // Invalid latitude (> 90)
    const res2 = await api()
      .post('/api/v1/customers/me/places')
      .set(rider1.auth)
      .send({
        name: 'North Pole',
        type: 'other',
        address: 'Arctic',
        lat: 95.0,
        lng: 0,
      });
    expect(res2.status).toBe(400);

    // Invalid longitude (< -180)
    const res3 = await api()
      .post('/api/v1/customers/me/places')
      .set(rider1.auth)
      .send({
        name: 'Somewhere',
        type: 'other',
        address: 'Pacific',
        lat: 0,
        lng: -190,
      });
    expect(res3.status).toBe(400);
  });

  it('enforces maximum count of saved places (20)', async () => {
    // Insert 20 places directly
    for (let i = 0; i < 20; i++) {
      await SavedPlace.create({
        customerId: rider1.userId,
        name: `Place ${i}`,
        type: 'other',
        address: `Address ${i}`,
        location: { type: 'Point', coordinates: [77.0, 28.0] },
      });
    }

    // 21st place must fail
    const res = await api()
      .post('/api/v1/customers/me/places')
      .set(rider1.auth)
      .send({
        name: 'Place 21',
        type: 'other',
        address: 'Another address',
        lat: 28.1,
        lng: 77.1,
      });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UNPROCESSABLE');
  });

  it('enforces owner-only access: another customer cannot read, edit or delete your place', async () => {
    const createRes = await api()
      .post('/api/v1/customers/me/places')
      .set(rider1.auth)
      .send({
        name: 'Secret Place',
        type: 'other',
        address: 'Secret Address',
        lat: 28.6,
        lng: 77.2,
      });
    const placeId = createRes.body.data.id;

    // Rider 2 tries to update Rider 1's place -> 404
    const patchRes = await api()
      .patch(`/api/v1/customers/me/places/${placeId}`)
      .set(rider2.auth)
      .send({ name: 'Hacked Place' });
    expect(patchRes.status).toBe(404);

    // Rider 2 tries to delete Rider 1's place -> 404
    const deleteRes = await api()
      .delete(`/api/v1/customers/me/places/${placeId}`)
      .set(rider2.auth);
    expect(deleteRes.status).toBe(404);

    // Place is still intact for Rider 1
    const listRes = await api().get('/api/v1/customers/me/places').set(rider1.auth);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0].name).toBe('Secret Place');
  });

  it('updates and deletes own saved place', async () => {
    const createRes = await api()
      .post('/api/v1/customers/me/places')
      .set(rider1.auth)
      .send({
        name: 'Original',
        type: 'home',
        address: 'Original Address',
        lat: 28.6,
        lng: 77.2,
      });
    const placeId = createRes.body.data.id;

    // Update
    const updateRes = await api()
      .patch(`/api/v1/customers/me/places/${placeId}`)
      .set(rider1.auth)
      .send({ name: 'Updated Name', address: 'Updated Address' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.name).toBe('Updated Name');
    expect(updateRes.body.data.address).toBe('Updated Address');

    // Delete
    const delRes = await api()
      .delete(`/api/v1/customers/me/places/${placeId}`)
      .set(rider1.auth);
    expect(delRes.status).toBe(200);

    // Listing is now empty
    const listRes = await api().get('/api/v1/customers/me/places').set(rider1.auth);
    expect(listRes.body.data).toHaveLength(0);
  });

  it('integrates saved places with data export and account deletion', async () => {
    await api()
      .post('/api/v1/customers/me/places')
      .set(rider1.auth)
      .send({
        name: 'Home',
        type: 'home',
        address: 'Export Address',
        lat: 28.6,
        lng: 77.2,
      });

    // Export data
    const exportRes = await api().get('/api/v1/me/data-export').set(rider1.auth);
    expect(exportRes.status).toBe(200);
    expect(exportRes.body.data.savedPlaces).toHaveLength(1);
    expect(exportRes.body.data.savedPlaces[0].name).toBe('Home');

    // Delete account
    const delRes = await api()
      .post('/api/v1/me/deletion')
      .set(rider1.auth)
      .send({ confirm: true });
    expect(delRes.status).toBe(201);

    // Fast-forward or run privacy cleaner:
    const privacy = (env.app.locals['services'] as { privacy: { run: () => Promise<number> } }).privacy;
    // Set user deletionScheduledFor to in the past so privacy.run() executes it
    // User imported at top
    await User.updateOne(
      { _id: rider1.userId },
      { deletionScheduledFor: new Date(Date.now() - 1000) },
    );
    await privacy.run();

    // Verify saved places were removed
    const remaining = await SavedPlace.find({ customerId: rider1.userId });
    expect(remaining).toHaveLength(0);
  });
});
