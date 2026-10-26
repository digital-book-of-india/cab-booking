import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { REQUIRED_DOCUMENT_TYPES } from '../src/common/enums';
import { RideOffer } from '../src/modules/dispatch/rideOffer.model';
import { DriverDocument } from '../src/modules/drivers/driverDocument.model';
import type { DocumentExpiryService } from '../src/modules/drivers/documentExpiry.service';
import { DriverProfile } from '../src/modules/drivers/driverProfile.model';
import { Notification } from '../src/modules/notifications/notification.model';
import { Vehicle } from '../src/modules/vehicles/vehicle.model';
import {
  addApprovedDocuments,
  assignTo,
  createDriver,
  loginAs,
  loginAsAdmin,
  nextPhone,
  requestRide,
  rideCall,
  seedWorld,
  startTestEnv,
  type Session,
  type TestEnv,
} from './helpers';

let env: TestEnv;
let world: Awaited<ReturnType<typeof seedWorld>>;
let ops: Session;
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(() => env.stop());
beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
  ops = await loginAsAdmin(env, nextPhone(), 'OPS');
});

const api = () => request(env.app);
const DAY = 86_400_000;
const expiry = () =>
  (env.app.locals['services'] as { documentExpiry: DocumentExpiryService }).documentExpiry;
let T0 = new Date();
const atDay = (days: number) => env.setNow(new Date(T0.getTime() + days * DAY));

/** A driver who has applied but has no documents yet. */
async function applicant() {
  const s = await loginAs(env, nextPhone(), 'DRIVER');
  const res = await api()
    .post('/api/v1/drivers/applications')
    .set(s.auth)
    .send({ fullName: 'Ravi Kumar', city: 'Delhi' });
  return { s, driverId: res.body.data.driverId as string };
}
async function upload(s: Session, type: string, expiresAt?: Date) {
  const res = await api()
    .post('/api/v1/drivers/me/documents')
    .set(s.auth)
    .send({
      type,
      contentType: 'image/jpeg',
      ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
    });
  expect(res.status).toBe(201);
  return res.body.data.document.id as string;
}
const review = (driverId: string, docId: string, status: 'APPROVED' | 'REJECTED') =>
  api()
    .patch(`/api/v1/admin/drivers/${driverId}/documents/${docId}`)
    .set(ops.auth)
    .send({ status, ...(status === 'REJECTED' ? { reason: 'Photo unreadable' } : {}) });
const approveDriver = (driverId: string) =>
  api()
    .patch(`/api/v1/admin/drivers/${driverId}/approval`)
    .set(ops.auth)
    .send({ decision: 'APPROVE' });

describe('approving a driver needs current required documents', () => {
  it('lists exactly what is missing', async () => {
    const { s, driverId } = await applicant();
    const none = await approveDriver(driverId);
    expect(none.status).toBe(422);
    expect(none.body.error.message).toContain('driving licence');
    expect(none.body.error.fieldErrors.map((f: { field: string }) => f.field).sort()).toEqual(
      REQUIRED_DOCUMENT_TYPES.map((t) => `documents.${t}`).sort(),
    );

    for (const type of ['DRIVING_LICENCE', 'VEHICLE_RC', 'INSURANCE']) {
      expect((await review(driverId, await upload(s, type), 'APPROVED')).status).toBe(200);
    }
    const one = await approveDriver(driverId);
    expect(one.status).toBe(422);
    expect(one.body.error.fieldErrors.map((f: { field: string }) => f.field)).toEqual([
      'documents.ID_PROOF',
    ]);

    expect((await review(driverId, await upload(s, 'ID_PROOF'), 'APPROVED')).status).toBe(200);
    expect((await approveDriver(driverId)).status).toBe(200);
  });

  it('a pending, rejected or expired document does not count', async () => {
    const { driverId } = await applicant();
    await addApprovedDocuments(driverId);
    // Swap the licence for a rejected one and the RC for a pending one; insurance has expired.
    await DriverDocument.updateOne({ driverId, type: 'DRIVING_LICENCE' }, { status: 'REJECTED' });
    await DriverDocument.updateOne({ driverId, type: 'VEHICLE_RC' }, { status: 'PENDING' });
    await DriverDocument.updateOne(
      { driverId, type: 'INSURANCE' },
      { expiresAt: new Date(Date.now() - DAY) },
    );
    const res = await approveDriver(driverId);
    expect(res.status).toBe(422);
    expect(res.body.error.fieldErrors.map((f: { field: string }) => f.field).sort()).toEqual([
      'documents.DRIVING_LICENCE',
      'documents.INSURANCE',
      'documents.VEHICLE_RC',
    ]);
  });

  it('also applies when reinstating a suspended driver', async () => {
    const driver = await createDriver(env, world, { online: false });
    await api()
      .patch(`/api/v1/admin/drivers/${driver.driverId}/approval`)
      .set(ops.auth)
      .send({ decision: 'SUSPEND', reason: 'Complaint' });
    await DriverDocument.updateMany({ driverId: driver.driverId }, { status: 'EXPIRED' });
    expect((await approveDriver(driver.driverId)).status).toBe(422);
  });
});

