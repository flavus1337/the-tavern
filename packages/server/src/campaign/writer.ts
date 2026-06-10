import fs from 'node:fs/promises';
import path from 'node:path';
import type { NoteEntity, AssetManifest } from '@vtt/shared';
import type { CampaignStore } from './loader.js';

async function writeAtomic(filePath: string, content: string): Promise<void> {
  const tmpPath = filePath + '.tmp';
  await fs.writeFile(tmpPath, content, 'utf8');
  await fs.rename(tmpPath, filePath);
}

export async function saveNote(store: CampaignStore, note: NoteEntity): Promise<void> {
  const filePath = path.join(store.dir, 'notes', `${note.id}.json`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeAtomic(filePath, JSON.stringify(note, null, 2));
  store.notes.set(note.id, note);
}

export async function saveAssetManifest(
  store: CampaignStore,
  manifest: AssetManifest,
): Promise<void> {
  // Derive manifest filename from the binary file's basename.
  const ext = path.extname(manifest.file);
  const base = path.basename(manifest.file, ext);
  const filePath = path.join(store.dir, 'assets', `${base}.json`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeAtomic(filePath, JSON.stringify(manifest, null, 2));
  store.assets.set(manifest.id, manifest);
}

export async function deleteAssetFiles(
  store: CampaignStore,
  manifest: AssetManifest,
): Promise<void> {
  const ext = path.extname(manifest.file);
  const base = path.basename(manifest.file, ext);
  const binaryPath = path.join(store.dir, 'assets', manifest.file);
  const manifestPath = path.join(store.dir, 'assets', `${base}.json`);

  for (const p of [binaryPath, manifestPath]) {
    try {
      await fs.unlink(p);
    } catch {
      // Best-effort.
    }
  }

  store.assets.delete(manifest.id);
}
