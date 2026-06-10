import { useState, type FormEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { LoginRequest, LoginResponse } from '@vtt/shared';
import { api, ApiRequestError } from '../lib/api';
import { useStore } from '../store';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

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

      // Load campaigns
      const { CampaignListItem } = await import('@vtt/shared').then(() => ({ CampaignListItem: null }));
      void CampaignListItem; // type only
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
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo area */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-600 mb-3">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-white">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-zinc-100">Tabletop</h1>
          <p className="text-zinc-500 text-sm mt-1">Virtual tabletop for D&amp;D</p>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          {inviteToken && (
            <div className="mb-4 p-3 rounded-lg bg-indigo-950 border border-indigo-800 text-sm text-indigo-200">
              You've been invited — log in to join the campaign.{' '}
              <button
                type="button"
                onClick={() => setRoute('register')}
                className="underline text-indigo-300 hover:text-indigo-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
              >
                Register instead
              </button>
            </div>
          )}

          <form onSubmit={(e) => { void handleSubmit(e); }} noValidate>
            <div className="space-y-4">
              <div className="space-y-1.5">
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

              <div className="space-y-1.5">
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
                <div role="alert" className="text-sm text-red-400 bg-red-950/50 border border-red-900 rounded-md p-3">
                  {error}
                  {lockoutSeconds != null && (
                    <span className="block mt-1 text-red-300">
                      Try again in {lockoutSeconds}s
                    </span>
                  )}
                </div>
              )}

              <Button type="submit" loading={loading} className="w-full" size="md">
                Sign In
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
