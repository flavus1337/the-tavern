import { isDeepStrictEqual } from 'node:util';
import { randomId, type ClientMessage, type MapPiece, type AoeTemplate } from '@vtt/shared';
import type { CampaignEntry } from '../campaign/registry.js';
import { persistState, type BoardItem, type Token, type RuntimeState } from '../campaign/runtime.js';
import { getRole } from '../auth/memberships.js';
import { canControlToken } from './sharing.js';
import type { WsSession } from './hub.js';
import { CommandRejection } from './errors.js';

type Collection = 'board' | 'tokens' | 'pieces' | 'aoes';
type Entity = BoardItem | Token | MapPiece | AoeTemplate;
export const AOE_MAX = 100;
export interface UndoReceipt {
  receiptId: string;
  campaignId: string;
  boardGeneration: number;
  label: string;
  collection: Collection;
  command: string;
  before: Array<{ index: number; entity: Entity }>;
  after: Entity[];
}

export function boardChanged(before: RuntimeState, after: RuntimeState): boolean {
  return (['board', 'tokens', 'pieces', 'aoes', 'grid'] as const).some((key) => !isDeepStrictEqual(before[key], after[key]));
}

/** Capture only this action's entities, never the whole board or private ACK data. */
export function captureUndo(session: WsSession, message: ClientMessage, entry: CampaignEntry): UndoReceipt | undefined {
  let collection: Collection, label: string, id: string | undefined;
  switch (message.type) {
    case 'boardMove': collection = 'board'; id = message.itemId; label = 'Move or resize image'; break;
    case 'boardRemove': collection = 'board'; id = message.itemId; label = 'Remove image'; break;
    case 'tokenMove': collection = 'tokens'; id = message.tokenId; label = 'Move token'; break;
    case 'tokenRemove': collection = 'tokens'; id = message.tokenId; label = 'Remove token'; break;
    case 'pieceMove': collection = 'pieces'; id = message.id; label = 'Move map piece'; break;
    case 'pieceUpdate': collection = 'pieces'; id = message.id; label = 'Edit map piece'; break;
    case 'pieceRemove': collection = 'pieces'; id = message.id; label = 'Remove map piece'; break;
    case 'aoeRemove': collection = 'aoes'; id = message.id; label = 'Remove spell area'; break;
    case 'aoeClear': collection = 'aoes'; label = 'Clear spell areas'; break;
    default: return;
  }
  const before = (entry.runtime.state[collection] as Entity[]).flatMap((entity, index) =>
    (id !== undefined ? entity.id === id : session.role === 'dm' || (entity as AoeTemplate).ownerUserId === session.userId)
      ? [{ index, entity: structuredClone(entity) }] : []);
  if (!before.length) return;
  return { receiptId: randomId('undo'), campaignId: session.campaignId!, boardGeneration: 0, command: message.type, label, collection, before, after: [] };
}

export function completeUndo(receipt: UndoReceipt, entry: CampaignEntry): UndoReceipt | undefined {
  const ids = new Set(receipt.before.map((item) => item.entity.id));
  receipt.after = structuredClone((entry.runtime.state[receipt.collection] as Entity[]).filter((entity) => ids.has(entity.id)));
  if (isDeepStrictEqual(receipt.before.map((item) => item.entity), receipt.after)) return;
  receipt.boardGeneration = entry.boardGeneration ?? 0;
  return receipt;
}

export async function restoreUndo(session: WsSession, receiptId: string, entry: CampaignEntry): Promise<Collection> {
  const receipt = session.undo;
  const stale = () => { throw new CommandRejection('UNDO_STALE', 'This action can no longer be undone because the board or its assets changed.'); };
  if (!receipt || receipt.receiptId !== receiptId || receipt.campaignId !== session.campaignId || receipt.boardGeneration !== (entry.boardGeneration ?? 0)) return stale();
  const role = getRole(receipt.campaignId, session.userId);
  if (!role) throw new CommandRejection('FORBIDDEN', 'You are no longer a member of this campaign.');
  session.role = role;
  const state = entry.runtime.state;
  const current = state[receipt.collection] as Entity[];
  const ids = new Set(receipt.before.map((item) => item.entity.id));
  if (!isDeepStrictEqual(current.filter((entity) => ids.has(entity.id)), receipt.after)) return stale();
  if (receipt.collection === 'board' && state.mapLocked) throw new CommandRejection('FORBIDDEN', 'Unlock the map before undoing this action.');
  for (const { entity } of receipt.before) {
    if ('assetId' in entity && entity.assetId) {
      const asset = entry.store.assets.get(entity.assetId);
      if (!asset || asset.assetKind === 'document') return stale();
    }
    let allowed = role === 'dm';
    if (!allowed) {
      if (receipt.collection === 'board') allowed = receipt.command === 'boardMove' && !!(entity as BoardItem).playersCanMove;
      else if (receipt.collection === 'tokens') {
        const token = entity as Token;
        allowed = !token.dmOnly && (receipt.command === 'tokenMove'
          ? canControlToken({ role, userId: session.userId, username: session.username }, token.ownerUserId, token.sharing)
          : token.ownerUserId === session.userId);
      } else if (receipt.collection === 'aoes') allowed = (entity as AoeTemplate).ownerUserId === session.userId;
    }
    if (!allowed) throw new CommandRejection('FORBIDDEN', 'You no longer have permission to undo this action.');
  }
  const restored = current.filter((entity) => !ids.has(entity.id));
  if (receipt.collection === 'aoes' && restored.length + receipt.before.length > AOE_MAX) throw new CommandRejection('TOO_MANY', 'Clear some spell areas before undoing this action.');
  for (const { index, entity } of receipt.before) {
    const value = structuredClone(entity);
    if (receipt.collection === 'tokens') (value as Token).revision = Math.max((entity as Token).revision ?? 0, (receipt.after.find((after) => after.id === entity.id) as Token | undefined)?.revision ?? 0) + 1;
    restored.splice(index, 0, value);
  }
  entry.runtime.state = { ...state, [receipt.collection]: restored };
  await persistState(entry.runtime);
  return receipt.collection;
}
