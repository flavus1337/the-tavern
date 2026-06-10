import type { ServerSnapshotPayload, AssetRef, Note } from '@vtt/shared';
import type { WsSession } from './hub.js';
import type { CampaignEntry } from '../campaign/registry.js';
import { config } from '../config.js';
import { getPresenceEntries } from './hub.js';

function makeAssetRef(
  campaignId: string,
  assetId: string,
  entry: CampaignEntry,
): AssetRef | null {
  const manifest = [...entry.store.assets.values()].find((a) => a.id === assetId);
  if (!manifest) return null;
  return {
    assetId: manifest.id,
    url: `${config.PUBLIC_ORIGIN}/api/campaigns/${campaignId}/files/assets/${manifest.file}`,
    title: manifest.title,
    width: manifest.width,
    height: manifest.height,
    sharedAt: new Date().toISOString(),
  };
}

export function buildSnapshot(session: WsSession, entry: CampaignEntry): ServerSnapshotPayload {
  const { store, runtime } = entry;
  const campaignId = store.meta.id;
  const role = session.role!;
  const isDm = role === 'dm';

  // Current image.
  let currentImage: AssetRef | null = null;
  if (runtime.state.currentImageAssetId) {
    currentImage = makeAssetRef(campaignId, runtime.state.currentImageAssetId, entry);
    if (currentImage) {
      currentImage = { ...currentImage, sharedAt: new Date().toISOString() };
    }
  }

  // Presence.
  const presence = getPresenceEntries(campaignId);

  // Roll log: players don't see dm-visibility rolls from others.
  const rollLog = runtime.rollLog.filter((r) => {
    if (r.visibility === 'dm') {
      return isDm || r.userId === session.userId;
    }
    return true;
  });

  // Assets: full list for DM, null for players.
  const assets = isDm
    ? [...store.assets.values()].filter((a) => a.assetKind !== 'document')
    : null;

  // Documents: all members.
  const documents = [...store.assets.values()].filter((a) => a.assetKind === 'document');

  // Notes: DM sees all dm-visibility + own; players see own only.
  const myNotes: Note[] = [];
  for (const note of store.notes.values()) {
    if (isDm) {
      if (note.visibility === 'dm' || note.ownerUsername === session.username) {
        myNotes.push(noteToWire(note));
      }
    } else {
      if (note.ownerUsername === session.username) {
        myNotes.push(noteToWire(note));
      }
    }
  }

  return {
    type: 'snapshot',
    campaign: {
      id: store.meta.id,
      name: store.meta.name,
      description: store.meta.description,
    },
    currentImage,
    presence,
    rollLog,
    assets,
    documents,
    myNotes,
  };
}

function noteToWire(note: {
  id: string;
  title: string;
  body: string;
  visibility: 'dm' | 'player';
  ownerUsername: string | null;
  createdAt: string;
  updatedAt: string;
}): Note {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    visibility: note.visibility,
    ownerUsername: note.ownerUsername,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}
