import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing with scrypt (built into Node, memory-hard, no extra package).
 * Stored as `scrypt$N$r$p$salt$hash` so the cost can be raised later without breaking old hashes.
 */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  const options: ScryptOptions = { N: n, r, p, maxmem: 64 * 1024 * 1024 };
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEYLEN, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password.normalize('NFKC'), salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await derive(password.normalize('NFKC'), Buffer.from(salt, 'base64'), +n, +r, +p);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A hash to check against when the account does not exist, so "no such user" takes as long as "wrong password". */
let dummy: Promise<string> | null = null;
export const dummyHash = () => (dummy ??= hashPassword('not-a-real-password-for-timing-only'));

const COMMON = new Set([
  'password1234',
  'password12345',
  'passwordpassword',
  '123456789012',
  '1234567890123',
  'qwertyuiop12',
  'qwertyuiopas',
  'letmein123456',
  'administrator',
  'welcome12345',
  'iloveyou12345',
  'changeme1234',
]);

/** Returns a message if the password is not acceptable, otherwise null. */
export function passwordProblem(password: string, personal: string[] = []): string | null {
  if (password.length < 12) return 'Use at least 12 characters.';
  if (password.length > 128) return 'Use at most 128 characters.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'This password is too common.';
  if (new Set(password).size < 5) return 'Use a password with more variety.';
  for (const word of personal) {
    if (word.length >= 4 && lower.includes(word.toLowerCase())) {
      return 'Do not include your name or email in the password.';
    }
  }
  return null;
}
