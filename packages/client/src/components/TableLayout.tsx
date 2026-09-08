import { useEffect, useRef, useState, useCallback } from 'react';
import type { PresenceEntry } from '@vtt/shared';
import { useStore } from '../store';
import { TableConnection, sendWs } from '../ws/connection';
import { CanvasViewer } from './CanvasViewer';
import { DocumentViewer } from './DocumentViewer';
import { NoteEditor } from './NoteEditor';
import { TokenEditor } from './TokenEditor';
import { TokensPanel } from './TokensPanel';
import { UndoControl } from './UndoControl';
import { RollToasts } from './RollToasts';
import { DiceOverlay } from './DiceOverlay';
import { AudioDock } from './AudioDock';
import { DiceRoller } from './DiceRoller';
import { RollLog } from './RollLog';
import { DocumentsPanel } from './DocumentsPanel';
import { NotesPanel } from './NotesPanel';
import { InitiativePanel } from './InitiativePanel';
import { PresenceBar } from './PresenceBar';
import { DmPanel } from './dm/DmPanel';
import { BuildInspector } from './build/BuildInspector';
import { GenDialog } from './build/GenDialog';
import { D20Logo } from './D20Logo';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';

export function TableLayout() {
  const activeCampaignId = useStore((s) => s.activeCampaignId);
  const campaignName = useStore((s) => s.campaignName);
  const connection = useStore((s) => s.connection);
  const presence = useStore((s) => s.presence);
  const rollLog = useStore((s) => s.rollLog);
  const documents = useStore((s) => s.documents);
  const self = useStore((s) => s.self);
  const lastErrorMessage = useStore((s) => s.lastErrorMessage);
  const pendingCommands = useStore((s) => s.pendingCommands);
  const saveOutcome = useStore((s) => s.saveOutcome);
  const openPanels = useStore((s) => s.openPanels);
  const setRoute = useStore((s) => s.setRoute);
  const resetTable = useStore((s) => s.resetTable);
  const setActiveCampaignId = useStore((s) => s.setActiveCampaignId);
  const addJoinToast = useStore((s) => s.addJoinToast);
  const editorMode = useStore((s) => s.editorMode);
  const setEditorMode = useStore((s) => s.setEditorMode);
  const mapMeta = useStore((s) => s.mapMeta);
  const genDialog = useStore((s) => s.genDialog);

  const connRef = useRef<TableConnection | null>(null);
  const [sidebarTab, setSidebarTab] = useState<'dice' | 'tokens' | 'combat' | 'docs' | 'notes' | 'dm'>('dice');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const isDm = self?.role === 'dm';
  const isConnected = connection === 'open';
  const buildMode = isDm && editorMode === 'build';

  useEffect(() => {
    if (!activeCampaignId) return;

    const conn = new TableConnection();
    connRef.current = conn;

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

  const handlePresenceJoin = useCallback((entry: PresenceEntry) => {
    addJoinToast(entry);
  }, [addJoinToast]);

  // Opening an editor returns the available height to its board container on small screens.
  useEffect(() => { if (openPanels.length) setDrawerOpen(false); }, [openPanels]);

  useEffect(() => {
    const closeOutside = (event: Event) => {
      if (menuRef.current?.open && !menuRef.current.contains(event.target as Node)) menuRef.current.open = false;
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);

  // Listen for empty-board DM CTA tab switch
  useEffect(() => {
    function onSwitchTab(e: Event) {
      const tab = (e as CustomEvent<string>).detail;
      if (tab === 'dice' || tab === 'tokens' || tab === 'combat' || tab === 'docs' || tab === 'notes' || tab === 'dm') {
        setSidebarTab(tab as typeof sidebarTab);
        setDrawerOpen(true);
      }
    }
    window.addEventListener('vtt:switch-sidebar-tab', onSwitchTab);
    return () => window.removeEventListener('vtt:switch-sidebar-tab', onSwitchTab);
  }, []);

  return (
    <div className="h-dvh flex flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>

      <header className="table-header">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="shrink-0" style={{ color: 'var(--ember)' }}><D20Logo size={24} /></span>
          <span className="truncate font-semibold" style={{ fontFamily: 'var(--serif)', fontSize: 17, color: 'var(--hi)' }}>
            {campaignName || 'Loading…'}
          </span>
        </div>
        <div className="table-presence"><PresenceBar entries={presence} onJoin={handlePresenceJoin} /></div>
        <div className="flex items-center gap-2 shrink-0">
          {isDm && <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
            {(['play', 'build'] as const).map((mode) => <button key={mode} type="button" aria-pressed={editorMode === mode}
              onClick={() => { setEditorMode(mode); if (mode === 'build') setDrawerOpen(true); }}
              className="px-2 py-2 text-xs font-semibold capitalize"
              style={{ background: editorMode === mode ? 'var(--ember)' : 'transparent', color: editorMode === mode ? 'var(--ink)' : 'var(--mid)' }}>{mode}</button>)}
          </div>}
          <span className="table-connection" role="status" aria-label={isConnected ? 'Connected' : connection === 'closed' ? 'Disconnected' : 'Reconnecting'}
            title={isConnected ? 'Connected' : connection === 'closed' ? 'Disconnected' : 'Reconnecting'}>
            <span aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: isConnected ? 'var(--teal)' : 'var(--gold)' }} />
            <span className="table-connection-label">{isConnected ? 'Connected' : connection === 'closed' ? 'Disconnected' : 'Reconnecting'}</span>
          </span>
          <span role="status" className="text-xs whitespace-nowrap" style={{ color: saveOutcome === 'failed' || saveOutcome === 'unconfirmed' ? 'var(--gold)' : 'var(--mid)' }}>
            {pendingCommands ? 'Saving…' : saveOutcome === 'saved' ? 'Saved' : saveOutcome === 'failed' ? 'Save failed' : saveOutcome === 'unconfirmed' ? 'Unconfirmed' : ''}
          </span>
          <details ref={menuRef} className="table-menu" onKeyDown={(event) => {
            if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
          }}>
            <summary aria-label="Table menu" className="cursor-pointer rounded-lg px-2 py-2 text-sm font-semibold">⋯</summary>
            <div className="table-menu-content">
              <p className="text-sm">{isConnected ? 'Connected to the table' : connection === 'closed' ? 'Disconnected from the table' : 'Reconnecting to the table…'}</p>
              <p className="eyebrow">At the table</p>
              <ul className="space-y-1 text-sm">{presence.map((entry) => <li key={entry.userId}>{entry.username}{entry.role === 'dm' ? ' · DM' : ''}{entry.connected ? '' : ' · away'}</li>)}</ul>
              {buildMode && <label className="block text-xs">Map name
                <input key={mapMeta.name} defaultValue={mapMeta.name} aria-label="Map name"
                  className="mt-1 w-full rounded-lg border p-2 text-sm" style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--hi)' }}
                  onBlur={(event) => { const name = event.target.value.trim() || 'Untitled map'; if (name !== mapMeta.name) sendWs({ type: 'setMapMeta', name }); }} />
              </label>}
              <button type="button" onClick={handleLeave} disabled={pendingCommands > 0}
                className="w-full rounded-lg border px-3 py-2 text-sm text-left disabled:opacity-50" style={{ borderColor: 'var(--border)' }}>Leave table</button>
            </div>
          </details>
        </div>
      </header>

      {/* Error bar */}
      {lastErrorMessage && (
        <div
          role="alert"
          style={{
            flexShrink: 0,
            background: '#b6485a22',
            borderBottom: '1px solid #b6485a44',
            color: 'var(--garnet)',
            fontSize: 13,
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{lastErrorMessage}</span>
          <button
            type="button"
            onClick={() => useStore.setState({ lastErrorMessage: null, saveOutcome: 'idle' })}
            style={{ color: 'var(--garnet)', background: 'none', border: 'none', cursor: 'pointer', marginLeft: 12, fontSize: 16 }}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* Main layout */}
      <div className={`table-main flex-1 min-h-0 ${drawerOpen ? 'drawer-expanded' : ''}`}>
        {/* Board area */}
        <div className="table-board flex-1 min-w-0 min-h-0 relative flex">
          <CanvasViewer />
          <UndoControl />
          {openPanels.map((panel, i) => {
            if (panel.kind === 'doc') {
              return <DocumentViewer key={panel.panelId} panelId={panel.panelId} doc={panel.doc} stackIndex={i} />;
            }
            if (panel.kind === 'token') {
              return <TokenEditor key={panel.panelId} panelId={panel.panelId} tokenId={panel.tokenId} stackIndex={i} />;
            }
            return <NoteEditor key={panel.panelId} panelId={panel.panelId} noteId={panel.noteId} stackIndex={i} />;
          })}
          <AudioDock />
          <RollToasts />
        </div>

        {/* Sidebar — build inspector in build mode, else the play tabs */}
        <aside
          className={`table-sidebar ${drawerOpen ? 'drawer-open' : ''}`}
          style={{
            borderColor: 'var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <button type="button" className="sidebar-toggle" aria-expanded={drawerOpen} aria-controls="table-sidebar-content"
            onClick={() => setDrawerOpen((open) => !open)}>
            {drawerOpen ? 'Back to table' : 'Open tools'} · {buildMode ? 'Build' : sidebarTab === 'dm' ? 'DM' : sidebarTab.charAt(0).toUpperCase() + sidebarTab.slice(1)}
            <span aria-hidden="true">{drawerOpen ? '⌄' : '⌃'}</span>
          </button>
          <div id="table-sidebar-content" className="sidebar-body">
          {buildMode ? (
            <div className="flex flex-col h-full"><BuildInspector /></div>
          ) : (
          <div className="flex flex-col h-full">
            <Tabs
              value={sidebarTab}
              onValueChange={(v) => setSidebarTab(v as typeof sidebarTab)}
              className="flex flex-col h-full"
            >
              <TabsList label="Table tools">
                <TabsTrigger value="dice">Dice</TabsTrigger>
                <TabsTrigger value="tokens">Tokens</TabsTrigger>
                <TabsTrigger value="combat">Combat</TabsTrigger>
                <TabsTrigger value="docs">
                  Docs
                  {documents.length > 0 && (
                    <span
                      style={{
                        fontFamily: 'var(--mono)', fontSize: 10,
                        color: sidebarTab === 'docs' ? 'var(--ember)' : 'var(--low)',
                        background: sidebarTab === 'docs' ? '#e08a4b1a' : 'var(--raised)',
                        padding: '1px 6px', borderRadius: 20,
                      }}
                    >
                      {documents.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="notes">Notes</TabsTrigger>
                {isDm && <TabsTrigger value="dm">DM</TabsTrigger>}
              </TabsList>

              <TabsContent value="dice" className="flex flex-col overflow-y-auto">
                <DiceRoller />
                <div style={{ borderTop: '1px solid var(--border)', flex: 1, minHeight: 176, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <p className="eyebrow" style={{ padding: '10px 14px 6px' }}>
                    Roll Log
                  </p>
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <RollLog entries={rollLog} />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="tokens" className="flex flex-col overflow-hidden"><TokensPanel /></TabsContent>

              <TabsContent value="combat" className="flex flex-col h-full overflow-hidden">
                <InitiativePanel />
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
          </div>
          )}
          </div>
        </aside>
      </div>

      {genDialog && <GenDialog />}
      <DiceOverlay />
    </div>
  );
}
