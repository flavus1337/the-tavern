import { useState, type FormEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { LoginRequest, LoginResponse } from '@vtt/shared';
import { api, ApiRequestError } from '../lib/api';
import { useStore } from '../store';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { D20Logo } from '../components/D20Logo';
import loginHero from '../assets/login-hero.png';

export function LoginScreen() {
  const { inviteToken, setRoute, setUser, setCampaigns } = useStore(
    useShallow((s) => ({
      inviteToken: s.inviteToken,
      setRoute: s.setRoute,
      setUser: s.setUser,
      setCampaigns: s.setCampaigns,
      clearInviteToken: s.clearInviteToken,
    })),
  );
  const clearInviteToken = useStore((s) => s.clearInviteToken);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockoutSeconds, setLockoutSeconds] = useState<number | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLockoutSeconds(null);
    setLoading(true);

    try {
      const body: LoginRequest = { username, password };
      if (inviteToken) body.inviteToken = inviteToken;

      const res = await api.post<LoginResponse>('/api/auth/login', body);
      setUser(res.user);

      const { CampaignListItem } = await import('@vtt/shared').then(() => ({ CampaignListItem: null }));
      void CampaignListItem;
      const campaigns = await api.get<import('@vtt/shared').CampaignListItem[]>('/api/campaigns');
      setCampaigns(campaigns);

      if (inviteToken) clearInviteToken();
      setRoute('lobby');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
        if (err.lockedForSeconds != null) setLockoutSeconds(err.lockedForSeconds);
      } else {
        setError('An unexpected error occurred');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="relative min-h-screen w-full overflow-hidden flex items-center"
      style={{ background: 'var(--bg)' }}
    >
      {/* Backdrop: hero image */}
      <div
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `url(${loginHero})`,
          backgroundPosition: 'center 38%',
          backgroundSize: 'cover',
        }}
        aria-hidden="true"
      />

      {/* Scrim stack */}
      <div
        className="absolute inset-0 z-[1] pointer-events-none"
        style={{
          background: `
            linear-gradient(90deg, #0c0a09f2 0%, #0c0a09cc 20%, #0c0a0955 40%, transparent 60%),
            linear-gradient(0deg, #0c0a09d9, transparent 32%),
            radial-gradient(55% 65% at 74% 42%, #e0824c16, transparent 70%),
            radial-gradient(125% 105% at 50% 50%, transparent 58%, #0c0a09 100%)
          `,
        }}
        aria-hidden="true"
      />

      {/* Content */}
      <div className="relative z-[3] w-full max-w-[1240px] mx-auto px-[6vw] py-12">
        <div className="max-w-[392px]">

          {/* Brand block */}
          <div className="flex flex-col gap-1 mb-1" style={{ color: 'var(--ember)' }}>
            <div className="flex items-center gap-[11px]">
              <D20Logo size={40} />
              <div>
                <div style={{ fontFamily: 'var(--serif)', fontSize: 30, fontWeight: 600, color: 'var(--hi)', letterSpacing: '-0.01em', lineHeight: 1.1 }}>
                  The Tavern
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--low)', marginTop: 4 }}>
                  GATHER · ROLL · ADVENTURE
                </div>
              </div>
            </div>
          </div>

          {/* Lead line */}
          <p style={{ fontFamily: 'var(--serif)', fontWeight: 300, fontSize: 19, color: 'var(--mid)', margin: '20px 0 30px', lineHeight: 1.5 }}>
            Pull up a chair. Your party is{' '}
            <em style={{ color: 'var(--gold)', fontStyle: 'italic' }}>waiting by the fire.</em>
          </p>

          {/* Card */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 24 }}>

            {/* Invite line (login with token) */}
            {inviteToken && (
              <div style={{ fontSize: 13, color: 'var(--low)', marginBottom: 18, paddingBottom: 16, borderBottom: '1px solid var(--border-soft)', lineHeight: 1.5 }}>
                You've been invited — log in to join the campaign.{' '}
                <button
                  type="button"
                  onClick={() => setRoute('register')}
                  style={{ color: 'var(--ember)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}
                >
                  Register instead
                </button>
              </div>
            )}

            <form onSubmit={(e) => { void handleSubmit(e); }} noValidate>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    type="text"
                    autoComplete="username"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={loading}
                    placeholder="Your username"
                  />
                </div>

                <div>
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    placeholder="••••••••"
                  />
                </div>

                {error && (
                  <div role="alert" style={{ fontSize: 13, color: 'var(--garnet)', background: '#b6485a18', border: '1px solid #b6485a44', borderRadius: 9, padding: '10px 13px' }}>
                    {error}
                    {lockoutSeconds != null && (
                      <span style={{ display: 'block', marginTop: 4, color: 'var(--mid)' }}>
                        Try again in {lockoutSeconds}s
                      </span>
                    )}
                  </div>
                )}

                <Button type="submit" loading={loading} className="w-full" size="md">
                  Enter the Tavern
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
