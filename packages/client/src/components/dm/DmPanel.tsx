import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { AssetPicker } from './AssetPicker';
import { InviteManager } from './InviteManager';

export function DmPanel() {
  const [tab, setTab] = useState<'assets' | 'invites'>('assets');

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-zinc-800">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="w-full">
            <TabsTrigger value="assets">Assets</TabsTrigger>
            <TabsTrigger value="invites">Invites</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'assets' && <AssetPicker />}
        {tab === 'invites' && <InviteManager />}
      </div>
    </div>
  );
}
