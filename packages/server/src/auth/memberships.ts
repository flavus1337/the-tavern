import path from 'node:path';
import { JsonFileStore } from '../data/jsonStore.js';
import { config } from '../config.js';
import type { Role } from '@vtt/shared';

export interface MembershipRecord {
  campaignId: string;
  userId: string;
  role: Role;
  joinedAt: string;
}

interface MembershipsFile {
  memberships: MembershipRecord[];
}

let store: JsonFileStore<MembershipsFile>;

export async function initMembershipsStore(): Promise<void> {
  store = await JsonFileStore.create<MembershipsFile>(
    path.join(config.DATA_DIR, 'memberships.json'),
    { memberships: [] },
  );
}

export function addMembership(campaignId: string, userId: string, role: Role): void {
  const existing = store
    .get()
    .memberships.find((m) => m.campaignId === campaignId && m.userId === userId);
  if (existing) {
    // Idempotent — keep existing role.
    return;
  }

  const record: MembershipRecord = {
    campaignId,
    userId,
    role,
    joinedAt: new Date().toISOString(),
  };
  store.mutate((s) => ({ memberships: [...s.memberships, record] }));
}

export function getRole(campaignId: string, userId: string): Role | null {
  const m = store.get().memberships.find((m) => m.campaignId === campaignId && m.userId === userId);
  return m?.role ?? null;
}

export function listForUser(userId: string): MembershipRecord[] {
  return store.get().memberships.filter((m) => m.userId === userId);
}

export function listForCampaign(campaignId: string): MembershipRecord[] {
  return store.get().memberships.filter((m) => m.campaignId === campaignId);
}

export function getMembershipsStore(): JsonFileStore<MembershipsFile> {
  return store;
}
