import { createHmac } from 'node:crypto';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UPLOAD_TYPES } from '../src/common/enums';
import { DriverDocument } from '../src/modules/drivers/driverDocument.model';
import { DriverProfile } from '../src/modules/drivers/driverProfile.model';
import { createLocalStorage, type LocalStorage } from '../src/providers/local';
import { loginAs, loginAsAdmin, nextPhone, startTestEnv, type TestEnv } from './helpers';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(500, 1),
]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(500, 2)]);

const SECRET = 's'.repeat(40);
const MAX = 50_000;
let dir: string;
let storage: LocalStorage;
let clockMs = Date.parse('2026-10-23T10:00:00Z');
let env: TestEnv;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'cab-uploads-'));
  storage = createLocalStorage({
    dir,
    publicUrl: 'https://api.example.com',
    secret: SECRET,
    maxBytes: MAX,
    allowedTypes: UPLOAD_TYPES,
    now: () => new Date(clockMs),
  });
  env = await startTestEnv({}, { storage });
});
afterAll(async () => {
  await env.stop();
  await rm(dir, { recursive: true, force: true });
});

const api = () => request(env.app);
/** Turns a signed link into a path on the test app. */
const pathOf = (url: string) => url.replace('https://api.example.com', '');
const asBuffer = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const parts: Buffer[] = [];
  res.on('data', (c: Buffer) => parts.push(c));
  res.on('end', () => cb(null, Buffer.concat(parts)));
};

