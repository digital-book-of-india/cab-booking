import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/auditLog.model';
import { SafetyIncident } from '../src/modules/safety/safety.models';
import type { SafetyService } from '../src/modules/safety/safety.service';
import {
  NEAR_CP,
  assignTo,
  createDriver,
  loginAs,
  loginAsAdmin,
  nextPhone,
  requestRide,
  rideCall,
  seedWorld,
  sleep,
  startRide,
  startTestEnv,
  until,
  type Session,
  type TestDriver,
  type TestEnv,
} from './helpers';

let env: TestEnv;
let world: Awaited<ReturnType<typeof seedWorld>>;
let rider: Session;
let driver: TestDriver;
beforeAll(async () => {
  env = await startTestEnv({}, { safetyAckWindowMs: 20 });
});
afterAll(() => env.stop());
beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
  rider = await loginAs(env, nextPhone(), 'CUSTOMER');
  driver = await createDriver(env, world, { at: NEAR_CP, name: 'Ravi Kumar' });
});

const api = () => request(env.app);
const sos = (who: Session, rideId: string, body: object = {}) =>
  api().post(`/api/v1/rides/${rideId}/sos`).set(who.auth).send(body);

/** A ride that is under way (rider in the cab). */
async function liveRide() {
  await requestRide(env, world, rider);
  const rideId = await assignTo(env, driver);
  await startRide(env, rider, driver, rideId);
  return rideId;
}

describe('emergency contacts', () => {
  const add = (who: Session, body: object) =>
    api().post('/api/v1/me/emergency-contacts').set(who.auth).send(body);

  it('saves, lists and removes contacts; at most 3; no duplicates; own only', async () => {
    const a = await add(rider, { name: 'Asha', phone: '+919812300001', relationship: 'Sister' });
    expect(a.status).toBe(201);
    expect((await add(rider, { name: 'Asha again', phone: '9812300001' })).status).toBe(409);
    expect((await add(rider, { name: 'Bala', phone: '+919812300002' })).status).toBe(201);
    expect((await add(rider, { name: 'Chitra', phone: '+919812300003' })).status).toBe(201);
    expect((await add(rider, { name: 'Dev', phone: '+919812300004' })).status).toBe(422);
    expect((await add(rider, { name: 'Bad', phone: '12' })).status).toBe(400);

    const list = await api().get('/api/v1/me/emergency-contacts').set(rider.auth);
    expect(list.body.data).toHaveLength(3);

    const other = await loginAs(env, nextPhone(), 'CUSTOMER');
    const id = a.body.data.contactId ?? a.body.data.id;
    expect((await api().delete(`/api/v1/me/emergency-contacts/${id}`).set(other.auth)).status).toBe(
      404,
    );
    expect((await api().delete(`/api/v1/me/emergency-contacts/${id}`).set(rider.auth)).status).toBe(
      200,
    );
    expect(
      (await api().get('/api/v1/me/emergency-contacts').set(rider.auth)).body.data,
    ).toHaveLength(2);
  });
});

