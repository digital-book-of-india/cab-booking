import { createHmac, timingSafeEqual } from 'node:crypto';

/** Keyed hash for OTPs and refresh tokens. Never store these in plaintext. */
export function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
