import { Router, json } from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import sharp from 'sharp';
import { param } from './params.js';
import { requireMember } from '../auth/middleware.js';
import { getCampaign } from '../campaign/registry.js';
import { saveAssetManifest } from '../campaign/writer.js';
import { broadcast } from '../ws/hub.js';
import { config } from '../config.js';
import { generateImages, type GenKind } from '../services/imagegen.js';
import { randomId, slugify, SCHEMA_VERSIONS } from '@vtt/shared';
import type { AssetManifest, UploadAssetResponse } from '@vtt/shared';

const router = Router();
// Generated/uploaded images arrive as base64 JSON — allow a larger body here
// than the global 1 MB limit (this parser is scoped to these routes only).
const bigJson = json({ limit: '20mb' });
const MAX_DIMENSION = 2560;
const MAX_ASSETS_PER_CAMPAIGN = 1000;
const TAKES = 4;

function parseKind(v: unknown): GenKind {
  return v === 'prop' ? 'prop' : 'background';
}

/**
 * Make a prop's background transparent. The model often returns an opaque
 * (white) background; we flood-fill inward from the edges, clearing every pixel
 * that matches the corner colour, so the subject stays intact. Returns a PNG.
 */
async function makeBackgroundTransparent(buf: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const px = data; // RGBA, length w*h*4
  // Seed background colour = average of the four corners.
  const corner = (x: number, y: number) => (y * w + x) * 4;
  const cs = [corner(0, 0), corner(w - 1, 0), corner(0, h - 1), corner(w - 1, h - 1)];
  let br = 0, bg = 0, bb = 0;
  for (const c of cs) { br += px[c]!; bg += px[c + 1]!; bb += px[c + 2]!; }
  br /= 4; bg /= 4; bb /= 4;

  const TOL = 100;
  const visited = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + (w - 1)); }
  while (stack.length) {
    const p = stack.pop()!;
    if (visited[p]) continue;
    const o = p * 4;
    if (Math.abs(px[o]! - br) + Math.abs(px[o + 1]! - bg) + Math.abs(px[o + 2]! - bb) > TOL) continue;
    visited[p] = 1;
    px[o + 3] = 0; // transparent
    const x = p % w, y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  return sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

// POST /api/campaigns/:id/generate — DM only. Returns N candidate images as
// base64 (transient; the client holds them and saves the chosen one).
router.post('/:id/generate', bigJson, requireMember('dm'), async (req: Request, res: Response) => {
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
    const images = await generateImages(parseKind(kind), subject.trim(), TAKES);
    res.json({ images });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? 'GEN_ERROR';
    res.status(502).json({ error: (err as Error).message ?? 'Generation failed', code });
  }
});

// POST /api/campaigns/:id/generate/save — DM only. Persist a chosen candidate
// (or an uploaded data URL) as a campaign asset and return its manifest.
router.post('/:id/generate/save', bigJson, requireMember('dm'), async (req: Request, res: Response) => {
  const campaignId = param(req.params['id']);
  const entry = getCampaign(campaignId);
  if (!entry) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }
  if (entry.store.assets.size >= MAX_ASSETS_PER_CAMPAIGN) {
    res.status(413).json({ error: 'Campaign asset limit reached', code: 'ASSET_LIMIT' });
    return;
  }

  const { base64, kind, title, category } = req.body as { base64?: string; kind?: string; title?: string; category?: string };
  if (!base64) {
    res.status(400).json({ error: 'base64 image data is required' });
    return;
  }
  const genKind = parseKind(kind);
  // Strip an optional data: URL prefix.
  const raw = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, 'base64');
  } catch {
    res.status(400).json({ error: 'Invalid base64' });
    return;
  }

  const baseName = (title && title.trim()) || (genKind === 'prop' ? 'prop' : 'map');
  const slug = slugify(baseName);
  const outputFilename = `${slug}-${randomId().slice(0, 8)}.webp`;
  const outputPath = path.join(entry.store.dir, 'assets', outputFilename);

  let width: number, height: number;
  try {
    // Props get their background flood-filled to transparent (cut-out); maps stay opaque.
    const src = genKind === 'prop' ? await makeBackgroundTransparent(buf) : buf;
    const img = sharp(src).resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true });
    const info = await img.webp({ quality: 86, alphaQuality: 90 }).toFile(outputPath);
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
    assetKind: genKind === 'prop' ? 'token' : 'map',
    tags: ['generated'],
    dmOnly: false,
    width,
    height,
    mime: 'image/webp',
    ownerUsername: req.user!.username,
    ...(genKind === 'prop' && typeof category === 'string' && category.trim() ? { category: category.trim().slice(0, 40) } : {}),
  };
  await saveAssetManifest(entry.store, manifest);

  // Refresh the DM's asset list so the new prop/background shows in the palette.
  const assets = [...entry.store.assets.values()].filter((a) => a.assetKind !== 'document');
  broadcast(campaignId, { type: 'assetsUpdated', assets }, (s) => s.role === 'dm');

  const body: UploadAssetResponse = { asset: manifest };
  res.status(201).json(body);
});

export default router;
