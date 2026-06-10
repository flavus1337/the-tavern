import { Router } from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { param } from './params.js';
import { requireAuth, requireAdmin, requireMember } from '../auth/middleware.js';
import { createCampaign } from '../campaign/create.js';
import { addMembership, listForUser, getRole } from '../auth/memberships.js';
import { createInvite, previewInvite, redeemInvite, listInvitesForCampaign, revokeInvite } from '../auth/invites.js';
import { getCampaign, getAllCampaigns } from '../campaign/registry.js';
import { broadcastDocuments } from '../ws/documents.js';
import { persistState } from '../campaign/runtime.js';
import { deleteAssetFiles } from '../campaign/writer.js';
import { config } from '../config.js';
import { broadcast } from '../ws/hub.js';
import type {
  CampaignListItem,
  CreateCampaignResponse,
  CreateInviteResponse,
  InviteSummary,
  RedeemInviteResponse,
} from '@vtt/shared';

const router = Router();

// GET /api/campaigns — auth user's campaigns.
router.get('/', requireAuth, (req: Request, res: Response) => {
  const user = req.user!;
  const memberships = listForUser(user.id);
  const items: CampaignListItem[] = [];

  for (const membership of memberships) {
    const entry = getCampaign(membership.campaignId);
    if (!entry) continue;
    items.push({
      id: entry.store.meta.id,
      name: entry.store.meta.name,
      description: entry.store.meta.description,
      role: membership.role,
    });
  }

  res.json(items);
});

// POST /api/campaigns — admin only.
router.post('/', requireAdmin, async (req: Request, res: Response) => {
  const { name, description } = req.body as { name?: string; description?: string };
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  try {
    const meta = await createCampaign(name, description ?? '');
    // Grant admin DM membership.
    addMembership(meta.id, req.user!.id, 'dm');

    const body: CreateCampaignResponse = {
      campaign: {
        id: meta.id,
        name: meta.name,
        description: meta.description,
        role: 'dm',
      },
    };
    res.status(201).json(body);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === 'CONFLICT') {
      res.status(409).json({ error: 'Campaign id already exists', code: 'CONFLICT' });
      return;
    }
    throw err;
  }
});

// POST /api/campaigns/:id/invites — dm.
router.post('/:id/invites', requireMember('dm'), (req: Request, res: Response) => {
  const campaignId = param(req.params['id']);
  const { expiresInHours, maxUses } = req.body as {
    expiresInHours?: number;
    maxUses?: number;
  };

  const invite = createInvite(campaignId, req.user!.id, { expiresInHours, maxUses });
  const body: CreateInviteResponse = {
    token: invite.token,
    url: `${config.PUBLIC_ORIGIN}/?invite=${invite.token}`,
  };
  res.status(201).json(body);
});

// GET /api/campaigns/:id/invites — dm.
router.get('/:id/invites', requireMember('dm'), (req: Request, res: Response) => {
  const campaignId = param(req.params['id']);
  const invites = listInvitesForCampaign(campaignId);
  const summaries: InviteSummary[] = invites.map((i) => ({
    token: i.token,
    createdAt: i.createdAt,
    expiresAt: i.expiresAt,
    maxUses: i.maxUses,
    uses: i.uses,
    revoked: i.revoked,
  }));
  res.json({ invites: summaries });
});

// DELETE /api/campaigns/:id/invites/:token — dm.
router.delete('/:id/invites/:token', requireMember('dm'), (req: Request, res: Response) => {
  const token = param(req.params['token']);
  const found = revokeInvite(token);
  if (!found) {
    res.status(404).json({ error: 'Invite not found' });
    return;
  }
  res.status(204).send();
});

// GET /api/campaigns/:id/files/assets/:filename — member-gated binary serving.
router.get('/:id/files/assets/:filename', requireMember(), async (req: Request, res: Response) => {
  const campaignId = param(req.params['id']);
  const filename = param(req.params['filename']);

  // Security: reject path traversal.
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }

  const entry = getCampaign(campaignId);
  if (!entry) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }

  // Find manifest for this file.
  const manifest = [...entry.store.assets.values()].find((a) => a.file === filename);
  if (!manifest) {
    res.status(404).json({ error: 'Asset not found' });
    return;
  }

  const user = req.user!;
  const role = getRole(campaignId, user.id);

  // Documents: private to the uploader unless shared with the table.
  if (manifest.assetKind === 'document') {
    const isShared = entry.runtime.state.sharedDocumentIds.includes(manifest.id);
    if (!isShared && manifest.ownerUsername !== user.username) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }
  } else {
    // Images with dmOnly: only DM can access, UNLESS it's the current shared image.
    if (manifest.dmOnly) {
      const isCurrentImage = entry.runtime.state.currentImageAssetId === manifest.id;
      if (!isCurrentImage && role !== 'dm') {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
        return;
      }
    }
  }

  const filePath = path.join(entry.store.dir, 'assets', filename);
  try {
    await fs.access(filePath);
  } catch {
    res.status(404).json({ error: 'File not found on disk' });
    return;
  }

  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Only types a browser can render harmlessly are served inline; everything
  // else is forced to download so user uploads can never execute same-origin.
  const INLINE_SAFE_MIMES = new Set([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'text/plain',
  ]);
  const inlineMime = manifest.mime === 'text/markdown' ? 'text/plain' : manifest.mime;
  if (INLINE_SAFE_MIMES.has(inlineMime)) {
    res.setHeader('Content-Type', inlineMime);
  } else {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  }
  res.sendFile(filePath);
});

// DELETE /api/campaigns/:id/assets/:assetId — owner or dm.
router.delete('/:id/assets/:assetId', requireMember(), async (req: Request, res: Response) => {
  const campaignId = param(req.params['id']);
  const assetId = param(req.params['assetId']);

  const entry = getCampaign(campaignId);
  if (!entry) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }

  const manifest = entry.store.assets.get(assetId);
  if (!manifest) {
    res.status(404).json({ error: 'Asset not found' });
    return;
  }

  const user = req.user!;
  const isDm = req.campaignRole === 'dm';
  const isOwner = manifest.ownerUsername === user.username;

  if (!isDm && !isOwner) {
    res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    return;
  }

  await deleteAssetFiles(entry.store, manifest);

  // Clear current image if needed.
  if (entry.runtime.state.currentImageAssetId === assetId) {
    entry.runtime.state = { ...entry.runtime.state, currentImageAssetId: null };
    await persistState(entry.runtime);
    broadcast(campaignId, { type: 'imageShared', asset: null });
  }

  // Broadcast appropriate update.
  if (manifest.assetKind === 'document') {
    // Revoke table access if it was shared, then push per-user lists.
    if (entry.runtime.state.sharedDocumentIds.includes(assetId)) {
      entry.runtime.state = {
        ...entry.runtime.state,
        sharedDocumentIds: entry.runtime.state.sharedDocumentIds.filter((id) => id !== assetId),
      };
      await persistState(entry.runtime);
    }
    broadcastDocuments(campaignId, entry);
  } else {
    const assets = [...entry.store.assets.values()].filter((a) => a.assetKind !== 'document');
    broadcast(campaignId, { type: 'assetsUpdated', assets }, (s) => s.role === 'dm');
  }

  res.status(204).send();
});

export default router;
