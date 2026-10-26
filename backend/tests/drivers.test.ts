import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/modules/audit/auditLog.model';
import { DriverProfile } from '../src/modules/drivers/driverProfile.model';
import {
  loginAs,
  loginAsAdmin,
  nextPhone,
  startTestEnv,
  type Session,
  type TestEnv,
  addApprovedDocuments,
} from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(() => env.stop());
beforeEach(() => env.reset());

const api = () => request(env.app);

async function submittedDriver(
  opts: { documents?: boolean } = {},
): Promise<{ s: Session; driverId: string }> {
  const s = await loginAs(env, nextPhone(), 'DRIVER');
  const res = await api()
    .post('/api/v1/drivers/applications')
    .set(s.auth)
    .send({ fullName: 'Ravi Kumar', city: 'Delhi' });
  expect(res.status).toBe(201);
  // Approval needs current required documents; most tests here are about other things.
  if (opts.documents !== false) await addApprovedDocuments(res.body.data.driverId);
  return { s, driverId: res.body.data.driverId };
}

describe('driver application', () => {
  it('submits once; duplicates conflict', async () => {
    const { s } = await submittedDriver();
    const again = await api()
      .post('/api/v1/drivers/applications')
      .set(s.auth)
      .send({ fullName: 'Ravi Kumar', city: 'Delhi' });
    expect(again.status).toBe(409);
    const status = await api().get('/api/v1/drivers/me/application').set(s.auth);
    expect(status.body.data).toMatchObject({ approvalStatus: 'PENDING', city: 'Delhi' });
  });

  it('rejects unknown fields such as approvalStatus', async () => {
    const s = await loginAs(env, nextPhone(), 'DRIVER');
    const res = await api()
      .post('/api/v1/drivers/applications')
      .set(s.auth)
      .send({ fullName: 'Ravi Kumar', city: 'Delhi', approvalStatus: 'APPROVED' });
    expect(res.status).toBe(400);
  });
});

describe('driver documents', () => {
  it('registers metadata, returns a signed upload URL, and never exposes the object key', async () => {
    const { s } = await submittedDriver({ documents: false });
    const res = await api()
      .post('/api/v1/drivers/me/documents')
      .set(s.auth)
      .send({ type: 'DRIVING_LICENCE', documentNumberLast4: '1234', contentType: 'image/jpeg' });
    expect(res.status).toBe(201);
    expect(res.body.data.upload.url).toContain('mock-upload');
    expect(JSON.stringify(res.body)).not.toContain('private/driver-docs');

    const list = await api().get('/api/v1/drivers/me/documents').set(s.auth);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ type: 'DRIVING_LICENCE', status: 'PENDING' });
  });

  it('rejects a full document number, unknown type, or disallowed content type', async () => {
    const { s } = await submittedDriver();
    const post = (body: object) =>
      api().post('/api/v1/drivers/me/documents').set(s.auth).send(body);
    expect(
      (
        await post({
          type: 'DRIVING_LICENCE',
          documentNumberLast4: 'DL0420110012345',
          contentType: 'image/png',
        })
      ).status,
    ).toBe(400);
    expect((await post({ type: 'PASSPORT', contentType: 'image/png' })).status).toBe(400);
    expect((await post({ type: 'INSURANCE', contentType: 'text/html' })).status).toBe(400);
  });

  it("a driver can't see another driver's documents", async () => {
    const a = await submittedDriver({ documents: false });
    const b = await submittedDriver({ documents: false });
    await api()
      .post('/api/v1/drivers/me/documents')
      .set(a.s.auth)
      .send({ type: 'INSURANCE', contentType: 'application/pdf' });
    const list = await api().get('/api/v1/drivers/me/documents').set(b.s.auth);
    expect(list.body.data).toHaveLength(0);
  });
});

