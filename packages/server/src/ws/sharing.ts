import type { Role, Sharing } from '@vtt/shared';
import type { AssetManifest } from '@vtt/shared';
import type { CampaignEntry } from '../campaign/registry.js';

export interface Viewer {
  userId: string;
  username: string;
  role: Role;
}

/**
 * Read access for notes & documents. The DM is omniscient; the owner always
 * sees their own; otherwise the scope decides. 'dm' means owner + DM only.
 */
export function canAccessShared(viewer: Viewer, ownerUsername: string | null, sharing: Sharing): boolean {
  if (viewer.role === 'dm') return true;
  if (ownerUsername && ownerUsername === viewer.username) return true;
  switch (sharing.scope) {
    case 'all':
      return true;
    case 'users':
      return sharing.userIds.includes(viewer.userId);
    case 'dm':
    case 'private':
      return false;
  }
}

/**
 * Control (move/edit) for tokens. DM always; owner always; otherwise the
 * control-share scope decides. ('dm'/'private' both mean owner + DM only.)
 */
export function canControlToken(viewer: Viewer, ownerUserId: string | null, sharing: Sharing): boolean {
  if (viewer.role === 'dm') return true;
  if (ownerUserId && ownerUserId === viewer.userId) return true;
  switch (sharing.scope) {
    case 'all':
      return true;
    case 'users':
      return sharing.userIds.includes(viewer.userId);
    default:
      return false;
  }
}

/**
 * Effective sharing for a document. Prefer the manifest field; fall back to the
 * legacy runtime.sharedDocumentIds list (pre-v5 data) → 'all', else private.
 */
export function documentSharing(entry: CampaignEntry, manifest: AssetManifest): Sharing {
  if (manifest.sharing) return manifest.sharing;
  const legacyShared = entry.runtime.state.sharedDocumentIds.includes(manifest.id);
  return legacyShared ? { scope: 'all', userIds: [] } : { scope: 'private', userIds: [] };
}
