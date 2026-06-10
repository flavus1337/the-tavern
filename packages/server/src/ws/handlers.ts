import { PROTOCOL_VERSION, randomId, SCHEMA_VERSIONS } from '@vtt/shared';
import type { ClientMessage, ServerMessage, WsErrorCode, BoardItemView } from '@vtt/shared';
import type { WsSession } from './hub.js';
import { send, broadcast, broadcastPresence } from './hub.js';
import { buildSnapshot, makeBoardItemView } from './snapshot.js';
import { broadcastDocuments } from './documents.js';
import { getCampaign } from '../campaign/registry.js';
import { getRole } from '../auth/memberships.js';
import { roll } from '../dice/roller.js';
import { appendRollLog, persistState } from '../campaign/runtime.js';
import { saveNote, deleteNote } from '../campaign/writer.js';
import { log } from '../log.js';
import type { NoteEntity } from '@vtt/shared';

const BOARD_W_MIN = 40;
const BOARD_W_MAX = 8000;

function sendError(
  session: WsSession,
  code: WsErrorCode,
  message: string,
  fatal = false,
): void {
  send(session.ws, { type: 'error', code, message, fatal });
  if (fatal) {
    session.ws.close(1008, code);
  }
}

function broadcastBoardUpdated(campaignId: string, entry: { store: { meta: { id: string }; assets: Map<string, { id: string; file: string; title: string; width: number | null; height: number | null }> }; runtime: { state: { board: Array<{ id: string; assetId: string; x: number; y: number; w: number; z: number }> } } }): void {
  const items: BoardItemView[] = entry.runtime.state.board.map((item) =>
    makeBoardItemView(campaignId, item, entry as Parameters<typeof makeBoardItemView>[2]),
  );
  broadcast(campaignId, { type: 'boardUpdated', items });
}

export async function handleMessage(session: WsSession, raw: unknown): Promise<void> {
  if (typeof raw !== 'object' || raw === null || !('type' in raw)) {
    // Unknown message — ignore.
    return;
  }

  const msg = raw as ClientMessage;

  // Before join, only allow 'join'.
  if (!session.campaignId && msg.type !== 'join') {
    sendError(session, 'NOT_JOINED', 'You must join a campaign first');
    return;
  }

  try {
    switch (msg.type) {
      case 'join':
        await handleJoin(session, msg);
        break;
      case 'roll':
        await handleRoll(session, msg);
        break;
      case 'boardAdd':
        await handleBoardAdd(session, msg);
        break;
      case 'boardMove':
        await handleBoardMove(session, msg);
        break;
      case 'boardRemove':
        await handleBoardRemove(session, msg);
        break;
      case 'boardSetAccess':
        await handleBoardSetAccess(session, msg);
        break;
      case 'setUploadsLocked':
        await handleSetUploadsLocked(session, msg);
        break;
      case 'shareDocument':
        await handleShareDocument(session, msg);
        break;
      case 'saveNote':
        await handleSaveNote(session, msg);
        break;
      case 'deleteNote':
        await handleDeleteNote(session, msg);
        break;
      case 'mediaControl':
        await handleMediaControl(session, msg);
        break;
      case 'ping':
        send(session.ws, { type: 'pong', sentAt: msg.sentAt });
        break;
      default:
        log.warn(`Unknown WS message type from ${session.username}: ${(raw as { type: string }).type}`);
    }
  } catch (err) {
    log.error(`WS handler error: ${String(err)}`);
    sendError(session, 'INTERNAL', 'Internal error');
  }
}

async function handleJoin(
  session: WsSession,
  msg: { type: 'join'; protocolVersion: number; campaignId: string },
): Promise<void> {
  if (msg.protocolVersion !== PROTOCOL_VERSION) {
    sendError(
      session,
      'PROTOCOL_MISMATCH',
      `Protocol version mismatch: server=${PROTOCOL_VERSION}, client=${msg.protocolVersion}`,
      true,
    );
    return;
  }

  const entry = getCampaign(msg.campaignId);
  if (!entry) {
    sendError(session, 'UNKNOWN_CAMPAIGN', `Campaign "${msg.campaignId}" not found`, true);
    return;
  }

  const role = getRole(msg.campaignId, session.userId);
  if (!role) {
    sendError(session, 'NOT_MEMBER', 'You are not a member of this campaign', true);
    return;
  }

  // Bind session to campaign.
  session.campaignId = msg.campaignId;
  session.role = role;
  entry.room.add(session.id);

  // Send joined.
  send(session.ws, {
    type: 'joined',
    userId: session.userId,
    username: session.username,
    role,
    campaignId: msg.campaignId,
    protocolVersion: PROTOCOL_VERSION,
  });

  // Send snapshot.
  send(session.ws, buildSnapshot(session, entry));

  // Broadcast presence to all in room.
  broadcastPresence(msg.campaignId);
}

