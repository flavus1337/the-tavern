// WebSocket protocol types — the wire contract between server and client.
import type { AssetManifest, Sharing } from './campaign.js';

export const PROTOCOL_VERSION = 6;

export type Role = 'dm' | 'player';

/** A campaign member (online or not) — powers share pickers + owner dropdowns. */
export interface MemberEntry {
  userId: string;
  username: string;
  role: Role;
}

export interface PresenceEntry {
  userId: string;
  username: string;
  role: Role;
  connected: boolean;
}

export interface BoardItemView {
  id: string;
  assetId: string;
  x: number;
  y: number;
  w: number;
  z: number;
  url: string;
  title: string;
  naturalWidth: number | null;
  naturalHeight: number | null;
  /** when true, players may move/resize this item (DM toggles per item) */
  playersCanMove: boolean;
}

// ---------------------------------------------------------------------------
// Token & Grid types
// ---------------------------------------------------------------------------

export interface TokenView {
  id: string;
  name: string;
  shape: 'round' | 'square';
  allegiance: 'ally' | 'enemy' | 'neutral';
  ownerUserId: string | null;
  size: 'S' | 'M' | 'L' | 'H';
  x: number;
  y: number;
  z: number;
  imageUrl: string | null;
  fill: string | null;
  hp: number | null;
  maxHp: number | null;
  dmOnly: boolean;
  /** Who, besides owner + DM, may control (move/edit) this token. */
  sharing: Sharing;
}

export interface GridState {
  cell: number;
  offsetX: number;
  offsetY: number;
  visible: boolean;
  snap: boolean;
  color: string;
  unit: 'ft' | 'm';
}

// ---------------------------------------------------------------------------
// Map Creation (Build mode) — placed terrain/props
// ---------------------------------------------------------------------------

/**
 * A placed map piece: either a built-in inked library piece (`builtin` set) or
 * an uploaded/generated image (`assetId` set). Terrain locks to the grid;
 * props scale & rotate freely. Visible to everyone; DM-editable in build mode.
 */
export interface MapPiece {
  id: string;
  /** built-in library piece name (e.g. 'oak', 'wall'); null when image-backed */
  builtin: string | null;
  /** image asset id; null when builtin */
  assetId: string | null;
  /** resolved image url for asset-backed pieces (server fills) */
  imageUrl: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  z: number;
  layer: 'terrain' | 'props';
  lockedToGrid: boolean;
}

export interface MapMeta {
  name: string;
  areaTag: string;
}

/** Lightweight template descriptor for the build-mode picker. */
export interface MapTemplateSummary {
  id: string;
  name: string;
  createdAt: string;
}

export type RollVisibility = 'public' | 'dm';

export type DieSides = 4 | 6 | 8 | 10 | 12 | 20 | 100;

export type RollPart =
  | {
      kind: 'dice';
      count: number;
      sides: DieSides;
      rolls: number[];
      negative?: boolean;
      /** Indices (0-based) of rolls dropped by keep-highest. Absent for normal rolls. */
      dropped?: number[];
    }
  | { kind: 'modifier'; value: number };

