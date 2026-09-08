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
import { mutateCampaign } from '../campaign/commit.js';
import { asyncRoute } from './asyncRoute.js';
import { validateBody, validateId } from './validate.js';
import { object, text, finite, integer } from '@vtt/shared';
import { deleteAssetFiles } from '../campaign/writer.js';
import { config } from '../config.js';
import { broadcast } from '../ws/hub.js';
import { canAccessShared, documentSharing } from '../ws/sharing.js';
import type {
  CampaignListItem,
  CreateCampaignResponse,
  CreateInviteResponse,
  InviteSummary,
  RedeemInviteResponse,
} from '@vtt/shared';

const router = Router();
router.param('id', validateId);
router.param('token', validateId);
router.param('assetId', validateId);

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
router.post('/', requireAdmin, asyncRoute(async (req: Request, res: Response) => {
  validateBody(req.body, object({ name: text(200, 1) }, { description: text(4000) }));
  const { name, description } = req.body as { name?: string; description?: string };
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  try {
    const meta = await createCampaign(name, description ?? '', (id) => addMembership(id, req.user!.id, 'dm'));

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
}));

// POST /api/campaigns/:id/invites — dm.
router.post('/:id/invites', requireMember('dm'), asyncRoute(async (req: Request, res: Response) => {
  const campaignId = param(req.params['id']);
  validateBody(req.body, object({}, { expiresInHours: finite(0.01, 8760), maxUses: integer(1, 1_000_000) }));
  const { expiresInHours, maxUses } = req.body as {
    expiresInHours?: number;
    maxUses?: number;
  };

  const invite = await createInvite(campaignId, req.user!.id, { expiresInHours, maxUses });
  const body: CreateInviteResponse = {
    token: invite.token,
    url: `${config.PUBLIC_ORIGIN}/?invite=${invite.token}`,
  };
  res.status(201).json(body);
}));

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
router.delete('/:id/invites/:token', requireMember('dm'), asyncRoute(async (req: Request, res: Response) => {
  const token = param(req.params['token']);
  const found = await revokeInvite(token);
  if (!found) {
    res.status(404).json({ error: 'Invite not found' });
    return;
  }
  res.status(204).send();
}));

// GET /api/campaigns/:id/files/assets/:filename — member-gated binary serving.
router.get('/:id/files/assets/:filename', requireMember(), asyncRoute(async (req: Request, res: Response) => {
  const campaignId = param(req.params['id']);
  const filename = param(req.params['filename']);

  // Security: reject path traversal.
  if (filename.length > 255 || filename.includes('\0') || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
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

  // Documents: owner, anyone shared-with, or the DM (omniscient).
  if (manifest.assetKind === 'document') {
    const viewer = { userId: user.id, username: user.username, role: role ?? 'player' };
    if (!canAccessShared(viewer, manifest.ownerUsername ?? null, documentSharing(entry, manifest))) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }
  } else {
    // Current board items, map pieces and visible tokens are public to members.
    // Saved templates and private prep do not expose their unplaced images.
    if (manifest.dmOnly) {
      const isOnBoard = entry.runtime.state.board.some((item) => item.assetId === manifest.id)
        || entry.runtime.state.pieces.some((piece) => piece.assetId === manifest.id);
      const isReferencedByToken = entry.runtime.state.tokens.some(
        (tok) => tok.assetId === manifest.id && !tok.dmOnly,
      );
      if (!isOnBoard && !isReferencedByToken && role !== 'dm') {
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
    // audio elements need inline serving (sendFile handles Range for seeking)
    'audio/mpeg',
    'audio/mp4',
    'audio/ogg',
    'audio/wav',
    'audio/webm',
    'audio/aac',
    'audio/flac',
  ]);
  const inlineMime = manifest.mime === 'text/markdown' ? 'text/plain' : manifest.mime;
  if (INLINE_SAFE_MIMES.has(inlineMime)) {
    res.setHeader('Content-Type', inlineMime);
  } else {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  }
  res.sendFile(filePath);
}));

function assetUses(entry: NonNullable<ReturnType<typeof getCampaign>>, assetId: string, isDm: boolean): string[] {
  const uses: string[] = [];
  const { state } = entry.runtime;
  const asset = entry.store.assets.get(assetId)!;
  for (const item of state.board) if (item.assetId === assetId) uses.push(asset.assetKind === 'map' ? 'current map background' : `board image "${asset.title}"`);
  for (const token of state.tokens) if (token.assetId === assetId) uses.push(isDm || !token.dmOnly ? `token face "${token.name}"` : 'a private token face');
  for (const piece of state.pieces) if (piece.assetId === assetId) uses.push(`map piece "${asset.title}" on the current map`);
  for (const template of state.mapTemplates) {
    if (template.board.some((item) => item.assetId === assetId)) uses.push(`saved map "${template.name}" (board)`);
    if (template.pieces.some((piece) => piece.assetId === assetId)) uses.push(`saved map "${template.name}" (pieces)`);
  }
  if (entry.store.meta.coverAssetId === assetId) uses.push('campaign cover');
  for (const character of entry.store.characters.values()) {
    if (character.portraitAssetId === assetId) uses.push(isDm ? `character portrait "${character.name}"` : 'a private character portrait');
    if (character.sheet?.sheetAssetId === assetId) uses.push(isDm ? `character sheet "${character.name}"` : 'a private character sheet');
  }
  for (const chapter of entry.store.chapters.values()) {
    for (const scene of chapter.scenes) {
      if (scene.assetIds.includes(assetId)) uses.push(isDm ? `chapter "${chapter.title}", scene "${scene.title}"` : 'a private chapter scene');
    }
  }
  if (entry.media?.assetId === assetId) uses.push('table playback (stop it first)');
  return [...new Set(uses)];
}

// DELETE /api/campaigns/:id/assets/:assetId — owner or dm, only when unused.
router.delete('/:id/assets/:assetId', requireMember(), asyncRoute(async (req: Request, res: Response) => {
  const campaignId = param(req.params['id']);
  const assetId = param(req.params['assetId']);

  const entry = getCampaign(campaignId);
  if (!entry) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }

  const deleted = await mutateCampaign(entry, async (draft) => {
    const manifest = draft.store.assets.get(assetId);
    if (!manifest) {
      res.status(404).json({ error: 'Asset not found' });
      return false;
    }

    const user = req.user!;
    const isDm = req.campaignRole === 'dm';
    const isOwner = manifest.ownerUsername === user.username;

    if (!isDm && !isOwner) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
      return false;
    }

    const uses = assetUses(draft, assetId, isDm);
    if (uses.length) {
      res.status(409).json({ error: `Asset is used by ${uses.join('; ')}. Remove these references before deleting it.`, code: 'ASSET_IN_USE' });
      return false;
    }

    await deleteAssetFiles(draft.store, manifest);

    // Broadcast appropriate update.
    if (manifest.assetKind === 'document') {
      // Revoke table access if it was shared, then push per-user lists.
      if (draft.runtime.state.sharedDocumentIds.includes(assetId)) {
        draft.runtime.state = {
          ...draft.runtime.state,
          sharedDocumentIds: draft.runtime.state.sharedDocumentIds.filter((id) => id !== assetId),
        };
        await persistState(draft.runtime);
      }
      broadcastDocuments(campaignId, draft);
    } else {
      const assets = [...draft.store.assets.values()].filter((a) => a.assetKind !== 'document');
      broadcast(campaignId, { type: 'assetsUpdated', assets }, (s) => s.role === 'dm');
    }
    return true;
  });
  if (!deleted) return;

  res.status(204).send();
}));

export default router;
