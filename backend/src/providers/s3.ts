import { createHash, createHmac } from 'node:crypto';
import { AppError } from '../common/errors';
import type { StorageProvider } from './types';

/**
 * File storage on any S3-compatible service (Amazon S3, Cloudflare R2, MinIO...) using AWS
 * Signature V4 on Node's crypto (no SDK). Files go straight from the phone to the bucket through a
 * short-lived signed link; the server only signs links and checks what arrived.
 *
 * The signing is checked against the examples published in the AWS documentation. NOT verified
 * against a real bucket: the first live check is to upload one file through a signed link.
 */
export type S3Options = {
  /** e.g. https://s3.ap-south-1.amazonaws.com or https://<account>.r2.cloudflarestorage.com */
  endpoint: string;
  bucket: string;
  /** 'auto' for Cloudflare R2. */
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** true: https://endpoint/bucket/key (R2, MinIO). false: https://bucket.endpoint/key (AWS). */
  pathStyle?: boolean;
  fetchFn?: typeof fetch;
  /** For tests. */
  now?: () => Date;
};

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const hmac = (key: Buffer | string, v: string) => createHmac('sha256', key).update(v).digest();

/** RFC 3986 encoding as S3 wants it (slashes in a key stay). */
const enc = (v: string, keepSlash = false) =>
  encodeURIComponent(v)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%2F/g, keepSlash ? '/' : '%2F');

const stamp = (d: Date) => d.toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20130524T000000Z

export function createS3Storage(options: S3Options): StorageProvider & {
  /** Exposed for tests: a signed link for any method. */
  presign: (
    method: string,
    key: string,
    expiresInSeconds: number,
    headers?: Record<string, string>,
  ) => string;
} {
  const doFetch = options.fetchFn ?? fetch;
  const clock = options.now ?? (() => new Date());
  const base = new URL(options.endpoint);

  function target(key: string): { host: string; path: string; origin: string } {
    const encKey = enc(key, true);
    if (options.pathStyle) {
      return { host: base.host, path: `/${options.bucket}/${encKey}`, origin: base.origin };
    }
    const host = `${options.bucket}.${base.host}`;
    return { host, path: `/${encKey}`, origin: `${base.protocol}//${host}` };
  }

  function signingKey(date: string): Buffer {
    const k = hmac(`AWS4${options.secretAccessKey}`, date);
    return hmac(hmac(hmac(k, options.region), 's3'), 'aws4_request');
  }

  /** A link that works for `expiresInSeconds` and only for this method and these signed headers. */
  function presign(
    method: string,
    key: string,
    expiresInSeconds: number,
    headers: Record<string, string> = {},
  ): string {
    const now = clock();
    const amzDate = stamp(now);
    const date = amzDate.slice(0, 8);
    const scope = `${date}/${options.region}/s3/aws4_request`;
    const { host, path, origin } = target(key);
    const signed: Record<string, string> = { host, ...headers };
    const names = Object.keys(signed)
      .map((n) => n.toLowerCase())
      .sort();
    const query: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${options.accessKeyId}/${scope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresInSeconds),
      'X-Amz-SignedHeaders': names.join(';'),
    };
    const canonicalQuery = Object.keys(query)
      .sort()
      .map((k) => `${enc(k)}=${enc(query[k]!)}`)
      .join('&');
    const lowered = Object.fromEntries(
      Object.entries(signed).map(([k, v]) => [k.toLowerCase(), v.trim()]),
    );
    const canonicalHeaders = names.map((n) => `${n}:${lowered[n]}\n`).join('');
    const canonical = [
      method,
      path,
      canonicalQuery,
      canonicalHeaders,
      names.join(';'),
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
    const signature = createHmac('sha256', signingKey(date)).update(toSign).digest('hex');
    return `${origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }

  /** A request the server itself makes (HEAD / DELETE), signed in the Authorization header. */
  async function signedRequest(method: 'HEAD' | 'DELETE', key: string): Promise<Response> {
    const now = clock();
    const amzDate = stamp(now);
    const date = amzDate.slice(0, 8);
    const scope = `${date}/${options.region}/s3/aws4_request`;
    const { host, path, origin } = target(key);
    const payloadHash = sha256('');
    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    const names = Object.keys(headers).sort();
    const canonical = [
      method,
      path,
      '',
      names.map((n) => `${n}:${headers[n]}\n`).join(''),
      names.join(';'),
      payloadHash,
    ].join('\n');
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
    const signature = createHmac('sha256', signingKey(date)).update(toSign).digest('hex');
    try {
      return await doFetch(`${origin}${path}`, {
        method,
        headers: {
          'x-amz-content-sha256': payloadHash,
          'x-amz-date': amzDate,
          authorization: `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError('PROVIDER_ERROR', 'The file storage could not be reached.');
    }
  }

  return {
    presign,

    async createUploadUrl(objectKey, contentType) {
      // The content type is part of the signature: the phone must send exactly the declared type.
      return {
        url: presign('PUT', objectKey, 600, { 'content-type': contentType }),
        expiresInSeconds: 600,
      };
    },

    async createDownloadUrl(objectKey) {
      return { url: presign('GET', objectKey, 300), expiresInSeconds: 300 };
    },

    async statObject(objectKey) {
      const res = await signedRequest('HEAD', objectKey);
      if (res.status === 404 || res.status === 403) return { exists: false as const };
      if (!res.ok) throw new AppError('PROVIDER_ERROR', 'The file storage did not answer.');
      return {
        exists: true as const,
        sizeBytes: Number(res.headers.get('content-length') ?? 0),
        contentType: res.headers.get('content-type') ?? undefined,
      };
    },

    async deleteObject(objectKey) {
      const res = await signedRequest('DELETE', objectKey);
      if (!res.ok && res.status !== 404)
        throw new AppError('PROVIDER_ERROR', 'The file could not be removed.');
    },
  };
}
