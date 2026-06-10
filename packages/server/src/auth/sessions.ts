import path from 'node:path';
import crypto from 'node:crypto';
import { JsonFileStore } from '../data/jsonStore.js';
import { config } from '../config.js';
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
export const COOKIE_NAME = 'vtt_session';

let store: JsonFileStore<SessionsFile>;

export async function initSessionsStore(): Promise<void> {
  store = await JsonFileStore.create<SessionsFile>(path.join(config.DATA_DIR, 'sessions.json'), {
    sessions: [],
  });

  // Prune expired sessions on load.
  const now = new Date().toISOString();
  store.mutate((s) => ({
    sessions: s.sessions.filter((sess) => sess.expiresAt > now),
  }));
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

  store.mutate((s) => ({ sessions: [...s.sessions, session] }));
  return session;
}

export function resolveSession(token: string): SessionRecord | null {
  const now = new Date().toISOString();
  const session = store.get().sessions.find((s) => s.token === token);
  if (!session) return null;
  if (session.expiresAt <= now) return null;
  return session;
}

export function deleteSession(token: string): void {
  store.mutate((s) => ({
    sessions: s.sessions.filter((sess) => sess.token !== token),
  }));
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
