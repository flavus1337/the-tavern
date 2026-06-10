import path from 'node:path';
import crypto from 'node:crypto';
import { JsonFileStore } from '../data/jsonStore.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { config } from '../config.js';
import { log } from '../log.js';
import { randomId } from '@vtt/shared';

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  isAdmin: boolean;
  createdAt: string;
}

interface UsersFile {
  type: 'vtt.users';
  schemaVersion: 1;
  users: UserRecord[];
}

const USERNAME_RE = /^[a-z0-9_.-]{2,30}$/;

// Login attempt limiter: in-memory (resets on restart which is intentional).
interface LimitEntry {
  fails: number;
  lockUntil: number | null;
}
const loginLimiter = new Map<string, LimitEntry>();
const MAX_FAILS = 10;
const LOCK_MS = 5 * 60 * 1000;

let store: JsonFileStore<UsersFile>;

// In-flight reservation set: normalized usernames currently being hashed/inserted.
// Prevents concurrent async paths from both passing the pre-hash uniqueness check.
const inFlightUsernames = new Set<string>();

export async function initUsersStore(): Promise<void> {
  store = await JsonFileStore.create<UsersFile>(path.join(config.DATA_DIR, 'users.json'), {
    type: 'vtt.users',
    schemaVersion: 1,
    users: [],
  });
}

export function getStore(): JsonFileStore<UsersFile> {
  return store;
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function validateUsername(username: string): { ok: true } | { ok: false; reason: string } {
  const norm = normalizeUsername(username);
  if (!USERNAME_RE.test(norm)) {
    return {
      ok: false,
      reason:
        'Username must be 2-30 characters and contain only letters, digits, _, ., or -',
    };
  }
  return { ok: true };
}

export async function createUser(
  username: string,
  password: string,
  isAdmin = false,
): Promise<UserRecord> {
  const norm = normalizeUsername(username);
  const v = validateUsername(norm);
  if (!v.ok) throw new Error(v.reason);

  if (password.length < 8) throw new Error('password_too_short');

  // Fast pre-check before the expensive hash to give a quick rejection for
  // clearly-taken usernames (not a concurrency guarantee — the real check is
  // inside mutate below).
  if (
    store.get().users.some((u) => u.username.toLowerCase() === norm) ||
    inFlightUsernames.has(norm)
  ) {
    throw new Error('username_taken');
  }

  // Reserve the slot so other async paths for the same username fail fast.
  inFlightUsernames.add(norm);
  let passwordHash: string;
  try {
    passwordHash = await hashPassword(password);
  } finally {
    inFlightUsernames.delete(norm);
  }

  // Re-check uniqueness INSIDE the synchronous mutate callback so the check
  // and the insert are atomic relative to every other mutate call.
  let inserted: UserRecord | null = null;
  store.mutate((s) => {
    if (s.users.some((u) => u.username.toLowerCase() === norm)) {
      // Another request sneaked in — do not insert.
      return s;
    }
    inserted = {
      id: randomId('usr'),
      // Preserve display case ("DM"); uniqueness and login are case-insensitive.
      username: username.trim(),
      passwordHash,
      isAdmin,
      createdAt: new Date().toISOString(),
    };
    return { ...s, users: [...s.users, inserted] };
  });

  if (!inserted) throw new Error('username_taken');
  return inserted;
}

export async function seedAdmin(): Promise<void> {
  const data = store.get();
  if (data.users.length > 0) return;

  const username = config.ADMIN_USER;
  let password = config.ADMIN_PASSWORD;
  let generated = false;

  if (!password) {
    // Generate random 16-char alphanumeric password.
    const bytes = crypto.randomBytes(12);
    password = bytes.toString('base64url').slice(0, 16);
    generated = true;
  }

  await createUser(username, password, true);

  if (generated) {
    log.info('');
    log.info('╔══════════════════════════════════════════════════════╗');
    log.info('║           ADMIN ACCOUNT CREATED                       ║');
    log.info(`║  Username: ${username.padEnd(43)}║`);
    log.info(`║  Password: ${password.padEnd(43)}║`);
    log.info('║  SAVE THIS — it will not be shown again               ║');
    log.info('╚══════════════════════════════════════════════════════╝');
    log.info('');
  } else {
    log.info(`Admin user "${username}" created.`);
  }
}

export async function login(
  username: string,
  password: string,
): Promise<{ ok: true; user: UserRecord } | { ok: false; reason: 'locked'; lockedForSeconds: number } | { ok: false; reason: 'invalid' }> {
  const norm = normalizeUsername(username);
  const entry = loginLimiter.get(norm);

  if (entry?.lockUntil !== null && entry?.lockUntil !== undefined && entry.lockUntil > Date.now()) {
    const remaining = Math.ceil((entry.lockUntil - Date.now()) / 1000);
    return { ok: false, reason: 'locked', lockedForSeconds: remaining };
  }

  const user = store.get().users.find((u) => u.username.toLowerCase() === norm);
  if (!user) {
    recordFail(norm);
    return { ok: false, reason: 'invalid' };
  }

  const match = await verifyPassword(password, user.passwordHash);
  if (!match) {
    recordFail(norm);
    return { ok: false, reason: 'invalid' };
  }

  // Success — reset limiter.
  loginLimiter.delete(norm);
  return { ok: true, user };
}

function recordFail(norm: string): void {
  const entry = loginLimiter.get(norm) ?? { fails: 0, lockUntil: null };
  entry.fails += 1;
  if (entry.fails >= MAX_FAILS) {
    entry.lockUntil = Date.now() + LOCK_MS;
  }
  loginLimiter.set(norm, entry);
}

export function findUserById(id: string): UserRecord | undefined {
  return store.get().users.find((u) => u.id === id);
}

export function findUserByUsername(username: string): UserRecord | undefined {
  const norm = normalizeUsername(username);
  return store.get().users.find((u) => u.username.toLowerCase() === norm);
}
