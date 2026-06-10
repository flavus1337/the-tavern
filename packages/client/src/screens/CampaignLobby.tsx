import { useState } from 'react';
import type { CampaignListItem, CreateCampaignRequest, CreateCampaignResponse } from '@vtt/shared';
import { api, ApiRequestError } from '../lib/api';
import { useStore } from '../store';
import { Button } from '../components/ui/button';
import { D20Logo } from '../components/D20Logo';
import { CreateCampaignDialog } from '../components/dm/CreateCampaignDialog';
import lobbyBg from '../assets/lobby-tavern.png';

// Avatar gradient assignments (stable by index)
const PLAYER_GRADIENTS = [
  'linear-gradient(135deg,#5b86c2,#41609c)',
  'linear-gradient(135deg,#5bb3a3,#3f8c7f)',
  'linear-gradient(135deg,#c79a4b,#a07a32)',
];
const DM_GRADIENT = 'linear-gradient(135deg,#c2596a,#9c4150)';

function avatarGradient(role: string, index: number): string {
  if (role === 'dm') return DM_GRADIENT;
  return PLAYER_GRADIENTS[index % PLAYER_GRADIENTS.length] ?? DM_GRADIENT;
}

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

  // Sort campaigns: most recent (active) first, then alphabetically
  const sorted = [...campaigns].sort((a, b) => {
    if (a.id === activeCampaignId) return -1;
    if (b.id === activeCampaignId) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div
      className="relative overflow-hidden"
      style={{ height: '100dvh', width: '100vw', background: 'var(--bg)' }}
    >
      {/* Tavern backdrop */}
      <div
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `url(${lobbyBg})`,
          backgroundPosition: 'center 42%',
          backgroundSize: 'cover',
          filter: 'brightness(1.32) saturate(1.08)',
        }}
        aria-hidden="true"
      />

      {/* Lobby scrims */}
      <div
        className="absolute inset-0 z-[1] pointer-events-none"
        style={{
          background: `
            linear-gradient(180deg, #0c0a09f2 0%, #0c0a09b0 9%, #0c0a0950 24%, transparent 46%),
            linear-gradient(90deg, #0c0a0985 0%, #0c0a0938 32%, transparent 56%)
          `,
        }}
        aria-hidden="true"
      />

      {/* Glass top bar */}
      <header
        className="absolute top-0 left-0 right-0 z-[5] flex items-center justify-between"
        style={{
          height: 60,
          padding: '0 22px',
          background: 'rgba(12,10,9,0.72)',
          backdropFilter: 'blur(14px) saturate(130%)',
          WebkitBackdropFilter: 'blur(14px) saturate(130%)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <div className="flex items-center gap-[11px]" style={{ color: 'var(--ember)' }}>
          <D20Logo size={30} />
          <span style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 600, color: 'var(--hi)', letterSpacing: '-0.01em' }}>
            The Tavern
          </span>
        </div>

        <div className="flex items-center gap-[14px]">
          {/* Avatar */}
          <div
            style={{
              width: 28, height: 28, borderRadius: '50%',
              background: avatarGradient(user?.isAdmin ? 'dm' : 'player', 0),
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, color: '#fff',
              border: '1.5px solid var(--bg)', flexShrink: 0,
            }}
            aria-hidden="true"
          >
            {user?.username.slice(0, 2).toUpperCase()}
          </div>
          <span style={{ fontSize: 13, color: 'var(--mid)' }}>{user?.username}</span>
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

      {/* Main content — scrollable below top bar */}
      <main
        className="absolute left-0 right-0 bottom-0 overflow-auto z-[2]"
        style={{ top: 60, padding: '44px 7vw' }}
      >
        {/* Heading */}
        <div className="flex items-baseline justify-between mb-7" style={{ maxWidth: 1080 }}>
          <h1 style={{ fontFamily: 'var(--serif)', fontSize: 32, fontWeight: 600, color: 'var(--hi)' }}>
            Your Campaigns
          </h1>
        </div>

        {/* Campaign grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 332px))',
            gap: 18,
            maxWidth: 1080,
          }}
        >
          {sorted.map((c, i) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              isPrimary={i === 0}
              onEnter={() => enterCampaign(c.id)}
            />
          ))}

          {/* New Campaign tile — admin only */}
          {user?.isAdmin && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              style={{
                border: '1px dashed var(--border)',
                background: 'rgba(20,15,13,0.69)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                borderRadius: 14,
                minHeight: 210,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                color: 'var(--low)',
                cursor: 'pointer',
                transition: 'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--ember)';
                (e.currentTarget as HTMLElement).style.color = 'var(--ember)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
                (e.currentTarget as HTMLElement).style.color = 'var(--low)';
              }}
              aria-label="New Campaign"
            >
              <span style={{ fontSize: 24, lineHeight: 1 }}>＋</span>
              <span style={{ fontFamily: 'var(--serif)', fontSize: 17, fontWeight: 600 }}>New Campaign</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.7 }}>
                Light a new fire
              </span>
            </button>
          )}
        </div>

        {/* Empty state (no campaigns, non-admin) */}
        {campaigns.length === 0 && !user?.isAdmin && (
          <div className="text-center py-20">
            <p style={{ fontSize: 15, color: 'var(--mid)' }}>No campaigns yet.</p>
            <p style={{ fontSize: 13, color: 'var(--faint)', marginTop: 6 }}>Ask your DM to invite you to a campaign.</p>
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
  isPrimary: boolean;
  onEnter: () => void;
}

function CampaignCard({ campaign, isPrimary, onEnter }: CampaignCardProps) {
  const isDm = campaign.role === 'dm';

  return (
    <div
      style={{
        background: 'rgba(26,21,18,0.93)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        boxShadow: '0 20px 50px -20px #000c',
        position: 'relative',
        overflow: 'hidden',
        transition: 'border-color 0.15s, transform 0.12s, box-shadow 0.15s',
        cursor: 'pointer',
      }}
      onClick={onEnter}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = '#5a4a40';
        el.style.transform = 'translateY(-2px)';
        el.style.boxShadow = '0 28px 60px -18px #000e, 0 0 0 1px #e0824c22';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = 'var(--border)';
        el.style.transform = '';
        el.style.boxShadow = '0 20px 50px -20px #000c';
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEnter(); } }}
      aria-label={`Enter campaign: ${campaign.name}`}
    >
      {/* Decorative radial ember highlight */}
      <div
        style={{
          position: 'absolute', right: -30, top: -30, width: 120, height: 120,
          background: 'radial-gradient(circle, #e0824c14, transparent 70%)',
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      />

      {/* Name + role badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
        <h3 style={{ fontFamily: 'var(--serif)', fontSize: 21, fontWeight: 600, color: 'var(--hi)', lineHeight: 1.2 }}>
          {campaign.name}
        </h3>
        <span
          style={{
            fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
            padding: '3px 8px', borderRadius: 5, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
            color: isDm ? 'var(--garnet)' : 'var(--ember)',
            background: isDm ? '#b6485a1f' : '#e08a4b1a',
          }}
        >
          {isDm ? 'DM' : 'PLAYER'}
        </span>
      </div>

      {/* Description */}
      {campaign.description && (
        <p style={{ fontSize: 14, color: 'var(--low)', marginBottom: 18, flex: 1, lineHeight: 1.5 }}>
          {campaign.description}
        </p>
      )}

      <div style={{ marginTop: 'auto', paddingTop: campaign.description ? 0 : 16 }}>
        {/* CTA */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEnter(); }}
          style={{
            width: '100%',
            padding: '11px 16px',
            borderRadius: 9,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s',
            background: isPrimary ? 'var(--ember)' : 'transparent',
            color: isPrimary ? 'var(--ink)' : 'var(--hi)',
            border: isPrimary ? 'none' : '1px solid var(--border)',
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLElement;
            if (isPrimary) {
              el.style.background = 'var(--ember-h)';
              el.style.boxShadow = '0 0 22px -6px rgba(224,138,75,0.67)';
            } else {
              el.style.borderColor = '#473b34';
              el.style.background = '#ffffff06';
            }
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLElement;
            if (isPrimary) {
              el.style.background = 'var(--ember)';
              el.style.boxShadow = '';
            } else {
              el.style.borderColor = 'var(--border)';
              el.style.background = 'transparent';
            }
          }}
        >
          {isPrimary ? 'Enter the Table' : 'Open Table'}
        </button>
      </div>
    </div>
  );
}
