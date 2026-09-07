import { useRef, useState } from 'react';
import type { ServerCommandAckPayload } from '@vtt/shared';
import { CommandError, sendCommand, type DurableCommand } from '../ws/connection';
import { useStore } from '../store';
import { Button } from './ui/button';

export function useSaveCommand() {
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<CommandError | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const blocked = error?.uncertain === true && !reviewed;
  async function run(message: DurableCommand): Promise<ServerCommandAckPayload | undefined> {
    if (busy.current || blocked) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    setReviewed(false);
    useStore.getState().setLastErrorMessage(null);
    try { return await sendCommand(message); }
    catch (err) { setError(err instanceof CommandError ? err : new CommandError(String(err), 'INTERNAL')); }
    finally { busy.current = false; setSaving(false); }
  }
  return { saving, error, blocked, run, clearError: () => { setError(null); }, review: () => setReviewed(true) };
}

export function SaveFeedback({ save, conflicts, latest, onUseTable, onKeepChanges }: {
  save: ReturnType<typeof useSaveCommand>;
  conflicts: string[];
  latest: object;
  onUseTable: () => void;
  onKeepChanges: () => void;
}) {
  const connected = useStore((s) => s.connection === 'open');
  const members = useStore((s) => s.members);
  const conflict = conflicts.length > 0 || save.error?.code === 'CONFLICT';
  const labels: Record<string, string> = { title: 'Title', body: 'Text', summary: 'Summary', name: 'Name', hp: 'Current HP', maxHp: 'Maximum HP', conditions: 'Conditions', sharing: 'Shared with', ownerUserId: 'Controlled by', dmOnly: 'Hidden from players', statBlock: 'Combat stats', fill: 'Colour', ac: 'Armour class', speed: 'Speed', notes: 'Notes' };
  const label = (key: string) => labels[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
  function display(key: string, value: unknown): string {
    if (key === 'ownerUserId') return members.find((m) => m.userId === value)?.username ?? 'DM only';
    if (key === 'sharing' && value && typeof value === 'object') {
      const sharing = value as { scope: string; userIds: string[] };
      return sharing.scope === 'all' ? 'Everyone' : sharing.scope === 'dm' ? 'DM' : sharing.scope === 'private' ? 'Private' :
        sharing.userIds.map((id) => members.find((m) => m.userId === id)?.username ?? 'Campaign member').join(', ');
    }
    if (value === null || value === undefined || value === '') return 'Not set';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.length ? value.join(', ') : 'None';
    if (typeof value === 'object') return Object.entries(value).map(([field, v]) => `${label(field)}: ${display(field, v)}`).join('\n');
    return String(value);
  }
  if (!save.error && !conflict && !save.saving) return null;
  return <div className="text-sm space-y-2 p-3" role={save.error || conflict ? 'alert' : 'status'} style={{ background: 'var(--raised)', color: 'var(--hi)' }}>
    {save.saving && <p>Saving…</p>}
    {save.error && <p>{save.error.uncertain ? 'Unconfirmed: ' : 'Save failed: '}{save.error.message}</p>}
    {conflict && <>
      <p>The table changed {conflicts.length ? conflicts.map(label).join(', ') : 'this item'} while you were editing. Your draft is kept.</p>
      <details><summary>Review the current table version</summary><dl className="max-h-48 overflow-auto space-y-2 mt-2">
        {(conflicts.length ? conflicts : Object.keys(latest)).map((key) => <div key={key}>
          <dt className="font-semibold">{label(key)}</dt>
          <dd className="whitespace-pre-wrap">{display(key, (latest as Record<string, unknown>)[key])}</dd>
        </div>)}
      </dl></details>
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" variant="secondary" disabled={save.saving} onClick={() => { onUseTable(); save.clearError(); }}>Use table version</Button>
        <Button size="sm" variant="secondary" disabled={save.saving} onClick={() => { onKeepChanges(); save.clearError(); }}>Keep my changes for next save</Button>
      </div>
    </>}
    {save.blocked && <>
      <p>Check for an existing copy or completed action before retrying. Creating again can make a duplicate.</p>
      <Button size="sm" variant="secondary" disabled={!connected} onClick={save.review}>I checked the table; enable retry</Button>
    </>}
  </div>;
}