describe('SOS', () => {
  it('alerts the safety desk by event and push, texts saved contacts, and is idempotent', async () => {
    const desk = await loginAsAdmin(env, nextPhone(), 'SAFETY_ADMIN');
    await api()
      .post('/api/v1/me/notifications/devices')
      .set(desk.auth)
      .send({})
      .catch(() => undefined);
    const live = await env.connect(desk.accessToken);
    await api()
      .post('/api/v1/me/emergency-contacts')
      .set(rider.auth)
      .send({ name: 'Asha', phone: '+919812300001' });
    const rideId = await liveRide();

    const res = await sos(rider, rideId, { note: 'Wrong route' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'OPEN', replayed: false, note: 'Wrong route' });
    // The rider never sees staff-only fields.
    expect(res.body.data.snapshot).toBeUndefined();

    const evt = await live.waitFor('ops:sos');
    expect(evt.data).toMatchObject({ incidentId: res.body.data.incidentId, kind: 'TRIGGERED' });
    expect(env.texts).toHaveLength(1);
    expect(env.texts[0]!.phone).toBe('+919812300001');
    expect(env.texts[0]!.message).toContain('/api/v1/public/trips/');
    expect(await SafetyIncident.findOne({})).toMatchObject({ contactsNotified: 1 });

    // Pressing again returns the same alert and does not text anyone twice.
    const again = await sos(rider, rideId);
    expect(again.status).toBe(201);
    expect(again.body.data).toMatchObject({ incidentId: res.body.data.incidentId, replayed: true });
    expect(env.texts).toHaveLength(1);
    expect(await SafetyIncident.countDocuments({})).toBe(1);

    const mine = await api().get(`/api/v1/rides/${rideId}/sos`).set(rider.auth);
    expect(mine.body.data).toHaveLength(1);
  });

  it('the driver can raise one too, and the ride carries on', async () => {
    const rideId = await liveRide();
    expect((await sos(driver, rideId)).status).toBe(201);
    expect((await rideCall(env, driver, rideId, 'complete')).status).toBe(200);
  });

  it('only people on the ride, and only while it is live; off when the flag is off', async () => {
    const stranger = await loginAs(env, nextPhone(), 'CUSTOMER');
    const otherDriver = await createDriver(env, world, { at: NEAR_CP, name: 'Other Driver' });
    const rideId = await liveRide();
    expect((await sos(stranger, rideId)).status).toBe(404);
    expect((await sos(otherDriver, rideId)).status).toBe(404);

    // Before the ride starts there is nothing to raise an alert about.
    await requestRide(env, world, rider).catch(() => undefined);
    const config = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    await api().put('/api/v1/admin/feature-flags/SOS').set(config.auth).send({ enabled: false });
    const off = await sos(rider, rideId);
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe('FEATURE_DISABLED');

    await api().put('/api/v1/admin/feature-flags/SOS').set(config.auth).send({ enabled: true });
    await rideCall(env, driver, rideId, 'complete');
    expect((await sos(rider, rideId)).status).toBe(409); // the ride is over
  });

  it('is on by default outside production only (server decides)', async () => {
    const res = await api().get('/api/v1/config/flags').set(rider.auth);
    expect(res.body.data.SOS).toBe(true);
  });
});

describe('the safety desk', () => {
  it('acknowledges once, notes, locates, resolves, and every view is audited', async () => {
    const desk = await loginAsAdmin(env, nextPhone(), 'SAFETY_ADMIN');
    const second = await loginAsAdmin(env, nextPhone(), 'OPS');
    const rideId = await liveRide();
    const inc = (await sos(rider, rideId)).body.data.incidentId as string;

    const list = await api().get('/api/v1/admin/incidents?status=OPEN').set(desk.auth);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].snapshot).toBeUndefined(); // list stays light

    const detail = await api().get(`/api/v1/admin/incidents/${inc}`).set(desk.auth);
    expect(detail.body.data.snapshot.rider.phone).toBeDefined();
    expect(detail.body.data.snapshot.driver.name).toBe('Ravi Kumar');
    expect(detail.body.data.snapshot.vehicle.registrationNumber).toBeDefined();
    expect(await AuditLog.countDocuments({ action: 'safety.incident.view' })).toBe(1);

    expect(
      (await api().post(`/api/v1/admin/incidents/${inc}/acknowledge`).set(desk.auth)).status,
    ).toBe(200);
    expect(
      (await api().post(`/api/v1/admin/incidents/${inc}/acknowledge`).set(second.auth)).status,
    ).toBe(409);

    const note = await api()
      .post(`/api/v1/admin/incidents/${inc}/notes`)
      .set(desk.auth)
      .send({ text: 'Called driver' });
    expect(note.body.data.notes).toHaveLength(1);

    const loc = await api().get(`/api/v1/admin/incidents/${inc}/location`).set(desk.auth);
    expect(loc.body.data).toMatchObject({ rideLive: true, bookingStatus: 'IN_PROGRESS' });
    expect(loc.body.data.location.lat).toBeDefined();

    const bad = await api()
      .post(`/api/v1/admin/incidents/${inc}/resolve`)
      .set(desk.auth)
      .send({ outcome: 'NOPE' });
    expect(bad.status).toBe(400);
    const done = await api()
      .post(`/api/v1/admin/incidents/${inc}/resolve`)
      .set(desk.auth)
      .send({ outcome: 'ASSISTED', note: 'Reached safely' });
    expect(done.body.data).toMatchObject({ status: 'RESOLVED', outcome: 'ASSISTED' });
    expect(
      (
        await api()
          .post(`/api/v1/admin/incidents/${inc}/resolve`)
          .set(desk.auth)
          .send({ outcome: 'OTHER' })
      ).status,
    ).toBe(409);

    // After resolution the rider can raise a fresh alert.
    expect((await sos(rider, rideId)).body.data.replayed).toBe(false);
  });

  it('an alert nobody takes is escalated to super admins exactly once', async () => {
    const root = await loginAsAdmin(env, nextPhone(), 'SUPER_ADMIN');
    const live = await env.connect(root.accessToken);
    const rideId = await liveRide();
    await sos(rider, rideId);
    await live.waitFor('ops:sos');
    await sleep(40); // past the (20 ms) acknowledgement window of this test server

    const safety = (env.app.locals['services'] as { safety: SafetyService }).safety;
    expect(await safety.escalate()).toEqual({ escalated: 1 });
    expect(await safety.escalate()).toEqual({ escalated: 0 });
    await until(() => live.count('ops:sos') === 2, 'the escalation arrives');
    expect(
      live.events.filter((e) => e.type === 'ops:sos').map((e) => (e.data as { kind: string }).kind),
    ).toEqual(['TRIGGERED', 'ESCALATED']);
  });

  it('keeps people without a safety role out', async () => {
    const support = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    const finance = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    for (const who of [support, finance, rider, driver]) {
      expect((await api().get('/api/v1/admin/incidents').set(who.auth)).status).toBe(403);
    }
  });
});

