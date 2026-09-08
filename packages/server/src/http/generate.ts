import { Router, json } from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import { processImage } from '../services/image-processing.js';
import { assetRoute, canSaveAsset, checkAssetCapacity, syncAssetFile } from './assetWork.js';
import { param } from './params.js';
import { requireMember } from '../auth/middleware.js';
import { getCampaign } from '../campaign/registry.js';
import { saveAssetManifest } from '../campaign/writer.js';
import { mutateCampaign, writeCampaignFile } from '../campaign/commit.js';
import { validateBody, validateId } from './validate.js';
import { object, text, oneOf } from '@vtt/shared';
import { broadcast } from '../ws/hub.js';
import { config } from '../config.js';
import { generateImages, type GenKind } from '../services/imagegen.js';
import { randomId, slugify, SCHEMA_VERSIONS } from '@vtt/shared';
import type { AssetManifest, UploadAssetResponse } from '@vtt/shared';

const router = Router();
router.param('id', validateId);
// Generated/uploaded images arrive as base64 JSON — allow a larger body here
// than the global 1 MB limit (this parser is scoped to these routes only).
const bigJson = json({ limit: '20mb' });
const TAKES = 4;

function parseKind(v: unknown): GenKind {
  return v === 'prop' ? 'prop' : 'background';
}

// POST /api/campaigns/:id/generate — DM only. Returns N candidate images as
// base64 (transient; the client holds them and saves the chosen one).
router.post('/:id/generate', requireMember('dm'), assetRoute(json({ limit: '8kb' }), async (req: Request, res: Response, work) => {
  validateBody(req.body, object({ subject: text(2000, 1) }, { kind: oneOf(['prop', 'background']) }));
  if (!config.LLM_API_KEY) {
    res.status(503).json({ error: 'Image generation is off — no LLM_API_KEY configured', code: 'GEN_DISABLED' });
    return;
  }
  const { subject, kind } = req.body as { subject?: string; kind?: string };
  if (!subject || subject.trim() === '') {
    res.status(400).json({ error: 'A subject/prompt is required' });
    return;
  }
  try {
    const images = await generateImages(parseKind(kind), subject.trim(), TAKES, work.signal);
    res.json({ images });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? 'GEN_ERROR';
    res.status(502).json({ error: (err as Error).message ?? 'Generation failed', code });
  }
}));

// POST /api/campaigns/:id/generate/save — DM only. Persist a chosen candidate
// (or an uploaded data URL) as a campaign asset and return its manifest.
router.post('/:id/generate/save', requireMember('dm'), checkAssetCapacity(true), assetRoute(bigJson, async (req: Request, res: Response, work) => {
  const campaignId = param(req.params['id']);
  const entry = getCampaign(campaignId);
  if (!entry) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }
  validateBody(req.body, object({ base64: text(20_000_000, 1) }, { kind: oneOf(['prop', 'background']), title: text(200), category: text(40) }));
  const { base64, kind, title, category } = req.body as { base64?: string; kind?: string; title?: string; category?: string };
  if (!base64) {
    res.status(400).json({ error: 'base64 image data is required' });
    return;
  }
  const genKind = parseKind(kind);
  // Strip an optional data: URL prefix.
  const raw = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 !== 0) {
    res.status(400).json({ error: 'Invalid base64' });
    return;
  }
  const baseName = (title && title.trim()) || (genKind === 'prop' ? 'prop' : 'map');
  const slug = slugify(baseName);
  const outputFilename = `${slug}-${randomId().slice(0, 8)}.webp`;
  const outputPath = path.join(entry.store.dir, 'assets', outputFilename);

  const processedPath = path.join(work.dir, 'processed.webp');
  let width: number, height: number;
  try {
    ({ width, height } = await processImage({ base64: raw, outputPath: processedPath, transparent: genKind === 'prop', quality: 86 }, work.signal));
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
    assetKind: genKind === 'prop' ? 'token' : 'map',
    tags: ['generated'],
    dmOnly: false,
    width,
    height,
    mime: 'image/webp',
    ownerUsername: req.user!.username,
    ...(genKind === 'prop' && typeof category === 'string' && category.trim() ? { category: category.trim().slice(0, 40) } : {}),
  };
  await syncAssetFile(processedPath, work.signal);
  const saved = await mutateCampaign(entry, async (draft) => {
    work.signal.throwIfAborted();
    if (!canSaveAsset(req, res, draft, true)) return false;
    await writeCampaignFile(draft.store.dir, outputPath, { sourcePath: processedPath });
    await saveAssetManifest(draft.store, manifest);
    const assets = [...draft.store.assets.values()].filter((a) => a.assetKind !== 'document');
    broadcast(campaignId, { type: 'assetsUpdated', assets }, (s) => s.role === 'dm');
    return true;
  });
  if (!saved) return;

  const body: UploadAssetResponse = { asset: manifest };
  res.status(201).json(body);
}));

export default router;
