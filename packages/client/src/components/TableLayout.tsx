import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { TableConnection } from '../ws/connection';
import { CanvasViewer } from './CanvasViewer';
import { DocumentViewer } from './DocumentViewer';
import { NoteEditor } from './NoteEditor';
import { RollToasts } from './RollToasts';
import { DiceRoller } from './DiceRoller';
import { RollLog } from './RollLog';
import { DocumentsPanel } from './DocumentsPanel';
import { NotesPanel } from './NotesPanel';
import { PresenceBar } from './PresenceBar';
import { DmPanel } from './dm/DmPanel';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Button } from './ui/button';

const CONNECTION_COLORS: Record<string, string> = {
  open: 'bg-green-500',
  connecting: 'bg-yellow-500 animate-pulse',
  reconnecting: 'bg-yellow-500 animate-pulse',
  closed: 'bg-zinc-600',
};

const CONNECTION_LABELS: Record<string, string> = {
  open: 'Connected',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  closed: 'Disconnected',
};

export function TableLayout() {
  const activeCampaignId = useStore((s) => s.activeCampaignId);
  const campaignName = useStore((s) => s.campaignName);
  const connection = useStore((s) => s.connection);
  const presence = useStore((s) => s.presence);
  const rollLog = useStore((s) => s.rollLog);
  const self = useStore((s) => s.self);
  const lastErrorMessage = useStore((s) => s.lastErrorMessage);
  const viewingDocument = useStore((s) => s.viewingDocument);
  const noteEditor = useStore((s) => s.noteEditor);
  const setRoute = useStore((s) => s.setRoute);
  const resetTable = useStore((s) => s.resetTable);
  const setActiveCampaignId = useStore((s) => s.setActiveCampaignId);

  const connRef = useRef<TableConnection | null>(null);
  const [sidebarTab, setSidebarTab] = useState<'dice' | 'docs' | 'notes' | 'dm'>('dice');

  const isDm = self?.role === 'dm';

  useEffect(() => {
    if (!activeCampaignId) return;

    const conn = new TableConnection();
    connRef.current = conn;

    // Expose for child components that need to send WS messages
    (window as unknown as Record<string, unknown>).__vttConn = conn;

    conn.connect(activeCampaignId);

    return () => {
      conn.disconnect();
      (window as unknown as Record<string, unknown>).__vttConn = undefined;
      connRef.current = null;
    };
  }, [activeCampaignId]);

  function handleLeave() {
    connRef.current?.disconnect();
    resetTable();
    setActiveCampaignId(null);
    setRoute('lobby');
  }

  // Dismiss error toast after 5s
  useEffect(() => {
    if (!lastErrorMessage) return;
    const t = setTimeout(() => {
      useStore.getState().setLastErrorMessage(null);
    }, 5000);
    return () => clearTimeout(t);
  }, [lastErrorMessage]);

  return (
    <div className="h-dvh flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="shrink-0 h-12 border-b border-zinc-800 bg-zinc-950 flex items-center px-3 gap-3 z-10">
        <span className="font-semibold text-zinc-100 truncate max-w-[200px]">
          {campaignName || 'Loading…'}
        </span>

        <div className="flex items-center gap-1.5 ml-auto min-w-0 overflow-hidden">
          <PresenceBar entries={presence} />
        </div>

        <div
          className={`w-2 h-2 rounded-full shrink-0 ${CONNECTION_COLORS[connection] ?? 'bg-zinc-600'}`}
          title={CONNECTION_LABELS[connection] ?? connection}
          aria-label={CONNECTION_LABELS[connection] ?? connection}
        />

        <Button
          variant="ghost"
          size="sm"
          onClick={handleLeave}
        >
          Leave
        </Button>
      </header>

      {/* Error toast */}
      {lastErrorMessage && (
        <div
          role="alert"
          className="shrink-0 bg-red-950 border-b border-red-900 text-red-300 text-sm px-4 py-2 flex items-center justify-between"
        >
          <span>{lastErrorMessage}</span>
          <button
            type="button"
            onClick={() => useStore.getState().setLastErrorMessage(null)}
            className="text-red-500 hover:text-red-200 ml-3"
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* Main content — stacks vertically on narrow screens, sidebar right on md+ */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        {/* Canvas area — the document viewer overlays it, keeping the canvas
            mounted (pan/zoom state survives) and the sidebar interactive. */}
        <div className="flex-1 min-w-0 min-h-0 relative flex">
          <CanvasViewer />
          {viewingDocument && <DocumentViewer doc={viewingDocument} />}
          {noteEditor && <NoteEditor key={noteEditor.noteId ?? 'new'} noteId={noteEditor.noteId} />}
          <RollToasts />
        </div>

        {/* Sidebar: bottom panel on mobile, right column on md+ */}
        <aside className="w-full h-2/5 border-t md:w-80 md:h-auto md:border-t-0 md:border-l shrink-0 border-zinc-800 flex flex-col overflow-hidden bg-zinc-950">
          <Tabs
            value={sidebarTab}
            onValueChange={(v) => setSidebarTab(v as typeof sidebarTab)}
            className="flex flex-col h-full"
          >
            <div className="p-2 border-b border-zinc-800">
              <TabsList className="w-full">
                <TabsTrigger value="dice">Dice</TabsTrigger>
                <TabsTrigger value="docs">Docs</TabsTrigger>
                <TabsTrigger value="notes">Notes</TabsTrigger>
                {isDm && <TabsTrigger value="dm">DM</TabsTrigger>}
              </TabsList>
            </div>

            <TabsContent value="dice" className="flex flex-col overflow-y-auto">
              <DiceRoller />
              <div className="border-t border-zinc-800 flex-1 min-h-44 overflow-hidden flex flex-col">
                <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider px-3 pt-2 pb-1">
                  Roll Log
                </p>
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <RollLog entries={rollLog} />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="docs" className="flex flex-col h-full overflow-hidden">
              <DocumentsPanel />
            </TabsContent>

            <TabsContent value="notes" className="flex flex-col h-full overflow-hidden">
              <NotesPanel />
            </TabsContent>

            {isDm && (
              <TabsContent value="dm" className="flex flex-col h-full overflow-hidden">
                <DmPanel />
              </TabsContent>
            )}
          </Tabs>
        </aside>
      </div>
    </div>
  );
}
