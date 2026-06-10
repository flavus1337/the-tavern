import { useState, useEffect, type FormEvent } from 'react';
import type { CreateInviteRequest, CreateInviteResponse, InviteSummary } from '@vtt/shared';
import { api, ApiRequestError } from '../../lib/api';
import { useStore } from '../../store';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';

export function InviteManager() {
  const campaignId = useStore((s) => s.activeCampaignId);
  const [invites, setInvites] = useState<InviteSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create invite form
  const [expiresHours, setExpiresHours] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [creating, setCreating] = useState(false);
  const [newInviteUrl, setNewInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function fetchInvites() {
    if (!campaignId) return;
    setLoading(true);
    try {
      const res = await api.get<{ invites: InviteSummary[] }>(`/api/campaigns/${campaignId}/invites`);
      setInvites(res.invites);
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!campaignId) return;
    setCreating(true);
    setError(null);
    setNewInviteUrl(null);
    try {
      const body: CreateInviteRequest = {};
      if (expiresHours) body.expiresInHours = parseInt(expiresHours, 10);
      if (maxUses) body.maxUses = parseInt(maxUses, 10);
      const res = await api.post<CreateInviteResponse>(`/api/campaigns/${campaignId}/invites`, body);
      setNewInviteUrl(res.url);
      setExpiresHours('');
      setMaxUses('');
      await fetchInvites();
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(token: string) {
    if (!campaignId) return;
    try {
      await api.del(`/api/campaigns/${campaignId}/invites/${token}`);
      await fetchInvites();
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
    }
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <div className="p-4 space-y-5">
      <form onSubmit={(e) => { void handleCreate(e); }} className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-200">Create Invite Link</h3>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="inv-expires" className="text-xs">Expires (hours)</Label>
            <Input
              id="inv-expires"
              type="number"
              min="1"
              value={expiresHours}
              onChange={(e) => setExpiresHours(e.target.value)}
              placeholder="Never"
              className="text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-uses" className="text-xs">Max Uses</Label>
            <Input
              id="inv-uses"
              type="number"
              min="1"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="Unlimited"
              className="text-xs"
            />
          </div>
        </div>
        <Button type="submit" loading={creating} size="sm" className="w-full">
          Generate Link
        </Button>
      </form>

      {newInviteUrl && (
        <div className="bg-zinc-950 border border-zinc-700 rounded-lg p-3 space-y-2">
          <p className="text-xs text-zinc-400">Invite link (share this):</p>
          <div className="flex gap-2">
            <code className="flex-1 text-xs text-indigo-300 break-all">{newInviteUrl}</code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => { void copyUrl(newInviteUrl); }}
              className="shrink-0"
            >
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="text-xs text-red-400 bg-red-950/50 border border-red-900 rounded p-2">
          {error}
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-zinc-200 mb-2">Existing Invites</h3>
        {loading ? (
          <p className="text-xs text-zinc-500">Loading…</p>
        ) : invites.length === 0 ? (
          <p className="text-xs text-zinc-500">No invites yet.</p>
        ) : (
          <div className="space-y-2">
            {invites.map((inv) => (
              <div
                key={inv.token}
                className="flex items-center gap-2 p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <code className="text-xs text-zinc-400 truncate block">{inv.token.slice(0, 12)}…</code>
                  <p className="text-xs text-zinc-600 mt-0.5">
                    {inv.uses}/{inv.maxUses ?? '∞'} uses
                    {inv.expiresAt && ` · expires ${new Date(inv.expiresAt).toLocaleDateString()}`}
                  </p>
                </div>
                {inv.revoked ? (
                  <Badge variant="destructive">Revoked</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => { void handleRevoke(inv.token); }}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
