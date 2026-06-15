import type { AssetManifest } from '@vtt/shared';
import type { CampaignEntry } from '../campaign/registry.js';
import { getSessionsInRoom, send } from './hub.js';
import { canAccessShared, documentSharing, type Viewer } from './sharing.js';

/**
 * Documents a viewer may see: their own uploads, plus any shared with them
 * (scope all / users-including-them). The DM is omniscient.
 */
export function visibleDocuments(entry: CampaignEntry, viewer: Viewer): AssetManifest[] {
  return [...entry.store.assets.values()].filter(
    (a) =>
      a.assetKind === 'document' &&
      canAccessShared(viewer, a.ownerUsername ?? null, documentSharing(entry, a)),
  );
}

/** Push each member their own filtered document list. */
export function broadcastDocuments(campaignId: string, entry: CampaignEntry): void {
  for (const session of getSessionsInRoom(campaignId)) {
    send(session.ws, {
      type: 'documentsUpdated',
      documents: visibleDocuments(entry, {
        userId: session.userId,
        username: session.username,
        role: session.role!,
      }),
    });
  }
}