describe('replacing a document', () => {
  it('the newly approved document retires the older one of the same type', async () => {
    const { s, driverId } = await applicant();
    const oldDoc = await upload(s, 'DRIVING_LICENCE');
    await review(driverId, oldDoc, 'APPROVED');
    const newDoc = await upload(s, 'DRIVING_LICENCE', new Date(Date.now() + 400 * DAY));
    // Uploading alone changes nothing: the approved one still counts.
    expect((await DriverDocument.findById(oldDoc).lean())?.status).toBe('APPROVED');
    await review(driverId, newDoc, 'APPROVED');
    expect((await DriverDocument.findById(oldDoc).lean())?.status).toBe('SUPERSEDED');
    expect((await DriverDocument.findById(newDoc).lean())?.status).toBe('APPROVED');
    const listed = await api().get('/api/v1/drivers/me/documents').set(s.auth);
    expect(listed.body.data.map((d: { status: string }) => d.status).sort()).toEqual([
      'APPROVED',
      'SUPERSEDED',
    ]);
  });

  it('approving an older upload does not retire a newer one waiting for review', async () => {
    const { s, driverId } = await applicant();
    const first = await upload(s, 'INSURANCE');
    const second = await upload(s, 'INSURANCE');
    await review(driverId, first, 'APPROVED');
    expect((await DriverDocument.findById(second).lean())?.status).toBe('PENDING');
  });
});

