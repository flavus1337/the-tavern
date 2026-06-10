import { useState } from 'react';
import type { CampaignListItem, CreateCampaignRequest, CreateCampaignResponse } from '@vtt/shared';
import { api, ApiRequestError } from '../lib/api';
import { useStore } from '../store';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { CreateCampaignDialog } from '../components/dm/CreateCampaignDialog';

export function CampaignLobby() {
  const user = useStore((s) => s.user);
  const campaigns = useStore((s) => s.campaigns);
  const setCampaigns = useStore((s) => s.setCampaigns);
  const setRoute = useStore((s) => s.setRoute);
  const setActiveCampaignId = useStore((s) => s.setActiveCampaignId);
  const activeCampaignId = useStore((s) => s.activeCampaignId);

  const [logoutLoading, setLogoutLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  async function handleLogout() {
    setLogoutLoading(true);
    try {
      await api.post('/api/auth/logout');
    } catch {
      // ignore
    }
    useStore.getState().setUnauthenticated();
    setLogoutLoading(false);
  }

  function enterCampaign(id: string) {
    setActiveCampaignId(id);
    setRoute('table');
  }

  async function refreshCampaigns() {
    try {
      const list = await api.get<CampaignListItem[]>('/api/campaigns');
      setCampaigns(list);
    } catch {
      // ignore
    }
  }

  async function handleCreate(name: string, description: string) {
    const body: CreateCampaignRequest = { name, description: description || undefined };
    const res = await api.post<CreateCampaignResponse>('/api/campaigns', body);
    await refreshCampaigns();
    setCreateOpen(false);
    enterCampaign(res.campaign.id);
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-white">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="font-semibold text-zinc-100">Tabletop</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-400">{user?.username}</span>
          {user?.isAdmin && (
            <Badge variant="dm">Admin</Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            loading={logoutLoading}
            onClick={() => { void handleLogout(); }}
          >
            Sign Out
          </Button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-zinc-100">Your Campaigns</h2>
          {user?.isAdmin && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
              New Campaign
            </Button>
          )}
        </div>

        {campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-zinc-600">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-zinc-400 font-medium">No campaigns yet</p>
            <p className="text-zinc-600 text-sm mt-1">
              {user?.isAdmin ? 'Create your first campaign above.' : 'Ask your DM to invite you to a campaign.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {campaigns.map((c) => (
              <CampaignCard
                key={c.id}
                campaign={c}
                highlighted={c.id === activeCampaignId}
                onEnter={() => enterCampaign(c.id)}
              />
            ))}
          </div>
        )}
      </main>

      <CreateCampaignDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={(name, desc) => handleCreate(name, desc)}
      />
    </div>
  );
}

interface CampaignCardProps {
  campaign: CampaignListItem;
  highlighted: boolean;
  onEnter: () => void;
}

function CampaignCard({ campaign, highlighted, onEnter }: CampaignCardProps) {
  return (
    <div
      className={`
        group bg-zinc-900 border rounded-xl p-5 flex flex-col gap-3
        hover:border-indigo-700 transition-colors cursor-pointer
        ${highlighted ? 'border-indigo-600 ring-1 ring-indigo-600' : 'border-zinc-800'}
      `}
      onClick={onEnter}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEnter(); } }}
      aria-label={`Enter campaign: ${campaign.name}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-zinc-100 text-base leading-snug">{campaign.name}</h3>
        <Badge variant={campaign.role === 'dm' ? 'dm' : 'player'}>
          {campaign.role === 'dm' ? 'DM' : 'Player'}
        </Badge>
      </div>
      {campaign.description && (
        <p className="text-sm text-zinc-500 line-clamp-2">{campaign.description}</p>
      )}
      <div className="mt-auto pt-1">
        <Button size="sm" variant="secondary" className="w-full group-hover:bg-indigo-600 group-hover:text-white group-hover:border-transparent transition-colors">
          Enter Table
        </Button>
      </div>
    </div>
  );
}
