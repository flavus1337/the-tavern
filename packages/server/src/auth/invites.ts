import path from 'node:path';
import crypto from 'node:crypto';
import { JsonFileStore } from '../data/jsonStore.js';
import { config } from '../config.js';
import { addMembership } from './memberships.js';
import type { InvitePreviewResponse } from '@vtt/shared';
import { getCampaign } from '../campaign/registry.js';
import { withCampaignFiles } from '../campaign/commit.js';

export interface InviteRecord {
  token: string;
  campaignId: string;
  createdByUserId: string;
  createdAt: string;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
  revoked: boolean;
}

interface InvitesFile {
  invites: InviteRecord[];
}

let store: JsonFileStore<InvitesFile>;

export async function initInvitesStore(): Promise<void> {
  store = await JsonFileStore.create<InvitesFile>(path.join(config.DATA_DIR, 'invites.json'), {
    invites: [],
  });
}

function generateToken(): string {
  return 'inv_' + crypto.randomBytes(24).toString('base64url');
}

export async function createInvite(
  campaignId: string,
  createdByUserId: string,
  opts: { expiresInHours?: number; maxUses?: number } = {},
): Promise<InviteRecord> {
  if (opts.expiresInHours != null && (!Number.isFinite(opts.expiresInHours) || opts.expiresInHours <= 0 || opts.expiresInHours > 8760)) {
    throw Object.assign(new Error('expiresInHours must be a number between 0 and 8760'), { status: 400 });
  }
  if (opts.maxUses != null && (!Number.isSafeInteger(opts.maxUses) || opts.maxUses < 1 || opts.maxUses > 10_000)) {
    throw Object.assign(new Error('maxUses must be an integer between 1 and 10000'), { status: 400 });
  }
  const token = generateToken();
  const now = new Date();
  const expiresAt =
    opts.expiresInHours != null
      ? new Date(now.getTime() + opts.expiresInHours * 60 * 60 * 1000).toISOString()
      : null;

  const invite: InviteRecord = {
    token,
    campaignId,
    createdByUserId,
    createdAt: now.toISOString(),
    expiresAt,
    maxUses: opts.maxUses ?? null,
    uses: 0,
    revoked: false,
  };

  await store.mutate((s) => ({ invites: [...s.invites, invite] }));
  return invite;
}

export function previewInvite(token: string): InvitePreviewResponse {
  const invite = store.get().invites.find((i) => i.token === token);
  if (!invite) return { valid: false, reason: 'unknown' };
  if (invite.revoked) return { valid: false, reason: 'revoked' };
  if (invite.expiresAt && new Date(invite.expiresAt) < new Date())
    return { valid: false, reason: 'expired' };
  if (invite.maxUses != null && invite.uses >= invite.maxUses)
    return { valid: false, reason: 'exhausted' };

  // Get campaign name from registry.
  const entry = getCampaign(invite.campaignId);
  const campaignName = entry?.store.meta?.name ?? invite.campaignId;
  return { valid: true, campaignName };
}

export function redeemInvite(
  token: string,
  userId: string,
): Promise<{ ok: true; campaignId: string } | { ok: false; reason: string }> {
  // The invite capacity check, use count, and membership share one file commit.
  // Neither memory store publishes until both files have been persisted.
  return withCampaignFiles(config.DATA_DIR, async () => {
    const invite = store.get().invites.find((i) => i.token === token);
    if (!invite) return { ok: false, reason: 'unknown' };
    if (invite.revoked) return { ok: false, reason: 'revoked' };
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) return { ok: false, reason: 'expired' };
    if (invite.maxUses != null && invite.uses >= invite.maxUses) return { ok: false, reason: 'exhausted' };

    await store.mutate((s) => ({
      invites: s.invites.map((i) => i.token === token ? { ...i, uses: i.uses + 1 } : i),
    }));
    await addMembership(invite.campaignId, userId, 'player');
    return { ok: true, campaignId: invite.campaignId };
  });
}

export function listInvitesForCampaign(campaignId: string): InviteRecord[] {
  return store.get().invites.filter((i) => i.campaignId === campaignId);
}

export async function revokeInvite(token: string): Promise<boolean> {
  let found = false;
  await store.mutate((s) => {
    const idx = s.invites.findIndex((i) => i.token === token);
    if (idx === -1) return s;
    found = true;
    const updated = [...s.invites];
    const invite = updated[idx];
    if (!invite) return s;
    updated[idx] = { ...invite, revoked: true };
    return { invites: updated };
  });
  return found;
}

export function getInvitesStore(): JsonFileStore<InvitesFile> {
  return store;
}
