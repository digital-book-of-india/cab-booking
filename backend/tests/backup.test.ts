import { gunzipSync, gzipSync } from 'node:zlib';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  compareDatabases,
  dumpDatabase,
  parseBackupKey,
  readManifest,
  restoreDatabase,
  verifyBackup,
} from '../src/tools/backup';
import {
  completedRide,
  createDriver,
  loginAs,
  nextPhone,
  seedWorld,
  startTestEnv,
  type TestEnv,
} from './helpers';

let env: TestEnv;
let dir: string;
const client = () => mongoose.connection.getClient();
const source = () => mongoose.connection.db!;
const target = (name: string) => client().db(name);
let n = 0;
const freshDb = () => target(`restore_${Date.now()}_${++n}`);

beforeAll(async () => {
  env = await startTestEnv();
  dir = await mkdtemp(path.join(os.tmpdir(), 'cab-backup-'));
  // Real, varied data: users, a finished cash ride, ledger entries, geo points, dates.
  const world = await seedWorld();
  const rider = await loginAs(env, nextPhone(), 'CUSTOMER');
  const driver = await createDriver(env, world);
  await completedRide(env, world, rider, driver, 'CASH');
  // Types plain JSON would damage.
  await source()
    .collection('backup_types')
    .insertOne({
      _id: new mongoose.Types.ObjectId(),
      when: new Date('2026-10-23T10:11:12.345Z'),
      big: mongoose.mongo.Long.fromString('9007199254740993'),
      money: mongoose.Types.Decimal128.fromString('123.45'),
      bytes: Buffer.from([0, 1, 2, 255]),
      nested: { list: [1, 'two', { three: new Date(0) }], nothing: null },
      nan: Number.NaN,
      text: 'नमस्ते, "quotes" and\nnew lines',
    });
});
afterAll(async () => {
  await env.stop();
  await rm(dir, { recursive: true, force: true });
});

describe('backup and restore', () => {
  it('dumps every collection with counts and checksums, and the dump verifies', async () => {
    const out = path.join(dir, 'one');
    const manifest = await dumpDatabase(source(), out);
    expect(manifest.collections.length).toBeGreaterThan(10);
    const names = manifest.collections.map((c) => c.collection);
    expect(names).toEqual([...names].sort());
    for (const c of manifest.collections) {
      expect(c.documents).toBe(await source().collection(c.collection).countDocuments());
      expect(c.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(manifest.collections.find((c) => c.collection === 'bookings')!.documents).toBe(1);
    expect(await verifyBackup(out)).toMatchObject({ ok: true, problems: [] });
  });

  it('restores into an empty database and the copy is identical, types included', async () => {
    const out = path.join(dir, 'two');
    await dumpDatabase(source(), out);
    const copy = freshDb();
    const report = await restoreDatabase(copy, out);
    expect(report.documents).toBeGreaterThan(10);
    const same = await compareDatabases(source(), copy);
    expect(same).toEqual({ same: true, differences: [] });

    const back = (await copy.collection('backup_types').findOne({}))!;
    expect(back['when']).toEqual(new Date('2026-10-23T10:11:12.345Z'));
    expect(String(back['big'])).toBe('9007199254740993'); // a plain number would round this
    expect(back['money'].toString()).toBe('123.45');
    expect(Buffer.from(back['bytes'].buffer)).toEqual(Buffer.from([0, 1, 2, 255]));
    expect(back['nested'].list[2].three).toEqual(new Date(0));
    expect(back['nan']).toBeNaN();
    expect(back['text']).toBe('नमस्ते, "quotes" and\nnew lines');
    expect(back['_id']).toBeInstanceOf(mongoose.mongo.ObjectId);
  });

  it('refuses a database that already has data, and force replaces documents from the backup', async () => {
    const out = path.join(dir, 'three');
    await dumpDatabase(source(), out);
    const copy = freshDb();
    await restoreDatabase(copy, out);
    await expect(restoreDatabase(copy, out)).rejects.toThrow(/already has data/);

    // Damage the copy, then force the backup back over it.
    await copy.collection('backup_types').updateMany({}, { $set: { text: 'damaged' } });
    expect((await compareDatabases(source(), copy)).same).toBe(false);
    await restoreDatabase(copy, out, { force: true });
    expect((await compareDatabases(source(), copy)).same).toBe(true);
  });

  it('notices a backup that was changed, and restores nothing from it', async () => {
    const out = path.join(dir, 'four');
    await dumpDatabase(source(), out);
    const file = path.join(out, 'backup_types.ndjson.gz');
    const text = gunzipSync(await readFile(file)).toString('utf8');
    // Same number of documents, one character different.
    await writeFile(file, gzipSync(text.replace('damaged', 'x').replace('new lines', 'new LINES')));
    const check = await verifyBackup(out);
    expect(check.ok).toBe(false);
    expect(check.problems.join(' ')).toMatch(/backup_types: .*checksum/);

    const copy = freshDb();
    await expect(restoreDatabase(copy, out)).rejects.toThrow(/does not verify/);
    const left = await copy.listCollections().toArray();
    expect(left).toEqual([]); // nothing half-restored
  });

  it('notices a missing file, a short file and a foreign folder', async () => {
    const out = path.join(dir, 'five');
    await dumpDatabase(source(), out);
    await rm(path.join(out, 'bookings.ndjson.gz'));
    expect((await verifyBackup(out)).problems).toContain('bookings: file is missing');

    const short = path.join(dir, 'six');
    await dumpDatabase(source(), short);
    const f = path.join(short, 'backup_types.ndjson.gz');
    await writeFile(f, gzipSync(''));
    expect((await verifyBackup(short)).problems.join(' ')).toMatch(/backup_types: .*0 documents/);

    const foreign = path.join(dir, 'seven');
    await dumpDatabase(source(), foreign);
    await writeFile(path.join(foreign, 'manifest.json'), '{"hello":"world"}');
    await expect(verifyBackup(foreign)).rejects.toThrow(/not a backup made by this tool/);
  });

  it('will not follow a manifest that names a file outside the folder', async () => {
    const out = path.join(dir, 'eight');
    await dumpDatabase(source(), out);
    const m = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));
    m.collections[0].collection = '../../etc/passwd';
    await writeFile(path.join(out, 'manifest.json'), JSON.stringify(m));
    await expect(readManifest(out)).rejects.toThrow(/Unsafe collection name/);
    await expect(restoreDatabase(freshDb(), out)).rejects.toThrow(/Unsafe collection name/);
  });

  it('the comparison reports real differences', async () => {
    const out = path.join(dir, 'nine');
    await dumpDatabase(source(), out);
    const copy = freshDb();
    await restoreDatabase(copy, out);
    await copy.collection('users').deleteOne({});
    await copy.collection('backup_types').updateOne({}, { $set: { text: 'changed' } });
    await copy.collection('extra_collection').insertOne({ a: 1 });
    const result = await compareDatabases(source(), copy);
    expect(result.same).toBe(false);
    expect(result.differences.join('\n')).toMatch(/users: \d+ documents vs \d+/);
    expect(result.differences.join('\n')).toMatch(
      /backup_types: same count \(1\) but different contents/,
    );
    expect(result.differences.join('\n')).toMatch(/extra_collection: only in the second database/);
  });
});