export interface RollLogEntry {
  id: string;
  ts: string;
  userId: string;
  username: string;
  expression: string;
  label?: string;
  parts: RollPart[];
  total: number;
  visibility: RollVisibility;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  sharing: Sharing;
  ownerUsername: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Client → Server messages
// ---------------------------------------------------------------------------

export interface ClientJoinPayload {
  type: 'join';
  protocolVersion: number;
  campaignId: string;
}

export interface ClientRollPayload {
  type: 'roll';
  requestId: string;
  expression: string;
  label?: string;
  visibility: RollVisibility;
}

export interface ClientBoardAddPayload {
  type: 'boardAdd';
  /** Must reference an assetKind that is an image (not 'document'). */
  assetId: string;
  x: number;
  y: number;
}

export interface ClientBoardMovePayload {
  type: 'boardMove';
  itemId: string;
  x: number;
  y: number;
  /** Also used for resize; clamped to [40, 8000] server-side. */
  w: number;
}

export interface ClientBoardRemovePayload {
  type: 'boardRemove';
  itemId: string;
}

export interface ClientBoardSetAccessPayload {
  type: 'boardSetAccess';
  itemId: string;
  /** DM only: allow players to move/resize this item */
  playersCanMove: boolean;
}

export interface ClientSetUploadsLockedPayload {
  type: 'setUploadsLocked';
  locked: boolean;
}

export interface ClientSetDocumentSharingPayload {
  type: 'setDocumentSharing';
  /** must reference an assetKind 'document' asset; owner or DM may change it */
  assetId: string;
  sharing: Sharing;
}

export interface ClientSaveNotePayload {
  type: 'saveNote';
  noteId?: string;
  title: string;
  body: string;
  sharing: Sharing;
}

export interface ClientDeleteNotePayload {
  type: 'deleteNote';
  noteId: string;
}

export interface ClientMediaControlPayload {
  type: 'mediaControl';
  /** asset id of an audio document; sender must be its owner or the DM */
  assetId: string;
  action: 'play' | 'pause' | 'stop';
  /** current playback position in seconds */
  time: number;
}

export interface ClientPingPayload {
  type: 'ping';
  sentAt: number;
}

// Token messages. DM may add any token; a player may add a token they own
// (ownerUserId/dmOnly are forced server-side for players). tokenMove is allowed
// for the DM, the owner, or anyone the token is shared-to-control.
export interface ClientTokenAddPayload {
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
}

export interface ClientTokenMovePayload {
  type: 'tokenMove';
  tokenId: string;
  x: number;
  y: number;
}

export interface ClientTokenUpdatePayload {
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
}

export interface ClientTokenRemovePayload {
  type: 'tokenRemove';
  tokenId: string;
}

export interface ClientSetGridPayload {
  type: 'setGrid';
  grid: Partial<GridState>;
}

export type ClientMeasurePayload =
  | { type: 'measure'; kind: 'ruler'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'measure'; kind: 'clear' };

// Map piece messages — DM only.
export interface ClientPieceAddPayload {
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
}

export interface ClientPieceMovePayload {
  type: 'pieceMove';
  id: string;
  x: number;
  y: number;
}

export interface ClientPieceUpdatePayload {
  type: 'pieceUpdate';
  id: string;
  w?: number;
  h?: number;
  rotation?: number;
  layer?: 'terrain' | 'props';
  /** bring-to-front etc.; clamped server-side */
  z?: number;
}

export interface ClientPieceRemovePayload {
  type: 'pieceRemove';
  id: string;
}

export interface ClientSetMapMetaPayload {
  type: 'setMapMeta';
  name?: string;
  areaTag?: string;
}

export interface ClientSaveMapTemplatePayload {
  type: 'saveMapTemplate';
  name: string;
}

export interface ClientLoadMapTemplatePayload {
  type: 'loadMapTemplate';
  id: string;
}

export interface ClientDeleteMapTemplatePayload {
  type: 'deleteMapTemplate';
  id: string;
}

export type ClientMessage =
  | ClientJoinPayload
  | ClientRollPayload
  | ClientBoardAddPayload
  | ClientBoardMovePayload
  | ClientBoardRemovePayload
  | ClientBoardSetAccessPayload
  | ClientSetUploadsLockedPayload
  | ClientSetDocumentSharingPayload
  | ClientSaveNotePayload
  | ClientDeleteNotePayload
  | ClientMediaControlPayload
  | ClientPingPayload
  | ClientTokenAddPayload
  | ClientTokenMovePayload
  | ClientTokenUpdatePayload
  | ClientTokenRemovePayload
  | ClientSetGridPayload
  | ClientMeasurePayload
  | ClientPieceAddPayload
  | ClientPieceMovePayload
  | ClientPieceUpdatePayload
  | ClientPieceRemovePayload
  | ClientSetMapMetaPayload
  | ClientSaveMapTemplatePayload
  | ClientLoadMapTemplatePayload
  | ClientDeleteMapTemplatePayload;

// ---------------------------------------------------------------------------
// Server → Client messages
// ---------------------------------------------------------------------------

export interface ServerJoinedPayload {
  type: 'joined';
  userId: string;
  username: string;
  role: Role;
  campaignId: string;
  protocolVersion: number;
}

export interface SnapshotCampaignInfo {
  id: string;
  name: string;
  description: string;
}

export interface ServerSnapshotPayload {
  type: 'snapshot';
  campaign: SnapshotCampaignInfo;
  /** Board items currently pinned. */
  board: BoardItemView[];
  uploadsLocked: boolean;
  presence: PresenceEntry[];
  /** All campaign members (online or not) — for share pickers + owner dropdowns. */
  members: MemberEntry[];
  /** Last 200 entries, visibility-filtered for role. */
  rollLog: RollLogEntry[];
  /** Image assets — DM only, null for players. */
  assets: AssetManifest[] | null;
  /** kind==='document' assets — ALL members see these. */
  documents: AssetManifest[];
  myNotes: Note[];
  /** active table playback, if any — late joiners sync from this */
  media: { assetId: string; action: 'play' | 'pause'; time: number; elapsedMs: number } | null;
  /** Tokens on the board — dmOnly tokens filtered out for non-DM. */
  tokens: TokenView[];
  /** Current grid state. */
  grid: GridState;
  /** Placed map pieces (terrain/props) — visible to everyone. */
  pieces: MapPiece[];
  /** Map metadata (name + area tag) shown in the build-mode top bar. */
  mapMeta: MapMeta;
  /** Server capability flags derived from config. */
  features: { imageGenEnabled: boolean };
  /** Saved map templates (summaries) for the build-mode picker. */
  templates: MapTemplateSummary[];
}

export interface ServerPresencePayload {
  type: 'presence';
  entries: PresenceEntry[];
}

export interface ServerBoardUpdatedPayload {
  type: 'boardUpdated';
  items: BoardItemView[];
}

export interface ServerSettingsUpdatedPayload {
  type: 'settingsUpdated';
  uploadsLocked: boolean;
}

export interface ServerRollResultPayload {
  type: 'rollResult';
  entry: RollLogEntry;
  requestId?: string;
}

export interface ServerAssetsUpdatedPayload {
  type: 'assetsUpdated';
  /** dm sockets only (image assets) */
  assets: AssetManifest[];
}

export interface ServerDocumentsUpdatedPayload {
  type: 'documentsUpdated';
  /** ALL members of the campaign */
  documents: AssetManifest[];
}

export interface ServerDocumentSharedPayload {
  type: 'documentShared';
  /** broadcast to ALL members; clients open this document in their viewer */
  asset: AssetManifest;
  sharedBy: string;
}

export interface ServerNoteSavedPayload {
  type: 'noteSaved';
  note: Note;
}

export interface ServerNoteDeletedPayload {
  type: 'noteDeleted';
  noteId: string;
}

export interface ServerMediaControlPayload {
  type: 'mediaControl';
  assetId: string;
  action: 'play' | 'pause' | 'stop';
  time: number;
  by: string;
}

export interface ServerTokensUpdatedPayload {
  type: 'tokensUpdated';
  tokens: TokenView[];
}

export interface ServerGridUpdatedPayload {
  type: 'gridUpdated';
  grid: GridState;
}

export interface ServerPiecesUpdatedPayload {
  type: 'piecesUpdated';
  pieces: MapPiece[];
}

export interface ServerMapMetaUpdatedPayload {
  type: 'mapMetaUpdated';
  mapMeta: MapMeta;
}

export interface ServerTemplatesUpdatedPayload {
  type: 'templatesUpdated';
  templates: MapTemplateSummary[];
}

export type ServerMeasureSharedPayload =
  | { type: 'measureShared'; kind: 'ruler'; x1: number; y1: number; x2: number; y2: number; by: string }
  | { type: 'measureShared'; kind: 'clear'; by: string };

export type WsErrorCode =
  | 'NOT_MEMBER'
  | 'FORBIDDEN'
  | 'NOT_JOINED'
  | 'BAD_EXPRESSION'
  | 'PROTOCOL_MISMATCH'
  | 'UNKNOWN_CAMPAIGN'
  | 'UNKNOWN_ASSET'
  | 'UNKNOWN_NOTE'
  | 'UNKNOWN_ITEM'
  | 'UNKNOWN_TOKEN'
  | 'UNKNOWN_PIECE'
  | 'UNKNOWN_TEMPLATE'
  | 'UPLOADS_LOCKED'
  | 'INTERNAL';

export interface ServerErrorPayload {
  type: 'error';
  code: WsErrorCode;
  message: string;
  fatal?: boolean;
}

export interface ServerPongPayload {
  type: 'pong';
  sentAt: number;
}

export type ServerMessage =
  | ServerJoinedPayload
  | ServerSnapshotPayload
  | ServerPresencePayload
  | ServerBoardUpdatedPayload
  | ServerSettingsUpdatedPayload
  | ServerRollResultPayload
  | ServerAssetsUpdatedPayload
  | ServerDocumentsUpdatedPayload
  | ServerDocumentSharedPayload
  | ServerNoteSavedPayload
  | ServerNoteDeletedPayload
  | ServerMediaControlPayload
  | ServerTokensUpdatedPayload
  | ServerGridUpdatedPayload
  | ServerPiecesUpdatedPayload
  | ServerMapMetaUpdatedPayload
  | ServerTemplatesUpdatedPayload
  | ServerMeasureSharedPayload
  | ServerErrorPayload
  | ServerPongPayload;
