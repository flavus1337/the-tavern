import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { parseEntity, randomId, SCHEMA_VERSIONS } from '@vtt/shared';
import type {
  CampaignMeta,
  Chapter,
  Character,
  NoteEntity,
  AssetManifest,
} from '@vtt/shared';
import { log } from '../log.js';

export interface CampaignStore {
  meta: CampaignMeta;
  chapters: Map<string, Chapter>;
  characters: Map<string, Character>;
  notes: Map<string, NoteEntity>;
  assets: Map<string, AssetManifest>;
  /** Campaign folder absolute path */
  dir: string;
}

async function tryReadJson(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function tryReadText(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function probeDimensions(
  filePath: string,
): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await sharp(filePath).metadata();
    if (meta.width != null && meta.height != null) {
      return { width: meta.width, height: meta.height };
    }
    return null;
  } catch {
    return null;
  }
}

function mimeForExt(ext: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  return map[ext.toLowerCase()] ?? 'application/octet-stream';
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const PDF_EXT = '.pdf';

export async function loadCampaign(campaignDir: string): Promise<CampaignStore | null> {
  const campaignJsonPath = path.join(campaignDir, 'campaign.json');
  const rawCampaign = await tryReadJson(campaignJsonPath);
  if (!rawCampaign) {
    log.warn(`Could not read campaign.json in ${campaignDir}`);
    return null;
  }

  const parsedCampaign = parseEntity('campaign', rawCampaign);
  if (!parsedCampaign.ok) {
    log.warn(`Invalid campaign.json in ${campaignDir}: ${parsedCampaign.reason}`);
    return null;
  }

  const meta = parsedCampaign.entity as CampaignMeta;
  const store: CampaignStore = {
    meta,
    chapters: new Map(),
    characters: new Map(),
    notes: new Map(),
    assets: new Map(),
    dir: campaignDir,
  };

  // Load chapters.
  const chaptersDir = path.join(campaignDir, 'chapters');
  await loadEntities(chaptersDir, 'chapter', store.chapters as Map<string, Chapter>, true);

  // Load characters.
  const charactersDir = path.join(campaignDir, 'characters');
  await loadEntities(
    charactersDir,
    'character',
    store.characters as Map<string, Character>,
    true,
  );

  // Load notes.
  const notesDir = path.join(campaignDir, 'notes');
  await loadEntities(notesDir, 'note', store.notes as Map<string, NoteEntity>, false);

  // Load assets — parse manifests + auto-register missing ones.
  const assetsDir = path.join(campaignDir, 'assets');
  await loadAssets(assetsDir, store, campaignDir);

  return store;
}

async function loadEntities<T extends { id: string; body?: string }>(
  dir: string,
  entityType: string,
  target: Map<string, T>,
  hasSidecar: boolean,
): Promise<void> {
  try {
    const entries = await fs.readdir(dir);
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const filePath = path.join(dir, entry);
      const raw = await tryReadJson(filePath);
      if (!raw) {
        log.warn(`Skipping unreadable file: ${filePath}`);
        continue;
      }

      const parsed = parseEntity(entityType as Parameters<typeof parseEntity>[0], raw);
      if (!parsed.ok) {
        log.warn(`Skipping malformed ${entityType} at ${filePath}: ${parsed.reason}`);
        continue;
      }

      let entity = parsed.entity as unknown as T;

      // Load sidecar markdown if applicable.
      if (hasSidecar) {
        const basename = entry.slice(0, -5); // remove .json
        const sidecarPath = path.join(dir, basename + '.md');
        const sidecarBody = await tryReadText(sidecarPath);
        if (sidecarBody !== null) {
          entity = { ...entity, body: sidecarBody };
        }
      }

      target.set(entity.id, entity);
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn(`Error reading ${dir}: ${String(err)}`);
    }
  }
}

async function loadAssets(
  assetsDir: string,
  store: CampaignStore,
  campaignDir: string,
): Promise<void> {
  // Maps from file basename → manifest (for assets that already have manifests).
  const manifestsByFile = new Map<string, AssetManifest>();

  let entries: string[] = [];
  try {
    entries = await fs.readdir(assetsDir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn(`Error reading assets dir ${assetsDir}: ${String(err)}`);
    }
    return;
  }

  // First pass: collect manifests (.json files).
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const filePath = path.join(assetsDir, entry);
    const raw = await tryReadJson(filePath);
    if (!raw) continue;

    const parsed = parseEntity('asset', raw);
    if (!parsed.ok) {
      log.warn(`Skipping malformed asset manifest at ${filePath}: ${parsed.reason}`);
      continue;
    }

    const manifest = parsed.entity as AssetManifest;
    store.assets.set(manifest.id, manifest);
    manifestsByFile.set(manifest.file, manifest);
  }

  // Second pass: auto-register binary files without manifests.
  for (const entry of entries) {
    const ext = path.extname(entry).toLowerCase();
    if (IMAGE_EXTS.has(ext)) {
      if (!manifestsByFile.has(entry)) {
        const filePath = path.join(assetsDir, entry);
        const dims = await probeDimensions(filePath);
        const title = path.basename(entry, ext).replace(/[-_]/g, ' ');
        const manifest: AssetManifest = {
          type: 'asset',
          schemaVersion: SCHEMA_VERSIONS.asset,
          id: randomId('ast'),
          file: entry,
          title,
          assetKind: 'art',
          tags: [],
          dmOnly: false,
          width: dims?.width ?? null,
          height: dims?.height ?? null,
          mime: mimeForExt(ext),
          ownerUsername: null,
        };
        // Write manifest.
        const manifestPath = path.join(assetsDir, path.basename(entry, ext) + '.json');
        try {
          await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
        } catch (err) {
          log.warn(`Could not write auto-manifest for ${entry}: ${String(err)}`);
        }
        store.assets.set(manifest.id, manifest);
        manifestsByFile.set(entry, manifest);
      }
    } else if (ext === PDF_EXT) {
      if (!manifestsByFile.has(entry)) {
        const title = path.basename(entry, ext).replace(/[-_]/g, ' ');
        const manifest: AssetManifest = {
          type: 'asset',
          schemaVersion: SCHEMA_VERSIONS.asset,
          id: randomId('ast'),
          file: entry,
          title,
          assetKind: 'document',
          tags: [],
          dmOnly: false,
          width: null,
          height: null,
          mime: 'application/pdf',
          ownerUsername: null,
        };
        const manifestPath = path.join(assetsDir, path.basename(entry, ext) + '.json');
        try {
          await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
        } catch (err) {
          log.warn(`Could not write auto-manifest for ${entry}: ${String(err)}`);
        }
        store.assets.set(manifest.id, manifest);
        manifestsByFile.set(entry, manifest);
      }
    }
  }
}
