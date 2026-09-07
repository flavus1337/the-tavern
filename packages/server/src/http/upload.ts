import { Router } from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';
import { param } from './params.js';
import { requireMember } from '../auth/middleware.js';
import { getCampaign } from '../campaign/registry.js';
import { saveAssetManifest } from '../campaign/writer.js';
import { mutateCampaign, writeCampaignFile } from '../campaign/commit.js';
import { asyncRoute } from './asyncRoute.js';
import { validateBody, validateId } from './validate.js';
import { object, text, oneOf } from '@vtt/shared';
import { broadcast } from '../ws/hub.js';
import { broadcastDocuments } from '../ws/documents.js';
import { randomId, slugify, SCHEMA_VERSIONS } from '@vtt/shared';
import type { AssetManifest } from '@vtt/shared';
import type { UploadAssetResponse } from '@vtt/shared';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB (videos; images get resized anyway)
});

const router = Router();
router.param('id', validateId);

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_DIMENSION = 2560;
// Cap assets per campaign so a member can't flood the disk with files. Generous
// for any real campaign; combined with the 100 MB per-file limit it bounds disk.
const MAX_ASSETS_PER_CAMPAIGN = 1000;

// Recheck after image processing and while holding the campaign command queue.
function canFinishUpload(req: Request, res: Response, entry: NonNullable<ReturnType<typeof getCampaign>>): boolean {
  if (req.campaignRole !== 'dm' && entry.runtime.state.uploadsLocked) {
    res.status(403).json({ error: 'Uploads are locked by the DM', code: 'UPLOADS_LOCKED' });
    return false;
  }
  if (entry.store.assets.size >= MAX_ASSETS_PER_CAMPAIGN) {
    res.status(413).json({ error: 'Campaign asset limit reached', code: 'ASSET_LIMIT' });
    return false;
  }
  return true;
}

// Never accept files a browser could execute as same-origin markup/script.
const BLOCKED_DOC_MIMES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'application/javascript',
  'text/javascript',
]);
const BLOCKED_DOC_EXTENSIONS = new Set(['html', 'htm', 'xhtml', 'svg', 'js', 'mjs']);

