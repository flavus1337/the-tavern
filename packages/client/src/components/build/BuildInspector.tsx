import { sendCommand, sendWs } from '../../ws/connection';
import { useStore } from '../../store';
import { centredPlacement } from '../../lib/view';
import { AssetPicker } from '../dm/AssetPicker';
import { openInvites } from '../../lib/navigation';


const SIZE_PRESETS: Array<['S' | 'M' | 'L' | 'H', number]> = [['S', 0.6], ['M', 1], ['L', 1.6], ['H', 2.4]];

/**
 * The build-mode docked inspector: selected-piece card (when a piece is
 * selected) + the inked asset palette + the layer stack.
 */
export function BuildInspector() {
  const pieces = useStore((s) => s.pieces);
  const grid = useStore((s) => s.grid);
  const selectedPieceId = useStore((s) => s.selectedPieceId);
  const setSelectedPieceId = useStore((s) => s.setSelectedPieceId);
  const layerVisible = useStore((s) => s.layerVisible);
  const toggleLayerVisible = useStore((s) => s.toggleLayerVisible);

  const boardTool = useStore((s) => s.boardTool);
  const setBoardToolDirect = useStore((s) => s.setBoardTool);
  const setGenDialog = useStore((s) => s.setGenDialog);
  const templates = useStore((s) => s.templates);
  const mapMeta = useStore((s) => s.mapMeta);
  const board = useStore((s) => s.board);
  const mapLocked = useStore((s) => s.mapLocked);
  const selected = selectedPieceId ? pieces.find((p) => p.id === selectedPieceId) : undefined;

  function removeBackground() {
    if (board.length === 0) return;
    if (board.length > 1 && !window.confirm(`Remove all ${board.length} background images?`)) return;
    for (const item of board) sendWs({ type: 'boardRemove', itemId: item.id });
  }

  function resetGrid() {
    const std = 44;
    sendWs({ type: 'setGrid', grid: { cell: std, offsetX: 0, offsetY: 0, visible: true, snap: true, unit: 'm', color: board.length ? '#00000059' : '#ffffff33' } });
    // Re-fit the current background to a 40-cell map at the standard cell size.
    const bg = board[0];
    if (bg && !mapLocked) {
      const w = 40 * std;
      const p = centredPlacement(w, w, { cell: std, offsetX: 0, offsetY: 0 });
      sendWs({ type: 'boardMove', itemId: bg.id, x: p.x, y: p.y, w });
    }
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Selected-piece card */}
      {selected && (
        <SelectedPieceCard
          key={selected.id}
          cell={grid.cell}
          unit={grid.unit}
          w={selected.w}
          rotation={selected.rotation}
          builtin={selected.builtin}
          onSize={(w) => sendWs({ type: 'pieceUpdate', id: selected.id, w, h: w })}
          onRotate={(r) => sendWs({ type: 'pieceUpdate', id: selected.id, rotation: r })}
          onDelete={() => { void sendCommand({ type: 'pieceRemove', id: selected.id }).then(() => { if (useStore.getState().selectedPieceId === selected.id) setSelectedPieceId(null); }, () => {}); }}
        />
      )}

      <div className="p-3 space-y-2 shrink-0" style={{ borderBottom: '1px solid var(--border-soft)' }}>
        <p className="text-sm" style={{ color: 'var(--mid)' }}>1. Place a map from the library. 2. Invite your players.</p>
        <button type="button" onClick={openInvites} className="text-sm underline" style={{ color: 'var(--ember)' }}>Invite players →</button>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => setGenDialog('background')} className="text-xs underline" style={{ color: 'var(--mid)' }}>Generate a map</button>
          <button type="button" onClick={() => setGenDialog('prop')} className="text-xs underline" style={{ color: 'var(--mid)' }}>Generate a prop</button>
        </div>
      </div>
      <AssetPicker build />

      <details className="p-3 shrink-0" style={{ borderTop: '1px solid var(--border-soft)' }}>
        <summary className="text-sm cursor-pointer" style={{ color: 'var(--mid)' }}>Grid and map controls</summary>
        <div className="space-y-2 pt-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setBoardToolDirect(boardTool === 'calibrate' ? 'select' : 'calibrate')}
            title="Drag a box over a printed grid to align cells"
            className="flex-1 py-2 rounded-[9px] text-xs font-semibold"
            style={boardTool === 'calibrate'
              ? { background: 'var(--ember)', color: 'var(--ink)', border: 'none', cursor: 'pointer' }
              : { background: 'var(--raised)', color: 'var(--hi)', border: '1px solid var(--border)', cursor: 'pointer' }}
          >
            ⊹ Calibrate grid
          </button>
          <button
            type="button"
            onClick={resetGrid}
            title="Reset to the standard 40-square battle grid"
            className="flex-1 py-2 rounded-[9px] text-xs font-semibold"
            style={{ background: 'var(--raised)', color: 'var(--hi)', border: '1px solid var(--border)', cursor: 'pointer' }}
          >
            ↺ Reset grid
          </button>
        </div>
        {board.length > 0 && (
          <button
            type="button"
            onClick={removeBackground}
            className="w-full py-2 rounded-[9px] text-xs font-semibold flex items-center justify-center gap-1.5"
            style={{ background: 'transparent', color: 'var(--garnet)', border: '1px solid #b6485a3a', cursor: 'pointer' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Remove background{board.length > 1 ? ` (${board.length})` : ''}
          </button>
        )}
        {boardTool === 'calibrate' && (
          <p className="text-[11px]" style={{ color: 'var(--gold)' }}>Drag a box over a known number of grid squares on the image.</p>
        )}

        <label className="flex items-center justify-between cursor-pointer select-none pt-1">
          <span className="text-xs" style={{ color: 'var(--mid)' }}>
            Lock map <span style={{ color: 'var(--faint)' }}>· no accidental moves</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={mapLocked}
            onClick={() => sendWs({ type: 'setMapLocked', locked: !mapLocked })}
            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${mapLocked ? 'bg-[var(--ember)]' : 'bg-[var(--raised)]'}`}
          >
            <span className={`pointer-events-none inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${mapLocked ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
        </label>
      </div>

      </details>

      <details className="p-3 shrink-0" style={{ borderTop: '1px solid var(--border-soft)' }}>
        <summary className="text-sm cursor-pointer" style={{ color: 'var(--mid)' }}>Saved map templates</summary>
        <div className="space-y-2 pt-3">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Templates</p>
          <button
            type="button"
            onClick={() => {
              const name = window.prompt('Save this map as a template named:', mapMeta.name || 'Untitled map');
              if (name && name.trim()) sendWs({ type: 'saveMapTemplate', name: name.trim() });
            }}
            className="text-xs font-semibold px-2 py-1 rounded-[7px]"
            style={{ color: 'var(--hi)', background: 'var(--raised)', border: '1px solid var(--border)', cursor: 'pointer' }}
          >
            ⌃ Save current
          </button>
        </div>
        {templates.length === 0 ? (
          <p className="text-[11px]" style={{ color: 'var(--faint)' }}>No saved maps yet. Save the current map to reuse it later.</p>
        ) : (
          <div className="space-y-1.5">
            {templates.map((t) => (
              <div key={t.id} className="flex items-center gap-2 p-2 rounded-[9px]" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
                <span className="flex-1 text-sm truncate" style={{ color: 'var(--hi)' }}>{t.name}</span>
                <button type="button" onClick={() => { if (window.confirm(`Load "${t.name}"? This replaces the current map.`)) sendWs({ type: 'loadMapTemplate', id: t.id }); }}
                  className="text-xs font-semibold px-2 py-1 rounded-[7px]" style={{ color: 'var(--ink)', background: 'var(--ember)', border: 'none', cursor: 'pointer' }}>Load</button>
                <button type="button" onClick={() => { if (window.confirm(`Delete template "${t.name}"?`)) sendWs({ type: 'deleteMapTemplate', id: t.id }); }}
                  aria-label={`Delete ${t.name}`} className="px-1.5 py-1 rounded-[7px]" style={{ color: 'var(--garnet)', background: 'none', border: 'none', cursor: 'pointer' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      </details>

      {/* Layers */}
      <div className="p-3 space-y-2 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
        <p className="eyebrow">Layers</p>
        <LayerRow label="Props" hint="trees · camp" on={layerVisible.props} onToggle={() => toggleLayerVisible('props')} />
        <LayerRow label="Terrain" hint="walls · doors" on={layerVisible.terrain} onToggle={() => toggleLayerVisible('terrain')} />
        <LayerRow label="Background" hint="map image" on={layerVisible.background} onToggle={() => toggleLayerVisible('background')} />
        <div className="flex items-center justify-between opacity-40" title="Coming soon">
          <span className="text-xs" style={{ color: 'var(--mid)' }}>Fog of war <span style={{ color: 'var(--faint)' }}>· v2</span></span>
        </div>
      </div>
    </div>
  );
}

function SelectedPieceCard({
  cell, unit, w, rotation, builtin, onSize, onRotate, onDelete,
}: {
  cell: number; unit: 'ft' | 'm'; w: number; rotation: number; builtin: string | null;
  onSize: (w: number) => void; onRotate: (r: number) => void; onDelete: () => void;
}) {
  const scale = +(w / cell).toFixed(2);
  const label = builtin ?? 'Prop';
  const preset = scale <= 0.75 ? 'S' : scale <= 1.25 ? 'M' : scale <= 1.9 ? 'L' : 'H';
  return (
    <div className="p-3 space-y-3" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: 'var(--hi)' }}>
          {label} <span className="eyebrow" style={{ marginLeft: 4 }}>Selected</span>
        </span>
        <button type="button" onClick={onDelete} aria-label="Delete piece" title="Delete"
          style={{ color: 'var(--garnet)', background: 'none', border: 'none', cursor: 'pointer' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>

      <Row label="Size">
        <input type="range" min={0.5} max={3} step={0.1} value={scale}
          onChange={(e) => onSize(Math.round(Number(e.target.value) * cell))}
          style={{ flex: 1, accentColor: 'var(--ember)' }} />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--mid)', minWidth: 56, textAlign: 'right' }}>
          {scale.toFixed(1)}× · {Math.round(scale * (unit === 'ft' ? 5 : 1.5))} {unit}
        </span>
      </Row>

      <Row label="Preset">
        <div className="flex overflow-hidden rounded-[9px] flex-1" style={{ border: '1px solid var(--border)' }}>
          {SIZE_PRESETS.map(([p, s]) => (
            <button key={p} type="button" onClick={() => onSize(Math.round(s * cell))}
              className="flex-1 py-1 text-xs transition-colors"
              style={preset === p ? { background: 'var(--raised)', color: 'var(--hi)' } : { color: 'var(--low)' }}>{p}</button>
          ))}
        </div>
      </Row>

      <Row label="Rotate">
        <input type="range" min={-180} max={180} step={1} value={rotation}
          onChange={(e) => onRotate(Number(e.target.value))}
          style={{ flex: 1, accentColor: 'var(--ember)' }} />
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--mid)', minWidth: 56, textAlign: 'right' }}>{rotation}°</span>
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="eyebrow" style={{ width: 52, flexShrink: 0 }}>{label}</span>
      {children}
    </div>
  );
}

function LayerRow({ label, hint, on, onToggle }: { label: string; hint: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-sm" style={{ color: 'var(--hi)' }}>{label}</div>
        <div className="text-[11px]" style={{ color: 'var(--faint)', fontFamily: 'var(--mono)' }}>{hint}</div>
      </div>
      <button type="button" role="switch" aria-checked={on} onClick={onToggle} aria-label={`Toggle ${label} layer`}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-[var(--ember)]' : 'bg-[var(--raised)]'}`}>
        <span className={`pointer-events-none inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}
