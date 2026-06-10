import { useState, useEffect, type FormEvent } from 'react';
import type { InvitePreviewResponse, RegisterRequest, RegisterResponse, CampaignListItem } from '@vtt/shared';
import { api, ApiRequestError } from '../lib/api';
import { useStore } from '../store';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { D20Logo } from '../components/D20Logo';
import loginHero from '../assets/login-hero.png';

// Shared hero/card layout wrapper. Defined at module scope — defining it inside
// the screen would create a new component type on every render, remounting the
// subtree and dropping input focus on each keystroke.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative min-h-screen w-full overflow-hidden flex items-center"
      style={{ background: 'var(--bg)' }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 z-0"
        style={{ backgroundImage: `url(${loginHero})`, backgroundPosition: 'center 38%', backgroundSize: 'cover' }}
        aria-hidden="true"
      />
      {/* Scrim */}
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
      <div className="relative z-[3] w-full max-w-[1240px] mx-auto px-[6vw] py-12">
        <div className="max-w-[392px]">
          {/* Brand */}
          <div className="flex items-center gap-[11px] mb-6" style={{ color: 'var(--ember)' }}>
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
          {children}
        </div>
      </div>
    </div>
  );
}

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

  const campaignName = preview?.valid ? preview.campaignName : null;
  const dmName = preview?.valid && 'dmUsername' in preview ? (preview as { dmUsername?: string }).dmUsername : null;

  if (!inviteToken) {
    return (
      <Shell>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 16 }}>🔒</div>
          <h2 style={{ fontFamily: 'var(--serif)', fontSize: 21, fontWeight: 600, color: 'var(--hi)', marginBottom: 10 }}>Invite Only</h2>
          <p style={{ fontSize: 14, color: 'var(--mid)', marginBottom: 20, lineHeight: 1.6 }}>
            Registration requires an invitation link. Ask your DM to invite you.
          </p>
          <Button variant="secondary" onClick={() => setRoute('login')}>
            Back to Login
          </Button>
        </div>
      </Shell>
    );
  }

  if (previewLoading) {
    return (
      <Shell>
        <p style={{ color: 'var(--mid)', fontFamily: 'var(--mono)' }}>Validating invite…</p>
      </Shell>
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
      <Shell>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 16 }}>❌</div>
          <h2 style={{ fontFamily: 'var(--serif)', fontSize: 21, fontWeight: 600, color: 'var(--hi)', marginBottom: 10 }}>Invalid Invite</h2>
          <p style={{ fontSize: 14, color: 'var(--mid)', marginBottom: 20, lineHeight: 1.6 }}>
            {reasons[preview.reason] ?? 'This invite is invalid.'}
          </p>
          <Button variant="secondary" onClick={() => setRoute('login')}>
            Back to Login
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* Lead line */}
      <p style={{ fontFamily: 'var(--serif)', fontWeight: 300, fontSize: 19, color: 'var(--mid)', margin: '0 0 30px', lineHeight: 1.5 }}>
        Pull up a chair. Your party is{' '}
        <em style={{ color: 'var(--gold)', fontStyle: 'italic' }}>waiting by the fire.</em>
      </p>

      {/* Card */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 24 }}>

        {/* Invite line */}
        {campaignName && (
          <div style={{ fontSize: 13, color: 'var(--low)', marginBottom: 18, paddingBottom: 16, borderBottom: '1px solid var(--border-soft)', lineHeight: 1.5 }}>
            You've been invited to{' '}
            <strong style={{ color: 'var(--ember)', fontWeight: 600, fontFamily: 'var(--serif)', fontSize: 14 }}>
              {campaignName}
            </strong>
            {dmName ? ` by ${dmName}.` : '.'}
          </div>
        )}

        <form onSubmit={(e) => { void handleSubmit(e); }} noValidate>
          <div className="space-y-4">
            <div>
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

            <div>
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

            <div>
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
              <div role="alert" style={{ fontSize: 13, color: 'var(--garnet)', background: '#b6485a18', border: '1px solid #b6485a44', borderRadius: 9, padding: '10px 13px' }}>
                {validationError ?? error}
              </div>
            )}

            <Button type="submit" loading={loading} className="w-full" size="md">
              Create Account &amp; Join
            </Button>

            <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--faint)' }}>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => setRoute('login')}
                style={{ color: 'var(--ember)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}
              >
                Sign in
              </button>
            </p>
          </div>
        </form>
      </div>
    </Shell>
  );
}
