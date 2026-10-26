import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { PassThrough, Readable } from 'node:stream';
import mongoose from 'mongoose';
import type { Db, Document } from 'mongodb';

/**
 * A logical backup of the whole database in plain files, using only the Node packages the app
 * already has (no mongodump needed). One gzip file of JSON lines per collection plus a manifest
 * with each collection's document count and a SHA-256 of its contents, so a backup can be proved
 * intact before it is trusted, and a restore can be proved complete after it.
 *
 * What it does NOT save: indexes (run `npm run indexes:prod` after a restore), the uploaded driver
 * documents on the server disk (back that folder up separately), and anything that happens after
 * the dump starts (it is not a point-in-time snapshot while the app is writing; take it at a quiet
 * time, or use Atlas backups when you have a paid tier).
 *
 * Backups hold personal data, token hashes and bank references. Keep them off the server, encrypted:
 * give `dump` a 32-byte key and every file is sealed with AES-256-GCM (a changed or truncated file fails
 * to open). Keep the key somewhere other than next to the backups; without it they cannot be read.
 */
const { EJSON } = mongoose.mongo.BSON;

export type ManifestEntry = { collection: string; documents: number; sha256: string };
export type Manifest = {
  format: 1;
  createdAt: string;
  database: string;
  /** True when every collection file is encrypted (the key is needed to verify or restore). */
  encrypted?: boolean;
  collections: ManifestEntry[];
};

/** The key for encrypted backups: 32 bytes, written as 64 hex characters (`openssl rand -hex 32`). */
export function parseBackupKey(hex: string | undefined): Buffer | undefined {
  if (hex === undefined || hex === '') return undefined;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('The backup key must be 64 hex characters (openssl rand -hex 32).');
  }
  return Buffer.from(hex, 'hex');
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

const MANIFEST = 'manifest.json';
const fileOf = (collection: string, encrypted = false) =>
  `${collection}.ndjson.gz${encrypted ? '.enc' : ''}`;
const BATCH = 500;

/** Collection names become file names, so only plain ones are accepted. */
function safeName(name: string): string {
  if (!/^[A-Za-z0-9_.-]{1,120}$/.test(name) || name.includes('..')) {
    throw new Error(`Unsafe collection name: ${JSON.stringify(name)}`);
  }
  return name;
}

async function userCollections(db: Db): Promise<string[]> {
  const all = await db.listCollections({}, { nameOnly: true }).toArray();
  return all
    .filter((c) => c.type !== 'view' && !c.name.startsWith('system.'))
    .map((c) => safeName(c.name))
    .sort();
}

/** Encrypts a stream: 12-byte random start value, the sealed data, then the 16-byte check tag. */
function sealer(key: Buffer) {
  return async function* (source: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    yield iv;
    for await (const chunk of source) yield cipher.update(chunk);
    yield cipher.final();
    yield cipher.getAuthTag();
  };
}

/** The plain (gunzipped) contents of a collection file, decrypting first when the backup is encrypted. */
function openPlain(file: string, encrypted: boolean, key: Buffer | undefined): Readable {
  if (!encrypted) return createReadStream(file).pipe(createGunzip());
  if (!key) throw new Error('This backup is encrypted. Set BACKUP_ENCRYPTION_KEY to open it.');
  const out = new PassThrough();
  async function* opened(): AsyncGenerator<Buffer> {
    const size = (await stat(file)).size;
    if (size < IV_BYTES + TAG_BYTES) throw new Error('The encrypted file is too short.');
    const handle = await open(file, 'r');
    const iv = Buffer.alloc(IV_BYTES);
    const tag = Buffer.alloc(TAG_BYTES);
    try {
      await handle.read(iv, 0, IV_BYTES, 0);
      await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
    } finally {
      await handle.close();
    }
    const range = { start: IV_BYTES, end: size - TAG_BYTES - 1 };
    const decipherer = () => {
      const d = createDecipheriv('aes-256-gcm', key as Buffer, iv);
      d.setAuthTag(tag);
      return d;
    };
    // GCM only proves the data is genuine at the very end, so check the whole file first and hand out
    // nothing that has not been authenticated.
    const check = decipherer();
    for await (const chunk of createReadStream(file, range)) check.update(chunk as Buffer);
    try {
      check.final();
    } catch (err) {
      throw new Error('wrong key, or the file was changed (encryption check failed)', {
        cause: err,
      });
    }
    const decipher = decipherer();
    for await (const chunk of createReadStream(file, range)) yield decipher.update(chunk as Buffer);
    yield decipher.final();
  }
  pipeline(Readable.from(opened()), createGunzip(), out).catch((err) => out.destroy(err));
  return out;
}

/** Writes every collection to `dir` (encrypted when a key is given) and returns the manifest. */
export async function dumpDatabase(
  db: Db,
  dir: string,
  now = new Date(),
  key?: Buffer,
): Promise<Manifest> {
  await mkdir(dir, { recursive: true });
  const entries: ManifestEntry[] = [];
  for (const name of await userCollections(db)) {
    const hash = createHash('sha256');
    let documents = 0;
    const cursor = db.collection(name).find({}).sort({ _id: 1 });
    async function* lines(): AsyncGenerator<string> {
      for await (const doc of cursor) {
        // Canonical form keeps every type exactly (dates, 64-bit numbers, ids), unlike plain JSON.
        const line = EJSON.stringify(doc, { relaxed: false }) + '\n';
        hash.update(line);
        documents += 1;
        yield line;
      }
    }
    const target = createWriteStream(path.join(dir, fileOf(name, key !== undefined)));
    if (key) await pipeline(Readable.from(lines()), createGzip(), sealer(key), target);
    else await pipeline(Readable.from(lines()), createGzip(), target);
    entries.push({ collection: name, documents, sha256: hash.digest('hex') });
  }
  const manifest: Manifest = {
    format: 1,
    createdAt: now.toISOString(),
    database: db.databaseName,
    ...(key ? { encrypted: true } : {}),
    collections: entries,
  };
  await writeFile(path.join(dir, MANIFEST), JSON.stringify(manifest, null, 2));
  return manifest;
}

