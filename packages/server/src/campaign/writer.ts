import fs from 'node:fs/promises';
import path from 'node:path';
import type { NoteEntity, AssetManifest, Chapter, Character } from '@vtt/shared';
import type { CampaignStore } from './loader.js';

async function writeAtomic(filePath: string, content: string): Promise<void> {
  const tmpPath = filePath + '.tmp';
  await fs.writeFile(tmpPath, content, 'utf8');
  await fs.rename(tmpPath, filePath);
}

/**
 * Persist an entity whose `body` lives in a same-basename `.md` sidecar (chapters,
 * characters). The JSON is written without `body` (the loader reads the sidecar
 * and it wins); the sidecar is written when body is non-empty, else removed.
 */
async function writeWithSidecar(
  dir: string,
  id: string,
  entity: { body?: string },
): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const { body, ...rest } = entity;
  await writeAtomic(path.join(dir, `${id}.json`), JSON.stringify(rest, null, 2));
  const sidecar = path.join(dir, `${id}.md`);
  if (body && body.trim()) {
    await writeAtomic(sidecar, body);
  } else {
    await fs.unlink(sidecar).catch(() => {});
  }
}

export async function saveChapter(store: CampaignStore, chapter: Chapter): Promise<void> {
  await writeWithSidecar(path.join(store.dir, 'chapters'), chapter.id, chapter);
  store.chapters.set(chapter.id, chapter);
}

export async function deleteChapter(store: CampaignStore, chapterId: string): Promise<void> {
  const dir = path.join(store.dir, 'chapters');
  for (const f of [`${chapterId}.json`, `${chapterId}.md`]) {
    await fs.unlink(path.join(dir, f)).catch(() => {});
  }
  store.chapters.delete(chapterId);
}

export async function saveCharacter(store: CampaignStore, character: Character): Promise<void> {
  await writeWithSidecar(path.join(store.dir, 'characters'), character.id, character);
  store.characters.set(character.id, character);
}

export async function saveNote(store: CampaignStore, note: NoteEntity): Promise<void> {
  const filePath = path.join(store.dir, 'notes', `${note.id}.json`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeAtomic(filePath, JSON.stringify(note, null, 2));
  store.notes.set(note.id, note);
}

export async function deleteNote(store: CampaignStore, noteId: string): Promise<void> {
  const filePath = path.join(store.dir, 'notes', `${noteId}.json`);
  try {
    await fs.unlink(filePath);
  } catch {
    // Best-effort — the in-memory removal below is authoritative for the session.
  }
  store.notes.delete(noteId);
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
