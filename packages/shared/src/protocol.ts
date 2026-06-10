// WebSocket protocol types — the wire contract between server and client.
import type { AssetManifest } from './campaign.js';

export const PROTOCOL_VERSION = 2;

export type Role = 'dm' | 'player';

export interface PresenceEntry {
  userId: string;
  username: string;
  role: Role;
  connected: boolean;
}

export interface AssetRef {
  assetId: string;
  url: string;
  title: string;
  width: number | null;
  height: number | null;
  sharedAt: string;
}

export type RollVisibility = 'public' | 'dm';

export type DieSides = 4 | 6 | 8 | 10 | 12 | 20 | 100;

export type RollPart =
  | { kind: 'dice'; count: number; sides: DieSides; rolls: number[]; negative?: boolean }
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
  visibility: 'dm' | 'player';
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

export interface ClientShareImagePayload {
  type: 'shareImage';
  assetId: string;
}

export interface ClientClearImagePayload {
  type: 'clearImage';
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
  visibility: 'dm' | 'player';
}

export interface ClientPingPayload {
  type: 'ping';
  sentAt: number;
}

export type ClientMessage =
  | ClientJoinPayload
  | ClientRollPayload
  | ClientShareImagePayload
  | ClientClearImagePayload
  | ClientShareDocumentPayload
  | ClientSaveNotePayload
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
  currentImage: AssetRef | null;
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

export interface ServerImageSharedPayload {
  type: 'imageShared';
  /** null = cleared */
  asset: AssetRef | null;
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

export type WsErrorCode =
  | 'NOT_MEMBER'
  | 'FORBIDDEN'
  | 'NOT_JOINED'
  | 'BAD_EXPRESSION'
  | 'PROTOCOL_MISMATCH'
  | 'UNKNOWN_CAMPAIGN'
  | 'UNKNOWN_ASSET'
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
  | ServerImageSharedPayload
  | ServerRollResultPayload
  | ServerAssetsUpdatedPayload
  | ServerDocumentsUpdatedPayload
  | ServerDocumentSharedPayload
  | ServerNoteSavedPayload
  | ServerErrorPayload
  | ServerPongPayload;