export async function readManifest(dir: string): Promise<Manifest> {
  const manifest = JSON.parse(await readFile(path.join(dir, MANIFEST), 'utf8')) as Manifest;
  if (manifest.format !== 1 || !Array.isArray(manifest.collections)) {
    throw new Error('This is not a backup made by this tool.');
  }
  for (const c of manifest.collections) safeName(c.collection);
  return manifest;
}

/** Reads a collection's file line by line (and checks the contents against the manifest as it goes). */
async function* readLines(
  dir: string,
  entry: ManifestEntry,
  encrypted: boolean,
  key: Buffer | undefined,
): AsyncGenerator<Document> {
  const hash = createHash('sha256');
  let count = 0;
  const rl = createInterface({
    input: openPlain(path.join(dir, fileOf(entry.collection, encrypted)), encrypted, key),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    hash.update(line + '\n');
    count += 1;
    yield EJSON.parse(line, { relaxed: false }) as Document;
  }
  if (count !== entry.documents) {
    throw new Error(
      `${entry.collection}: the backup file has ${count} documents, the manifest says ${entry.documents}.`,
    );
  }
  if (hash.digest('hex') !== entry.sha256) {
    throw new Error(`${entry.collection}: the backup file's contents do not match its checksum.`);
  }
}

export type VerifyReport = {
  ok: boolean;
  collections: number;
  documents: number;
  problems: string[];
};

/** Proves a backup folder is complete and untouched, without any database. */
export async function verifyBackup(dir: string, key?: Buffer): Promise<VerifyReport> {
  const problems: string[] = [];
  let documents = 0;
  const manifest = await readManifest(dir);
  const encrypted = manifest.encrypted === true;
  if (encrypted && !key) {
    throw new Error('This backup is encrypted. Set BACKUP_ENCRYPTION_KEY to open it.');
  }
  const present = new Set(await readdir(dir));
  for (const entry of manifest.collections) {
    if (!present.has(fileOf(entry.collection, encrypted))) {
      problems.push(`${entry.collection}: file is missing`);
      continue;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _doc of readLines(dir, entry, encrypted, key)) documents += 1;
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
  }
  return {
    ok: problems.length === 0,
    collections: manifest.collections.length,
    documents,
    problems,
  };
}

export type RestoreReport = { collections: number; documents: number };

/**
 * Loads a backup into `db`. Refuses a database that already has data (unless `force`), and refuses
 * a backup that does not verify, so a half-damaged backup never produces a half-restored database.
 */
export async function restoreDatabase(
  db: Db,
  dir: string,
  options: { force?: boolean; key?: Buffer } = {},
): Promise<RestoreReport> {
  const check = await verifyBackup(dir, options.key);
  if (!check.ok) throw new Error(`The backup does not verify: ${check.problems.join('; ')}`);
  const manifest = await readManifest(dir);
  if (!options.force) {
    for (const name of await userCollections(db)) {
      if ((await db.collection(name).estimatedDocumentCount()) > 0) {
        throw new Error(
          `Database "${db.databaseName}" already has data (${name}). Restore into an empty database, or pass force.`,
        );
      }
    }
  }
  let documents = 0;
  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
  );
  for (const entry of manifest.collections) {
    // Empty collections come back too, so the restored database has the same set of collections.
    if (!existing.has(entry.collection)) await db.createCollection(entry.collection);
    const col = db.collection(entry.collection);
    let batch: Document[] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      // With force, a document already there is replaced by the backup's copy.
      if (options.force) {
        await col.bulkWrite(
          batch.map((d) => ({
            replaceOne: { filter: { _id: d['_id'] }, replacement: d, upsert: true },
          })),
          { ordered: false },
        );
      } else {
        await col.insertMany(batch, { ordered: false });
      }
      documents += batch.length;
      batch = [];
    };
    for await (const doc of readLines(dir, entry, manifest.encrypted === true, options.key)) {
      batch.push(doc);
      if (batch.length >= BATCH) await flush();
    }
    await flush();
  }
  return { collections: manifest.collections.length, documents };
}

export type CompareReport = {
  same: boolean;
  differences: string[];
};

/** Per collection: the same documents (count and a hash of every document) in both databases? */
export async function compareDatabases(a: Db, b: Db): Promise<CompareReport> {
  const differences: string[] = [];
  async function fingerprint(db: Db, name: string) {
    const hash = createHash('sha256');
    let n = 0;
    for await (const doc of db.collection(name).find({}).sort({ _id: 1 })) {
      hash.update(EJSON.stringify(doc, { relaxed: false }) + '\n');
      n += 1;
    }
    return { n, sha: hash.digest('hex') };
  }
  const namesA = await userCollections(a);
  const namesB = new Set(await userCollections(b));
  for (const name of namesA) {
    if (!namesB.has(name)) {
      differences.push(`${name}: missing in the second database`);
      continue;
    }
    const [fa, fb] = await Promise.all([fingerprint(a, name), fingerprint(b, name)]);
    if (fa.n !== fb.n) differences.push(`${name}: ${fa.n} documents vs ${fb.n}`);
    else if (fa.sha !== fb.sha)
      differences.push(`${name}: same count (${fa.n}) but different contents`);
  }
  for (const name of namesB) {
    if (!namesA.includes(name)) differences.push(`${name}: only in the second database`);
  }
  return { same: differences.length === 0, differences };
}
