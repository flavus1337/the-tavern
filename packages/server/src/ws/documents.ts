import type { AssetManifest } from '@vtt/shared';
import type { CampaignEntry } from '../campaign/registry.js';
import { getSessionsInRoom, send } from './hub.js';

/**
 * Documents are private to their uploader unless explicitly shared with the
 * table (runtime.state.sharedDocumentIds). The DM has no special read access —
 * sharing is the only way a document becomes table-visible.
 */
export function visibleDocuments(entry: CampaignEntry, username: string): AssetManifest[] {
  const shared = new Set(entry.runtime.state.sharedDocumentIds);
  return [...entry.store.assets.values()].filter(
    (a) => a.assetKind === 'document' && (a.ownerUsername === username || shared.has(a.id)),
  );
}

/** Push each member their own filtered document list. */
export function broadcastDocuments(campaignId: string, entry: CampaignEntry): void {
  for (const session of getSessionsInRoom(campaignId)) {
    send(session.ws, {
      type: 'documentsUpdated',
      documents: visibleDocuments(entry, session.username),
    });
  }
}
