import { Router } from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import multer from 'multer';
import fs from 'node:fs/promises';
import { processImage } from '../services/image-processing.js';
import { assetRoute, uploadDirectory, canSaveAsset, checkAssetCapacity, syncAssetFile } from './assetWork.js';
import { param } from './params.js';
import { requireMember } from '../auth/middleware.js';
import { getCampaign } from '../campaign/registry.js';
import { saveAssetManifest } from '../campaign/writer.js';
import { mutateCampaign, writeCampaignFile } from '../campaign/commit.js';
import { validateBody, validateId } from './validate.js';
import { object, text, oneOf } from '@vtt/shared';
import { broadcast } from '../ws/hub.js';
import { broadcastDocuments } from '../ws/documents.js';
import { randomId, slugify, SCHEMA_VERSIONS } from '@vtt/shared';
import type { AssetManifest } from '@vtt/shared';
import type { UploadAssetResponse } from '@vtt/shared';

const upload = multer({
  storage: multer.diskStorage({ destination: (req, _file, callback) => callback(null, uploadDirectory(req)) }),
  limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 3, parts: 4, fieldSize: 1024, fieldNameSize: 40, fieldNestingDepth: 0 },
});

const router = Router();
router.param('id', validateId);

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
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
  checkAssetCapacity(),
  assetRoute(upload.single('file'), async (req: Request, res: Response, work) => {
    const campaignId = param(req.params['id']);
    const entry = getCampaign(campaignId);
    if (!entry) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    validateBody(req.body, object({}, { kind: oneOf(['map', 'art', 'handout', 'token']), dmOnly: oneOf(['true', 'false', '1', '0']), category: text(40) }));
    const isDm = req.campaignRole === 'dm';

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    if (!IMAGE_MIMES.has(file.mimetype)) {
      res.status(400).json({ error: 'Only image files are allowed (png, jpg, webp, gif)', code: 'INVALID_FILE_TYPE' });
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

    const processedPath = path.join(work.dir, 'processed.webp');
    let width: number, height: number;
    try {
      ({ width, height } = await processImage({ sourcePath: file.path, outputPath: processedPath, transparent: false, quality: 82 }, work.signal));
    } catch (error) {
      if (work.signal.aborted) throw error;
      res.status((error as { status?: number }).status ?? 500).json({ error: `Image processing failed: ${String(error)}` });
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

    await syncAssetFile(processedPath, work.signal);
    const saved = await mutateCampaign(entry, async (draft) => {
      work.signal.throwIfAborted();
      if (!canSaveAsset(req, res, draft)) return false;
      await writeCampaignFile(draft.store.dir, outputPath, { sourcePath: processedPath });
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
  checkAssetCapacity(),
  assetRoute(upload.single('file'), async (req: Request, res: Response, work) => {
    const campaignId = param(req.params['id']);
    const entry = getCampaign(campaignId);
    if (!entry) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    validateBody(req.body, object({}));
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
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
      const handle = await fs.open(file.path, 'r');
      const prefix = Buffer.alloc(4);
      try { await handle.read(prefix, 0, 4, 0); } finally { await handle.close(); }
      const magicBytes = prefix.toString('ascii');
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

    await syncAssetFile(file.path, work.signal);
    const saved = await mutateCampaign(entry, async (draft) => {
      work.signal.throwIfAborted();
      if (!canSaveAsset(req, res, draft)) return false;
      await writeCampaignFile(draft.store.dir, outputPath, { sourcePath: file.path });
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
