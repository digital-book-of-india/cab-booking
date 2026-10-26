import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DriverDocument } from '../src/modules/drivers/driverDocument.model';
import { DriverProfile } from '../src/modules/drivers/driverProfile.model';
import { createS3Storage } from '../src/providers/s3';
import { loginAs, loginAsAdmin, nextPhone, startTestEnv, type TestEnv } from './helpers';

describe('S3 / R2 signing', () => {
  // The example from the AWS documentation ("Authenticating requests: using query parameters").
  const aws = createS3Storage({
    endpoint: 'https://s3.amazonaws.com',
    bucket: 'examplebucket',
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    pathStyle: false,
    now: () => new Date('2013-05-24T00:00:00Z'),
  });

  it('produces exactly the signature AWS publishes for its example', () => {
    expect(aws.presign('GET', 'test.txt', 86_400)).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
        '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request' +
        '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host' +
        '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });

  it('signs the content type into an upload link, and uses the path style for R2', async () => {
    const r2 = createS3Storage({
      endpoint: 'https://acct.r2.cloudflarestorage.com',
      bucket: 'docs',
      region: 'auto',
      accessKeyId: 'k',
      secretAccessKey: 's',
      pathStyle: true,
    });
    const up = await r2.createUploadUrl('private/driver-docs/d1/file-1', 'image/jpeg');
    expect(up.url).toMatch(
      /^https:\/\/acct\.r2\.cloudflarestorage\.com\/docs\/private\/driver-docs\/d1\/file-1\?/,
    );
    expect(decodeURIComponent(up.url)).toContain('X-Amz-SignedHeaders=content-type;host');
    expect(up.expiresInSeconds).toBe(600);
    const down = await r2.createDownloadUrl('private/driver-docs/d1/file-1');
    expect(decodeURIComponent(down.url)).toContain('X-Amz-SignedHeaders=host');
    // Another type, another signature.
    const other = await r2.createUploadUrl('private/driver-docs/d1/file-1', 'application/pdf');
    expect(other.url).not.toBe(up.url);
  });

  it('looks up and deletes files with signed requests and reports what it finds', async () => {
    const calls: { method: string; auth: string }[] = [];
    const answers: Record<string, Response> = {
      'HEAD:present': new Response(null, {
        status: 200,
        headers: { 'content-length': '2048', 'content-type': 'image/png' },
      }),
      'HEAD:missing': new Response(null, { status: 404 }),
      'DELETE:present': new Response(null, { status: 204 }),
    };
    const store = createS3Storage({
      endpoint: 'https://s3.example.com',
      bucket: 'b',
      region: 'us-east-1',
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
      pathStyle: true,
      fetchFn: (async (url: string, init: RequestInit) => {
        const key = String(url).split('/').pop()!;
        calls.push({
          method: String(init.method),
          auth: String((init.headers as Record<string, string>)['authorization']),
        });
        return answers[`${init.method}:${key}`] ?? new Response(null, { status: 500 });
      }) as unknown as typeof fetch,
    });
    expect(await store.statObject('present')).toEqual({
      exists: true,
      sizeBytes: 2048,
      contentType: 'image/png',
    });
    expect(await store.statObject('missing')).toEqual({ exists: false });
    await expect(store.statObject('broken')).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    await store.deleteObject('present');
    expect(calls[0]!.auth).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });
});

describe('driver documents', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await startTestEnv({}, { strictUploads: true });
  });
  afterAll(() => env.stop());

  const api = () => request(env.app);

  async function newDriverWithDocument(contentType = 'image/jpeg') {
    const s = await loginAs(env, nextPhone(), 'DRIVER');
    await api()
      .post('/api/v1/drivers/applications')
      .set(s.auth)
      .send({ fullName: 'Ravi Kumar', city: 'Delhi' });
    const reg = await api()
      .post('/api/v1/drivers/me/documents')
      .set(s.auth)
      .send({ type: 'DRIVING_LICENCE', documentNumberLast4: '1234', contentType });
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    const id = reg.body.data.document.id as string;
    const doc = (await DriverDocument.findById(id))!;
    const profile = (await DriverProfile.findOne({ userId: s.userId }))!;
    return { s, id, key: doc.objectKey, driverId: profile.id as string };
  }
  const approve = async (driverId: string, id: string) => {
    const reviewer = await loginAsAdmin(env, nextPhone(), 'OPS');
    return api()
      .patch(`/api/v1/admin/drivers/${driverId}/documents/${id}`)
      .set(reviewer.auth)
      .send({ status: 'APPROVED' });
  };

  it('the signed-file endpoints answer 404 when the server does not use local storage', async () => {
    expect((await api().get('/api/v1/files/download?key=a')).status).toBe(404);
    expect((await api().put('/api/v1/files/upload?key=a').send('x')).status).toBe(404);
  });

  it('staff cannot approve a document whose file was never uploaded', async () => {
    const { driverId, id } = await newDriverWithDocument();
    const res = await approve(driverId, id);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/not been uploaded/);
  });

  it('a confirmed upload can be approved', async () => {
    const { s, id, key, driverId } = await newDriverWithDocument();
    env.uploads.set(key, { sizeBytes: 250_000, contentType: 'image/jpeg' });
    const confirmed = await api()
      .post(`/api/v1/drivers/me/documents/${id}/uploaded`)
      .set(s.auth)
      .send({});
    expect(confirmed.status).toBe(200);
    expect((await DriverDocument.findById(id))!.uploadVerifiedAt).toBeTruthy();
    expect((await approve(driverId, id)).status).toBe(200);
  });

  it('refuses and removes a file that is empty, too big, or the wrong type', async () => {
    for (const [label, put] of [
      ['empty', { sizeBytes: 0, contentType: 'image/jpeg' }],
      ['too big', { sizeBytes: 11 * 1024 * 1024, contentType: 'image/jpeg' }],
      ['wrong type', { sizeBytes: 1000, contentType: 'application/pdf' }],
    ] as const) {
      const { s, id, key, driverId } = await newDriverWithDocument();
      env.uploads.set(key, put);
      const res = await api()
        .post(`/api/v1/drivers/me/documents/${id}/uploaded`)
        .set(s.auth)
        .send({});
      expect(res.status, label).toBe(422);
      expect(env.uploads.has(key), label).toBe(false); // deleted
      expect((await approve(driverId, id)).status, label).toBe(409); // and cannot be approved
    }
  });

  it('nobody can confirm someone else’s document, or one that is not uploaded', async () => {
    const mine = await newDriverWithDocument();
    const other = await newDriverWithDocument();
    expect(
      (
        await api()
          .post(`/api/v1/drivers/me/documents/${mine.id}/uploaded`)
          .set(other.s.auth)
          .send({})
      ).status,
    ).toBe(404);
    expect(
      (
        await api()
          .post(`/api/v1/drivers/me/documents/${mine.id}/uploaded`)
          .set(mine.s.auth)
          .send({})
      ).status,
    ).toBe(422);
    const rider = await loginAs(env, nextPhone(), 'CUSTOMER');
    expect(
      (
        await api()
          .post(`/api/v1/drivers/me/documents/${mine.id}/uploaded`)
          .set(rider.auth)
          .send({})
      ).status,
    ).toBe(403);
  });
});
