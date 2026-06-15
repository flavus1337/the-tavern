import { PROTOCOL_VERSION, randomId, SCHEMA_VERSIONS, parseSharing, defaultSharing } from '@vtt/shared';
import type {
  ClientMessage,
  WsErrorCode,
  BoardItemView,
  TokenView,
  GridState,
  Sharing,
  MapPiece,
  MapMeta,
} from '@vtt/shared';
import type { WsSession } from './hub.js';
import { send, broadcast, broadcastPresence, getSessionsInRoom } from './hub.js';
import { buildSnapshot, makeBoardItemView, makeTokenView, makePieceView } from './snapshot.js';
import { broadcastDocuments } from './documents.js';
import { canAccessShared, canControlToken, documentSharing, type Viewer } from './sharing.js';
import { getCampaign } from '../campaign/registry.js';
import { getRole } from '../auth/memberships.js';
import { roll } from '../dice/roller.js';
import { appendRollLog, persistState } from '../campaign/runtime.js';
import type { Token, MapTemplate } from '../campaign/runtime.js';
import { saveNote, deleteNote, saveAssetManifest } from '../campaign/writer.js';
import { log } from '../log.js';
import type { NoteEntity } from '@vtt/shared';

function viewerOf(session: WsSession): Viewer {
  return { userId: session.userId, username: session.username, role: session.role! };
}

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