// POST /api/campaigns/:id/assets — image upload. DM may upload any image kind;
// players may upload only token face images (gated by the upload lock).
router.post(
  '/:id/assets',
  requireMember(),
  upload.single('file'),
  asyncRoute(async (req: Request, res: Response) => {
    const campaignId = param(req.params['id']);
    const entry = getCampaign(campaignId);
    if (!entry) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    validateBody(req.body, object({}, { kind: oneOf(['map', 'art', 'handout', 'token']), dmOnly: oneOf(['true', 'false', '1', '0']), category: text(40) }));
    const isDm = req.campaignRole === 'dm';

    // Players: only token images, and only while uploads are unlocked.
    if (!isDm && entry.runtime.state.uploadsLocked) {
      res.status(403).json({ error: 'Uploads are locked by the DM', code: 'UPLOADS_LOCKED' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    if (!IMAGE_MIMES.has(file.mimetype)) {
      res.status(400).json({ error: 'Only image files are allowed (png, jpg, webp, gif)', code: 'INVALID_FILE_TYPE' });
      return;
    }

    if (entry.store.assets.size >= MAX_ASSETS_PER_CAMPAIGN) {
      res.status(413).json({ error: 'Campaign asset limit reached', code: 'ASSET_LIMIT' });
      return;
    }

    const kind = (req.body as Record<string, string>)['kind'] ?? 'art';
    const validKinds = ['map', 'art', 'handout', 'token'];
    // Players can only contribute token images (never maps/handouts/dmOnly art).
    const assetKind = !isDm
      ? 'token'
      : validKinds.includes(kind)
        ? (kind as 'map' | 'art' | 'handout' | 'token')
        : 'art';

    const dmOnlyRaw = (req.body as Record<string, string>)['dmOnly'];
    const dmOnly = isDm && (dmOnlyRaw === 'true' || dmOnlyRaw === '1');
    // Optional palette category for stampable prop assets.
    const categoryRaw = (req.body as Record<string, string>)['category'];
    const category = typeof categoryRaw === 'string' && categoryRaw.trim() ? categoryRaw.trim().slice(0, 40) : undefined;

    // Process with sharp: resize to max 2560, encode as webp q82.
    validateBody(file.originalname, text(255, 1));
    validateBody(file.mimetype, text(100, 1));
    const originalName = file.originalname;
    const baseName = path.basename(originalName, path.extname(originalName));
    const slug = slugify(baseName);
    const shortId = randomId().slice(0, 8);
    const outputFilename = `${slug}-${shortId}.webp`;
    const outputPath = path.join(entry.store.dir, 'assets', outputFilename);

    let width: number;
    let height: number;
    let imageBuffer: Buffer;

    try {
      const img = sharp(file.buffer).resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      });
      const { data, info } = await img.webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
      imageBuffer = data;
      width = info.width;
      height = info.height;
    } catch (err) {
      res.status(400).json({ error: `Image processing failed: ${String(err)}` });
      return;
    }

    const manifest: AssetManifest = {
      type: 'asset',
      schemaVersion: SCHEMA_VERSIONS.asset,
      id: randomId('ast'),
      file: outputFilename,
      title: baseName,
      assetKind,
      tags: [],
      dmOnly,
      width,
      height,
      mime: 'image/webp',
      ownerUsername: req.user!.username,
      ...(category ? { category } : {}),
    };

    const saved = await mutateCampaign(entry, async (draft) => {
      if (!canFinishUpload(req, res, draft)) return false;
      await writeCampaignFile(draft.store.dir, outputPath, imageBuffer);
      await saveAssetManifest(draft.store, manifest);
      const assets = [...draft.store.assets.values()].filter((a) => a.assetKind !== 'document');
      broadcast(campaignId, { type: 'assetsUpdated', assets }, (s) => s.role === 'dm');
      return true;
    });
    if (!saved) return;

    const body: UploadAssetResponse = { asset: manifest };
    res.status(201).json(body);
  }),
);

// POST /api/campaigns/:id/documents — any member, any file type except
// browser-executable markup/script (those would be a stored-XSS vector when
// served same-origin). PDFs additionally get a magic-byte check.
router.post(
  '/:id/documents',
  requireMember(),
  upload.single('file'),
  asyncRoute(async (req: Request, res: Response) => {
    const campaignId = param(req.params['id']);
    const entry = getCampaign(campaignId);
    if (!entry) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    validateBody(req.body, object({}));
    // Upload lock: non-DM members cannot upload while locked.
    if (entry.runtime.state.uploadsLocked && req.campaignRole !== 'dm') {
      res.status(403).json({ error: 'Uploads are locked by the DM', code: 'UPLOADS_LOCKED' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    if (entry.store.assets.size >= MAX_ASSETS_PER_CAMPAIGN) {
      res.status(413).json({ error: 'Campaign asset limit reached', code: 'ASSET_LIMIT' });
      return;
    }

    validateBody(file.originalname, text(255, 1));
    validateBody(file.mimetype, text(100, 1));
    const originalName = file.originalname;
    const rawExt = path.extname(originalName).slice(1).toLowerCase();
    // A .json binary would collide with its own JSON manifest sidecar.
    const ext = rawExt !== 'json' && /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'bin';
    const mime = file.mimetype && file.mimetype !== '' ? file.mimetype : 'application/octet-stream';

    if (BLOCKED_DOC_MIMES.has(mime) || BLOCKED_DOC_EXTENSIONS.has(ext)) {
      res.status(400).json({
        error: 'This file type cannot be uploaded (HTML/SVG/script files are not allowed)',
        code: 'INVALID_FILE_TYPE',
      });
      return;
    }

    // PDFs get a magic-byte sanity check.
    if (mime === 'application/pdf' || ext === 'pdf') {
      const magicBytes = file.buffer.slice(0, 4).toString('ascii');
      if (magicBytes !== '%PDF') {
        res.status(400).json({ error: 'File does not appear to be a valid PDF', code: 'INVALID_FILE_TYPE' });
        return;
      }
    }

    const baseName = path.basename(originalName, path.extname(originalName));
    const slug = slugify(baseName);
    const shortId = randomId().slice(0, 8);
    const outputFilename = `${slug}-${shortId}.${ext}`;
    const outputPath = path.join(entry.store.dir, 'assets', outputFilename);

    const manifest: AssetManifest = {
      type: 'asset',
      schemaVersion: SCHEMA_VERSIONS.asset,
      id: randomId('ast'),
      file: outputFilename,
      title: baseName,
      assetKind: 'document',
      tags: [],
      dmOnly: false,
      width: null,
      height: null,
      mime,
      ownerUsername: req.user!.username,
    };

    const saved = await mutateCampaign(entry, async (draft) => {
      if (!canFinishUpload(req, res, draft)) return false;
      await writeCampaignFile(draft.store.dir, outputPath, file.buffer);
      await saveAssetManifest(draft.store, manifest);
      broadcastDocuments(campaignId, draft);
      return true;
    });
    if (!saved) return;

    const body: UploadAssetResponse = { asset: manifest };
    res.status(201).json(body);
  }),
);

export default router;
