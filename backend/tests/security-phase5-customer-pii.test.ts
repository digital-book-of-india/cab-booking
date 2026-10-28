import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/auditLog.model';
import {
  CP,
  IGI,
  loginAs,
  loginAsAdmin,
  nextPhone,
  seedWorld,
  startTestEnv,
  type Session,
  type TestEnv,
} from './helpers';

let env: TestEnv;
let world: Awaited<ReturnType<typeof seedWorld>>;
let opsStaff: Session;
let supportStaff: Session;
let superAdmin: Session;
let testCustomer: Session;
let customerRawPhone: string;

beforeAll(async () => {
  env = await startTestEnv();
  world = await seedWorld();

  opsStaff = await loginAsAdmin(env, nextPhone(), 'OPS');
  supportStaff = await loginAsAdmin(env, nextPhone(), 'SUPPORT');
  superAdmin = await loginAsAdmin(env, nextPhone(), 'SUPER_ADMIN');
  customerRawPhone = nextPhone();
  testCustomer = await loginAs(env, customerRawPhone, 'CUSTOMER');
});

afterAll(async () => {
  await env.stop();
});

const api = () => request(env.app);

describe('Phase 5: Customer Data Privacy & Dispatch Queue PII Audit Logging', () => {
  let activeBookingPublicId: string;

  beforeAll(async () => {
    // 1. Create a quote
    const quoteRes = await api()
      .post('/api/v1/fare-quotes')
      .set(testCustomer.auth)
      .send({ pickup: CP, drop: IGI, categoryId: world.cats['MINI'] });
    expect(quoteRes.status).toBe(201);
    const quoteId = quoteRes.body.data.quoteId;

    // 2. Create a booking
    const bookRes = await api()
      .post('/api/v1/bookings')
      .set(testCustomer.auth)
      .set('Idempotency-Key', 'pii-test-booking-1')
      .send({
        quoteId,
        paymentMethod: 'CASH',
        rideType: 'INSTANT',
      });
    expect(bookRes.status).toBe(201);
    activeBookingPublicId = bookRes.body.data.bookingId;
  });

  describe('Default Dispatch Queue View (PII Redaction)', () => {
    it('returns customerPhone as null by default for OPS staff without generating audit logs', async () => {
      const auditsBefore = await AuditLog.countDocuments({
        action: 'DISPATCH_QUEUE_CUSTOMER_PII_VIEWED',
      });

      const res = await api()
        .get('/api/v1/admin/dispatch/queue')
        .set(opsStaff.auth);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);

      const bookingItem = res.body.data.find(
        (b: { bookingId: string }) => b.bookingId === activeBookingPublicId,
      );
      expect(bookingItem).toBeDefined();
      // Crucial privacy requirement: customerPhone must be null
      expect(bookingItem.customerPhone).toBeNull();
      // Non-sensitive customer info is preserved
      expect(bookingItem.customerId).toBe(testCustomer.userId);
      expect(bookingItem.customerName).toBeDefined();

      const auditsAfter = await AuditLog.countDocuments({
        action: 'DISPATCH_QUEUE_CUSTOMER_PII_VIEWED',
      });
      expect(auditsAfter).toBe(auditsBefore);
    });

    it('returns customerPhone as null by default even for SUPER_ADMIN when includePhone is omitted', async () => {
      const res = await api()
        .get('/api/v1/admin/dispatch/queue')
        .set(superAdmin.auth);

      expect(res.status).toBe(200);
      const bookingItem = res.body.data.find(
        (b: { bookingId: string }) => b.bookingId === activeBookingPublicId,
      );
      expect(bookingItem).toBeDefined();
      expect(bookingItem.customerPhone).toBeNull();
    });
  });

  describe('Role-Based Authorization for Customer PII', () => {
    it('rejects includePhone=true from OPS staff with 403 Forbidden', async () => {
      const res = await api()
        .get('/api/v1/admin/dispatch/queue?includePhone=true')
        .set(opsStaff.auth);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toMatch(/Only SUPER_ADMIN/);
    });

    it('rejects includePhone=true from SUPPORT staff with 403 Forbidden', async () => {
      const res = await api()
        .get('/api/v1/admin/dispatch/queue?includePhone=true')
        .set(supportStaff.auth);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects includePhone=true from unauthenticated or customer callers', async () => {
      const unauth = await api().get('/api/v1/admin/dispatch/queue?includePhone=true');
      expect(unauth.status).toBe(401);

      const customerRes = await api()
        .get('/api/v1/admin/dispatch/queue?includePhone=true')
        .set(testCustomer.auth);
      expect(customerRes.status).toBe(403);
    });
  });

  describe('Audited SUPER_ADMIN Access to Customer PII', () => {
    it('allows SUPER_ADMIN with includePhone=true to view unmasked phone numbers and writes audit log', async () => {
      const auditsBefore = await AuditLog.countDocuments({
        action: 'DISPATCH_QUEUE_CUSTOMER_PII_VIEWED',
      });

      const res = await api()
        .get('/api/v1/admin/dispatch/queue?includePhone=true')
        .set(superAdmin.auth);

      expect(res.status).toBe(200);
      const bookingItem = res.body.data.find(
        (b: { bookingId: string }) => b.bookingId === activeBookingPublicId,
      );
      expect(bookingItem).toBeDefined();
      expect(bookingItem.customerPhone).toBe(customerRawPhone);

      // Verify audit log entry was created
      const auditEntries = await AuditLog.find({
        action: 'DISPATCH_QUEUE_CUSTOMER_PII_VIEWED',
      }).sort({ createdAt: -1 });

      expect(auditEntries.length).toBeGreaterThan(auditsBefore);
      const latestAudit = auditEntries[0];
      expect(latestAudit).toBeDefined();
      if (!latestAudit) throw new Error('Expected latestAudit to be defined');

      expect(latestAudit.actorRole).toBe('SUPER_ADMIN');
      expect(latestAudit.actorUserId.toString()).toBe(superAdmin.userId);
      expect(latestAudit.targetType).toBe('DispatchQueue');
      expect(latestAudit.targetId).toBe('queue');
      expect(latestAudit.metadata?.count).toBeGreaterThanOrEqual(1);
      expect(latestAudit.metadata?.bookingIds).toContain(activeBookingPublicId);

      // Verify audit log DOES NOT contain raw phone numbers or sensitive secrets
      const auditString = JSON.stringify(latestAudit.toObject());
      expect(auditString).not.toContain(customerRawPhone);
      expect(auditString).not.toMatch(/password|secret|token/i);
    });
  });
});