describe('admin driver review', () => {
  it('approves a submitted driver and writes an audit entry', async () => {
    const { driverId } = await submittedDriver();
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const res = await api()
      .patch(`/api/v1/admin/drivers/${driverId}/approval`)
      .set(ops.auth)
      .send({ decision: 'APPROVE' });
    expect(res.status).toBe(200);
    expect(res.body.data.approvalStatus).toBe('APPROVED');

    const audit = await AuditLog.findOne({ action: 'driver.approve', targetId: driverId }).lean();
    expect(audit).toMatchObject({ actorRole: 'OPS', targetType: 'DriverProfile' });
    expect(audit?.requestId).toBeTruthy();
  });

  it('requires a reason to reject, suspend, or request resubmission', async () => {
    const { driverId } = await submittedDriver();
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    for (const decision of ['REJECT', 'REQUEST_RESUBMISSION', 'SUSPEND']) {
      const res = await api()
        .patch(`/api/v1/admin/drivers/${driverId}/approval`)
        .set(ops.auth)
        .send({ decision });
      expect(res.status, decision).toBe(400);
    }
  });

  it('cannot approve a driver who has not applied', async () => {
    const s = await loginAs(env, nextPhone(), 'DRIVER');
    const profile = await DriverProfile.findOne({ userId: s.userId });
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const res = await api()
      .patch(`/api/v1/admin/drivers/${profile!.id}/approval`)
      .set(ops.auth)
      .send({ decision: 'APPROVE' });
    expect(res.status).toBe(422);
  });

  it('enforces valid transitions (no double approval, no suspending a pending driver)', async () => {
    const { driverId } = await submittedDriver();
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const decide = (body: object) =>
      api().patch(`/api/v1/admin/drivers/${driverId}/approval`).set(ops.auth).send(body);

    expect((await decide({ decision: 'SUSPEND', reason: 'testing' })).status).toBe(409);
    expect((await decide({ decision: 'APPROVE' })).status).toBe(200);
    expect((await decide({ decision: 'APPROVE' })).status).toBe(409);
    expect((await decide({ decision: 'SUSPEND', reason: 'safety complaint' })).status).toBe(200);
    expect((await decide({ decision: 'APPROVE' })).status).toBe(200); // reinstated
  });

  it('two concurrent opposite decisions: exactly one wins', async () => {
    const { driverId } = await submittedDriver();
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const decide = (body: object) =>
      api().patch(`/api/v1/admin/drivers/${driverId}/approval`).set(ops.auth).send(body);
    const results = await Promise.all([
      decide({ decision: 'APPROVE' }),
      decide({ decision: 'REJECT', reason: 'invalid documents' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('request-resubmission lets the driver apply again, and clears the reason on approval', async () => {
    const { s, driverId } = await submittedDriver();
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    await api()
      .patch(`/api/v1/admin/drivers/${driverId}/approval`)
      .set(ops.auth)
      .send({ decision: 'REQUEST_RESUBMISSION', reason: 'Licence photo is blurry' });
    const status = await api().get('/api/v1/drivers/me/application').set(s.auth);
    expect(status.body.data).toMatchObject({
      approvalStatus: 'NEEDS_RESUBMISSION',
      decisionReason: 'Licence photo is blurry',
    });
    const resubmit = await api()
      .post('/api/v1/drivers/applications')
      .set(s.auth)
      .send({ fullName: 'Ravi Kumar', city: 'Delhi' });
    expect(resubmit.status).toBe(201);
    await api()
      .patch(`/api/v1/admin/drivers/${driverId}/approval`)
      .set(ops.auth)
      .send({ decision: 'APPROVE' });
    const after = await api().get('/api/v1/drivers/me/application').set(s.auth);
    expect(after.body.data.decisionReason).toBeNull();
  });

  it('suspending forces the driver offline', async () => {
    const { driverId } = await submittedDriver();
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    await api()
      .patch(`/api/v1/admin/drivers/${driverId}/approval`)
      .set(ops.auth)
      .send({ decision: 'APPROVE' });
    await DriverProfile.updateOne({ _id: driverId }, { onlineStatus: 'ONLINE' });
    await api()
      .patch(`/api/v1/admin/drivers/${driverId}/approval`)
      .set(ops.auth)
      .send({ decision: 'SUSPEND', reason: 'Safety complaint' });
    expect((await DriverProfile.findById(driverId).lean())?.onlineStatus).toBe('OFFLINE');
  });

  it('reviews a document and records it', async () => {
    const { s, driverId } = await submittedDriver();
    const doc = await api()
      .post('/api/v1/drivers/me/documents')
      .set(s.auth)
      .send({ type: 'DRIVING_LICENCE', contentType: 'image/png' });
    const docId = doc.body.data.document.id;
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');

    const bad = await api()
      .patch(`/api/v1/admin/drivers/${driverId}/documents/${docId}`)
      .set(ops.auth)
      .send({ status: 'REJECTED' });
    expect(bad.status).toBe(400);
    const res = await api()
      .patch(`/api/v1/admin/drivers/${driverId}/documents/${docId}`)
      .set(ops.auth)
      .send({ status: 'REJECTED', reason: 'Expired licence' });
    expect(res.body.data).toMatchObject({ status: 'REJECTED', rejectionReason: 'Expired licence' });
    expect(await AuditLog.countDocuments({ action: 'driver.document.rejected' })).toBe(1);
  });

  it('detail view returns download URLs and is itself audited', async () => {
    const { s, driverId } = await submittedDriver();
    await api()
      .post('/api/v1/drivers/me/documents')
      .set(s.auth)
      .send({ type: 'ID_PROOF', contentType: 'image/png' });
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    const res = await api().get(`/api/v1/admin/drivers/${driverId}`).set(ops.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.documents[0].downloadUrl).toContain('mock-download');
    expect(await AuditLog.countDocuments({ action: 'driver.view', targetId: driverId })).toBe(1);
  });

  it('lists with filters, search and pagination', async () => {
    const d1 = await submittedDriver();
    await submittedDriver();
    await submittedDriver();
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    await api()
      .patch(`/api/v1/admin/drivers/${d1.driverId}/approval`)
      .set(ops.auth)
      .send({ decision: 'APPROVE' });

    const page = await api().get('/api/v1/admin/drivers?limit=2&page=1').set(ops.auth);
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });

    const approved = await api().get('/api/v1/admin/drivers?approvalStatus=APPROVED').set(ops.auth);
    expect(approved.body.data).toHaveLength(1);

    const search = await api()
      .get(`/api/v1/admin/drivers?q=${encodeURIComponent('ravi')}`)
      .set(ops.auth);
    expect(search.body.data).toHaveLength(3);
    const noMatch = await api().get('/api/v1/admin/drivers?q=zzz').set(ops.auth);
    expect(noMatch.body.data).toHaveLength(0);

    expect((await api().get('/api/v1/admin/drivers?limit=1000').set(ops.auth)).status).toBe(400);
    expect((await api().get('/api/v1/admin/drivers?q=.*').set(ops.auth)).body.data).toHaveLength(0);
  });
});

describe('audit log access', () => {
  it('is readable by SUPER_ADMIN only', async () => {
    const { driverId } = await submittedDriver();
    const ops = await loginAsAdmin(env, nextPhone(), 'OPS');
    await api()
      .patch(`/api/v1/admin/drivers/${driverId}/approval`)
      .set(ops.auth)
      .send({ decision: 'APPROVE' });

    expect((await api().get('/api/v1/admin/audit-logs').set(ops.auth)).status).toBe(403);
    const root = await loginAsAdmin(env, nextPhone(), 'SUPER_ADMIN');
    const res = await api().get('/api/v1/admin/audit-logs?action=driver.approve').set(root.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].actorRole).toBe('OPS');
  });
});
