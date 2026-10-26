import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/auditLog.model';
import { Device } from '../src/modules/notifications/device.model';
import { loginAs, loginAsAdmin, nextPhone, seedWorld, startTestEnv, type Session, type TestEnv } from './helpers';

let env: TestEnv;
let opsAdmin: Session;
let customer: Session;
let customerPhone: string;

beforeAll(async () => {
  env = await startTestEnv();
});

afterAll(() => env.stop());

beforeEach(async () => {
  await env.reset();
  await seedWorld();
  opsAdmin = await loginAsAdmin(env, nextPhone(), 'OPS');
  customerPhone = nextPhone();
  customer = await loginAs(env, customerPhone, 'CUSTOMER');
});

const api = () => request(env.app);

describe('Admin Test Notification Feature', () => {
  it('denies unauthenticated and unauthorized requests', async () => {
    // Unauthenticated
    const unauth = await api()
      .post('/api/v1/admin/notifications/test')
      .send({
        channel: 'push',
        recipientId: customer.userId,
        title: 'Test',
        body: 'Hello test',
      });
    expect(unauth.status).toBe(401);

    // Customer
    const forbidden = await api()
      .post('/api/v1/admin/notifications/test')
      .set(customer.auth)
      .send({
        channel: 'push',
        recipientId: customer.userId,
        title: 'Test',
        body: 'Hello test',
      });
    expect(forbidden.status).toBe(403);
  });

  it('rejects invalid channel and malformed payloads', async () => {
    // Unsupported channel
    const invalidChannel = await api()
      .post('/api/v1/admin/notifications/test')
      .set(opsAdmin.auth)
      .send({
        channel: 'whatsapp',
        recipientId: customer.userId,
        title: 'Test',
        body: 'Hello',
      });
    expect(invalidChannel.status).toBe(400);

    // Missing body
    const missingBody = await api()
      .post('/api/v1/admin/notifications/test')
      .set(opsAdmin.auth)
      .send({
        channel: 'push',
        recipientId: customer.userId,
        title: 'Test',
      });
    expect(missingBody.status).toBe(400);

    // Invalid recipientId format
    const invalidRecipient = await api()
      .post('/api/v1/admin/notifications/test')
      .set(opsAdmin.auth)
      .send({
        channel: 'push',
        recipientId: 'not-an-objectid',
        title: 'Test',
        body: 'Hello',
      });
    expect(invalidRecipient.status).toBe(400);
  });

  it('sends a test push notification to a recipient with an active push token and audits', async () => {
    // Register push device for customer
    await Device.create({
      userId: customer.userId,
      token: 'fcm-token-customer-1',
      platform: 'android',
      lastSeenAt: new Date(),
    });

    const res = await api()
      .post('/api/v1/admin/notifications/test')
      .set(opsAdmin.auth)
      .send({
        channel: 'push',
        recipientId: customer.userId,
        title: 'Ops Test Alert',
        body: 'This is a test notification from operations staff.',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(true);
    expect(res.body.data.channel).toBe('push');
    expect(res.body.data.recipientId).toBe(customer.userId);

    // Verify audit log recorded
    const audit = await AuditLog.findOne({
      action: 'ADMIN_TEST_NOTIFICATION_SENT',
      targetId: customer.userId,
    });
    expect(audit).toBeDefined();
    expect(audit?.actorUserId.toString()).toBe(opsAdmin.userId);
  });

  it('sends a test SMS notification to recipient and audits', async () => {
    const res = await api()
      .post('/api/v1/admin/notifications/test')
      .set(opsAdmin.auth)
      .send({
        channel: 'sms',
        recipientId: customer.userId,
        title: 'SMS Test',
        body: 'Test SMS from operations platform',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(true);
    expect(res.body.data.channel).toBe('sms');

    // Verify fake SMS provider received text
    expect(env.texts.length).toBeGreaterThan(0);
    const sent = env.texts.find((t) => t.phone === customerPhone);
    expect(sent).toBeDefined();
    expect(sent?.message).toContain('Test SMS from operations platform');
  });

  it('enforces rate limit on test notifications', async () => {
    // Send 10 test notifications (rate limit threshold)
    for (let i = 0; i < 10; i++) {
      const res = await api()
        .post('/api/v1/admin/notifications/test')
        .set(opsAdmin.auth)
        .send({
          channel: 'sms',
          recipientId: customer.userId,
          title: `Test ${i}`,
          body: `Burst test ${i}`,
        });
      expect(res.status).toBe(200);
    }

    // 11th request within window exceeds rate limit -> 429
    const limited = await api()
      .post('/api/v1/admin/notifications/test')
      .set(opsAdmin.auth)
      .send({
        channel: 'sms',
        recipientId: customer.userId,
        title: 'Exceeding test',
        body: 'Should be rate limited',
      });

    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });
});
