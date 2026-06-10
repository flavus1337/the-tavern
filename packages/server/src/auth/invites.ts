import path from 'node:path';
import crypto from 'node:crypto';
import { JsonFileStore } from '../data/jsonStore.js';
import { config } from '../config.js';
import { addMembership } from './memberships.js';
import type { InvitePreviewResponse } from '@vtt/shared';
import { getCampaign } from '../campaign/registry.js';

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

export function createInvite(
  campaignId: string,
  createdByUserId: string,
  opts: { expiresInHours?: number; maxUses?: number } = {},
): InviteRecord {
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

  store.mutate((s) => ({ invites: [...s.invites, invite] }));
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
): { ok: true; campaignId: string } | { ok: false; reason: string } {
  let campaignId: string | null = null;
  let error: string | null = null;

  store.mutate((s) => {
    const idx = s.invites.findIndex((i) => i.token === token);
    if (idx === -1) {
      error = 'unknown';
      return s;
    }
    const invite = s.invites[idx];
    if (!invite) {
      error = 'unknown';
      return s;
    }
    if (invite.revoked) {
      error = 'revoked';
      return s;
    }
    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      error = 'expired';
      return s;
    }
    if (invite.maxUses != null && invite.uses >= invite.maxUses) {
      error = 'exhausted';
      return s;
    }

    campaignId = invite.campaignId;
    const updated = [...s.invites];
    updated[idx] = { ...invite, uses: invite.uses + 1 };
    return { invites: updated };
  });

  if (error || !campaignId) return { ok: false, reason: error ?? 'unknown' };

  // Add membership idempotently after incrementing uses.
  addMembership(campaignId, userId, 'player');
  return { ok: true, campaignId };
}

export function listInvitesForCampaign(campaignId: string): InviteRecord[] {
  return store.get().invites.filter((i) => i.campaignId === campaignId);
}

export function revokeInvite(token: string): boolean {
  let found = false;
  store.mutate((s) => {
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
