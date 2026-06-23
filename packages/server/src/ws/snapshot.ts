import type { ServerSnapshotPayload, BoardItemView, Note, NoteEntity, ChapterView, CharacterView, Character, TokenView, GridState, MemberEntry, MapPiece } from '@vtt/shared';
import type { WsSession } from './hub.js';
import type { CampaignEntry } from '../campaign/registry.js';
import type { CampaignStore } from '../campaign/loader.js';
import type { Token } from '../campaign/runtime.js';
import { config } from '../config.js';
import { getPresenceEntries } from './hub.js';
import { visibleDocuments } from './documents.js';
import { canAccessShared } from './sharing.js';
import { listForCampaign } from '../auth/memberships.js';
import { findUserById } from '../auth/users.js';

function makeBoardItemView(
  campaignId: string,
  item: { id: string; assetId: string; x: number; y: number; w: number; z: number; playersCanMove?: boolean },
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
    playersCanMove: item.playersCanMove ?? false,
    url: `/api/campaigns/${campaignId}/files/assets/${manifest?.file ?? ''}`,
    title: manifest?.title ?? '',
    naturalWidth: manifest?.width ?? null,
    naturalHeight: manifest?.height ?? null,
  };
}

function makeTokenView(campaignId: string, token: Token, entry: CampaignEntry): TokenView {
  let imageUrl: string | null = null;
  if (token.assetId) {
    const manifest = entry.store.assets.get(token.assetId);
    if (manifest) {
      imageUrl = `/api/campaigns/${campaignId}/files/assets/${manifest.file}`;
    }
  }
  return {
    id: token.id,
    name: token.name,
    shape: token.shape,
    allegiance: token.allegiance,
    ownerUserId: token.ownerUserId,
    size: token.size,
    x: token.x,
    y: token.y,
    z: token.z,
    imageUrl,
    fill: token.fill,
    hp: token.hp,
    maxHp: token.maxHp,
    dmOnly: token.dmOnly,
    sharing: token.sharing,
    conditions: token.conditions ?? [],
    statBlock: token.statBlock ?? null,
  };
}

/** Stat blocks are visible to the DM always, and to a player only for tokens
 *  they own. Everyone else receives statBlock: null. (Conditions stay visible.) */
export function redactStatBlock(view: TokenView, isDm: boolean, viewerUserId: string | null): TokenView {
  if (isDm || (view.ownerUserId !== null && view.ownerUserId === viewerUserId)) return view;
  return view.statBlock === null ? view : { ...view, statBlock: null };
}

/** Resolve an asset-backed piece's image url; builtin pieces carry no url. */
function makePieceView(campaignId: string, piece: MapPiece, entry: CampaignEntry): MapPiece {
  if (!piece.assetId) return { ...piece, imageUrl: null };
  const manifest = entry.store.assets.get(piece.assetId);
  return {
    ...piece,
    imageUrl: manifest ? `/api/campaigns/${campaignId}/files/assets/${manifest.file}` : null,
  };
}

export { makePieceView };

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

  const viewer = { userId: session.userId, username: session.username, role };

  // Documents: own + shared-with-me (DM omniscient).
  const documents = visibleDocuments(entry, viewer);

  // Notes: own + shared-with-me (DM omniscient).
  const myNotes: Note[] = [];
  for (const note of store.notes.values()) {
    if (canAccessShared(viewer, note.ownerUsername, note.sharing)) {
      myNotes.push(noteToWire(note));
    }
  }

  // Chapters & characters: DM-only prep. Players get none.
  const chapters: ChapterView[] = isDm ? chapterViews(store) : [];
  const characters: CharacterView[] = isDm ? characterViews(store) : [];

  // Tokens: DM sees all; players only see non-dmOnly tokens, and stat blocks
  // are redacted to the ones they own.
  const tokens: TokenView[] = runtime.state.tokens
    .filter((t) => isDm || !t.dmOnly)
    .map((t) => redactStatBlock(makeTokenView(campaignId, t, entry), isDm, session.userId));

  // Grid state (same for everyone — unit is table-wide display).
  const grid: GridState = runtime.state.grid;

  // All members (online or not) — powers share pickers + owner dropdowns.
  const members: MemberEntry[] = listForCampaign(campaignId).map((m) => ({
    userId: m.userId,
    username: findUserById(m.userId)?.username ?? m.userId,
    role: m.role,
  }));

  return {
    type: 'snapshot',
    campaign: {
      id: store.meta.id,
      name: store.meta.name,
      description: store.meta.description,
    },
    board,
    uploadsLocked: runtime.state.uploadsLocked,
    mapLocked: runtime.state.mapLocked,
    presence,
    members,
    rollLog,
    assets,
    documents,
    myNotes,
    chapters,
    characters,
    media: entry.media
      ? {
          assetId: entry.media.assetId,
          action: entry.media.action,
          time: entry.media.time,
          elapsedMs: Date.now() - entry.media.atMs,
        }
      : null,
    tokens,
    grid,
    pieces: runtime.state.pieces.map((p) => makePieceView(campaignId, p, entry)),
    aoes: runtime.state.aoes,
    initiative: runtime.state.initiative,
    mapMeta: runtime.state.mapMeta,
    features: { imageGenEnabled: config.LLM_API_KEY != null },
    templates: runtime.state.mapTemplates.map((t) => ({ id: t.id, name: t.name, createdAt: t.createdAt })),
  };
}

export { makeBoardItemView, makeTokenView };

function characterToWire(c: Character): CharacterView {
  return {
    id: c.id,
    name: c.name,
    tags: c.tags,
    portraitAssetId: c.portraitAssetId ?? null,
    cr: c.statBlock?.cr,
  };
}

/** Ordered chapter views — shared by the snapshot and chaptersUpdated broadcasts. */
export function chapterViews(store: CampaignStore): ChapterView[] {
  return [...store.chapters.values()]
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ id: c.id, title: c.title, order: c.order, summary: c.summary, body: c.body }));
}

/** Character views — shared by the snapshot and charactersUpdated broadcasts. */
export function characterViews(store: CampaignStore): CharacterView[] {
  return [...store.characters.values()].map(characterToWire);
}

export function noteToWire(note: NoteEntity): Note {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    sharing: note.sharing,
    ownerUsername: note.ownerUsername,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    tags: note.tags,
    noteKind: note.noteKind,
  };
}