/** Broadcast tokensUpdated to each session, filtering dmOnly tokens for non-DM. */
function broadcastTokensUpdated(
  campaignId: string,
  entry: Parameters<typeof makeTokenView>[2] & { runtime: { state: { tokens: Token[] } } },
): void {
  const allViews: TokenView[] = entry.runtime.state.tokens.map((t) =>
    makeTokenView(campaignId, t, entry),
  );
  for (const sess of getSessionsInRoom(campaignId)) {
    const isDm = sess.role === 'dm';
    const tokens: TokenView[] = isDm ? allViews : allViews.filter((tv) => !tv.dmOnly);
    send(sess.ws, { type: 'tokensUpdated', tokens });
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
      case 'setDocumentSharing':
        await handleSetDocumentSharing(session, msg);
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
      case 'tokenAdd':
        await handleTokenAdd(session, msg);
        break;
      case 'tokenMove':
        await handleTokenMove(session, msg);
        break;
      case 'tokenUpdate':
        await handleTokenUpdate(session, msg);
        break;
      case 'tokenRemove':
        await handleTokenRemove(session, msg);
        break;
      case 'setGrid':
        await handleSetGrid(session, msg);
        break;
      case 'measure':
        await handleMeasure(session, msg);
        break;
      case 'pieceAdd':
        await handlePieceAdd(session, msg);
        break;
      case 'pieceMove':
        await handlePieceMove(session, msg);
        break;
      case 'pieceUpdate':
        await handlePieceUpdate(session, msg);
        break;
      case 'pieceRemove':
        await handlePieceRemove(session, msg);
        break;
      case 'setMapMeta':
        await handleSetMapMeta(session, msg);
        break;
      case 'saveMapTemplate':
        await handleSaveMapTemplate(session, msg);
        break;
      case 'loadMapTemplate':
        await handleLoadMapTemplate(session, msg);
        break;
      case 'deleteMapTemplate':
        await handleDeleteMapTemplate(session, msg);
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

async function handleSetDocumentSharing(
  session: WsSession,
  msg: { type: 'setDocumentSharing'; assetId: string; sharing: Sharing },
): Promise<void> {
  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const manifest = entry.store.assets.get(msg.assetId);
  if (!manifest || manifest.assetKind !== 'document') {
    sendError(session, 'UNKNOWN_ASSET', `Document "${msg.assetId}" not found`);
    return;
  }

  // Documents are private to their uploader; only the owner (or DM) may re-share.
  if (manifest.ownerUsername !== session.username && session.role !== 'dm') {
    sendError(session, 'FORBIDDEN', 'Only the uploader can change sharing for this document');
    return;
  }

  // Who could see it before, so we only "pop open" for newly-granted members.
  const sessions = getSessionsInRoom(campaignId);
  const before = documentSharing(entry, manifest);
  const couldSeeBefore = new Set(
    sessions
      .filter((s) => canAccessShared(viewerOf(s), manifest.ownerUsername ?? null, before))
      .map((s) => s.userId),
  );

  const sharing = parseSharing(msg.sharing);
  manifest.sharing = sharing;
  await saveAssetManifest(entry.store, manifest);

  broadcastDocuments(campaignId, entry);

  // Notify newly-granted members so the handout opens on their screen.
  for (const s of sessions) {
    if (s.userId === session.userId) continue;
    if (couldSeeBefore.has(s.userId)) continue;
    if (canAccessShared(viewerOf(s), manifest.ownerUsername ?? null, sharing)) {
      send(s.ws, { type: 'documentShared', asset: manifest, sharedBy: session.username });
    }
  }
}

async function handleSaveNote(
  session: WsSession,
  msg: { type: 'saveNote'; noteId?: string; title: string; body: string; sharing: Sharing },
): Promise<void> {
  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const isDm = session.role === 'dm';
  const sharing = parseSharing(msg.sharing);

  let note: NoteEntity;
  const now = new Date().toISOString();

  if (msg.noteId) {
    const existing = entry.store.notes.get(msg.noteId);
    if (existing) {
      if (!isDm && existing.ownerUsername !== session.username) {
        sendError(session, 'FORBIDDEN', 'You can only edit your own notes');
        return;
      }
      note = { ...existing, title: msg.title, body: msg.body, sharing, updatedAt: now };
    } else {
      note = {
        type: 'note',
        schemaVersion: SCHEMA_VERSIONS.note,
        id: msg.noteId,
        title: msg.title,
        body: msg.body,
        sharing,
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
      sharing,
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
    sharing: note.sharing,
    ownerUsername: note.ownerUsername,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };

  // Push to everyone who may see it; tell everyone else to drop it (handles a
  // scope being narrowed, e.g. shared → private, in one pass).
  for (const s of getSessionsInRoom(campaignId)) {
    if (canAccessShared(viewerOf(s), note.ownerUsername, note.sharing)) {
      send(s.ws, { type: 'noteSaved', note: wireNote });
    } else {
      send(s.ws, { type: 'noteDeleted', noteId: note.id });
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

  if (manifest.ownerUsername !== session.username && session.role !== 'dm') {
    sendError(session, 'FORBIDDEN', 'Only the uploader or DM can control playback for the table');
    return;
  }

  const time = Number.isFinite(msg.time) ? Math.max(0, msg.time) : 0;

  // Playing a track auto-shares it with the table so everyone can fetch the file.
  if (msg.action === 'play' && documentSharing(entry, manifest).scope !== 'all') {
    manifest.sharing = { scope: 'all', userIds: [] };
    await saveAssetManifest(entry.store, manifest);
    broadcastDocuments(campaignId, entry);
  }

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

  if (session.role !== 'dm' && existing.ownerUsername !== session.username) {
    sendError(session, 'FORBIDDEN', 'You can only delete your own notes');
    return;
  }

  await deleteNote(entry.store, msg.noteId);

  broadcast(campaignId, { type: 'noteDeleted', noteId: msg.noteId });
}

// ---------------------------------------------------------------------------
// Token handlers
// ---------------------------------------------------------------------------

async function handleTokenAdd(
  session: WsSession,
  msg: {
    type: 'tokenAdd';
    name: string;
    shape: 'round' | 'square';
    allegiance: 'ally' | 'enemy' | 'neutral';
    ownerUserId: string | null;
    size: 'S' | 'M' | 'L' | 'H';
    x: number;
    y: number;
    assetId?: string | null;
    fill?: string | null;
    hp?: number | null;
    maxHp?: number | null;
    dmOnly?: boolean;
    sharing?: Sharing;
  },
): Promise<void> {
  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const isDm = session.role === 'dm';

  if (msg.assetId) {
    const manifest = entry.store.assets.get(msg.assetId);
    if (!manifest || manifest.assetKind === 'document') {
      sendError(session, 'UNKNOWN_ASSET', `Asset "${msg.assetId}" not found or is not an image`);
      return;
    }
  }

  const maxZ = entry.runtime.state.tokens.reduce((acc, t) => Math.max(acc, t.z), 0);

  // Players may only create tokens they own and that are visible (no dmOnly,
  // no assigning ownership to someone else).
  const ownerUserId = isDm ? (msg.ownerUserId ?? null) : session.userId;
  const dmOnly = isDm ? (msg.dmOnly ?? false) : false;

  const newToken: Token = {
    id: randomId('tok'),
    name: msg.name || 'Token',
    shape: msg.shape,
    allegiance: msg.allegiance,
    ownerUserId,
    size: msg.size,
    x: msg.x,
    y: msg.y,
    z: maxZ + 1,
    assetId: msg.assetId ?? null,
    fill: msg.fill ?? null,
    hp: msg.hp ?? null,
    maxHp: msg.maxHp ?? null,
    dmOnly,
    sharing: msg.sharing ? parseSharing(msg.sharing) : defaultSharing(),
  };

  entry.runtime.state = {
    ...entry.runtime.state,
    tokens: [...entry.runtime.state.tokens, newToken],
  };
  await persistState(entry.runtime);

  broadcastTokensUpdated(campaignId, entry);
}

async function handleTokenMove(
  session: WsSession,
  msg: { type: 'tokenMove'; tokenId: string; x: number; y: number },
): Promise<void> {
  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const idx = entry.runtime.state.tokens.findIndex((t) => t.id === msg.tokenId);
  if (idx === -1) {
    sendError(session, 'UNKNOWN_TOKEN', `Token "${msg.tokenId}" not found`);
    return;
  }

  const token = entry.runtime.state.tokens[idx]!;

  // DM, owner, or anyone the token is shared-to-control may move it.
  if (!canControlToken(viewerOf(session), token.ownerUserId, token.sharing)) {
    sendError(session, 'FORBIDDEN', 'You cannot control this token');
    return;
  }

  // Bring-to-front: give it the highest z.
  const maxZ = entry.runtime.state.tokens.reduce((acc, t) => Math.max(acc, t.z), 0);

  const updated = [...entry.runtime.state.tokens];
  updated[idx] = { ...token, x: msg.x, y: msg.y, z: maxZ + 1 };
  entry.runtime.state = { ...entry.runtime.state, tokens: updated };
  await persistState(entry.runtime);

  broadcastTokensUpdated(campaignId, entry);
}

async function handleTokenUpdate(
  session: WsSession,
  msg: {
    type: 'tokenUpdate';
    tokenId: string;
    name?: string;
    shape?: 'round' | 'square';
    allegiance?: 'ally' | 'enemy' | 'neutral';
    ownerUserId?: string | null;
    size?: 'S' | 'M' | 'L' | 'H';
    fill?: string | null;
    hp?: number | null;
    maxHp?: number | null;
    dmOnly?: boolean;
    sharing?: Sharing;
  },
): Promise<void> {
  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const idx = entry.runtime.state.tokens.findIndex((t) => t.id === msg.tokenId);
  if (idx === -1) {
    sendError(session, 'UNKNOWN_TOKEN', `Token "${msg.tokenId}" not found`);
    return;
  }

  const existing = entry.runtime.state.tokens[idx]!;
  const isDm = session.role === 'dm';
  const isOwner = existing.ownerUserId !== null && existing.ownerUserId === session.userId;

  // DM may edit any token; a player may edit a token they own. dmOnly and
  // ownerUserId are DM-only fields (a player can't hide a token or reassign it).
  if (!isDm && !isOwner) {
    sendError(session, 'FORBIDDEN', 'You can only edit your own tokens');
    return;
  }

  const updated = [...entry.runtime.state.tokens];
  updated[idx] = {
    ...existing,
    ...(msg.name !== undefined && { name: msg.name }),
    ...(msg.shape !== undefined && { shape: msg.shape }),
    ...(msg.allegiance !== undefined && { allegiance: msg.allegiance }),
    ...(msg.size !== undefined && { size: msg.size }),
    ...(msg.fill !== undefined && { fill: msg.fill }),
    ...(msg.hp !== undefined && { hp: msg.hp }),
    ...(msg.maxHp !== undefined && { maxHp: msg.maxHp }),
    ...(msg.sharing !== undefined && { sharing: parseSharing(msg.sharing) }),
    ...(isDm && msg.ownerUserId !== undefined && { ownerUserId: msg.ownerUserId }),
    ...(isDm && msg.dmOnly !== undefined && { dmOnly: msg.dmOnly }),
  };
  entry.runtime.state = { ...entry.runtime.state, tokens: updated };
  await persistState(entry.runtime);

  broadcastTokensUpdated(campaignId, entry);
}

async function handleTokenRemove(
  session: WsSession,
  msg: { type: 'tokenRemove'; tokenId: string },
): Promise<void> {
  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const token = entry.runtime.state.tokens.find((t) => t.id === msg.tokenId);
  if (!token) {
    sendError(session, 'UNKNOWN_TOKEN', `Token "${msg.tokenId}" not found`);
    return;
  }

  // DM may remove any token; a player may remove a token they own.
  if (session.role !== 'dm' && token.ownerUserId !== session.userId) {
    sendError(session, 'FORBIDDEN', 'You can only remove your own tokens');
    return;
  }

  entry.runtime.state = {
    ...entry.runtime.state,
    tokens: entry.runtime.state.tokens.filter((t) => t.id !== msg.tokenId),
  };
  await persistState(entry.runtime);

  broadcastTokensUpdated(campaignId, entry);
}

// ---------------------------------------------------------------------------
// Grid handler
// ---------------------------------------------------------------------------

async function handleSetGrid(
  session: WsSession,
  msg: { type: 'setGrid'; grid: Partial<GridState> },
): Promise<void> {
  if (session.role !== 'dm') {
    sendError(session, 'FORBIDDEN', 'Only the DM can change the grid');
    return;
  }

  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const incoming = msg.grid;
  const current = entry.runtime.state.grid;
  const newGrid: GridState = {
    ...current,
    ...incoming,
    // Clamp cell size: 8px–512px
    ...(incoming.cell !== undefined && {
      cell: Math.min(512, Math.max(8, incoming.cell)),
    }),
  };

  entry.runtime.state = { ...entry.runtime.state, grid: newGrid };
  await persistState(entry.runtime);

  broadcast(campaignId, { type: 'gridUpdated', grid: newGrid });
}

// ---------------------------------------------------------------------------
// Measure handler (ephemeral — not persisted)
// ---------------------------------------------------------------------------

async function handleMeasure(
  session: WsSession,
  msg: { type: 'measure' } & (
    | { kind: 'ruler'; x1: number; y1: number; x2: number; y2: number }
    | { kind: 'clear' }
  ),
): Promise<void> {
  const campaignId = session.campaignId!;

  // Ephemeral: broadcast to all OTHER sessions in the room (like mediaControl).
  if (msg.kind === 'ruler') {
    broadcast(
      campaignId,
      {
        type: 'measureShared',
        kind: 'ruler',
        x1: msg.x1,
        y1: msg.y1,
        x2: msg.x2,
        y2: msg.y2,
        by: session.username,
      },
      (s) => s !== session,
    );
  } else {
    broadcast(
      campaignId,
      { type: 'measureShared', kind: 'clear', by: session.username },
      (s) => s !== session,
    );
  }
}

// ---------------------------------------------------------------------------
// Map piece handlers (DM-only build mode)
// ---------------------------------------------------------------------------

function broadcastPiecesUpdated(campaignId: string, entry: NonNullable<ReturnType<typeof getCampaign>>): void {
  const pieces: MapPiece[] = entry.runtime.state.pieces.map((p) =>
    makePieceView(campaignId, p, entry),
  );
  broadcast(campaignId, { type: 'piecesUpdated', pieces });
}

const PIECE_MIN = 8;
const PIECE_MAX = 4000;
const clampSize = (v: number): number => Math.min(PIECE_MAX, Math.max(PIECE_MIN, v));

async function handlePieceAdd(
  session: WsSession,
  msg: {
    type: 'pieceAdd';
    builtin?: string | null;
    assetId?: string | null;
    x: number;
    y: number;
    w: number;
    h: number;
    rotation?: number;
    layer: 'terrain' | 'props';
    lockedToGrid: boolean;
  },
): Promise<void> {
  if (session.role !== 'dm') {
    sendError(session, 'FORBIDDEN', 'Only the DM can edit the map');
    return;
  }
  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  if (!msg.builtin && !msg.assetId) {
    sendError(session, 'UNKNOWN_PIECE', 'A piece needs a builtin name or an assetId');
    return;
  }
  if (msg.assetId) {
    const manifest = entry.store.assets.get(msg.assetId);
    if (!manifest || manifest.assetKind === 'document') {
      sendError(session, 'UNKNOWN_ASSET', `Asset "${msg.assetId}" not found or is not an image`);
      return;
    }
  }

  const maxZ = entry.runtime.state.pieces.reduce((acc, p) => Math.max(acc, p.z), 0);
  const newPiece: MapPiece = {
    id: randomId('pc'),
    builtin: msg.builtin ?? null,
    assetId: msg.assetId ?? null,
    imageUrl: null,
    x: msg.x,
    y: msg.y,
    w: clampSize(msg.w),
    h: clampSize(msg.h),
    rotation: msg.rotation ?? 0,
    z: maxZ + 1,
    layer: msg.layer,
    lockedToGrid: msg.lockedToGrid,
  };

  entry.runtime.state = {
    ...entry.runtime.state,
    pieces: [...entry.runtime.state.pieces, newPiece],
  };
  await persistState(entry.runtime);
  broadcastPiecesUpdated(campaignId, entry);
}

async function handlePieceMove(
  session: WsSession,
  msg: { type: 'pieceMove'; id: string; x: number; y: number },
): Promise<void> {
  if (session.role !== 'dm') {
    sendError(session, 'FORBIDDEN', 'Only the DM can edit the map');
    return;
  }
  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const idx = entry.runtime.state.pieces.findIndex((p) => p.id === msg.id);
  if (idx === -1) {
    sendError(session, 'UNKNOWN_PIECE', `Piece "${msg.id}" not found`);
    return;
  }
  const updated = [...entry.runtime.state.pieces];
  updated[idx] = { ...updated[idx]!, x: msg.x, y: msg.y };
  entry.runtime.state = { ...entry.runtime.state, pieces: updated };
  await persistState(entry.runtime);
  broadcastPiecesUpdated(campaignId, entry);
}

async function handlePieceUpdate(
  session: WsSession,
  msg: { type: 'pieceUpdate'; id: string; w?: number; h?: number; rotation?: number; layer?: 'terrain' | 'props'; z?: number },
): Promise<void> {
  if (session.role !== 'dm') {
    sendError(session, 'FORBIDDEN', 'Only the DM can edit the map');
    return;
  }
  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const idx = entry.runtime.state.pieces.findIndex((p) => p.id === msg.id);
  if (idx === -1) {
    sendError(session, 'UNKNOWN_PIECE', `Piece "${msg.id}" not found`);
    return;
  }
  const existing = entry.runtime.state.pieces[idx]!;
  const updated = [...entry.runtime.state.pieces];
  updated[idx] = {
    ...existing,
    ...(msg.w !== undefined && { w: clampSize(msg.w) }),
    ...(msg.h !== undefined && { h: clampSize(msg.h) }),
    ...(msg.rotation !== undefined && { rotation: msg.rotation }),
    ...(msg.layer !== undefined && { layer: msg.layer }),
    ...(msg.z !== undefined && { z: msg.z }),
  };
  entry.runtime.state = { ...entry.runtime.state, pieces: updated };
  await persistState(entry.runtime);
  broadcastPiecesUpdated(campaignId, entry);
}

async function handlePieceRemove(
  session: WsSession,
  msg: { type: 'pieceRemove'; id: string },
): Promise<void> {
  if (session.role !== 'dm') {
    sendError(session, 'FORBIDDEN', 'Only the DM can edit the map');
    return;
  }
  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const exists = entry.runtime.state.pieces.some((p) => p.id === msg.id);
  if (!exists) {
    sendError(session, 'UNKNOWN_PIECE', `Piece "${msg.id}" not found`);
    return;
  }
  entry.runtime.state = {
    ...entry.runtime.state,
    pieces: entry.runtime.state.pieces.filter((p) => p.id !== msg.id),
  };
  await persistState(entry.runtime);
  broadcastPiecesUpdated(campaignId, entry);
}

async function handleSetMapMeta(
  session: WsSession,
  msg: { type: 'setMapMeta'; name?: string; areaTag?: string },
): Promise<void> {
  if (session.role !== 'dm') {
    sendError(session, 'FORBIDDEN', 'Only the DM can edit the map');
    return;
  }
  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const mapMeta: MapMeta = {
    name: msg.name !== undefined ? msg.name : entry.runtime.state.mapMeta.name,
    areaTag: msg.areaTag !== undefined ? msg.areaTag : entry.runtime.state.mapMeta.areaTag,
  };
  entry.runtime.state = { ...entry.runtime.state, mapMeta };
  await persistState(entry.runtime);
  broadcast(campaignId, { type: 'mapMetaUpdated', mapMeta });
}

// ---------------------------------------------------------------------------
// Map template handlers (DM-only)
// ---------------------------------------------------------------------------

function broadcastTemplatesUpdated(campaignId: string, entry: NonNullable<ReturnType<typeof getCampaign>>): void {
  const templates = entry.runtime.state.mapTemplates.map((t) => ({ id: t.id, name: t.name, createdAt: t.createdAt }));
  broadcast(campaignId, { type: 'templatesUpdated', templates });
}

async function handleSaveMapTemplate(
  session: WsSession,
  msg: { type: 'saveMapTemplate'; name: string },
): Promise<void> {
  if (session.role !== 'dm') {
    sendError(session, 'FORBIDDEN', 'Only the DM can save templates');
    return;
  }
  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const s = entry.runtime.state;
  const template: MapTemplate = {
    id: randomId('tpl'),
    name: (msg.name || 'Untitled map').slice(0, 80),
    createdAt: new Date().toISOString(),
    // Deep-ish copies so later edits don't mutate the saved template.
    board: s.board.map((b) => ({ ...b })),
    pieces: s.pieces.map((p) => ({ ...p })),
    grid: { ...s.grid },
    mapMeta: { ...s.mapMeta },
  };
  entry.runtime.state = { ...s, mapTemplates: [...s.mapTemplates, template] };
  await persistState(entry.runtime);
  broadcastTemplatesUpdated(campaignId, entry);
}

async function handleLoadMapTemplate(
  session: WsSession,
  msg: { type: 'loadMapTemplate'; id: string },
): Promise<void> {
  if (session.role !== 'dm') {
    sendError(session, 'FORBIDDEN', 'Only the DM can load templates');
    return;
  }
  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const tpl = entry.runtime.state.mapTemplates.find((t) => t.id === msg.id);
  if (!tpl) {
    sendError(session, 'UNKNOWN_TEMPLATE', `Template "${msg.id}" not found`);
    return;
  }
  entry.runtime.state = {
    ...entry.runtime.state,
    board: tpl.board.map((b) => ({ ...b })),
    pieces: tpl.pieces.map((p) => ({ ...p })),
    grid: { ...tpl.grid },
    mapMeta: { ...tpl.mapMeta },
  };
  await persistState(entry.runtime);

  // Push every part of the loaded map to the table.
  broadcastBoardUpdated(campaignId, entry);
  broadcastPiecesUpdated(campaignId, entry);
  broadcast(campaignId, { type: 'gridUpdated', grid: entry.runtime.state.grid });
  broadcast(campaignId, { type: 'mapMetaUpdated', mapMeta: entry.runtime.state.mapMeta });
}

async function handleDeleteMapTemplate(
  session: WsSession,
  msg: { type: 'deleteMapTemplate'; id: string },
): Promise<void> {
  if (session.role !== 'dm') {
    sendError(session, 'FORBIDDEN', 'Only the DM can delete templates');
    return;
  }
  const campaignId = session.campaignId!;
  const entry = getCampaign(campaignId);
  if (!entry) return;

  const exists = entry.runtime.state.mapTemplates.some((t) => t.id === msg.id);
  if (!exists) {
    sendError(session, 'UNKNOWN_TEMPLATE', `Template "${msg.id}" not found`);
    return;
  }
  entry.runtime.state = {
    ...entry.runtime.state,
    mapTemplates: entry.runtime.state.mapTemplates.filter((t) => t.id !== msg.id),
  };
  await persistState(entry.runtime);
  broadcastTemplatesUpdated(campaignId, entry);
}