describe('local storage: links', () => {
  it('uploads through a signed link, then reports the file and serves it back', async () => {
    const key = 'private/driver-docs/d1/file-1';
    const up = await storage.createUploadUrl(key, 'image/jpeg');
    expect(up.expiresInSeconds).toBe(600);
    expect(await storage.statObject(key)).toEqual({ exists: false });

    const put = await api().put(pathOf(up.url)).set('Content-Type', 'image/jpeg').send(JPEG);
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(await storage.statObject(key)).toEqual({
      exists: true,
      sizeBytes: JPEG.length,
      contentType: 'image/jpeg',
    });

    const down = await storage.createDownloadUrl(key);
    const got = await api().get(pathOf(down.url)).buffer(true).parse(asBuffer);
    expect(got.status).toBe(200);
    expect(Buffer.from(got.body).equals(JPEG)).toBe(true);
    expect(got.headers['content-type']).toBe('image/jpeg');
    expect(got.headers['content-disposition']).toBe('attachment');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(got.headers['cache-control']).toBe('no-store');

    await storage.deleteObject(key);
    expect(await storage.statObject(key)).toEqual({ exists: false });
    await storage.deleteObject(key); // deleting twice is fine
  });

  it('refuses a forged, edited or expired link', async () => {
    const key = 'private/driver-docs/d2/file-2';
    const up = await storage.createUploadUrl(key, 'image/png');
    const good = pathOf(up.url);

    const forged = good.replace(/sig=[0-9a-f]{64}/, `sig=${'0'.repeat(64)}`);
    expect((await api().put(forged).set('Content-Type', 'image/png').send(PNG)).status).toBe(403);

    // Changing the key (to write somewhere else) breaks the signature.
    const moved = good.replace('d2%2Ffile-2', 'd3%2Ffile-2');
    expect(moved).not.toBe(good);
    expect((await api().put(moved).set('Content-Type', 'image/png').send(PNG)).status).toBe(403);

    // A link made for one type cannot be used to send another.
    const wrongType = good.replace('ct=image%2Fpng', 'ct=application%2Fpdf');
    expect(wrongType).not.toBe(good);
    expect(
      (await api().put(wrongType).set('Content-Type', 'application/pdf').send(PDF)).status,
    ).toBe(403);

    // A download link cannot upload, and an upload link cannot download.
    const down = pathOf((await storage.createDownloadUrl(key)).url);
    const downAsUpload = down.replace('/files/download', '/files/upload');
    const goodAsDownload = good.replace('/files/upload', '/files/download');
    expect((await api().put(downAsUpload).set('Content-Type', 'image/png').send(PNG)).status).toBe(
      403,
    );
    expect((await api().get(goodAsDownload)).status).toBe(403);

    // Eleven minutes later both links are dead.
    clockMs += 11 * 60_000;
    expect((await api().put(good).set('Content-Type', 'image/png').send(PNG)).status).toBe(403);
    expect((await api().get(down)).status).toBe(403);
    clockMs -= 11 * 60_000;
    expect(await storage.statObject(key)).toEqual({ exists: false });
  });

  it('checks the file: declared type, real contents, empty, and size', async () => {
    const key = 'private/driver-docs/d4/file-4';
    const url = pathOf((await storage.createUploadUrl(key, 'image/jpeg')).url);

    // The upload says a different type than the link was made for.
    const mismatch = await api().put(url).set('Content-Type', 'application/pdf').send(PDF);
    expect(mismatch.status).toBe(400);
    // A script renamed to .jpg.
    const fake = await api()
      .put(url)
      .set('Content-Type', 'image/jpeg')
      .send(Buffer.from('<script>alert(1)</script>'));
    expect(fake.status).toBe(400);
    expect(fake.body.error.message).toMatch(/do not match/);
    // Empty.
    const empty = await api().put(url).set('Content-Type', 'image/jpeg').send(Buffer.alloc(0));
    expect(empty.status).toBe(400);
    // Too big.
    const big = Buffer.concat([JPEG.subarray(0, 4), Buffer.alloc(MAX + 10, 1)]);
    const tooBig = await api().put(url).set('Content-Type', 'image/jpeg').send(big);
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.message).toMatch(/too large/);

    expect(await storage.statObject(key)).toEqual({ exists: false });
    // No half-written leftovers.
    const leftovers = await readdir(path.join(dir, 'tmp')).catch(() => []);
    expect(leftovers).toEqual([]);
  });

  it('refuses a file type that is not on the list, when the link is made', async () => {
    await expect(storage.createUploadUrl('private/x/1', 'text/html')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('cannot be pointed outside its folder', async () => {
    const hostile = [
      '../etc/passwd',
      'private/../../secret',
      '/absolute/path',
      'a//b',
      '.hidden/file',
      'a/./b',
      'a\\b',
      'a/b\u0000c',
      '',
    ];
    for (const key of hostile) {
      const what = JSON.stringify(key);
      await expect(storage.createUploadUrl(key, 'image/png'), what).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      await expect(storage.createDownloadUrl(key), what).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      await expect(storage.statObject(key), what).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      await expect(storage.deleteObject(key), what).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    }
    // Even a correctly signed link for a hostile key is not honoured (the signature is made by hand).
    const key = '../outside';
    const exp = Math.floor(clockMs / 1000) + 600;
    const sig = createHmac('sha256', SECRET).update(`PUT\n${key}\nimage/png\n${exp}`).digest('hex');
    const res = await api()
      .put(
        `/api/v1/files/upload?key=${encodeURIComponent(key)}&ct=image%2Fpng&exp=${exp}&sig=${sig}`,
      )
      .set('Content-Type', 'image/png')
      .send(PNG);
    expect(res.status).toBe(400);
    await expect(stat(path.join(dir, '..', 'outside'))).rejects.toThrow();
  });

  it('downloading a file that does not exist is a 404', async () => {
    const down = pathOf((await storage.createDownloadUrl('private/none/1')).url);
    expect((await api().get(down)).status).toBe(404);
  });
});

describe('local storage: driver documents end to end', () => {
  it('a driver uploads a document, confirms it, staff approve it and download it', async () => {
    const s = await loginAs(env, nextPhone(), 'DRIVER');
    await api()
      .post('/api/v1/drivers/applications')
      .set(s.auth)
      .send({ fullName: 'Ravi Kumar', city: 'Delhi' });
    const reg = await api()
      .post('/api/v1/drivers/me/documents')
      .set(s.auth)
      .send({ type: 'DRIVING_LICENCE', documentNumberLast4: '1234', contentType: 'image/jpeg' });
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);
    const id = reg.body.data.document.id as string;
    const uploadUrl = reg.body.data.upload.url as string;
    expect(uploadUrl).toMatch(/^https:\/\/api\.example\.com\/api\/v1\/files\/upload\?/);

    // Confirming before the file arrives is refused.
    const early = await api()
      .post(`/api/v1/drivers/me/documents/${id}/uploaded`)
      .set(s.auth)
      .send({});
    expect(early.status).toBe(422);

    const sent = await api().put(pathOf(uploadUrl)).set('Content-Type', 'image/jpeg').send(JPEG);
    expect(sent.status).toBe(200);
    const confirmed = await api()
      .post(`/api/v1/drivers/me/documents/${id}/uploaded`)
      .set(s.auth)
      .send({});
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);

    const driverId = (await DriverProfile.findOne({ userId: s.userId }))!.id as string;
    const reviewer = await loginAsAdmin(env, nextPhone(), 'OPS');
    const approved = await api()
      .patch(`/api/v1/admin/drivers/${driverId}/documents/${id}`)
      .set(reviewer.auth)
      .send({ status: 'APPROVED' });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);

    const detail = await api().get(`/api/v1/admin/drivers/${driverId}`).set(reviewer.auth);
    const downloadUrl = detail.body.data.documents[0].downloadUrl as string;
    const file = await api().get(pathOf(downloadUrl)).buffer(true).parse(asBuffer);
    expect(file.status).toBe(200);
    expect(Buffer.from(file.body).equals(JPEG)).toBe(true);

    // The driver is never handed the storage key.
    const key = (await DriverDocument.findById(id))!.objectKey;
    expect(JSON.stringify(reg.body)).not.toContain(key);
  });
});
