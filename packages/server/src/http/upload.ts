import { Router } from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import multer from 'multer';
import sharp from 'sharp';
import { param } from './params.js';
import { requireMember } from '../auth/middleware.js';
import { getCampaign } from '../campaign/registry.js';
import { saveAssetManifest } from '../campaign/writer.js';
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

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_DIMENSION = 2560;

// Never accept files a browser could execute as same-origin markup/script.
const BLOCKED_DOC_MIMES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'application/javascript',
  'text/javascript',
]);
const BLOCKED_DOC_EXTENSIONS = new Set(['html', 'htm', 'xhtml', 'svg', 'js', 'mjs']);

// POST /api/campaigns/:id/assets — dm only, images.
router.post(
  '/:id/assets',
  requireMember('dm'),
  upload.single('file'),
  async (req: Request, res: Response) => {
    const campaignId = param(req.params['id']);
    const entry = getCampaign(campaignId);
    if (!entry) {
      res.status(404).json({ error: 'Campaign not found' });
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

    const kind = (req.body as Record<string, string>)['kind'] ?? 'art';
    const validKinds = ['map', 'art', 'handout', 'token'];
    const assetKind = validKinds.includes(kind)
      ? (kind as 'map' | 'art' | 'handout' | 'token')
      : 'art';

    const dmOnlyRaw = (req.body as Record<string, string>)['dmOnly'];
    const dmOnly = dmOnlyRaw === 'true' || dmOnlyRaw === '1';

    // Process with sharp: resize to max 2560, encode as webp q82.
    const originalName = file.originalname;
    const baseName = path.basename(originalName, path.extname(originalName));
    const slug = slugify(baseName);
    const shortId = randomId().slice(0, 8);
    const outputFilename = `${slug}-${shortId}.webp`;
    const outputPath = path.join(entry.store.dir, 'assets', outputFilename);

    let width: number;
    let height: number;

    try {
      const img = sharp(file.buffer).resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      });
      const info = await img.webp({ quality: 82 }).toFile(outputPath);
      width = info.width;
      height = info.height;
    } catch (err) {
      res.status(500).json({ error: `Image processing failed: ${String(err)}` });
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
    };

    await saveAssetManifest(entry.store, manifest);

    // Broadcast assetsUpdated to DM sockets.
    const assets = [...entry.store.assets.values()].filter((a) => a.assetKind !== 'document');
    broadcast(campaignId, { type: 'assetsUpdated', assets }, (s) => s.role === 'dm');

    const body: UploadAssetResponse = { asset: manifest };
    res.status(201).json(body);
  },
);

// POST /api/campaigns/:id/documents — any member, any file type except
// browser-executable markup/script (those would be a stored-XSS vector when
// served same-origin). PDFs additionally get a magic-byte check.
router.post(
  '/:id/documents',
  requireMember(),
  upload.single('file'),
  async (req: Request, res: Response) => {
    const campaignId = param(req.params['id']);
    const entry = getCampaign(campaignId);
    if (!entry) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

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

    const originalName = file.originalname;
    const rawExt = path.extname(originalName).slice(1).toLowerCase();
    const ext = /^[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : 'bin';
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

    await fs.writeFile(outputPath, file.buffer);

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

    await saveAssetManifest(entry.store, manifest);

    // Documents are private to the uploader — push per-user filtered lists.
    broadcastDocuments(campaignId, entry);

    const body: UploadAssetResponse = { asset: manifest };
    res.status(201).json(body);
  },
);

export default router;
