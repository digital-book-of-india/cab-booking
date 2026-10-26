import { randomBytes } from 'node:crypto';

/** Opaque public id, e.g. bk_9f3a1c2b7d4e. Not sequential, safe to expose. */
export function publicId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}
