import path from 'node:path';
import crypto from 'node:crypto';
import { JsonFileStore } from '../data/jsonStore.js';
import { config } from '../config.js';
import { updateCampaignMemory, withCampaignFiles } from '../campaign/commit.js';
import { log } from '../log.js';
import type { Response } from 'express';

export interface SessionRecord {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

interface SessionsFile {
  sessions: SessionRecord[];
}

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days
const PRUNE_INTERVAL_MS = 60 * 60 * 1000; // hourly
export const COOKIE_NAME = 'vtt_session';

let store: JsonFileStore<SessionsFile>;
// In-memory token -> record index for O(1) lookups (avoids scanning a growing
// array on every request/WS upgrade).
const index = new Map<string, SessionRecord>();

async function pruneExpired(): Promise<void> {
  const now = new Date().toISOString();
  await withCampaignFiles(config.DATA_DIR, async () => {
    if (!store.get().sessions.some((sess) => sess.expiresAt <= now)) return;
    await store.mutate((s) => ({ sessions: s.sessions.filter((sess) => sess.expiresAt > now) }));
    updateCampaignMemory(() => {
      for (const [token, sess] of index) {
        if (sess.expiresAt <= now) index.delete(token);
      }
    });
  });
}

export async function initSessionsStore(): Promise<void> {
  store = await JsonFileStore.create<SessionsFile>(path.join(config.DATA_DIR, 'sessions.json'), {
    sessions: [],
  });

  index.clear();
  for (const sess of store.get().sessions) index.set(sess.token, sess);
  await pruneExpired();

  // Keep memory + disk from accumulating expired sessions over long uptime.
  const timer = setInterval(() => {
    void pruneExpired().catch((err: unknown) => { log.error(`Session pruning failed: ${String(err)}`); });
  }, PRUNE_INTERVAL_MS);
  timer.unref?.();
}

export async function createSession(userId: string): Promise<SessionRecord> {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);

  const session: SessionRecord = {
    token,
    userId,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  await withCampaignFiles(config.DATA_DIR, async () => {
    await store.mutate((s) => ({ sessions: [...s.sessions, session] }));
    updateCampaignMemory(() => { index.set(token, session); });
  });
  return session;
}

export function resolveSession(token: string): SessionRecord | null {
  // Map lookup keys on the full token (no per-character linear scan), so there
  // is no practical timing oracle on a 256-bit random token.
  const session = index.get(token);
  if (!session) return null;
  if (session.expiresAt <= new Date().toISOString()) {
    index.delete(token);
    return null;
  }
  return session;
}

export async function deleteSession(token: string): Promise<void> {
  await withCampaignFiles(config.DATA_DIR, async () => {
    await store.mutate((s) => ({
      sessions: s.sessions.filter((sess) => sess.token !== token),
    }));
    updateCampaignMemory(() => { index.delete(token); });
  });
}

export function resolveSessionFromCookieHeader(header: string | undefined): SessionRecord | null {
  if (!header) return null;

  // Parse Cookie header: name=value; name2=value2
  for (const pair of header.split(';')) {
    const [rawName, ...rest] = pair.split('=');
    if (!rawName) continue;
    const name = rawName.trim();
    if (name === COOKIE_NAME) {
      const value = rest.join('=').trim();
      if (value) return resolveSession(value);
    }
  }
  return null;
}

export function setCookieHeader(res: Response, token: string): void {
  const secure = config.COOKIE_SECURE ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`,
  );
}

export function clearCookieHeader(res: Response): void {
  const secure = config.COOKIE_SECURE ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`,
  );
}

export function getSessionsStore(): JsonFileStore<SessionsFile> {
  return store;
}
