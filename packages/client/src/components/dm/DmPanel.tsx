import { useState } from 'react';
import type { ClientMessage } from '@vtt/shared';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { AssetPicker } from './AssetPicker';
import { InviteManager } from './InviteManager';
import { useStore } from '../../store';

export function DmPanel() {
  const [tab, setTab] = useState<'assets' | 'invites'>('assets');
  const uploadsLocked = useStore((s) => s.uploadsLocked);
  const connection = useStore((s) => s.connection);

  function sendWs(msg: ClientMessage): void {
    const conn = (window as unknown as { __vttConn?: { send: (msg: ClientMessage) => void } }).__vttConn;
    conn?.send(msg);
  }

  function toggleUploadLock() {
    sendWs({ type: 'setUploadsLocked', locked: !uploadsLocked });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-zinc-800 space-y-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="w-full">
            <TabsTrigger value="assets">Assets</TabsTrigger>
            <TabsTrigger value="invites">Invites</TabsTrigger>
          </TabsList>
        </Tabs>
        {/* Upload lock toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <button
            type="button"
            role="switch"
            aria-checked={uploadsLocked}
            disabled={connection !== 'open'}
            onClick={toggleUploadLock}
            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:opacity-50 ${
              uploadsLocked ? 'bg-red-600' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                uploadsLocked ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
          <span className="text-xs text-zinc-400">
            {uploadsLocked ? 'Player uploads locked' : 'Lock player uploads'}
          </span>
        </label>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'assets' && <AssetPicker />}
        {tab === 'invites' && <InviteManager />}
      </div>
    </div>
  );
}
