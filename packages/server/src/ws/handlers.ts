import { PROTOCOL_VERSION, randomId, SCHEMA_VERSIONS } from '@vtt/shared';
import type { ClientMessage, ServerMessage, WsErrorCode } from '@vtt/shared';
import type { WsSession } from './hub.js';
import { send, broadcast, broadcastPresence } from './hub.js';
import { buildSnapshot } from './snapshot.js';
import { broadcastDocuments } from './documents.js';
import { getCampaign } from '../campaign/registry.js';
import { getRole } from '../auth/memberships.js';
import { roll } from '../dice/roller.js';
import { appendRollLog, persistState } from '../campaign/runtime.js';
import { saveNote, deleteNote } from '../campaign/writer.js';
import { log } from '../log.js';
import { config } from '../config.js';
import type { NoteEntity } from '@vtt/shared';

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
      case 'shareImage':
        await handleShareImage(session, msg);
        break;
      case 'clearImage':
        await handleClearImage(session, msg);
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
    // Include requestId context in a separate message (the error above has no requestId field per spec).
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

async function handleShareImage(
  session: WsSession,
  msg: { type: 'shareImage'; assetId: string },
): Promise<void> {
  if (session.role !== 'dm') {
    sendError(session, 'FORBIDDEN', 'Only the DM can share images');
    return;
  }

  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const manifest = entry.store.assets.get(msg.assetId);
  if (!manifest) {
    sendError(session, 'UNKNOWN_ASSET', `Asset "${msg.assetId}" not found`);
    return;
  }

  entry.runtime.state = { ...entry.runtime.state, currentImageAssetId: msg.assetId };
  await persistState(entry.runtime);

  const assetRef = {
    assetId: manifest.id,
    url: `/api/campaigns/${campaignId}/files/assets/${manifest.file}`,
    title: manifest.title,
    width: manifest.width,
    height: manifest.height,
    sharedAt: new Date().toISOString(),
  };

  broadcast(campaignId, { type: 'imageShared', asset: assetRef });
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

async function handleClearImage(session: WsSession, _msg: { type: 'clearImage' }): Promise<void> {
  if (session.role !== 'dm') {
    sendError(session, 'FORBIDDEN', 'Only the DM can clear the image');
    return;
  }

  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  entry.runtime.state = { ...entry.runtime.state, currentImageAssetId: null };
  await persistState(entry.runtime);

  broadcast(campaignId, { type: 'imageShared', asset: null });
}

async function handleSaveNote(
  session: WsSession,
  msg: { type: 'saveNote'; noteId?: string; title: string; body: string; visibility: 'dm' | 'player' },
): Promise<void> {
  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const isDm = session.role === 'dm';

  // Players may only save visibility='player' notes owned by themselves.
  if (!isDm) {
    if (msg.visibility !== 'player') {
      sendError(session, 'FORBIDDEN', 'Players can only create player-visibility notes');
      return;
    }
  }

  let note: NoteEntity;
  const now = new Date().toISOString();

  if (msg.noteId) {
    const existing = entry.store.notes.get(msg.noteId);
    if (existing) {
      // Updating: check ownership.
      if (!isDm && existing.ownerUsername !== session.username) {
        sendError(session, 'FORBIDDEN', 'You can only edit your own notes');
        return;
      }
      note = {
        ...existing,
        title: msg.title,
        body: msg.body,
        visibility: isDm ? msg.visibility : 'player',
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
        visibility: isDm ? msg.visibility : 'player',
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
      visibility: isDm ? msg.visibility : 'player',
      ownerUsername: session.username,
      createdAt: now,
      updatedAt: now,
    };
  }

  await saveNote(entry.store, note);

  // Send noteSaved only to the author.
  send(session.ws, {
    type: 'noteSaved',
    note: {
      id: note.id,
      title: note.title,
      body: note.body,
      visibility: note.visibility,
      ownerUsername: note.ownerUsername,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    },
  });
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