describe('encrypted backups', () => {
  const key = parseBackupKey('ab'.repeat(32))!;
  const otherKey = parseBackupKey('cd'.repeat(32))!;
  const file = (out: string) => path.join(out, 'backup_types.ndjson.gz.enc');

  it('are unreadable without the key, and restore to an identical database with it', async () => {
    const out = path.join(dir, 'enc-one');
    const manifest = await dumpDatabase(source(), out, new Date(), key);
    expect(manifest.encrypted).toBe(true);
    // The stored bytes hold no readable data, not even the gzip header.
    const raw = await readFile(file(out));
    expect(raw.includes(Buffer.from('नमस्ते'))).toBe(false);
    expect(raw.subarray(12, 14).equals(Buffer.from([0x1f, 0x8b]))).toBe(false);

    await expect(verifyBackup(out)).rejects.toThrow(/encrypted/);
    await expect(restoreDatabase(freshDb(), out)).rejects.toThrow(/encrypted/);
    expect(await verifyBackup(out, key)).toMatchObject({ ok: true, problems: [] });

    const copy = freshDb();
    await restoreDatabase(copy, out, { key });
    expect(await compareDatabases(source(), copy)).toEqual({ same: true, differences: [] });
  });

  it('fail clearly with the wrong key', async () => {
    const out = path.join(dir, 'enc-two');
    await dumpDatabase(source(), out, new Date(), key);
    const check = await verifyBackup(out, otherKey);
    expect(check.ok).toBe(false);
    expect(check.problems.join(' ')).toMatch(/wrong key, or the file was changed/);
    const copy = freshDb();
    await expect(restoreDatabase(copy, out, { key: otherKey })).rejects.toThrow(/does not verify/);
    expect(await copy.listCollections().toArray()).toEqual([]);
  });

  it('notice one changed byte or a cut-off file', async () => {
    const changed = path.join(dir, 'enc-three');
    await dumpDatabase(source(), changed, new Date(), key);
    const bytes = await readFile(file(changed));
    const mid = Math.floor(bytes.length / 2);
    bytes[mid] = bytes[mid]! ^ 0xff;
    await writeFile(file(changed), bytes);
    expect((await verifyBackup(changed, key)).ok).toBe(false);

    const cut = path.join(dir, 'enc-four');
    await dumpDatabase(source(), cut, new Date(), key);
    const whole = await readFile(file(cut));
    await writeFile(file(cut), whole.subarray(0, whole.length - 20));
    expect((await verifyBackup(cut, key)).ok).toBe(false);
  });

  it('only accepts a 32-byte key written as 64 hex characters', () => {
    expect(parseBackupKey(undefined)).toBeUndefined();
    expect(parseBackupKey('')).toBeUndefined();
    expect(parseBackupKey('ab'.repeat(32))).toHaveLength(32);
    expect(() => parseBackupKey('abc')).toThrow(/64 hex/);
    expect(() => parseBackupKey('zz'.repeat(32))).toThrow(/64 hex/);
  });
});
