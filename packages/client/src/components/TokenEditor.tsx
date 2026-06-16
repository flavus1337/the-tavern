import { useRef, useState, type ChangeEvent } from 'react';
import type { ClientMessage, TokenView, Sharing, UploadAssetResponse, TokenStatBlock } from '@vtt/shared';
import { defaultSharing, CONDITIONS } from '@vtt/shared';
import { useStore } from '../store';
import { apiUpload, ApiRequestError } from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { SharePicker } from './SharePicker';

function sendWs(msg: ClientMessage): void {
  const conn = (window as unknown as { __vttConn?: { send: (msg: ClientMessage) => void } }).__vttConn;
  conn?.send(msg);
}

const FILL_SWATCHES = ['#5b86c2', '#69b7a6', '#b6485a', '#e08a4b', '#9b7bd0', '#7d9b54', '#c2974b', '#8a8a8a'];
const MAX_IMG_SIZE = 100 * 1024 * 1024;

// Board-space coordinate at the centre of the visible canvas (for placing a new token).
function viewportCenterBoardPoint(): { x: number; y: number } {
  const el = document.querySelector('[aria-label="Campaign map canvas"]') as HTMLElement | null;
  const view = useStore.getState().boardView;
  const rect = el?.getBoundingClientRect();
  const cx = rect ? rect.width / 2 : 400;
  const cy = rect ? rect.height / 2 : 300;
  return { x: (cx - view.x) / view.scale, y: (cy - view.y) / view.scale };
}

/**
 * Token create/edit panel rendered over the canvas (non-modal). The DM may
 * create/edit any token; a player creates tokens they own (and can grant
 * control to others via the sharing picker). New token (tokenId === null)
 * sends tokenAdd; existing sends tokenUpdate.
 */
