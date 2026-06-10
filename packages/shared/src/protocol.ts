// WebSocket protocol types — the wire contract between server and client.
import type { AssetManifest } from './campaign.js';

export const PROTOCOL_VERSION = 3;

export type Role = 'dm' | 'player';

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
  /** 'dm' = all DMs · 'player' = owner only · 'shared' = the whole table */
  visibility: 'dm' | 'player' | 'shared';
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

export interface ClientSetUploadsLockedPayload {
  type: 'setUploadsLocked';
  locked: boolean;
}

export interface ClientShareDocumentPayload {
  type: 'shareDocument';
  /** must reference an assetKind 'document' asset; any member may share */
  assetId: string;
}

export interface ClientSaveNotePayload {
  type: 'saveNote';
  noteId?: string;
  title: string;
  body: string;
  /** players may use 'player' | 'shared'; only DMs may set 'dm' */
  visibility: 'dm' | 'player' | 'shared';
}

export interface ClientDeleteNotePayload {
  type: 'deleteNote';
  noteId: string;
}

export interface ClientPingPayload {
  type: 'ping';
  sentAt: number;
}

export type ClientMessage =
  | ClientJoinPayload
  | ClientRollPayload
  | ClientBoardAddPayload
  | ClientBoardMovePayload
  | ClientBoardRemovePayload
  | ClientSetUploadsLockedPayload
  | ClientShareDocumentPayload
  | ClientSaveNotePayload
  | ClientDeleteNotePayload
  | ClientPingPayload;

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
  /** Last 200 entries, visibility-filtered for role. */
  rollLog: RollLogEntry[];
  /** Image assets — DM only, null for players. */
  assets: AssetManifest[] | null;
  /** kind==='document' assets — ALL members see these. */
  documents: AssetManifest[];
  myNotes: Note[];
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
  | ServerErrorPayload
  | ServerPongPayload;
