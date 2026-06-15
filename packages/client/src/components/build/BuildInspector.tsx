import { useRef, useState, type ChangeEvent } from 'react';
import type { ClientMessage, UploadAssetResponse } from '@vtt/shared';
import { useStore } from '../../store';
import { apiUpload, ApiRequestError } from '../../lib/api';
import { inkTile, INK_LIBRARY, INK_PIECE_BY_NAME } from '../../lib/inkArt';

function sendWs(msg: ClientMessage): void {
  const conn = (window as unknown as { __vttConn?: { send: (msg: ClientMessage) => void } }).__vttConn;
  conn?.send(msg);
}

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
  const activePalettePiece = useStore((s) => s.activePalettePiece);
  const setActivePalettePiece = useStore((s) => s.setActivePalettePiece);
  const setBoardTool = useStore((s) => s.setBoardTool);
  const layerVisible = useStore((s) => s.layerVisible);
  const toggleLayerVisible = useStore((s) => s.toggleLayerVisible);

  const campaignId = useStore((s) => s.activeCampaignId);
  const boardTool = useStore((s) => s.boardTool);
  const setBoardToolDirect = useStore((s) => s.setBoardTool);
  const assets = useStore((s) => s.assets);
  const setGenDialog = useStore((s) => s.setGenDialog);
  const templates = useStore((s) => s.templates);
  const mapMeta = useStore((s) => s.mapMeta);
  // Image assets usable as stamps (props/uploads/generated) — not backgrounds.
  const stampAssets = (assets ?? []).filter((a) => a.assetKind === 'token' || a.assetKind === 'art');
  const board = useStore((s) => s.board);
  const [search, setSearch] = useState('');
  const [bgUploading, setBgUploading] = useState(false);
  const [bgError, setBgError] = useState<string | null>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const selected = selectedPieceId ? pieces.find((p) => p.id === selectedPieceId) : undefined;

  function removeBackground() {
    if (board.length === 0) return;
    if (board.length > 1 && !window.confirm(`Remove all ${board.length} background images?`)) return;
    for (const item of board) sendWs({ type: 'boardRemove', itemId: item.id });
  }

  async function uploadBackground(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !campaignId) return;
    setBgUploading(true);
    setBgError(null);
    try {
      const res = await apiUpload<UploadAssetResponse>(`/api/campaigns/${campaignId}/assets`, file, { kind: 'map' });
      // Pin it to the board at the origin as the background layer.
      sendWs({ type: 'boardAdd', assetId: res.asset.id, x: 0, y: 0 });
    } catch (err) {
      setBgError(err instanceof ApiRequestError ? err.message : 'Upload failed');
    } finally {
      setBgUploading(false);
      if (bgInputRef.current) bgInputRef.current.value = '';
    }
  }

  function arm(name: string) {
    const def = INK_PIECE_BY_NAME[name];
    if (!def) return;
    setActivePalettePiece({ builtin: name, assetId: null, url: null, layer: def.layer, lockedToGrid: def.lockedToGrid });
    setBoardTool('stamp');
  }
  function armAsset(assetId: string, url: string) {
    setActivePalettePiece({ builtin: null, assetId, url, layer: 'props', lockedToGrid: false });
    setBoardTool('stamp');
  }

  const q = search.trim().toLowerCase();
  // Custom prop assets grouped by their category (search-filtered).
  const assetsByCat: Record<string, typeof stampAssets> = {};
  for (const a of stampAssets) {
    if (q && !(a.title.toLowerCase().includes(q) || (a.category ?? '').toLowerCase().includes(q))) continue;
    (assetsByCat[a.category || 'Uploads'] ||= []).push(a);
  }
  const builtinNames = new Set(INK_LIBRARY.map((g) => g.section));
  // Built-in sections (with any custom assets filed under the same category)…
  const builtinGroups = INK_LIBRARY.map((g) => ({
    section: g.section,
    pieces: g.pieces.filter((p) => !q || p.label.toLowerCase().includes(q)),
    assets: assetsByCat[g.section] ?? [],
  })).filter((g) => g.pieces.length > 0 || g.assets.length > 0);
  // …then custom-only categories.
  const customGroups = Object.keys(assetsByCat)
    .filter((c) => !builtinNames.has(c))
    .sort()
    .map((c) => ({ section: c, pieces: [] as typeof INK_LIBRARY[number]['pieces'], assets: assetsByCat[c]! }));
  const groups = [...builtinGroups, ...customGroups];

  return (
    <div className="flex flex-col h-full" style={{ overflow: 'hidden' }}>
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
          onDelete={() => { sendWs({ type: 'pieceRemove', id: selected.id }); setSelectedPieceId(null); }}
        />
      )}

      {/* Background */}
      <div className="p-3 space-y-2" style={{ borderBottom: '1px solid var(--border-soft)' }}>
        <p className="eyebrow">Background</p>
        <button
          type="button"
          onClick={() => setGenDialog('background')}
          className="w-full py-2 rounded-[9px] text-xs font-semibold flex items-center justify-center gap-1.5"
          style={{ background: 'var(--gold)', color: 'var(--ink)', border: 'none', cursor: 'pointer' }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M12 3l1.8 5.6L19 10l-5.2 1.4L12 17l-1.8-5.6L5 10l5.2-1.4z" /></svg>
          Generate background
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => bgInputRef.current?.click()}
            disabled={bgUploading}
            className="flex-1 py-2 rounded-[9px] text-xs font-semibold disabled:opacity-50"
            style={{ background: 'var(--raised)', color: 'var(--hi)', border: '1px solid var(--border)', cursor: 'pointer' }}
          >
            {bgUploading ? 'Uploading…' : '⤓ Upload image'}
          </button>
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
        <input ref={bgInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void uploadBackground(e); }} />
        {boardTool === 'calibrate' && (
          <p className="text-[11px]" style={{ color: 'var(--gold)' }}>Drag a box over a known number of grid squares on the image.</p>
        )}
        {bgError && <p role="alert" className="text-xs" style={{ color: 'var(--garnet)' }}>{bgError}</p>}
      </div>

      {/* Templates */}
      <div className="p-3 space-y-2" style={{ borderBottom: '1px solid var(--border-soft)' }}>
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

      {/* Palette */}
      <div className="flex flex-col min-h-0 flex-1">
        <div className="p-3 space-y-2" style={{ borderBottom: '1px solid var(--border-soft)' }}>
          <div className="flex items-center justify-between">
            <p className="eyebrow">Build · terrain &amp; props</p>
            <button
              type="button"
              onClick={() => setGenDialog('prop')}
              className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-[7px]"
              style={{ color: 'var(--ember)', background: '#e08a4b14', border: '1px solid #e08a4b3a', cursor: 'pointer' }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
              Add asset
            </button>
          </div>
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-[9px]" style={{ background: '#100c0a', border: '1px solid var(--border)' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="w-4 h-4" style={{ color: 'var(--low)' }}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" strokeLinecap="round" /></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search trees, rocks, props…"
              className="flex-1 bg-transparent text-sm focus:outline-none"
              style={{ color: 'var(--hi)' }}
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
          {groups.map((g) => (
            <div key={g.section} className="space-y-2">
              <p className="eyebrow">{g.section}</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 8 }}>
                {g.pieces.map((p) => {
                  const on = activePalettePiece?.builtin === p.name;
                  return (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => arm(p.name)}
                      title={p.label}
                      className="flex flex-col items-center gap-1 p-1.5 rounded-[10px] transition-colors"
                      style={{
                        background: on ? '#e08a4b1a' : 'var(--surface2)',
                        border: `1px solid ${on ? 'var(--ember)' : 'var(--border)'}`,
                        boxShadow: on ? 'inset 0 0 0 1px var(--ember)' : 'none',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 7, overflow: 'hidden' }} dangerouslySetInnerHTML={{ __html: inkTile(p.name) }} />
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: on ? 'var(--ember)' : 'var(--mid)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{p.label}</span>
                    </button>
                  );
                })}
                {g.assets.map((a) => {
                  const url = `/api/campaigns/${campaignId}/files/assets/${a.file}`;
                  const on = activePalettePiece?.assetId === a.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => armAsset(a.id, url)}
                      title={a.title}
                      className="flex flex-col items-center gap-1 p-1.5 rounded-[10px] transition-colors"
                      style={{
                        background: on ? '#e08a4b1a' : 'var(--surface2)',
                        border: `1px solid ${on ? 'var(--ember)' : 'var(--border)'}`,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 7, overflow: 'hidden', background: '#0008' }}>
                        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      </div>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: on ? 'var(--ember)' : 'var(--mid)', textTransform: 'uppercase', letterSpacing: '0.06em', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {groups.length === 0 && (
            <p className="text-xs italic text-center py-6" style={{ color: 'var(--faint)' }}>No pieces match “{search}”.</p>
          )}
        </div>
      </div>

      {/* Layers */}
      <div className="p-3 space-y-2" style={{ borderTop: '1px solid var(--border)' }}>
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
  const label = builtin ? (INK_PIECE_BY_NAME[builtin]?.label ?? builtin) : 'Image';
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
