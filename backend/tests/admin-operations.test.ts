import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CP, IGI, loginAs, loginAsAdmin, nextPhone, seedWorld, startTestEnv, type Session, type TestEnv } from './helpers';
import { DriverProfile } from '../src/modules/drivers/driverProfile.model';
import { Vehicle } from '../src/modules/vehicles/vehicle.model';
import { AuditLog } from '../src/modules/audit/auditLog.model';

let env: TestEnv;
let opsAdmin: Session;
let customer: Session;
let driverSession: Session;
let world: Awaited<ReturnType<typeof seedWorld>>;

beforeAll(async () => {
  env = await startTestEnv();
});

afterAll(() => env.stop());

beforeEach(async () => {
  await env.reset();
  world = await seedWorld();
  opsAdmin = await loginAsAdmin(env, nextPhone(), 'OPS');
  customer = await loginAs(env, nextPhone(), 'CUSTOMER');
  driverSession = await loginAs(env, nextPhone(), 'DRIVER');
});

const api = () => request(env.app);

describe('Admin Operations: Live-Driver Feed & Dispatch Queue', () => {
  /* ---------------- FEATURE 5: LIVE-DRIVER FEED ---------------- */

  describe('GET /admin/drivers/live (Live-Driver Feed)', () => {
    it('denies unauthenticated and non-staff callers', async () => {
      const unauth = await api().get('/api/v1/admin/drivers/live');
      expect(unauth.status).toBe(401);

      const customerForbidden = await api()
        .get('/api/v1/admin/drivers/live')
        .set(customer.auth);
      expect(customerForbidden.status).toBe(403);
    });

    it('rejects invalid bounding box parameters (span > 5 degrees or min > max)', async () => {
      // span > 5 degrees
      const tooWide = await api()
        .get('/api/v1/admin/drivers/live?minLat=20&maxLat=28&minLng=70&maxLng=78')
        .set(opsAdmin.auth);
      expect(tooWide.status).toBe(400);

      // min > max
      const inverted = await api()
        .get('/api/v1/admin/drivers/live?minLat=30&maxLat=28&minLng=70&maxLng=72')
        .set(opsAdmin.auth);
      expect(inverted.status).toBe(400);
    });

    it('returns online approved drivers with location, vehicle data and creates audit log', async () => {
      // Approve driver and set online with location at Connaught Place
      const driver = await DriverProfile.findOne({ userId: driverSession.userId });
      expect(driver).toBeDefined();

      const vehicle = await Vehicle.create({
        driverId: driver!._id,
        categoryId: world.cats['MINI'],
        make: 'Maruti',
        model: 'WagonR',
        registrationNumber: 'DL01AB1234',
        seats: 4,
        holdsRegistration: true,
        verificationStatus: 'VERIFIED',
        active: true,
      });

      await DriverProfile.updateOne(
        { _id: driver!._id },
        {
          $set: {
            approvalStatus: 'APPROVED',
            onlineStatus: 'ONLINE',
            currentLocation: { type: 'Point', coordinates: [CP.lng, CP.lat] },
            locationUpdatedAt: new Date(),
            headingDegrees: 180,
            currentVehicleId: vehicle._id,
          },
        },
      );

      // Query live drivers feed within Delhi bounding box
      const res = await api()
        .get(`/api/v1/admin/drivers/live?minLat=${CP.lat - 0.1}&maxLat=${CP.lat + 0.1}&minLng=${CP.lng - 0.1}&maxLng=${CP.lng + 0.1}`)
        .set(opsAdmin.auth);

      if (res.status !== 200) console.log("FAILED RES BODY:", JSON.stringify(res.body));
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);

      const found = res.body.data.find((d: { driverId: string }) => d.driverId === driver!._id.toString());
      expect(found).toBeDefined();
      expect(found.onlineStatus).toBe('ONLINE');
      expect(found.location.lat).toBeCloseTo(CP.lat, 4);
      expect(found.location.lng).toBeCloseTo(CP.lng, 4);
      expect(found.vehicle).toBeDefined();
      expect(found.vehicle.make).toBe('Maruti');
      expect(found.vehicle.model).toBe('WagonR');
      expect(found.vehicle.registrationNumber).toBe('DL01AB1234');

      // Verify audit log recorded
      const audit = await AuditLog.findOne({ action: 'ADMIN_VIEW_LIVE_DRIVERS' });
      expect(audit).toBeDefined();
      expect(audit?.actorUserId.toString()).toBe(opsAdmin.userId);
    });

    it('filters drivers by zoneId correctly', async () => {
      const res = await api()
        .get(`/api/v1/admin/drivers/live?zoneId=${world.zoneId}`)
        .set(opsAdmin.auth);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta.page).toBe(1);
    });
  });

  /* ---------------- FEATURE 6: DISPATCH QUEUE ---------------- */

  describe('GET /admin/dispatch/queue (Admin Dispatch Queue)', () => {
    it('denies unauthenticated and customer callers', async () => {
      const unauth = await api().get('/api/v1/admin/dispatch/queue');
      expect(unauth.status).toBe(401);

      const customerForbidden = await api()
        .get('/api/v1/admin/dispatch/queue')
        .set(customer.auth);
      expect(customerForbidden.status).toBe(403);
    });

    it('lists bookings awaiting driver assignment with server-calculated waitingSeconds', async () => {
      // Create a quote
      const quoteRes = await api()
        .post('/api/v1/fare-quotes')
        .set(customer.auth)
        .send({ pickup: CP, drop: IGI, categoryId: world.cats['MINI'] });
      expect(quoteRes.status).toBe(201);
      const quoteId = quoteRes.body.data.quoteId;

      // Create a booking
      const bookRes = await api()
        .post('/api/v1/bookings')
        .set(customer.auth)
        .set('Idempotency-Key', 'queue-test-booking-1')
        .send({
          quoteId,
          paymentMethod: 'CASH',
          rideType: 'INSTANT',
        });
      expect(bookRes.status).toBe(201);
      const bookingId = bookRes.body.data.bookingId;

      // Query dispatch queue
      const queueRes = await api()
        .get('/api/v1/admin/dispatch/queue')
        .set(opsAdmin.auth);

      expect(queueRes.status).toBe(200);
      expect(queueRes.body.data.length).toBeGreaterThan(0);

      const item = queueRes.body.data.find((b: { bookingId: string }) => b.bookingId === bookingId);
      expect(item).toBeDefined();
      expect(item.status).toMatch(/REQUESTED|DISPATCHING/);
      expect(typeof item.waitingSeconds).toBe('number');
      expect(item.waitingSeconds).toBeGreaterThanOrEqual(0);
      expect(item.pickup).toBeDefined();
      expect(item.drop).toBeDefined();
      expect(item.estimatedFarePaise).toBeGreaterThan(0);
      expect(queueRes.body.meta.total).toBeGreaterThanOrEqual(1);
    });

    it('filters dispatch queue by zoneId and categoryId', async () => {
      const res = await api()
        .get(`/api/v1/admin/dispatch/queue?zoneId=${world.zoneId}&categoryId=${world.cats['MINI']}`)
        .set(opsAdmin.auth);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      for (const item of res.body.data) {
        expect(item.zoneId).toBe(world.zoneId);
        expect(item.categoryId).toBe(world.cats['MINI']);
      }
    });
  });
});
