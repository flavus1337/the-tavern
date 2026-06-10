// Zero-dependency ID helpers — isomorphic (Node 20+ & browsers).
// Uses the web-standard globalThis.crypto (no node:crypto import).

const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ID_BYTE_LENGTH = 9; // 9 bytes → 12 base62 chars (ceil(9*8/log2(62)) ≈ 12)

/**
 * Generates a random ID with 12+ characters from globalThis.crypto.
 * Optional prefix is separated by an underscore: e.g. `randomId('usr')` → `usr_Xk3...`.
 */
export function randomId(prefix?: string): string {
  const bytes = new Uint8Array(ID_BYTE_LENGTH);
  globalThis.crypto.getRandomValues(bytes);

  // Convert bytes to a BigInt, then encode in base62.
  let n = 0n;
  for (const byte of bytes) {
    n = (n << 8n) | BigInt(byte);
  }

  let encoded = '';
  while (n > 0n) {
    const rem = n % 62n;
    encoded = (BASE62_CHARS[Number(rem)] ?? '0') + encoded;
    n = n / 62n;
  }

  // Pad to at least 12 chars with leading '0'.
  while (encoded.length < 12) {
    encoded = '0' + encoded;
  }

  return prefix !== undefined && prefix.length > 0 ? `${prefix}_${encoded}` : encoded;
}

/**
 * Converts a name to a URL/file-safe slug.
 * - Lowercase ASCII
 * - Non-alphanumeric → dashes
 * - Consecutive dashes collapsed
 * - Leading/trailing dashes trimmed
 * - Max 60 chars
 * - Falls back to `'untitled'` when result is empty
 */
export function slugify(name: string): string {
  let slug = name
    .toLowerCase()
    // Replace non-alphanumeric characters with dashes.
    .replace(/[^a-z0-9]+/g, '-')
    // Collapse consecutive dashes.
    .replace(/-{2,}/g, '-')
    // Trim leading/trailing dashes.
    .replace(/^-+|-+$/g, '');

  if (slug.length > 60) {
    slug = slug.slice(0, 60).replace(/-+$/, '');
  }

  return slug.length > 0 ? slug : 'untitled';
}
