// WebSocket protocol types — the wire contract between server and client.
import type { AssetManifest, Sharing, NoteKind } from './campaign.js';

export const PROTOCOL_VERSION = 6;

/** The board is a finite BOARD_CELLS × BOARD_CELLS square — the hard playing-field boundary. */
export const BOARD_CELLS = 120;

/** Clamp a w×h object's top-left so it stays inside the BOARD_CELLS² field. Bigger-than-field
 *  objects (e.g. a full background) are clamped to keep covering it instead of being pushed out. */
export function clampToField(
  x: number, y: number, w: number, h: number, cell: number,
): { x: number; y: number } {
  const S = BOARD_CELLS * cell;
  const axis = (pos: number, size: number) =>
    size <= S ? Math.min(Math.max(0, pos), S - size) : Math.min(Math.max(S - size, pos), 0);
  return { x: axis(x, w), y: axis(y, h) };
}

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

/** Lightweight combat stat block on a token. The DM sees every block; a player
 *  sees it only for tokens they own (the server redacts it to null otherwise). */
export interface TokenStatBlock {
  ac: number | null;
  speed: string;
  str: number | null;
  dex: number | null;
  con: number | null;
  int: number | null;
  wis: number | null;
  cha: number | null;
  notes: string;
}

/** The standard D&D conditions a token can carry. Shown to everyone. */
export const CONDITIONS = [
  'blinded', 'charmed', 'concentration', 'deafened', 'frightened', 'grappled',
  'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone',
  'restrained', 'stunned', 'unconscious',
] as const;
export type Condition = (typeof CONDITIONS)[number];

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
  /** Active conditions (visible to everyone). */
  conditions: string[];
  /** Stat block — null when the viewer isn't allowed to see it. */
  statBlock: TokenStatBlock | null;
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
  /** `chapter:<id>` entries link a note to chapters. */
  tags: string[];
  /** Content type — drives list/editor treatment; absent ⇒ 'secret'. */
  noteKind?: NoteKind;
}

/** Chapter as sent to the DM panel — prep body included, scenes omitted (v1). */
export interface ChapterView {
  id: string;
  title: string;
  order: number;
  summary?: string;
  /** Markdown prep notes. */
  body?: string;
}