async function handleRoll(
  session: WsSession,
  msg: { type: 'roll'; requestId: string; expression: string; label?: string; visibility: 'public' | 'dm' },
): Promise<void> {
  if (typeof msg.expression !== 'string' || msg.expression.trim() === '') {
    sendError(session, 'BAD_EXPRESSION', 'expression must be a non-empty string');
    return;
  }

  const result = roll(msg.expression, {
    userId: session.userId,
    username: session.username,
    label: msg.label,
    visibility: msg.visibility,
  });

  if (!result.ok) {
    send(session.ws, {
      type: 'error',
      code: 'BAD_EXPRESSION',
      message: result.error,
      fatal: false,
    });
    return;
  }

  const { entry } = result;
  const campaignId = session.campaignId!;
  const campaignEntry = getCampaign(campaignId);
  if (!campaignEntry) return;

  await appendRollLog(campaignEntry.runtime, entry);

  // Broadcast: dm-visibility rolls go only to DM-role sessions + the roller.
  if (entry.visibility === 'dm') {
    broadcast(campaignId, { type: 'rollResult', entry, requestId: msg.requestId }, (s) => {
      return s.role === 'dm' || s.userId === session.userId;
    });
  } else {
    broadcast(campaignId, { type: 'rollResult', entry, requestId: msg.requestId });
  }
}

async function handleBoardAdd(
  session: WsSession,
  msg: { type: 'boardAdd'; assetId: string; x: number; y: number },
): Promise<void> {
  if (session.role !== 'dm') {
    sendError(session, 'FORBIDDEN', 'Only the DM can add items to the board');
    return;
  }

  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const manifest = entry.store.assets.get(msg.assetId);
  if (!manifest || manifest.assetKind === 'document') {
    sendError(session, 'UNKNOWN_ASSET', `Asset "${msg.assetId}" not found or is not an image`);
    return;
  }

  // w defaults to min(naturalWidth ?? 800, 1200); z = max existing z + 1.
  const naturalW = manifest.width ?? 800;
  const w = Math.min(naturalW, 1200);
  const maxZ = entry.runtime.state.board.reduce((acc, item) => Math.max(acc, item.z), 0);

  const newItem = {
    id: randomId('bi'),
    assetId: msg.assetId,
    x: msg.x,
    y: msg.y,
    w,
    z: maxZ + 1,
  };

  entry.runtime.state = {
    ...entry.runtime.state,
    board: [...entry.runtime.state.board, newItem],
  };
  await persistState(entry.runtime);

  broadcastBoardUpdated(campaignId, entry);
}

async function handleBoardMove(
  session: WsSession,
  msg: { type: 'boardMove'; itemId: string; x: number; y: number; w: number },
): Promise<void> {
  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const idx = entry.runtime.state.board.findIndex((item) => item.id === msg.itemId);
  if (idx === -1) {
    sendError(session, 'UNKNOWN_ITEM', `Board item "${msg.itemId}" not found`);
    return;
  }

  // DM always; players only when the DM unlocked this item for them.
  if (session.role !== 'dm' && !entry.runtime.state.board[idx]!.playersCanMove) {
    sendError(session, 'FORBIDDEN', 'The DM has not unlocked this item for players');
    return;
  }

  // Clamp w to [40, 8000].
  const w = Math.min(BOARD_W_MAX, Math.max(BOARD_W_MIN, msg.w));

  const updated = [...entry.runtime.state.board];
  updated[idx] = { ...updated[idx]!, x: msg.x, y: msg.y, w };
  entry.runtime.state = { ...entry.runtime.state, board: updated };
  await persistState(entry.runtime);

  broadcastBoardUpdated(campaignId, entry);
}

