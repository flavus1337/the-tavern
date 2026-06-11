import { Component, useEffect, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { MeResponse, CampaignListItem, RedeemInviteResponse } from '@vtt/shared';
import { api, ApiRequestError } from './lib/api';
import { useStore } from './store';
import { LoginScreen } from './screens/LoginScreen';
import { RegisterScreen } from './screens/RegisterScreen';
import { CampaignLobby } from './screens/CampaignLobby';
import { TableLayout } from './components/TableLayout';

// ---------------------------------------------------------------------------
// Error Boundary
// ---------------------------------------------------------------------------

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

/**
 * A failed dynamic import almost always means the server was rebuilt/restarted
 * while this tab held a stale bundle: the old hashed chunk (e.g. the lazy PDF
 * viewer or its pdf.js worker) no longer exists. The fix is to load the new
 * bundle, so we reload once automatically.
 */
function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|Loading chunk|Importing a module script failed|Failed to fetch/i.test(msg);
}
const RELOAD_FLAG = 'vtt_chunk_reload';

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    // Auto-recover from a stale-bundle chunk error, but only once per tab so a
    // genuinely broken chunk can't cause a reload loop.
    if (isChunkLoadError(error) && !sessionStorage.getItem(RELOAD_FLAG)) {
      sessionStorage.setItem(RELOAD_FLAG, '1');
      window.location.reload();
    }
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg)' }}>
          <div className="text-center max-w-sm">
            <p className="mb-2 font-medium" style={{ color: 'var(--mid)' }}>Something went wrong</p>
            <p className="text-sm mb-4" style={{ color: 'var(--faint)' }}>{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm transition-colors"
              style={{ background: 'var(--surface2)', color: 'var(--hi)', borderRadius: 9, border: '1px solid var(--border)' }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// App bootstrap
// ---------------------------------------------------------------------------

function AppContent() {
  const route = useStore((s) => s.route);
  const authChecked = useStore((s) => s.authChecked);
  const {
    setUser,
    setAuthChecked,
    setRoute,
    setInviteToken,
    clearInviteToken,
    setCampaigns,
    setActiveCampaignId,
  } = useStore(
    useShallow((s) => ({
      setUser: s.setUser,
      setAuthChecked: s.setAuthChecked,
      setRoute: s.setRoute,
      setInviteToken: s.setInviteToken,
      clearInviteToken: s.clearInviteToken,
      setCampaigns: s.setCampaigns,
      setActiveCampaignId: s.setActiveCampaignId,
    })),
  );

  useEffect(() => {
    // The app mounted, so the bundle is good — reset the chunk-reload guard so a
    // future restart can auto-recover again.
    sessionStorage.removeItem('vtt_chunk_reload');

    async function bootstrap() {
      // 1. Parse ?invite= from URL
      const params = new URLSearchParams(window.location.search);
      const inviteToken = params.get('invite');
      if (inviteToken) {
        setInviteToken(inviteToken);
      }

      // 2. Check auth
      try {
        const me = await api.get<MeResponse>('/api/auth/me');
        setUser(me.user);

        // 3. Redeem invite if present, then load campaigns
        if (inviteToken) {
          try {
            const redeemRes = await api.post<RedeemInviteResponse>(`/api/invites/${inviteToken}/redeem`);
            clearInviteToken();
            const campaigns = await api.get<CampaignListItem[]>('/api/campaigns');
            setCampaigns(campaigns);
            setActiveCampaignId(redeemRes.joinedCampaignId);
          } catch {
            // Invite redeem failed (already member, etc.) — still load campaigns
            clearInviteToken();
            const campaigns = await api.get<CampaignListItem[]>('/api/campaigns');
            setCampaigns(campaigns);
          }
        } else {
          const campaigns = await api.get<CampaignListItem[]>('/api/campaigns');
          setCampaigns(campaigns);
        }

        setRoute('lobby');
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) {
          // Not authenticated
          setRoute(inviteToken ? 'register' : 'login');
        } else {
          // Unexpected error — go to login
          setRoute(inviteToken ? 'register' : 'login');
        }
      } finally {
        setAuthChecked(true);
      }
    }

    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="text-sm animate-pulse" style={{ color: 'var(--faint)' }}>Loading…</div>
      </div>
    );
  }

  switch (route) {
    case 'login':
      return <LoginScreen />;
    case 'register':
      return <RegisterScreen />;
    case 'lobby':
      return <CampaignLobby />;
    case 'table':
      return <TableLayout />;
    default:
      return <LoginScreen />;
  }
}

export function App() {
  return (
    <AppErrorBoundary>
      <AppContent />
    </AppErrorBoundary>
  );
}
