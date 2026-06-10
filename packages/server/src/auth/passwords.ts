import crypto from 'node:crypto';
import { promisify } from 'node:util';

// Node's scrypt has params in an optional options object, but the promisify typing
// doesn't include the overload with options. We cast to the extended type.
type ScryptFn = (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
  callback: (err: Error | null, derivedKey: Buffer) => void,
) => void;

const scryptAsync = promisify(crypto.scrypt as ScryptFn);

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LEN);
  const key = (await scryptAsync(password, salt, KEY_LEN, { N, r: R, p: P })) as Buffer;
  return `scrypt$N=${N},r=${R},p=${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;

  const [, paramsStr, saltB64, keyB64] = parts;
  if (!paramsStr || !saltB64 || !keyB64) return false;

  const params: Record<string, number> = {};
  for (const kv of paramsStr.split(',')) {
    const [k, v] = kv.split('=');
    if (k && v) params[k] = parseInt(v, 10);
  }

  const n = params['N'] ?? N;
  const r = params['r'] ?? R;
  const p = params['p'] ?? P;

  const salt = Buffer.from(saltB64, 'base64url');
  const expectedKey = Buffer.from(keyB64, 'base64url');
  const key = (await scryptAsync(password, salt, expectedKey.length, { N: n, r, p })) as Buffer;

  if (key.length !== expectedKey.length) return false;
  return crypto.timingSafeEqual(key, expectedKey);
}