async function handleBoardSetAccess(
  session: WsSession,
  msg: { type: 'boardSetAccess'; itemId: string; playersCanMove: boolean },
): Promise<void> {
  if (session.role !== 'dm') {
    sendError(session, 'FORBIDDEN', 'Only the DM can change item permissions');
    return;
  }

  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const idx = entry.runtime.state.board.findIndex((item) => item.id === msg.itemId);
  if (idx === -1) {
    sendError(session, 'UNKNOWN_ITEM', `Board item "${msg.itemId}" not found`);
    return;
  }

  const updated = [...entry.runtime.state.board];
  updated[idx] = { ...updated[idx]!, playersCanMove: msg.playersCanMove };
  entry.runtime.state = { ...entry.runtime.state, board: updated };
  await persistState(entry.runtime);

  broadcastBoardUpdated(campaignId, entry);
}

async function handleBoardRemove(
  session: WsSession,
  msg: { type: 'boardRemove'; itemId: string },
): Promise<void> {
  if (session.role !== 'dm') {
    sendError(session, 'FORBIDDEN', 'Only the DM can remove board items');
    return;
  }

  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const idx = entry.runtime.state.board.findIndex((item) => item.id === msg.itemId);
  if (idx === -1) {
    sendError(session, 'UNKNOWN_ITEM', `Board item "${msg.itemId}" not found`);
    return;
  }

  entry.runtime.state = {
    ...entry.runtime.state,
    board: entry.runtime.state.board.filter((item) => item.id !== msg.itemId),
  };
  await persistState(entry.runtime);

  broadcastBoardUpdated(campaignId, entry);
}

async function handleSetUploadsLocked(
  session: WsSession,
  msg: { type: 'setUploadsLocked'; locked: boolean },
): Promise<void> {
  if (session.role !== 'dm') {
    sendError(session, 'FORBIDDEN', 'Only the DM can change upload lock');
    return;
  }

  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  entry.runtime.state = { ...entry.runtime.state, uploadsLocked: msg.locked };
  await persistState(entry.runtime);

  broadcast(campaignId, { type: 'settingsUpdated', uploadsLocked: msg.locked });
}

async function handleShareDocument(
  session: WsSession,
  msg: { type: 'shareDocument'; assetId: string },
): Promise<void> {
  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const manifest = entry.store.assets.get(msg.assetId);
  if (!manifest || manifest.assetKind !== 'document') {
    sendError(session, 'UNKNOWN_ASSET', `Document "${msg.assetId}" not found`);
    return;
  }

  // Documents are private to their uploader; only the owner (or DM) may share.
  if (manifest.ownerUsername !== session.username && session.role !== 'dm') {
    sendError(session, 'FORBIDDEN', 'Only the uploader can share this document');
    return;
  }

  // Sharing grants the whole table access until the document is deleted.
  if (!entry.runtime.state.sharedDocumentIds.includes(manifest.id)) {
    entry.runtime.state = {
      ...entry.runtime.state,
      sharedDocumentIds: [...entry.runtime.state.sharedDocumentIds, manifest.id],
    };
    await persistState(entry.runtime);
    broadcastDocuments(campaignId, entry);
  }

  broadcast(campaignId, { type: 'documentShared', asset: manifest, sharedBy: session.username });
}

