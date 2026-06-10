import { useState, useEffect, type FormEvent } from 'react';
import type { InvitePreviewResponse, RegisterRequest, RegisterResponse, CampaignListItem } from '@vtt/shared';
import { api, ApiRequestError } from '../lib/api';
import { useStore } from '../store';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';

export function RegisterScreen() {
  const inviteToken = useStore((s) => s.inviteToken);
  const setRoute = useStore((s) => s.setRoute);
  const setUser = useStore((s) => s.setUser);
  const setCampaigns = useStore((s) => s.setCampaigns);
  const setActiveCampaignId = useStore((s) => s.setActiveCampaignId);
  const clearInviteToken = useStore((s) => s.clearInviteToken);

  const [preview, setPreview] = useState<InvitePreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // If no invite token, show friendly message
  useEffect(() => {
    if (!inviteToken) {
      setPreviewLoading(false);
      return;
    }
    api.get<InvitePreviewResponse>(`/api/invites/${inviteToken}`)
      .then((res) => setPreview(res))
      .catch(() => setPreview({ valid: false, reason: 'unknown' }))
      .finally(() => setPreviewLoading(false));
  }, [inviteToken]);

  function validate(): boolean {
    setValidationError(null);
    if (password.length < 8) {
      setValidationError('Password must be at least 8 characters');
      return false;
    }
    if (password !== confirm) {
      setValidationError('Passwords do not match');
      return false;
    }
    return true;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    if (!inviteToken) return;

    setError(null);
    setLoading(true);

    try {
      const body: RegisterRequest = { username, password, inviteToken };
      const res = await api.post<RegisterResponse>('/api/auth/register', body);
      setUser(res.user);

      const campaigns = await api.get<CampaignListItem[]>('/api/campaigns');
      setCampaigns(campaigns);

      clearInviteToken();
      setActiveCampaignId(res.joinedCampaignId);
      setRoute('lobby');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred');
      }
    } finally {
      setLoading(false);
    }
  }

  if (!inviteToken) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8">
            <div className="text-4xl mb-4">🔒</div>
            <h2 className="text-xl font-semibold text-zinc-100 mb-2">Invite Only</h2>
            <p className="text-zinc-400 text-sm mb-4">
              Registration requires an invitation link. Ask your DM to invite you.
            </p>
            <Button variant="secondary" onClick={() => setRoute('login')}>
              Back to Login
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (previewLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-zinc-400">Validating invite…</div>
      </div>
    );
  }

  if (preview && !preview.valid) {
    const reasons: Record<string, string> = {
      expired: 'This invite link has expired.',
      revoked: 'This invite has been revoked.',
      exhausted: 'This invite has reached its maximum uses.',
      unknown: 'This invite is invalid.',
    };
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8">
            <div className="text-4xl mb-4">❌</div>
            <h2 className="text-xl font-semibold text-zinc-100 mb-2">Invalid Invite</h2>
            <p className="text-zinc-400 text-sm mb-4">
              {reasons[preview.reason] ?? 'This invite is invalid.'}
            </p>
            <Button variant="secondary" onClick={() => setRoute('login')}>
              Back to Login
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const campaignName = preview?.valid ? preview.campaignName : null;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-600 mb-3">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-white">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-zinc-100">Create Account</h1>
          {campaignName && (
            <p className="text-indigo-300 text-sm mt-1">
              You're invited to <strong>{campaignName}</strong>
            </p>
          )}
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <form onSubmit={(e) => { void handleSubmit(e); }} noValidate>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reg-username">Username</Label>
                <Input
                  id="reg-username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  placeholder="Choose a username"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reg-password">Password</Label>
                <Input
                  id="reg-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  placeholder="At least 8 characters"
                  error={!!validationError && password.length > 0 && password.length < 8}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reg-confirm">Confirm Password</Label>
                <Input
                  id="reg-confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={loading}
                  placeholder="Repeat your password"
                  error={!!validationError && confirm.length > 0 && confirm !== password}
                />
              </div>

              {(validationError ?? error) && (
                <div role="alert" className="text-sm text-red-400 bg-red-950/50 border border-red-900 rounded-md p-3">
                  {validationError ?? error}
                </div>
              )}

              <Button type="submit" loading={loading} className="w-full" size="md">
                Create Account &amp; Join
              </Button>

              <p className="text-center text-zinc-500 text-xs">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => setRoute('login')}
                  className="text-indigo-400 hover:text-indigo-200 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
                >
                  Sign in
                </button>
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
