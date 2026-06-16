import { useRef, useState, type ChangeEvent } from 'react';
import type { ClientMessage, UploadAssetResponse } from '@vtt/shared';
import { useStore } from '../../store';
import type { GenKind } from '../../store';
import { api, apiUpload, ApiRequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { INK_LIBRARY } from '../../lib/inkArt';
import { centredPlacement } from '../../lib/view';

function sendWs(msg: ClientMessage): void {
  const conn = (window as unknown as { __vttConn?: { send: (msg: ClientMessage) => void } }).__vttConn;
  conn?.send(msg);
}

interface GenImage { base64: string; mimeType: string }
const STYLE_CHIPS: Record<GenKind, string[]> = {
  background: ['Top-down battlemap', 'Hand-inked / painterly', 'Grid-ready', 'Fit to canvas'],
  prop: ['Top-down view', 'Hand-inked outline', 'Transparent cut-out', 'Grid-sized · scalable'],
};

/** AI asset generator — the platform owns the style; the user supplies the subject. */
export function GenDialog() {
  const kind = useStore((s) => s.genDialog) as GenKind;
  const campaignId = useStore((s) => s.activeCampaignId);
  const features = useStore((s) => s.features);
  const close = useStore((s) => s.setGenDialog);
  const assets = useStore((s) => s.assets);
  const grid = useStore((s) => s.grid);
  const enabled = features.imageGenEnabled;

  // Category suggestions: built-in palette sections + any already used on assets.
  const categoryOptions = Array.from(new Set([
    ...INK_LIBRARY.map((g) => g.section),
    ...(assets ?? []).map((a) => a.category).filter((c): c is string => !!c),
    'Uploads',
  ]));
  const [category, setCategory] = useState('Uploads');

  const [prompt, setPrompt] = useState(
    kind === 'background' ? 'a torchlit forest clearing with a worn dirt path' : 'a mossy standing stone carved with faded runes',
  );
  const [phase, setPhase] = useState<'idle' | 'gen' | 'done' | 'saving'>('idle');
  const [images, setImages] = useState<GenImage[]>([]);
  const [sel, setSel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function generate() {
    if (!campaignId || prompt.trim() === '') return;
    setPhase('gen');
    setError(null);
    try {
      const res = await api.post<{ images: GenImage[] }>(`/api/campaigns/${campaignId}/generate`, { subject: prompt.trim(), kind });
      setImages(res.images);
      setSel(0);
      setPhase('done');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Generation failed');
      setPhase('idle');
    }
  }

  async function commitAsset(base64: string): Promise<UploadAssetResponse['asset'] | null> {
    if (!campaignId) return null;
    const res = await api.post<UploadAssetResponse>(`/api/campaigns/${campaignId}/generate/save`, {
      base64, kind, title: prompt.trim().slice(0, 40),
      ...(kind === 'prop' ? { category: category.trim() || 'Uploads' } : {}),
    });
    return res.asset;
  }

  async function useSelected() {
    const img = images[sel];
    if (!img) return;
    setPhase('saving');
    setError(null);
    try {
      const asset = await commitAsset(img.base64);
      if (asset && kind === 'background') {
        // Scale the MAP (not the grid) to 40 cells wide and drop it centred in
        // the current view, grid-aligned; keep the grid clearly visible.
        const w = 40 * grid.cell;
        const p = centredPlacement(w, w);
        sendWs({ type: 'boardAdd', assetId: asset.id, x: p.x, y: p.y, w });
        sendWs({ type: 'setGrid', grid: { offsetX: 0, offsetY: 0, unit: 'm', visible: true, color: '#00000059' } });
      }
      close(null); // prop assets appear in the palette via assetsUpdated
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Save failed');
      setPhase('done');
    }
  }

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !campaignId) return;
    setError(null);
    try {
      const res = await apiUpload<UploadAssetResponse>(`/api/campaigns/${campaignId}/assets`, file, {
        kind: kind === 'background' ? 'map' : 'token',
        ...(kind === 'prop' ? { category: category.trim() || 'Uploads' } : {}),
      });
      if (kind === 'background') sendWs({ type: 'boardAdd', assetId: res.asset.id, x: 0, y: 0 });
      close(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Upload failed');
    }
  }

  const title = kind === 'background' ? 'New background' : 'New prop';
  const help = kind === 'background'
    ? 'Describe the place. The Tavern renders it as a top-down, grid-ready battlemap in the house ink style — you only say what it is.'
    : 'Describe what you want. The Tavern handles the rest — top-down view, hand-inked style and a clean transparent cut-out, sized to the grid.';

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000000a8', backdropFilter: 'blur(2px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(null); }}
    >
      <div
        style={{
          width: kind === 'background' ? 560 : 400, maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 30px 80px -20px #000f',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border-soft)' }}>
          <span className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--hi)' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.6" className="w-4 h-4"><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="8.5" cy="9.5" r="1.8" fill="var(--gold)" /><path d="M4 18l5-5 4 3 3-3 4 4" strokeLinejoin="round" /></svg>
            {title}
          </span>
          <button type="button" onClick={() => close(null)} aria-label="Close" style={{ color: 'var(--low)', background: 'none', border: 'none', cursor: 'pointer' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" /></svg>
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-sm" style={{ color: 'var(--mid)' }}>{help}</p>

          {kind === 'prop' && (
            <div className="flex items-center gap-2">
              <span className="eyebrow shrink-0">Category</span>
              <input
                list="gen-categories"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Nature, Monsters…"
                className="flex-1 px-3 py-1.5 text-sm rounded-[9px]"
                style={{ background: '#100c0a', border: '1px solid var(--border)', color: 'var(--hi)' }}
              />
              <datalist id="gen-categories">
                {categoryOptions.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
          )}

          {!enabled && (
            <div className="flex gap-3 p-3 rounded-[10px]" style={{ background: '#b6485a18', border: '1px solid #b6485a44' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--garnet)" strokeWidth="1.6" className="w-5 h-5 shrink-0"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
              <div>
                <div className="text-sm font-medium" style={{ color: 'var(--hi)' }}>AI generation is off</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--mid)' }}>
                  No image API key is configured on this server. Set <code style={{ fontFamily: 'var(--mono)', color: 'var(--gold)' }}>LLM_API_KEY</code> at startup to enable it. You can still add {kind === 'background' ? 'a background' : 'props'} by uploading your own art.
                </div>
              </div>
            </div>
          )}

          {/* AI block */}
          <div style={enabled ? undefined : { opacity: 0.45, filter: 'grayscale(1)', pointerEvents: 'none' }}>
            <span className="eyebrow">Describe the {kind === 'background' ? 'place' : 'prop'}</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={!enabled}
              rows={3}
              className="w-full mt-1.5 px-3 py-2 text-sm rounded-[9px] resize-none focus:outline-none"
              style={{ background: '#100c0a', border: '1px solid var(--border)', color: 'var(--hi)', caretColor: 'var(--gold)' }}
              onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--gold)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 3px #e8b76522'; }}
              onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
            />
            <div className="mt-2 p-2.5 rounded-[9px]" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--low)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-3 h-3"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
                Style &amp; format <span style={{ color: 'var(--faint)' }}>· set by The Tavern</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {STYLE_CHIPS[kind].map((c) => (
                  <span key={c} className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'var(--raised)', color: 'var(--mid)' }}>{c}</span>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={generate}
              disabled={!enabled || phase === 'gen' || phase === 'saving'}
              className="w-full mt-2.5 py-2.5 rounded-[9px] text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: 'var(--ember)', color: 'var(--ink)', border: 'none', cursor: 'pointer' }}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M12 3l1.8 5.6L19 10l-5.2 1.4L12 17l-1.8-5.6L5 10l5.2-1.4z" /></svg>
              {phase === 'gen' ? 'Generating…' : phase === 'done' ? 'Regenerate' : 'Generate'}
            </button>

            {phase !== 'idle' && (
              <>
                <div className="eyebrow mt-3 mb-1.5">Four takes · pick one</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {phase === 'gen'
                    ? [0, 1, 2, 3].map((i) => (
                        <div key={i} style={{ aspectRatio: kind === 'background' ? '16/10' : '1/1', borderRadius: 9, background: 'linear-gradient(110deg,#1f1815,#262019,#1f1815)' }} />
                      ))
                    : images.map((img, i) => {
                        const on = sel === i;
                        return (
                          <button key={i} type="button" onClick={() => setSel(i)}
                            style={{
                              position: 'relative', aspectRatio: kind === 'background' ? '16/10' : '1/1', borderRadius: 9, overflow: 'hidden', cursor: 'pointer', padding: 0,
                              border: `2px solid ${on ? 'var(--ember)' : 'var(--border)'}`,
                              background: 'repeating-conic-gradient(#2a2420 0% 25%, #1c1714 0% 50%) 0 0 / 16px 16px',
                            }}>
                            <img src={`data:${img.mimeType};base64,${img.base64}`} alt={`take ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: kind === 'background' ? 'cover' : 'contain' }} />
                            <span style={{ position: 'absolute', left: 5, top: 5, fontFamily: 'var(--mono)', fontSize: 10, color: '#fff', background: '#000a', padding: '1px 5px', borderRadius: 4 }}>0{i + 1}</span>
                            {on && <span style={{ position: 'absolute', right: 5, top: 5, width: 18, height: 18, borderRadius: '50%', background: 'var(--ember)', color: 'var(--ink)', display: 'grid', placeItems: 'center', fontSize: 11 }}>✓</span>}
                          </button>
                        );
                      })}
                </div>
                {phase !== 'gen' && images.length > 0 && (
                  <Button className="w-full mt-2.5" onClick={useSelected} disabled={phase === 'saving'}>
                    {phase === 'saving' ? 'Saving…' : kind === 'background' ? 'Use as background' : 'Add to palette'}
                  </Button>
                )}
              </>
            )}
          </div>

          {error && <p role="alert" className="text-xs" style={{ color: 'var(--garnet)' }}>{error}</p>}

          {/* Upload fallback */}
          <div className="flex items-center gap-3">
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span className="text-xs" style={{ color: 'var(--faint)' }}>or</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full py-3 rounded-[10px] flex flex-col items-center gap-1"
            style={{ border: `1px dashed ${enabled ? 'var(--border)' : 'var(--ember)'}`, background: enabled ? 'transparent' : '#e08a4b10', color: 'var(--mid)', cursor: 'pointer' }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="w-5 h-5"><path d="M12 16V5m0 0l-4 4m4-4l4 4" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 19h14" strokeLinecap="round" /></svg>
            <span className="text-sm font-medium">Upload {kind === 'background' ? 'an image' : 'a PNG'}</span>
            <span className="text-[11px]" style={{ color: 'var(--faint)' }}>{kind === 'background' ? 'JPG or PNG · calibrate the grid after' : 'Transparent background works best'}</span>
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void handleUpload(e); }} />
        </div>
      </div>
    </div>
  );
}
