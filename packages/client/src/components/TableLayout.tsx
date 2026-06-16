import { useEffect, useRef, useState, useCallback } from 'react';
import type { PresenceEntry } from '@vtt/shared';
import { useStore } from '../store';
import { TableConnection } from '../ws/connection';
import { CanvasViewer } from './CanvasViewer';
import { DocumentViewer } from './DocumentViewer';
import { NoteEditor } from './NoteEditor';
import { TokenEditor } from './TokenEditor';
import { RollToasts } from './RollToasts';
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
import type { ClientMessage } from '@vtt/shared';

export function TableLayout() {
  const activeCampaignId = useStore((s) => s.activeCampaignId);
  const campaignName = useStore((s) => s.campaignName);
  const connection = useStore((s) => s.connection);
  const presence = useStore((s) => s.presence);
  const rollLog = useStore((s) => s.rollLog);
  const documents = useStore((s) => s.documents);
  const self = useStore((s) => s.self);
  const lastErrorMessage = useStore((s) => s.lastErrorMessage);
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
  const [sidebarTab, setSidebarTab] = useState<'dice' | 'combat' | 'docs' | 'notes' | 'dm'>('dice');

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

  // Dismiss error toast after 5s
  useEffect(() => {
    if (!lastErrorMessage) return;
    const t = setTimeout(() => {
      useStore.getState().setLastErrorMessage(null);
    }, 5000);
    return () => clearTimeout(t);
  }, [lastErrorMessage]);

  const handlePresenceJoin = useCallback((entry: PresenceEntry) => {
    addJoinToast(entry);
  }, [addJoinToast]);

  // Listen for empty-board DM CTA tab switch
  useEffect(() => {
    function onSwitchTab(e: Event) {
      const tab = (e as CustomEvent<string>).detail;
      if (tab === 'dice' || tab === 'combat' || tab === 'docs' || tab === 'notes' || tab === 'dm') {
        setSidebarTab(tab as 'dice' | 'combat' | 'docs' | 'notes' | 'dm');
      }
    }
    window.addEventListener('vtt:switch-sidebar-tab', onSwitchTab);
    return () => window.removeEventListener('vtt:switch-sidebar-tab', onSwitchTab);
  }, []);

  return (
    <div className="h-dvh flex flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>

      {/* Top bar — 56px, three zones */}
      <header
        style={{
          height: 56,
          flexShrink: 0,
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: 18,
          paddingRight: 16,
          gap: 16,
          zIndex: 10,
          position: 'relative',
        }}
      >
        {/* Left zone: d20 + campaign name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
          <span style={{ color: 'var(--ember)', flexShrink: 0 }}>
            <D20Logo size={26} />
          </span>
          <span
            style={{
              fontFamily: 'var(--serif)',
              fontSize: 17,
              fontWeight: 600,
              color: 'var(--hi)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {campaignName || 'Loading…'}
          </span>
          {buildMode && (
            <>
              <span style={{ width: 1, height: 20, background: 'var(--border)' }} aria-hidden="true" />
              <input
                defaultValue={mapMeta.name}
                key={mapMeta.name}
                onBlur={(e) => {
                  const name = e.target.value.trim() || 'Untitled map';
                  if (name !== mapMeta.name) {
                    const conn = (window as unknown as { __vttConn?: { send: (m: ClientMessage) => void } }).__vttConn;
                    conn?.send({ type: 'setMapMeta', name });
                  }
                }}
                aria-label="Map name"
                style={{
                  fontFamily: 'var(--serif)', fontSize: 15, color: 'var(--hi)', background: 'transparent',
                  border: '1px solid transparent', borderRadius: 7, padding: '3px 7px', minWidth: 80, maxWidth: 220,
                }}
                onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
              />
            </>
          )}
        </div>

        {/* Center zone: presence pill */}
        <div style={{ display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
          <PresenceBar entries={presence} onJoin={handlePresenceJoin} />
        </div>

        {/* Right zone: build/play switch + connection status + Leave */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, justifyContent: 'flex-end' }}>
          {isDm && (
            <div style={{ display: 'flex', overflow: 'hidden', borderRadius: 9, border: '1px solid var(--border)' }}>
              {(['build', 'play'] as const).map((m) => {
                const on = editorMode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setEditorMode(m)}
                    aria-pressed={on}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600,
                      border: 'none', cursor: 'pointer', textTransform: 'capitalize',
                      background: on ? 'var(--ember)' : 'transparent', color: on ? 'var(--ink)' : 'var(--mid)',
                    }}
                  >
                    {m === 'build' ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-3.5 h-3.5"><path d="M14 7l4-4 3 3-4 4-3-3zm-1 1l-9 9 3 3 9-9-3-3z" strokeLinejoin="round" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M7 5l12 7-12 7z" /></svg>
                    )}
                    {m}
                  </button>
                );
              })}
            </div>
          )}
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--mid)' }}
            title={connection === 'open' ? 'Connected' : connection === 'connecting' ? 'Connecting…' : connection === 'reconnecting' ? 'Reconnecting…' : 'Disconnected'}
          >
            <span
              style={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: isConnected ? 'var(--teal)' : connection === 'connecting' || connection === 'reconnecting' ? 'var(--gold)' : 'var(--faint)',
                boxShadow: isConnected ? '0 0 9px var(--teal)' : undefined,
              }}
              aria-hidden="true"
            />
            {isConnected ? 'Connected' : connection === 'connecting' ? 'Connecting…' : connection === 'reconnecting' ? 'Reconnecting…' : 'Disconnected'}
          </div>

          <button
            type="button"
            onClick={handleLeave}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--low)',
              fontSize: 13,
              cursor: 'pointer',
              padding: '6px 10px',
              borderRadius: 7,
              fontWeight: 500,
              fontFamily: 'var(--sans)',
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--hi)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--low)'; }}
          >
            Leave
          </button>
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
            onClick={() => useStore.getState().setLastErrorMessage(null)}
            style={{ color: 'var(--garnet)', background: 'none', border: 'none', cursor: 'pointer', marginLeft: 12, fontSize: 16 }}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {/* Main layout */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        {/* Board area */}
        <div className="flex-1 min-w-0 min-h-0 relative flex">
          <CanvasViewer />
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
          className="w-full h-2/5 border-t md:w-[340px] md:h-auto md:border-t-0 md:border-l"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {buildMode ? (
            <div className="flex flex-col h-full"><BuildInspector /></div>
          ) : (
          <div className="flex flex-col h-full">
            <Tabs
              value={sidebarTab}
              onValueChange={(v) => setSidebarTab(v as typeof sidebarTab)}
              className="flex flex-col h-full"
            >
              <TabsList>
                <TabsTrigger value="dice">Dice</TabsTrigger>
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
        </aside>
      </div>

      {genDialog && <GenDialog />}
    </div>
  );
}