describe('trip sharing', () => {
  it('a rider shares a live trip; the public link shows no phone numbers and stops when asked or when the ride ends', async () => {
    const rideId = await liveRide();
    const share = await api().post(`/api/v1/rides/${rideId}/share`).set(rider.auth);
    expect(share.status).toBe(201);
    const token = share.body.data.token as string;

    const pub = await api().get(`/api/v1/public/trips/${token}`); // no login
    expect(pub.status).toBe(200);
    expect(pub.body.data).toMatchObject({ live: true, status: 'IN_PROGRESS' });
    expect(pub.body.data.driver.firstName).toBe('Ravi');
    const text = JSON.stringify(pub.body);
    expect(text).not.toMatch(/\+91\d{10}/);
    expect(text).not.toContain('"phone"');

    expect((await api().get('/api/v1/public/trips/not-a-real-token-at-all-xx')).status).toBe(404);

    // The driver cannot create links; a stranger cannot either.
    expect((await api().post(`/api/v1/rides/${rideId}/share`).set(driver.auth)).status).toBe(403);
    const stranger = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect((await api().post(`/api/v1/rides/${rideId}/share`).set(stranger.auth)).status).toBe(404);

    // Stop sharing: the link dies.
    const stop = await api().delete(`/api/v1/rides/${rideId}/share`).set(rider.auth);
    expect(stop.body.data.revoked).toBe(1);
    expect((await api().get(`/api/v1/public/trips/${token}`)).status).toBe(404);

    // A new link works until the ride ends, then shows nothing live.
    const t2 = (await api().post(`/api/v1/rides/${rideId}/share`).set(rider.auth)).body.data.token;
    await rideCall(env, driver, rideId, 'complete');
    const ended = await api().get(`/api/v1/public/trips/${t2}`);
    expect(ended.body.data).toMatchObject({ live: false, status: 'ENDED' });
    expect(ended.body.data.driver).toBeUndefined();
  });

  it('is limited to a few live links per ride and can be switched off', async () => {
    const rideId = await liveRide();
    for (let i = 0; i < 5; i += 1) {
      expect((await api().post(`/api/v1/rides/${rideId}/share`).set(rider.auth)).status).toBe(201);
    }
    expect((await api().post(`/api/v1/rides/${rideId}/share`).set(rider.auth)).status).toBe(422);
    const config = await loginAsAdmin(env, nextPhone(), 'CONFIG_ADMIN');
    await api()
      .put('/api/v1/admin/feature-flags/TRIP_SHARING')
      .set(config.auth)
      .send({ enabled: false });
    await api().delete(`/api/v1/rides/${rideId}/share`).set(rider.auth);
    const off = await api().post(`/api/v1/rides/${rideId}/share`).set(rider.auth);
    expect(off.body.error.code).toBe('FEATURE_DISABLED');
  });
});
