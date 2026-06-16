import { useState } from 'react';
import type { ClientMessage, GridState } from '@vtt/shared';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { AssetPicker } from './AssetPicker';
import { InviteManager } from './InviteManager';
import { useStore } from '../../store';

function sendWs(msg: ClientMessage): void {
  const conn = (window as unknown as { __vttConn?: { send: (msg: ClientMessage) => void } }).__vttConn;
  conn?.send(msg);
}

export function DmPanel() {
  const [tab, setTab] = useState<'assets' | 'board' | 'invites'>('assets');
  const uploadsLocked = useStore((s) => s.uploadsLocked);
  const connection = useStore((s) => s.connection);

  function toggleUploadLock() {
    sendWs({ type: 'setUploadsLocked', locked: !uploadsLocked });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-[var(--border)] space-y-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="w-full">
            <TabsTrigger value="assets">Assets</TabsTrigger>
            <TabsTrigger value="board">Board</TabsTrigger>
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
            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ember)] disabled:opacity-50 ${
              uploadsLocked ? 'bg-[var(--garnet)]' : 'bg-[var(--raised)]'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                uploadsLocked ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
          <span className="text-xs text-[var(--mid)]">
            {uploadsLocked ? 'Player uploads locked' : 'Lock player uploads'}
          </span>
        </label>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'assets' && <AssetPicker />}
        {tab === 'board' && <BoardControls />}
        {tab === 'invites' && <InviteManager />}
      </div>
    </div>
  );
}

const GRID_COLORS = ['#ffffff22', '#ffffff44', '#e08a4b55', '#69b7a655', '#00000055'];

function BoardControls() {
  const grid = useStore((s) => s.grid);
  const mapLocked = useStore((s) => s.mapLocked);
  const openTokenPanel = useStore((s) => s.openTokenPanel);
  const connection = useStore((s) => s.connection);
  const disabled = connection !== 'open';

  function patch(g: Partial<GridState>) {
    sendWs({ type: 'setGrid', grid: g });
  }

  return (
    <div className="p-3 space-y-4">
      <button
        type="button"
        onClick={() => openTokenPanel(null)}
        disabled={disabled}
        className="w-full py-2.5 rounded-[9px] text-sm font-semibold disabled:opacity-50"
        style={{ background: 'var(--ember)', color: 'var(--ink)', border: 'none', cursor: 'pointer' }}
      >
        + Add token
      </button>

      <Toggle label="Lock map" checked={mapLocked} onChange={(v) => sendWs({ type: 'setMapLocked', locked: v })} disabled={disabled} />

      <div className="space-y-3">
        <p className="eyebrow">Grid</p>

        <Toggle label="Show grid" checked={grid.visible} onChange={(v) => patch({ visible: v })} disabled={disabled} />
        <Toggle label="Snap to grid" checked={grid.snap} onChange={(v) => patch({ snap: v })} disabled={disabled} />

        {/* Cell size stepper */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--mid)]">Cell size</span>
          <div className="flex items-center gap-1">
            <StepBtn onClick={() => patch({ cell: grid.cell - 4 })} disabled={disabled} label="−" />
            <span className="font-mono text-xs w-12 text-center text-[var(--hi)]">{grid.cell}px</span>
            <StepBtn onClick={() => patch({ cell: grid.cell + 4 })} disabled={disabled} label="+" />
          </div>
        </div>

        {/* Unit */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--mid)]">Distance unit</span>
          <div className="flex overflow-hidden rounded-[9px] border border-[var(--border)]">
            {(['ft', 'm'] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => patch({ unit: u })}
                disabled={disabled}
                className="px-3 py-1 text-xs transition-colors"
                style={grid.unit === u ? { background: 'var(--raised)', color: 'var(--hi)' } : { color: 'var(--low)' }}
              >
                {u === 'ft' ? 'ft (5/cell)' : 'm (1.5/cell)'}
              </button>
            ))}
          </div>
        </div>

        {/* Offset */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--mid)]">Offset</span>
          <div className="flex items-center gap-2">
            <OffsetField label="X" value={grid.offsetX} onChange={(v) => patch({ offsetX: v })} disabled={disabled} />
            <OffsetField label="Y" value={grid.offsetY} onChange={(v) => patch({ offsetY: v })} disabled={disabled} />
          </div>
        </div>

        {/* Colour */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--mid)]">Line colour</span>
          <div className="flex gap-1.5">
            {GRID_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => patch({ color: c })}
                disabled={disabled}
                aria-label={`Grid colour ${c}`}
                style={{
                  width: 20, height: 20, borderRadius: 5, background: '#3a3330',
                  border: grid.color === c ? '2px solid var(--ember)' : '2px solid transparent',
                  cursor: 'pointer', position: 'relative',
                }}
              >
                <span style={{ position: 'absolute', inset: 3, background: c, borderRadius: 2 }} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  return (
    <label className="flex items-center justify-between cursor-pointer select-none">
      <span className="text-xs text-[var(--mid)]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-[var(--ember)]' : 'bg-[var(--raised)]'}`}
      >
        <span className={`pointer-events-none inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
    </label>
  );
}

function StepBtn({ onClick, disabled, label }: { onClick: () => void; disabled: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-6 h-6 rounded text-[var(--mid)] disabled:opacity-50"
      style={{ border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}
    >
      {label}
    </button>
  );
}

function OffsetField({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-[10px] text-[var(--faint)]">{label}</span>
      <input
        type="number"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-12 px-1.5 py-1 text-xs rounded font-mono"
        style={{ background: '#100c0a', border: '1px solid var(--border)', color: 'var(--hi)' }}
      />
    </label>
  );
}
