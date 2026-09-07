import path from 'node:path';
import type { NoteEntity, AssetManifest, Chapter, Character } from '@vtt/shared';
import type { CampaignStore } from './loader.js';
import { withCampaignFiles, writeCampaignFile, updateCampaignMemory } from './commit.js';

/**
 * Persist an entity whose `body` lives in a same-basename `.md` sidecar (chapters,
 * characters). The JSON is written without `body` (the loader reads the sidecar
 * and it wins); the sidecar is written when body is non-empty, else removed.
 */
async function writeWithSidecar(
  campaignDir: string,
  dir: string,
  id: string,
  entity: { body?: string },
): Promise<void> {
  const { body, ...rest } = entity;
  await writeCampaignFile(campaignDir, path.join(dir, `${id}.json`), JSON.stringify(rest, null, 2));
  const sidecar = path.join(dir, `${id}.md`);
  if (body && body.trim()) {
    await writeCampaignFile(campaignDir, sidecar, body);
  } else {
    await writeCampaignFile(campaignDir, sidecar, null);
  }
}

export async function saveChapter(store: CampaignStore, chapter: Chapter): Promise<void> {
  await withCampaignFiles(store.dir, async () => {
    await writeWithSidecar(store.dir, path.join(store.dir, 'chapters'), chapter.id, chapter);
    updateCampaignMemory(() => store.chapters.set(chapter.id, chapter));
  });
}

export async function deleteChapter(store: CampaignStore, chapterId: string): Promise<void> {
  await withCampaignFiles(store.dir, async () => {
    const dir = path.join(store.dir, 'chapters');
    for (const f of [`${chapterId}.json`, `${chapterId}.md`]) {
      await writeCampaignFile(store.dir, path.join(dir, f), null);
    }
    updateCampaignMemory(() => store.chapters.delete(chapterId));
  });
}

export async function saveCharacter(store: CampaignStore, character: Character): Promise<void> {
  await withCampaignFiles(store.dir, async () => {
    await writeWithSidecar(store.dir, path.join(store.dir, 'characters'), character.id, character);
    updateCampaignMemory(() => store.characters.set(character.id, character));
  });
}

export async function saveNote(store: CampaignStore, note: NoteEntity): Promise<void> {
  await withCampaignFiles(store.dir, async () => {
    await writeCampaignFile(store.dir, path.join(store.dir, 'notes', `${note.id}.json`), JSON.stringify(note, null, 2));
    updateCampaignMemory(() => store.notes.set(note.id, note));
  });
}

export async function deleteNote(store: CampaignStore, noteId: string): Promise<void> {
  await withCampaignFiles(store.dir, async () => {
    await writeCampaignFile(store.dir, path.join(store.dir, 'notes', `${noteId}.json`), null);
    updateCampaignMemory(() => store.notes.delete(noteId));
  });
}

export async function saveAssetManifest(
  store: CampaignStore,
  manifest: AssetManifest,
): Promise<void> {
  // Derive manifest filename from the binary file's basename.
  const ext = path.extname(manifest.file);
  const base = path.basename(manifest.file, ext);
  const filePath = path.join(store.dir, 'assets', `${base}.json`);
  await withCampaignFiles(store.dir, async () => {
    await writeCampaignFile(store.dir, filePath, JSON.stringify(manifest, null, 2));
    updateCampaignMemory(() => store.assets.set(manifest.id, manifest));
  });
}

export async function deleteAssetFiles(
  store: CampaignStore,
  manifest: AssetManifest,
): Promise<void> {
  const ext = path.extname(manifest.file);
  const base = path.basename(manifest.file, ext);
  const binaryPath = path.join(store.dir, 'assets', manifest.file);
  const manifestPath = path.join(store.dir, 'assets', `${base}.json`);

  await withCampaignFiles(store.dir, async () => {
    for (const file of [binaryPath, manifestPath]) {
      await writeCampaignFile(store.dir, file, null);
    }
    updateCampaignMemory(() => store.assets.delete(manifest.id));
  });
}
