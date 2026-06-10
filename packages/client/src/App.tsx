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

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="text-center max-w-sm">
            <p className="text-zinc-400 mb-2 font-medium">Something went wrong</p>
            <p className="text-zinc-600 text-sm mb-4">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-zinc-800 text-zinc-200 rounded-md text-sm hover:bg-zinc-700 transition-colors"
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-zinc-600 text-sm animate-pulse">Loading…</div>
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