export function TokenEditor({ tokenId, panelId, stackIndex }: { tokenId: string | null; panelId: string; stackIndex: number }) {
  const tokens = useStore((s) => s.tokens);
  const members = useStore((s) => s.members);
  const self = useStore((s) => s.self);
  const grid = useStore((s) => s.grid);
  const campaignId = useStore((s) => s.activeCampaignId);
  const connection = useStore((s) => s.connection);
  const uploadsLocked = useStore((s) => s.uploadsLocked);
  const closePanel = useStore((s) => s.closePanel);
  const bringPanelToFront = useStore((s) => s.bringPanelToFront);

  const isDm = self?.role === 'dm';
  const existing: TokenView | undefined = tokenId ? tokens.find((t) => t.id === tokenId) : undefined;

  const [name, setName] = useState(existing?.name ?? '');
  const [shape, setShape] = useState<TokenView['shape']>(existing?.shape ?? 'round');
  const [allegiance, setAllegiance] = useState<TokenView['allegiance']>(existing?.allegiance ?? 'ally');
  const [size, setSize] = useState<TokenView['size']>(existing?.size ?? 'M');
  const [ownerUserId, setOwnerUserId] = useState<string | null>(existing?.ownerUserId ?? (isDm ? null : self?.userId ?? null));
  const [fill, setFill] = useState(existing?.fill ?? FILL_SWATCHES[0]!);
  const [hasHp, setHasHp] = useState(existing?.maxHp != null);
  const [hp, setHp] = useState(existing?.hp ?? 10);
  const [maxHp, setMaxHp] = useState(existing?.maxHp ?? 10);
  const [dmOnly, setDmOnly] = useState(existing?.dmOnly ?? false);
  const [sharing, setSharing] = useState<Sharing>(existing?.sharing ?? defaultSharing());
  const [conditions, setConditions] = useState<string[]>(existing?.conditions ?? []);
  const BLANK_SB: TokenStatBlock = { ac: null, speed: '', str: null, dex: null, con: null, int: null, wis: null, cha: null, notes: '' };
  const [hasStats, setHasStats] = useState(existing?.statBlock != null);
  const [sb, setSb] = useState<TokenStatBlock>(existing?.statBlock ?? BLANK_SB);
  const setSbField = (k: keyof TokenStatBlock, v: number | string | null) => setSb((s) => ({ ...s, [k]: v }));
  const [assetId, setAssetId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(existing?.imageUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSubmit = connection === 'open' && name.trim() !== '';
  const candidates = members.filter((m) => m.role === 'player');
  const uploadBlocked = !isDm && uploadsLocked;
  // Image can only be set at creation time (tokenUpdate doesn't carry an asset).
  const canUploadImage = !tokenId && !uploadBlocked;

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !campaignId) return;
    if (file.size > MAX_IMG_SIZE) { setError('Image too large (max 100MB).'); return; }
    setUploading(true);
    setError(null);
    try {
      const res = await apiUpload<UploadAssetResponse>(`/api/campaigns/${campaignId}/assets`, file, { kind: 'token' });
      setAssetId(res.asset.id);
      setImageUrl(`/api/campaigns/${campaignId}/files/assets/${res.asset.file}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function submit() {
    if (!canSubmit) return;
    const hpFields = hasHp ? { hp, maxHp } : { hp: null, maxHp: null };
    const combat = { conditions, statBlock: hasStats ? sb : null };
    if (tokenId && existing) {
      sendWs({
        type: 'tokenUpdate', tokenId, name: name.trim(), shape, allegiance, size, fill, sharing, ...hpFields, ...combat,
        ...(isDm ? { ownerUserId, dmOnly } : {}),
      });
    } else {
      const pt = viewportCenterBoardPoint();
      const x = grid.snap ? Math.round((pt.x - grid.offsetX) / grid.cell) * grid.cell + grid.offsetX : pt.x;
      const y = grid.snap ? Math.round((pt.y - grid.offsetY) / grid.cell) * grid.cell + grid.offsetY : pt.y;
      sendWs({
        type: 'tokenAdd', name: name.trim(), shape, allegiance, size, fill, sharing, x, y, ...combat,
        // For players the server forces owner=self & dmOnly=false; sending sane defaults.
        ownerUserId: isDm ? ownerUserId : (self?.userId ?? null),
        dmOnly: isDm ? dmOnly : false,
        ...(assetId ? { assetId } : {}),
        ...hpFields,
      });
    }
    closePanel(panelId);
  }

  const toggleCondition = (c: string) =>
    setConditions((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));

  const labelCls = 'eyebrow';
  const rowCls = 'flex flex-col gap-1.5';

  return (
    <div
      className="absolute inset-0 flex flex-col lg:inset-auto lg:top-4 lg:bottom-4 lg:w-[380px] lg:rounded-xl lg:shadow-2xl lg:overflow-hidden"
      onPointerDownCapture={() => bringPanelToFront(panelId)}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        zIndex: 8 + stackIndex,
        right: `calc(1rem + ${(stackIndex % 5) * 36}px)`,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-2 px-4 py-2 shrink-0"
        style={{ borderBottom: '1px solid var(--border-soft)', background: 'var(--bg)' }}
      >
        <p className="text-sm font-medium truncate" style={{ color: 'var(--hi)' }}>
          {tokenId ? 'Edit token' : 'New token'}
        </p>
        <button
          type="button"
          onClick={() => closePanel(panelId)}
          className="p-1.5 rounded transition-colors"
          style={{ color: 'var(--low)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--hi)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--low)'; }}
          aria-label="Close token editor"
          title="Close"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
        {/* Live preview + name */}
        <div className="flex items-center gap-3">
          <div
            className={`tok ${shape} ${allegiance}`}
            style={{ position: 'relative', width: 52, height: 52, flexShrink: 0 }}
          >
            <div className="tok-ground" />
            <div
              className="tok-face"
              style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : { background: fill }}
            >
              {!imageUrl && <span className="glyph" style={{ fontSize: 20 }}>{(name.trim()[0] ?? '?').toUpperCase()}</span>}
            </div>
          </div>
          <div className="flex-1">
            <Input placeholder="Token name" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!tokenId} />
          </div>
        </div>

        {/* Image upload (creation only) */}
        {canUploadImage && (
          <div className={rowCls}>
            <span className={labelCls}>Face image (optional)</span>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full py-2 rounded-[9px] text-sm disabled:opacity-50"
              style={{ border: '1px dashed var(--border)', background: 'transparent', color: 'var(--mid)', cursor: 'pointer' }}
            >
              {uploading ? 'Uploading…' : imageUrl ? 'Replace image' : '⤓ Upload image'}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void handleUpload(e); }} />
            {imageUrl && (
              <button type="button" onClick={() => { setImageUrl(null); setAssetId(null); }}
                className="text-xs self-start" style={{ color: 'var(--low)', background: 'none', border: 'none', cursor: 'pointer' }}>
                Remove image (use colour instead)
              </button>
            )}
          </div>
        )}

        {/* Shape + size */}
        <div className="grid grid-cols-2 gap-3">
          <div className={rowCls}>
            <span className={labelCls}>Shape</span>
            <Segmented value={shape} onChange={(v) => setShape(v as TokenView['shape'])} options={[['round', 'Round'], ['square', 'Square']]} />
          </div>
          <div className={rowCls}>
            <span className={labelCls}>Size</span>
            <Segmented value={size} onChange={(v) => setSize(v as TokenView['size'])} options={[['S', 'S'], ['M', 'M'], ['L', 'L'], ['H', 'H']]} />
          </div>
        </div>

        <div className={rowCls}>
          <span className={labelCls}>Allegiance</span>
          <Segmented
            value={allegiance}
            onChange={(v) => setAllegiance(v as TokenView['allegiance'])}
            options={[['ally', 'Ally'], ['enemy', 'Enemy'], ['neutral', 'Neutral']]}
          />
        </div>

        {/* Fill swatches (only relevant without an image) */}
        {!imageUrl && (
          <div className={rowCls}>
            <span className={labelCls}>Colour</span>
            <div className="flex flex-wrap gap-2">
              {FILL_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setFill(c)}
                  aria-label={`Colour ${c}`}
                  style={{
                    width: 26, height: 26, borderRadius: 7, background: c, cursor: 'pointer',
                    border: fill === c ? '2px solid var(--hi)' : '2px solid transparent',
                    boxShadow: fill === c ? '0 0 0 2px var(--ember)' : 'inset 0 0 0 1px #00000055',
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Owner — DM only */}
        {isDm && (
          <div className={rowCls}>
            <span className={labelCls}>Controlled by</span>
            <select
              value={ownerUserId ?? ''}
              onChange={(e) => setOwnerUserId(e.target.value || null)}
              className="w-full px-3 py-2 text-sm rounded-[9px]"
              style={{ background: '#100c0a', border: '1px solid var(--border)', color: 'var(--hi)' }}
            >
              <option value="">DM only (no player owner)</option>
              {candidates.map((p) => (
                <option key={p.userId} value={p.userId}>{p.username}</option>
              ))}
            </select>
          </div>
        )}

        {/* Control sharing — who else can move/edit this token */}
        <div className={rowCls}>
          <span className={labelCls}>Also controllable by</span>
          <SharePicker
            sharing={sharing}
            onChange={setSharing}
            scopes={['private', 'users', 'all']}
            privateLabel={isDm ? 'Owner' : 'Just me'}
          />
        </div>

        {/* HP */}
        <div className={rowCls}>
          <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: 'var(--mid)' }}>
            <input type="checkbox" checked={hasHp} onChange={(e) => setHasHp(e.target.checked)} style={{ accentColor: 'var(--ember)' }} />
            Track HP
          </label>
          {hasHp && (
            <div className="flex items-center gap-2">
              <Input type="number" value={hp} onChange={(e) => setHp(Number(e.target.value))} className="w-20" aria-label="Current HP" />
              <span style={{ color: 'var(--faint)' }}>/</span>
              <Input type="number" value={maxHp} onChange={(e) => setMaxHp(Number(e.target.value))} className="w-20" aria-label="Max HP" />
            </div>
          )}
        </div>

        {/* Conditions — visible to everyone */}
        <div className={rowCls}>
          <span className={labelCls}>Conditions</span>
          <div className="flex flex-wrap gap-1.5">
            {CONDITIONS.map((c) => {
              const on = conditions.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCondition(c)}
                  className="px-2 py-1 text-xs rounded-full capitalize transition-colors"
                  style={{
                    border: `1px solid ${on ? 'var(--ember)' : 'var(--border)'}`,
                    background: on ? '#e08a4b22' : 'transparent',
                    color: on ? 'var(--ember)' : 'var(--low)', cursor: 'pointer',
                  }}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        {/* Stat block — lightweight; DM sees all, players only their own tokens */}
        <div className={rowCls}>
          <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: 'var(--mid)' }}>
            <input type="checkbox" checked={hasStats} onChange={(e) => setHasStats(e.target.checked)} style={{ accentColor: 'var(--ember)' }} />
            Combat stat block
          </label>
          {hasStats && (
            <div className="flex flex-col gap-2 p-2.5 rounded-[9px]" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--low)' }}>
                  AC
                  <Input type="number" value={sb.ac ?? ''} onChange={(e) => setSbField('ac', e.target.value === '' ? null : Number(e.target.value))} className="w-16" aria-label="Armor class" />
                </label>
                <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--low)' }}>
                  Speed
                  <Input value={sb.speed} onChange={(e) => setSbField('speed', e.target.value)} placeholder="30 ft." className="flex-1" aria-label="Speed" />
                </label>
              </div>
              <div className="grid grid-cols-6 gap-1.5">
                {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((ab) => (
                  <div key={ab} className="flex flex-col items-center gap-1">
                    <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--faint)' }}>{ab}</span>
                    <Input
                      type="number"
                      value={sb[ab] ?? ''}
                      onChange={(e) => setSbField(ab, e.target.value === '' ? null : Number(e.target.value))}
                      className="w-full text-center px-1"
                      aria-label={ab}
                    />
                  </div>
                ))}
              </div>
              <textarea
                value={sb.notes}
                onChange={(e) => setSbField('notes', e.target.value)}
                placeholder="Attacks, traits, notes…"
                rows={3}
                className="w-full px-2 py-1.5 text-sm rounded-[7px] resize-y"
                style={{ background: '#100c0a', border: '1px solid var(--border)', color: 'var(--hi)' }}
              />
            </div>
          )}
        </div>

        {/* DM only visibility — DM only */}
        {isDm && (
          <label className="flex items-center gap-2 cursor-pointer text-sm" style={{ color: 'var(--mid)' }}>
            <input type="checkbox" checked={dmOnly} onChange={(e) => setDmOnly(e.target.checked)} style={{ accentColor: 'var(--ember)' }} />
            Hidden from players (DM only)
          </label>
        )}

        {error && <p role="alert" className="text-xs" style={{ color: 'var(--garnet)' }}>{error}</p>}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-4 py-3 shrink-0" style={{ borderTop: '1px solid var(--border-soft)' }}>
        <Button size="sm" variant="ghost" onClick={() => closePanel(panelId)}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={!canSubmit}>{tokenId ? 'Save' : 'Place on board'}</Button>
      </div>
    </div>
  );
}

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <div className="flex overflow-hidden" style={{ borderRadius: 9, border: '1px solid var(--border)' }}>
      {options.map(([val, label]) => (
        <button
          key={val}
          type="button"
          onClick={() => onChange(val)}
          className="flex-1 px-2 py-1.5 text-xs transition-colors"
          style={value === val ? { background: 'var(--raised)', color: 'var(--hi)' } : { color: 'var(--low)', background: 'transparent' }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
