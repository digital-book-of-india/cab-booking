import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * One-time codes from an authenticator app (TOTP, RFC 6238: HMAC-SHA1, 6 digits, 30 seconds),
 * implemented on Node's crypto so there is no extra package to audit.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text.replace(/=+$/, '').toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

const stepAt = (ms: number) => Math.floor(ms / 1000 / PERIOD);

function codeForStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = h[h.length - 1]! & 15;
  const binary =
    ((h[offset]! & 127) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(binary % 1_000_000).padStart(6, '0');
}

export const totpCode = (secret: string, atMs: number) => codeForStep(secret, stepAt(atMs));

/**
 * The time step this code belongs to if it is right (allowing one step either side for clock
 * drift), otherwise null. The caller remembers the step to refuse the same code twice.
 */
export function verifyTotp(secret: string, code: string, atMs: number): number | null {
  const now = stepAt(atMs);
  for (const step of [now, now - 1, now + 1]) {
    if (codeForStep(secret, step) === code) return step;
  }
  return null;
}

export const otpauthUri = (secret: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}` +
  `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${PERIOD}`;

/** Encrypt a small secret at rest (AES-256-GCM). The key is derived from a server secret. */
export function seal(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function unseal(key: Buffer, sealed: string): string {
  const [iv, tag, enc] = sealed.split('.').map((p) => Buffer.from(p, 'base64'));
  if (!iv || !tag || !enc) throw new Error('Bad sealed value');
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}
