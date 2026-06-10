import type { ServerSnapshotPayload, BoardItemView, Note } from '@vtt/shared';
import type { WsSession } from './hub.js';
import type { CampaignEntry } from '../campaign/registry.js';
import { getPresenceEntries } from './hub.js';
import { visibleDocuments } from './documents.js';

function makeBoardItemView(
  campaignId: string,
  item: { id: string; assetId: string; x: number; y: number; w: number; z: number },
  entry: CampaignEntry,
): BoardItemView {
  const manifest = entry.store.assets.get(item.assetId);
  return {
    id: item.id,
    assetId: item.assetId,
    x: item.x,
    y: item.y,
    w: item.w,
    z: item.z,
    url: `/api/campaigns/${campaignId}/files/assets/${manifest?.file ?? ''}`,
    title: manifest?.title ?? '',
    naturalWidth: manifest?.width ?? null,
    naturalHeight: manifest?.height ?? null,
  };
}

export function buildSnapshot(session: WsSession, entry: CampaignEntry): ServerSnapshotPayload {
  const { store, runtime } = entry;
  const campaignId = store.meta.id;
  const role = session.role!;
  const isDm = role === 'dm';

  // Board items.
  const board: BoardItemView[] = runtime.state.board.map((item) =>
    makeBoardItemView(campaignId, item, entry),
  );

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
  const documents = visibleDocuments(entry, session.username);

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
    board,
    uploadsLocked: runtime.state.uploadsLocked,
    presence,
    rollLog,
    assets,
    documents,
    myNotes,
  };
}

export { makeBoardItemView };

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
