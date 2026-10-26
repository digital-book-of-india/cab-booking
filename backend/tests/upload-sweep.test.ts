import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sweepUploads } from '../src/tools/uploadSweep';

let dir: string;
const DAY = 86_400_000;
const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );
async function put(rel: string, ageMs: number) {
  const file = path.join(dir, ...rel.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, 'x'.repeat(100));
  const t = new Date(Date.now() - ageMs);
  await utimes(file, t, t);
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'cab-sweep-'));
  await put('objects/drivers/d1/licence.jpg', 5 * DAY); // referenced
  await put('meta/drivers/d1/licence.jpg.json', 5 * DAY);
  await put('objects/drivers/d1/old-licence.jpg', 5 * DAY); // orphan
  await put('meta/drivers/d1/old-licence.jpg.json', 5 * DAY);
  await put('objects/drivers/d2/just-uploaded.jpg', 60_000); // orphan but brand new
  await put('tmp/upload-abc', 3 * DAY); // abandoned
  await put('tmp/upload-live', 1000); // still being written
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('uploads sweep', () => {
  const referenced = new Set(['drivers/d1/licence.jpg']);

  it('a dry run lists orphans and abandoned partials, and deletes nothing', async () => {
    const r = await sweepUploads({ dir, referenced, minAgeMs: DAY });
    expect(r.orphans.map((o) => o.key)).toEqual(['drivers/d1/old-licence.jpg']);
    expect(r.abandonedTemp.map((t) => t.name)).toEqual(['upload-abc']);
    expect(r.freedBytes).toBe(200);
    expect(r.deleted).toBe(false);
    expect(await exists(path.join(dir, 'objects/drivers/d1/old-licence.jpg'))).toBe(true);
  });

  it('deleting removes the orphan with its metadata and keeps referenced and recent files', async () => {
    const r = await sweepUploads({ dir, referenced, minAgeMs: DAY, apply: true });
    expect(r.deleted).toBe(true);
    expect(await exists(path.join(dir, 'objects/drivers/d1/old-licence.jpg'))).toBe(false);
    expect(await exists(path.join(dir, 'meta/drivers/d1/old-licence.jpg.json'))).toBe(false);
    expect(await exists(path.join(dir, 'tmp/upload-abc'))).toBe(false);
    expect(await exists(path.join(dir, 'objects/drivers/d1/licence.jpg'))).toBe(true);
    expect(await exists(path.join(dir, 'meta/drivers/d1/licence.jpg.json'))).toBe(true);
    expect(await exists(path.join(dir, 'objects/drivers/d2/just-uploaded.jpg'))).toBe(true);
    expect(await exists(path.join(dir, 'tmp/upload-live'))).toBe(true);
  });

  it('a second run finds nothing, and a missing folder is not an error', async () => {
    expect((await sweepUploads({ dir, referenced, minAgeMs: DAY })).orphans).toEqual([]);
    const none = await sweepUploads({ dir: path.join(dir, 'nope'), referenced, minAgeMs: DAY });
    expect(none).toMatchObject({ orphans: [], abandonedTemp: [], freedBytes: 0 });
  });
});