async function handleSaveNote(
  session: WsSession,
  msg: { type: 'saveNote'; noteId?: string; title: string; body: string; visibility: 'dm' | 'player' | 'shared' },
): Promise<void> {
  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const isDm = session.role === 'dm';

  // Players may keep notes private ('player') or share them with the table
  // ('shared'); only DMs may use the 'dm' visibility.
  if (!isDm && msg.visibility === 'dm') {
    sendError(session, 'FORBIDDEN', 'Players cannot create DM-visibility notes');
    return;
  }
  const visibility = msg.visibility;

  let note: NoteEntity;
  let previousVisibility: NoteEntity['visibility'] | null = null;
  const now = new Date().toISOString();

  if (msg.noteId) {
    const existing = entry.store.notes.get(msg.noteId);
    if (existing) {
      // Updating: check ownership.
      if (!isDm && existing.ownerUsername !== session.username) {
        sendError(session, 'FORBIDDEN', 'You can only edit your own notes');
        return;
      }
      previousVisibility = existing.visibility;
      note = {
        ...existing,
        title: msg.title,
        body: msg.body,
        visibility,
        updatedAt: now,
      };
    } else {
      // New note with explicit id (rare, but handle gracefully).
      note = {
        type: 'note',
        schemaVersion: SCHEMA_VERSIONS.note,
        id: msg.noteId,
        title: msg.title,
        body: msg.body,
        visibility,
        ownerUsername: session.username,
        createdAt: now,
        updatedAt: now,
      };
    }
  } else {
    note = {
      type: 'note',
      schemaVersion: SCHEMA_VERSIONS.note,
      id: randomId('note'),
      title: msg.title,
      body: msg.body,
      visibility,
      ownerUsername: session.username,
      createdAt: now,
      updatedAt: now,
    };
  }

  await saveNote(entry.store, note);

  const wireNote = {
    id: note.id,
    title: note.title,
    body: note.body,
    visibility: note.visibility,
    ownerUsername: note.ownerUsername,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };

  if (note.visibility === 'shared') {
    // Visible to everyone — push the saved note to the whole room.
    broadcast(campaignId, { type: 'noteSaved', note: wireNote });
  } else {
    send(session.ws, { type: 'noteSaved', note: wireNote });
    if (previousVisibility === 'shared') {
      // Unshared — everyone else drops it from their list.
      broadcast(
        campaignId,
        { type: 'noteDeleted', noteId: note.id },
        (s) => s.username !== session.username,
      );
    }
  }
}

async function handleMediaControl(
  session: WsSession,
  msg: { type: 'mediaControl'; assetId: string; action: 'play' | 'pause' | 'stop'; time: number },
): Promise<void> {
  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const manifest = entry.store.assets.get(msg.assetId);
  if (!manifest || !manifest.mime.startsWith('audio/')) {
    sendError(session, 'UNKNOWN_ASSET', `Audio "${msg.assetId}" not found`);
    return;
  }

  // Driving everyone's player is reserved for the track's owner or the DM.
  if (manifest.ownerUsername !== session.username && session.role !== 'dm') {
    sendError(session, 'FORBIDDEN', 'Only the uploader or DM can control playback for the table');
    return;
  }

  const time = Number.isFinite(msg.time) ? Math.max(0, msg.time) : 0;

  // Playing for the table IS sharing: listeners need file access and the doc
  // in their list, so grant table visibility on first play.
  if (msg.action === 'play' && !entry.runtime.state.sharedDocumentIds.includes(manifest.id)) {
    entry.runtime.state = {
      ...entry.runtime.state,
      sharedDocumentIds: [...entry.runtime.state.sharedDocumentIds, manifest.id],
    };
    await persistState(entry.runtime);
    broadcastDocuments(campaignId, entry);
  }

  // Record transient playback state so late joiners sync from the snapshot.
  entry.media = msg.action === 'stop'
    ? null
    : { assetId: msg.assetId, action: msg.action, time, atMs: Date.now() };

  broadcast(
    campaignId,
    { type: 'mediaControl', assetId: msg.assetId, action: msg.action, time, by: session.username },
    (s) => s !== session,
  );
}

async function handleDeleteNote(
  session: WsSession,
  msg: { type: 'deleteNote'; noteId: string },
): Promise<void> {
  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const existing = entry.store.notes.get(msg.noteId);
  if (!existing) {
    sendError(session, 'UNKNOWN_NOTE', `Note "${msg.noteId}" not found`);
    return;
  }

  // Same ownership rule as editing: owner, or the DM.
  if (session.role !== 'dm' && existing.ownerUsername !== session.username) {
    sendError(session, 'FORBIDDEN', 'You can only delete your own notes');
    return;
  }

  await deleteNote(entry.store, msg.noteId);

  // Broadcast to the room — anyone whose list contains the note drops it;
  // clients simply ignore ids they don't have.
  broadcast(campaignId, { type: 'noteDeleted', noteId: msg.noteId });
}