describe('going online needs current documents', () => {
  it('is refused when a required document has lapsed, and says why', async () => {
    const driver = await createDriver(env, world, { online: false });
    await DriverDocument.updateOne(
      { driverId: driver.driverId, type: 'INSURANCE' },
      { expiresAt: new Date(Date.now() - 1000) },
    );
    const state = await api().get('/api/v1/drivers/me/presence').set(driver.auth);
    expect(state.body.data.issues).toContain('DOCUMENTS_INVALID');
    const res = await api()
      .post('/api/v1/drivers/me/presence')
      .set(driver.auth)
      .send({
        status: 'ONLINE',
        vehicleId: driver.vehicleId,
        location: { lat: 28.6335, lng: 77.2167 },
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DRIVER_NOT_ELIGIBLE');
    expect(res.body.error.message).toContain('DOCUMENTS_INVALID');
  });
});

describe('document reminders and expiry', () => {
  const notes = (type: string) => Notification.countDocuments({ type });

  it('reminds at 30, 7 and 1 days, each once, however often the job runs', async () => {
    T0 = new Date();
    atDay(0);
    const driver = await createDriver(env, world, { online: false });
    await DriverDocument.deleteMany({ driverId: driver.driverId });
    await addApprovedDocuments(driver.driverId, new Date(T0.getTime() + 20 * DAY));

    expect((await expiry().run()).reminded).toBe(4); // 20 days left: the 30-day reminder, per document
    expect((await expiry().run()).reminded).toBe(0); // same day again: nothing new
    expect(await notes('document.expiring')).toBe(4);

    atDay(14); // 6 days left
    expect((await expiry().run()).reminded).toBe(4);
    expect((await expiry().run()).reminded).toBe(0);

    atDay(19.5); // less than a day left
    expect((await expiry().run()).reminded).toBe(4);
    expect(await notes('document.expiring')).toBe(12);
    const body = (
      await Notification.findOne({ type: 'document.expiring' }).sort({ createdAt: -1 }).lean()
    )?.body;
    expect(body).toContain('expires in 1 day.');
  });

  it('a job that was down sends only the closest reminder, not a burst', async () => {
    T0 = new Date();
    atDay(0);
    const driver = await createDriver(env, world, { online: false });
    await DriverDocument.deleteMany({ driverId: driver.driverId });
    await addApprovedDocuments(driver.driverId, new Date(T0.getTime() + 5 * DAY));
    expect((await expiry().run()).reminded).toBe(4);
    expect(await notes('document.expiring')).toBe(4); // one per document (the 7-day one), not two
    const doc = await DriverDocument.findOne({ driverId: driver.driverId }).lean();
    expect(doc?.remindersSent.sort((a, b) => a - b)).toEqual([7, 30]);
  });

  it('an expired required document takes an online driver off the road and blocks going online', async () => {
    T0 = new Date();
    atDay(0);
    const driver = await createDriver(env, world); // online, documents valid for a year
    await DriverDocument.updateOne(
      { driverId: driver.driverId, type: 'INSURANCE' },
      { expiresAt: new Date(T0.getTime() + 10 * DAY) },
    );
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    await requestRide(env, world, customer); // the driver holds an open offer

    atDay(11);
    const report = await expiry().run();
    expect(report).toMatchObject({ expired: 1, driversSetOffline: 1 });
    const profile = await DriverProfile.findById(driver.driverId).lean();
    expect(profile?.onlineStatus).toBe('OFFLINE');
    expect(profile?.currentLocation).toBeUndefined();
    expect(
      (await DriverDocument.findOne({ driverId: driver.driverId, type: 'INSURANCE' }).lean())
        ?.status,
    ).toBe('EXPIRED');
    expect(await RideOffer.countDocuments({ driverId: driver.driverId, status: 'PENDING' })).toBe(
      0,
    );
    expect(await notes('document.expired')).toBe(1);

    const retry = await api()
      .post('/api/v1/drivers/me/presence')
      .set(driver.auth)
      .send({
        status: 'ONLINE',
        vehicleId: driver.vehicleId,
        location: { lat: 28.6335, lng: 77.2167 },
      });
    expect(retry.status).toBe(403);

    // A new insurance document, approved, puts them back on the road.
    const fresh = await upload(driver, 'INSURANCE', new Date(T0.getTime() + 400 * DAY));
    expect((await review(driver.driverId, fresh, 'APPROVED')).status).toBe(200);
    const back = await api()
      .post('/api/v1/drivers/me/presence')
      .set(driver.auth)
      .send({
        status: 'ONLINE',
        vehicleId: driver.vehicleId,
        location: { lat: 28.6335, lng: 77.2167 },
      });
    expect(back.status).toBe(200);
  });

  it('a driver in the middle of a ride is not thrown off it', async () => {
    T0 = new Date();
    atDay(0);
    const driver = await createDriver(env, world);
    await DriverDocument.updateOne(
      { driverId: driver.driverId, type: 'VEHICLE_RC' },
      { expiresAt: new Date(T0.getTime() + 1 * DAY) },
    );
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    await requestRide(env, world, customer);
    const rideId = await assignTo(env, driver);
    await rideCall(env, driver, rideId, 'en-route');
    await api()
      .post('/api/v1/drivers/me/location')
      .set(driver.auth)
      .send({ lat: 28.6315, lng: 77.2167 });
    await rideCall(env, driver, rideId, 'arrived');

    atDay(2);
    const report = await expiry().run();
    expect(report).toMatchObject({ expired: 1, driversSetOffline: 0 });
    const profile = await DriverProfile.findById(driver.driverId).lean();
    expect(profile?.onlineStatus).toBe('ONLINE');
    expect(profile?.activeRideId).toBeTruthy();
    // ...but once the ride is over they cannot go online again until the document is renewed.
    await rideCall(env, driver, rideId, 'cancel', { reasonCode: 'OTHER' });
    await api().post('/api/v1/drivers/me/presence').set(driver.auth).send({ status: 'OFFLINE' });
    const again = await api()
      .post('/api/v1/drivers/me/presence')
      .set(driver.auth)
      .send({
        status: 'ONLINE',
        vehicleId: driver.vehicleId,
        location: { lat: 28.6335, lng: 77.2167 },
      });
    expect(again.status).toBe(403);
  });

  it('an optional document expiring does not stop anyone driving', async () => {
    T0 = new Date();
    atDay(0);
    const driver = await createDriver(env, world);
    await DriverDocument.create({
      driverId: driver.driverId,
      type: 'PERMIT',
      objectKey: 'private/driver-docs/x/permit',
      status: 'APPROVED',
      expiresAt: new Date(T0.getTime() + 2 * DAY),
    });
    atDay(3);
    expect(await expiry().run()).toMatchObject({ expired: 1, driversSetOffline: 0 });
    expect((await DriverProfile.findById(driver.driverId).lean())?.onlineStatus).toBe('ONLINE');
  });

  it('several instances running at once expire and notify each document once', async () => {
    T0 = new Date();
    atDay(0);
    const driver = await createDriver(env, world);
    await DriverDocument.updateMany(
      { driverId: driver.driverId },
      { expiresAt: new Date(T0.getTime() + 1 * DAY) },
    );
    atDay(2);
    const reports = await Promise.all([expiry().run(), expiry().run(), expiry().run()]);
    expect(reports.reduce((n, r) => n + r.expired, 0)).toBe(4);
    expect(await notes('document.expired')).toBe(4);
  });
});

describe('who needs to renew', () => {
  const list = (who: Session, query = '') =>
    api().get(`/api/v1/admin/documents/expiring${query}`).set(who.auth);

  it('lists documents expiring soon and already expired, with the driver to contact', async () => {
    T0 = new Date();
    atDay(0);
    const soon = await createDriver(env, world, { online: false, name: 'Sunita Rao' });
    const gone = await createDriver(env, world, { online: false, name: 'Mohan Das' });
    await DriverDocument.updateOne(
      { driverId: soon.driverId, type: 'INSURANCE' },
      { expiresAt: new Date(T0.getTime() + 10 * DAY) },
    );
    await DriverDocument.updateOne(
      { driverId: gone.driverId, type: 'VEHICLE_RC' },
      { status: 'EXPIRED', expiresAt: new Date(T0.getTime() - 3 * DAY) },
    );

    const res = await list(ops);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({
      driverName: 'Mohan Das',
      type: 'VEHICLE_RC',
      status: 'EXPIRED',
    });
    expect(res.body.data[1]).toMatchObject({
      driverName: 'Sunita Rao',
      type: 'INSURANCE',
      status: 'APPROVED',
    });
    expect((await list(ops, '?days=5')).body.data).toHaveLength(1); // only the one already expired

    const dash = (await api().get('/api/v1/admin/dashboard').set(ops.auth)).body.data;
    expect(dash.reviewQueue).toMatchObject({ documentsExpiringSoon: 1, documentsExpired: 1 });
  });

  it('is for operations and support staff only', async () => {
    const customer = await loginAs(env, nextPhone(), 'CUSTOMER');
    const finance = await loginAsAdmin(env, nextPhone(), 'FINANCE');
    const support = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
    expect((await list(customer)).status).toBe(403);
    expect((await list(finance)).status).toBe(403);
    expect((await list(support)).status).toBe(200);
    expect((await list(ops, '?days=0')).status).toBe(400);
    expect((await list(ops, '?days=9999')).status).toBe(400);
  });
});

describe('a rejected vehicle gives its registration number back', () => {
  const register = (who: Session, plate: string) =>
    api().post('/api/v1/drivers/me/vehicles').set(who.auth).send({
      categoryId: world.cats['MINI'],
      registrationNumber: plate,
      make: 'Maruti',
      model: 'Dzire',
      color: 'White',
      seats: 4,
    });

  it('a plate can be registered once, until the vehicle holding it is rejected', async () => {
    const a = await applicant();
    const b = await applicant();
    const first = await register(a.s, 'DL01XY9999');
    expect(first.status).toBe(201);
    expect((await register(b.s, 'DL01XY9999')).status).toBe(409); // already taken

    const reject = await api()
      .patch(`/api/v1/admin/vehicles/${first.body.data.id}/verification`)
      .set(ops.auth)
      .send({ status: 'REJECTED', reason: 'Documents do not match' });
    expect(reject.status).toBe(200);
    expect((await Vehicle.findById(first.body.data.id).lean())?.holdsRegistration).toBe(false);

    const second = await register(b.s, 'DL01XY9999');
    expect(second.status).toBe(201);
    // The rejected one cannot be reinstated while someone else holds the plate...
    const reinstate = await api()
      .patch(`/api/v1/admin/vehicles/${first.body.data.id}/verification`)
      .set(ops.auth)
      .send({ status: 'VERIFIED' });
    expect(reinstate.status).toBe(409);
    expect((await Vehicle.findById(first.body.data.id).lean())?.verificationStatus).toBe(
      'REJECTED',
    );
    // ...but a verified one still blocks everybody else.
    await api()
      .patch(`/api/v1/admin/vehicles/${second.body.data.id}/verification`)
      .set(ops.auth)
      .send({ status: 'VERIFIED' });
    const c = await applicant();
    expect((await register(c.s, 'DL01XY9999')).status).toBe(409);
  });
});