/** Character as sent to the DM panel (NPCs & monsters list). DM only. */
export interface CharacterView {
  id: string;
  name: string;
  /** Includes `chapter:<id>` membership entries. */
  tags: string[];
  portraitAssetId?: string | null;
  /** Challenge rating, when the character has a stat block. */
  cr?: string;
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
  /** Optional display width (board space); clamped server-side. Defaults to the
   *  natural width capped at 1200 when omitted. */
  w?: number;
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

export interface ClientSetMapLockedPayload {
  type: 'setMapLocked';
  /** DM only: when true nobody (including the DM) can move/resize the background */
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
  /** `chapter:<id>` entries link the note to chapters. Omitted ⇒ unchanged/empty. */
  tags?: string[];
  noteKind?: NoteKind;
}

export interface ClientDeleteNotePayload {
  type: 'deleteNote';
  noteId: string;
}

export interface ClientSaveChapterPayload {
  type: 'saveChapter';
  /** Omit to create; order is assigned server-side (appended). */
  chapterId?: string;
  title: string;
  summary?: string;
  /** Markdown prep notes (written to the chapter's .md sidecar). */
  body?: string;
}

export interface ClientDeleteChapterPayload {
  type: 'deleteChapter';
  /** Items lose this chapter's tag; those with no remaining chapter become unfiled. */
  chapterId: string;
}

export interface ClientReorderChaptersPayload {
  type: 'reorderChapters';
  /** Chapter ids in the new display order. */
  orderedIds: string[];
}

export interface ClientSetEntityChaptersPayload {
  type: 'setEntityChapters';
  entityId: string;
  entityType: 'note' | 'character' | 'asset';
  /** Replaces the entity's `chapter:<id>` membership. */
  chapterIds: string[];
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
  conditions?: string[];
  statBlock?: TokenStatBlock | null;
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
  conditions?: string[];
  statBlock?: TokenStatBlock | null;
}

export interface ClientTokenRemovePayload {
  type: 'tokenRemove';
  tokenId: string;
}

// Initiative tracker — DM-controlled, but the turn order is visible to everyone.
export interface InitiativeEntry {
  id: string;
  /** linked token (null for abstract entries like "Lair Action") */
  tokenId: string | null;
  name: string;
  initiative: number;
  ownerUserId: string | null;
}
export interface InitiativeState {
  active: boolean;
  round: number;
  /** index into the initiative-sorted order whose turn it is */
  turnIndex: number;
  entries: InitiativeEntry[];
}
/** DM replaces the whole tracker state (add/remove/reorder/advance). */
export interface ClientSetInitiativePayload {
  type: 'setInitiative';
  initiative: InitiativeState;
}

export interface ClientSetGridPayload {
  type: 'setGrid';
  grid: Partial<GridState>;
}

/** A ruler or D&D AoE template. All shapes are defined by an origin (x1,y1) and
 *  a dragged-to point (x2,y2): ruler = line+distance, circle = centre+radius,
 *  cone = apex+length (5e: far-edge width == length), line = origin+length (1
 *  cell wide), square = centre+half-extent. Ephemeral — broadcast, never saved. */
export type MeasureKind = 'ruler' | 'circle' | 'cone' | 'line' | 'square';

export type ClientMeasurePayload =
  | { type: 'measure'; kind: MeasureKind; x1: number; y1: number; x2: number; y2: number }
  | { type: 'measure'; kind: 'clear' };

/** A placed AoE template that persists on the board (unlike the live ruler).
 *  Same origin→drag geometry as a measure, minus the 'ruler' kind. */
export type AoeKind = Exclude<MeasureKind, 'ruler'>;
export interface AoeTemplate {
  id: string;
  kind: AoeKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** who placed it — null for the DM's legacy entries; used for removal rights + colour */
  ownerUserId: string | null;
}

export interface ClientAoeAddPayload {
  type: 'aoeAdd';
  kind: AoeKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface ClientAoeRemovePayload {
  type: 'aoeRemove';
  id: string;
}
/** DM clears all; a player clears only their own. */
export interface ClientAoeClearPayload {
  type: 'aoeClear';
}

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
  | ClientSetMapLockedPayload
  | ClientSetDocumentSharingPayload
  | ClientSaveNotePayload
  | ClientDeleteNotePayload
  | ClientSaveChapterPayload
  | ClientDeleteChapterPayload
  | ClientReorderChaptersPayload
  | ClientSetEntityChaptersPayload
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
  | ClientAoeAddPayload
  | ClientAoeRemovePayload
  | ClientAoeClearPayload
  | ClientSetInitiativePayload
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
  /** when true the background is locked — nobody (incl. DM) can move/resize it */
  mapLocked: boolean;
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
  /** Campaign chapters (ordered) — DM only; empty for players. */
  chapters: ChapterView[];
  /** Campaign NPCs & monsters — DM only; empty for players. */
  characters: CharacterView[];
  /** active table playback, if any — late joiners sync from this */
  media: { assetId: string; action: 'play' | 'pause'; time: number; elapsedMs: number } | null;
  /** Tokens on the board — dmOnly tokens filtered out for non-DM. */
  tokens: TokenView[];
  /** Current grid state. */
  grid: GridState;
  /** Placed map pieces (terrain/props) — visible to everyone. */
  pieces: MapPiece[];
  /** Placed AoE templates (spell/effect areas) — visible to everyone. */
  aoes: AoeTemplate[];
  /** Initiative tracker — turn order visible to everyone, DM-controlled. */
  initiative: InitiativeState;
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

export interface ServerMapLockUpdatedPayload {
  type: 'mapLockUpdated';
  locked: boolean;
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

export interface ServerChaptersUpdatedPayload {
  type: 'chaptersUpdated';
  /** Full ordered list — DM sockets only. */
  chapters: ChapterView[];
}

export interface ServerCharactersUpdatedPayload {
  type: 'charactersUpdated';
  /** Full list — DM sockets only. */
  characters: CharacterView[];
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

export interface ServerAoesUpdatedPayload {
  type: 'aoesUpdated';
  aoes: AoeTemplate[];
}

export interface ServerInitiativeUpdatedPayload {
  type: 'initiativeUpdated';
  initiative: InitiativeState;
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
  | { type: 'measureShared'; kind: MeasureKind; x1: number; y1: number; x2: number; y2: number; by: string }
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
  | 'UNKNOWN_CHAPTER'
  | 'BAD_CHAPTER'
  | 'UNKNOWN_ITEM'
  | 'UNKNOWN_TOKEN'
  | 'UNKNOWN_PIECE'
  | 'UNKNOWN_TEMPLATE'
  | 'UPLOADS_LOCKED'
  | 'TOO_MANY'
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
  | ServerMapLockUpdatedPayload
  | ServerRollResultPayload
  | ServerAssetsUpdatedPayload
  | ServerDocumentsUpdatedPayload
  | ServerDocumentSharedPayload
  | ServerNoteSavedPayload
  | ServerNoteDeletedPayload
  | ServerChaptersUpdatedPayload
  | ServerCharactersUpdatedPayload
  | ServerMediaControlPayload
  | ServerTokensUpdatedPayload
  | ServerGridUpdatedPayload
  | ServerPiecesUpdatedPayload
  | ServerAoesUpdatedPayload
  | ServerInitiativeUpdatedPayload
  | ServerMapMetaUpdatedPayload
  | ServerTemplatesUpdatedPayload
  | ServerMeasureSharedPayload
  | ServerErrorPayload
  | ServerPongPayload;
