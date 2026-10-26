import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { RequestHandler } from 'express';
import { AppError } from '../common/errors';
import type { StorageProvider } from './types';

/**
 * File storage on the server's own disk. Same contract as the S3 adapter: the app asks for a
 * short-lived signed link, then sends the file to that link. Files live under `dir/objects`, never
 * in a folder the web server exposes, and are only reachable through signed links.
 *
 * Limit: the disk belongs to ONE server instance. Run a single instance (or a shared volume) until
 * storage moves to S3 or R2, which is a change of STORAGE_DRIVER only.
 */
export type LocalStorageOptions = {
  /** Folder that holds every file. Create it outside the application code. */
  dir: string;
  /** Public address of this API with no path, e.g. https://api.example.com. Links are built on it. */
  publicUrl: string;
  /** At least 32 characters. Signs the links; rotating it invalidates links not yet used. */
  secret: string;
  maxBytes: number;
  /** Content types a file may have. */
  allowedTypes: readonly string[];
  /** For tests. */
  now?: () => Date;
};

export const UPLOAD_LINK_SECONDS = 600;
export const DOWNLOAD_LINK_SECONDS = 300;

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,250}$/;

/** What a file of each type must start with. Stops a script renamed to .jpg. */
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'application/pdf': (b) => b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-',
};

export type LocalFilesHandlers = {
  /** PUT /files/upload?key&ct&exp&sig  (body = the file) */
  upload: RequestHandler;
  /** GET /files/download?key&exp&sig */
  download: RequestHandler;
};

export type LocalStorage = StorageProvider & {
  /** The two endpoints that receive and serve files through signed links. */
  handlers: LocalFilesHandlers;
};

