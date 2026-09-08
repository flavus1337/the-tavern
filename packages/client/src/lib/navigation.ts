import type { CampaignListItem } from '@vtt/shared';
import { useStore } from '../store';

export function campaignFromUrl(href: string): { id: string | null; invalid: boolean } {
  try {
    const values = new URL(href).searchParams.getAll('campaign');
    if (!values.length) return { id: null, invalid: false };
    const id = values[0]!;
    return values.length === 1 && /^[a-zA-Z0-9_-]{1,128}$/.test(id) ? { id, invalid: false } : { id: null, invalid: true };
  } catch { return { id: null, invalid: true }; }
}

export function writeCampaignUrl(id: string | null, replace = false) {
  const url = new URL(window.location.href);
  for (const key of [...url.searchParams.keys()]) if (key !== 'campaign' && key !== 'invite') url.searchParams.delete(key);
  if (id) url.searchParams.set('campaign', id); else url.searchParams.delete('campaign');
  url.hash = '';
  if (url.href !== window.location.href) window.history[replace ? 'replaceState' : 'pushState']({}, '', url);
}

/** Resolve a deep link only against the authenticated member's campaign list. */
export function restoreCampaign(campaigns: CampaignListItem[], joinedId?: string) {
  const requested = campaignFromUrl(window.location.href);
  const id = joinedId ?? requested.id;
  const available = id && campaigns.some((campaign) => campaign.id === id);
  const state = useStore.getState();
  if (!available || state.activeCampaignId !== id) state.resetTable();
  state.setActiveCampaignId(available ? id : null);
  state.setRoute(available ? 'table' : 'lobby');
  writeCampaignUrl(available ? id : null, true);
  if (!available && (id || requested.invalid)) state.setLastErrorMessage('This table is unavailable or you do not have access. Choose one of your campaigns or ask its DM for an invite.');
}

export function enterCampaign(id: string) {
  const state = useStore.getState();
  if (!state.campaigns.some((campaign) => campaign.id === id)) return;
  writeCampaignUrl(id);
  if (state.activeCampaignId !== id) state.resetTable();
  state.setActiveCampaignId(id);
  state.setRoute('table');
}

/** Build's next step mounts the existing DM tools before selecting Invites. */
export function openInvites() {
  useStore.getState().setEditorMode('play');
  window.dispatchEvent(new CustomEvent('vtt:switch-sidebar-tab', { detail: 'dm' }));
  requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('vtt:dm-tab', { detail: 'invites' })));
}

/** Called only for settled app navigation; sign-in/loading must retain deep links. */
export function syncCampaignUrl() {
  const state = useStore.getState();
  if (!state.authChecked || !state.user) return;
  if (state.route === 'table' && state.activeCampaignId) writeCampaignUrl(state.activeCampaignId);
  else if (state.route === 'lobby') writeCampaignUrl(null);
}

export function handleCampaignPopState() {
  const state = useStore.getState();
  if (!state.authChecked) return;
  if (state.user) restoreCampaign(state.campaigns);
  else state.setRoute(state.inviteToken ? 'register' : 'login');
}
