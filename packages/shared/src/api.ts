// HTTP API DTOs — request/response shapes for the REST API.
import type { AssetManifest } from './campaign.js';

/** Re-export/alias for use in API response types. */
export type AssetManifestDto = AssetManifest;

export interface PublicUser {
  id: string;
  username: string;
  isAdmin: boolean;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** POST /api/auth/register — invite REQUIRED; no open signup. */
export interface RegisterRequest {
  username: string;
  password: string;
  inviteToken: string;
}

export interface RegisterResponse {
  user: PublicUser;
  joinedCampaignId: string;
}

/** POST /api/auth/login — inviteToken optional. */
export interface LoginRequest {
  username: string;
  password: string;
  inviteToken?: string;
}

export interface LoginResponse {
  user: PublicUser;
  joinedCampaignId?: string;
}

/** GET /api/auth/me */
export interface MeResponse {
  user: PublicUser;
}

// POST /api/auth/logout → 204 (no body)

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

/** GET /api/invites/:token — public preview. */
export type InvitePreviewResponse =
  | { valid: true; campaignName: string }
  | { valid: false; reason: 'expired' | 'revoked' | 'exhausted' | 'unknown' };

/** POST /api/invites/:token/redeem (auth) */
export interface RedeemInviteResponse {
  joinedCampaignId: string;
}

/** POST /api/campaigns/:id/invites (dm) */
export interface CreateInviteRequest {
  expiresInHours?: number;
  maxUses?: number;
}

export interface CreateInviteResponse {
  token: string;
  url: string;
}

/** GET /api/campaigns/:id/invites (dm) */
export interface InviteSummary {
  token: string;
  createdAt: string;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
  revoked: boolean;
}

// DELETE /api/campaigns/:id/invites/:token (dm) → 204

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

/** GET /api/campaigns (auth) */
export interface CampaignListItem {
  id: string;
  name: string;
  description: string;
  role: 'dm' | 'player';
}

/** POST /api/campaigns (admin) */
export interface CreateCampaignRequest {
  name: string;
  description?: string;
}

export interface CreateCampaignResponse {
  campaign: CampaignListItem;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/**
 * POST /api/campaigns/:id/assets (dm, multipart image)
 * POST /api/campaigns/:id/documents (any member, multipart pdf)
 */
export interface UploadAssetResponse {
  asset: AssetManifestDto;
}

// DELETE /api/campaigns/:id/assets/:assetId (asset owner or dm) → 204
// GET /api/campaigns/:id/files/assets/:filename — member-gated binary serving

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string;
  code?: string;
  lockedForSeconds?: number;
}