export function createLocalStorage(options: LocalStorageOptions): LocalStorage {
  const root = path.resolve(options.dir);
  const objects = path.join(root, 'objects');
  const metas = path.join(root, 'meta');
  const tmp = path.join(root, 'tmp');
  const clock = options.now ?? (() => new Date());
  const base = options.publicUrl.replace(/\/$/, '');

  const sign = (method: string, key: string, ct: string, exp: number) =>
    createHmac('sha256', options.secret).update(`${method}\n${key}\n${ct}\n${exp}`).digest('hex');

  function validSignature(expected: string, given: unknown): boolean {
    if (typeof given !== 'string' || given.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
  }

  /** Where a key lives on disk. Throws for anything that could leave the folder. */
  function locate(key: string): { file: string; meta: string } {
    const segments = key.split('/');
    if (
      !KEY_PATTERN.test(key) ||
      segments.some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.'))
    ) {
      throw new AppError('VALIDATION_ERROR', 'Invalid file key.');
    }
    const file = path.resolve(objects, key);
    const meta = path.resolve(metas, `${key}.json`);
    if (!file.startsWith(objects + path.sep) || !meta.startsWith(metas + path.sep)) {
      throw new AppError('VALIDATION_ERROR', 'Invalid file key.');
    }
    return { file, meta };
  }

  const link = (route: string, params: Record<string, string>) =>
    `${base}/api/v1/files/${route}?${new URLSearchParams(params).toString()}`;

  async function readMeta(metaFile: string): Promise<{ contentType?: string } | null> {
    try {
      return JSON.parse(await readFile(metaFile, 'utf8')) as { contentType?: string };
    } catch {
      return null;
    }
  }

  const gone = (err: unknown) => (err as NodeJS.ErrnoException)?.code === 'ENOENT';

  const upload: RequestHandler = async (req, res) => {
    const key = String(req.query['key'] ?? '');
    const ct = String(req.query['ct'] ?? '');
    const exp = Number(req.query['exp']);
    if (!Number.isInteger(exp) || !validSignature(sign('PUT', key, ct, exp), req.query['sig'])) {
      throw new AppError('FORBIDDEN', 'This upload link is not valid.');
    }
    if (exp * 1000 < clock().getTime()) {
      throw new AppError('FORBIDDEN', 'This upload link has expired.');
    }
    if (!options.allowedTypes.includes(ct)) {
      throw new AppError('VALIDATION_ERROR', 'This file type is not allowed.');
    }
    const sent = (req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (sent !== ct) {
      throw new AppError('VALIDATION_ERROR', 'The file type does not match the upload link.');
    }
    const declared = Number(req.header('content-length'));
    if (Number.isFinite(declared) && declared > options.maxBytes) {
      throw new AppError('VALIDATION_ERROR', 'The file is too large.');
    }
    const { file, meta } = locate(key);
    await mkdir(tmp, { recursive: true });
    const partial = path.join(tmp, randomUUID());
    let seen = 0;
    let head = Buffer.alloc(0);
    const counter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        seen += chunk.length;
        if (head.length < 16) head = Buffer.concat([head, chunk]).subarray(0, 16);
        if (seen > options.maxBytes)
          return done(new AppError('VALIDATION_ERROR', 'The file is too large.'));
        done(null, chunk);
      },
    });
    try {
      await pipeline(req, counter, createWriteStream(partial, { flags: 'wx' }));
      if (seen === 0) throw new AppError('VALIDATION_ERROR', 'The file is empty.');
      if (!SIGNATURES[ct]?.(head)) {
        throw new AppError('VALIDATION_ERROR', 'The file contents do not match its type.');
      }
      await mkdir(path.dirname(file), { recursive: true });
      await mkdir(path.dirname(meta), { recursive: true });
      await writeFile(meta, JSON.stringify({ contentType: ct }));
      await rename(partial, file);
    } catch (err) {
      await unlink(partial).catch(() => undefined);
      throw err;
    }
    res.status(200).json({ success: true, data: { stored: true } });
  };

  const download: RequestHandler = async (req, res) => {
    const key = String(req.query['key'] ?? '');
    const exp = Number(req.query['exp']);
    if (!Number.isInteger(exp) || !validSignature(sign('GET', key, '', exp), req.query['sig'])) {
      throw new AppError('FORBIDDEN', 'This download link is not valid.');
    }
    if (exp * 1000 < clock().getTime()) {
      throw new AppError('FORBIDDEN', 'This download link has expired.');
    }
    const { file, meta } = locate(key);
    let size: number;
    try {
      size = (await stat(file)).size;
    } catch (err) {
      if (gone(err)) throw new AppError('NOT_FOUND', 'File not found.');
      throw err;
    }
    const type = (await readMeta(meta))?.contentType ?? 'application/octet-stream';
    res.status(200);
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', String(size));
    // A downloaded file must never run as a page, and a proxy must never keep it.
    res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'no-store');
    await pipeline(createReadStream(file), res);
  };

  return {
    handlers: { upload, download },

    async createUploadUrl(objectKey, contentType) {
      locate(objectKey);
      if (!options.allowedTypes.includes(contentType)) {
        throw new AppError('VALIDATION_ERROR', 'This file type is not allowed.');
      }
      const exp = Math.floor(clock().getTime() / 1000) + UPLOAD_LINK_SECONDS;
      return {
        url: link('upload', {
          key: objectKey,
          ct: contentType,
          exp: String(exp),
          sig: sign('PUT', objectKey, contentType, exp),
        }),
        expiresInSeconds: UPLOAD_LINK_SECONDS,
      };
    },

    async createDownloadUrl(objectKey) {
      locate(objectKey);
      const exp = Math.floor(clock().getTime() / 1000) + DOWNLOAD_LINK_SECONDS;
      return {
        url: link('download', {
          key: objectKey,
          exp: String(exp),
          sig: sign('GET', objectKey, '', exp),
        }),
        expiresInSeconds: DOWNLOAD_LINK_SECONDS,
      };
    },

    async statObject(objectKey) {
      const { file, meta } = locate(objectKey);
      try {
        const s = await stat(file);
        const contentType = (await readMeta(meta))?.contentType;
        return { exists: true as const, sizeBytes: s.size, contentType };
      } catch (err) {
        if (gone(err)) return { exists: false as const };
        throw new AppError('PROVIDER_ERROR');
      }
    },

    async deleteObject(objectKey) {
      const { file, meta } = locate(objectKey);
      for (const f of [file, meta]) {
        await unlink(f).catch((err) => {
          if (!gone(err)) throw err;
        });
      }
    },
  };
}
