import { useRef, useState, type ChangeEvent } from 'react';
import type { AssetManifest, UploadAssetResponse } from '@vtt/shared';
import { api, apiUpload, ApiRequestError } from '../../lib/api';
import { centredPlacement } from '../../lib/view';
import { useStore } from '../../store';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { DocumentsPanel } from '../DocumentsPanel';
import { SaveFeedback, useSaveCommand } from '../SaveFeedback';

/** The same library is used by DM tools and the Build inspector. */
export function AssetPicker({ build = false }: { build?: boolean }) {
  const campaignId = useStore((s) => s.activeCampaignId);
  const assets = useStore((s) => s.assets) ?? [];
  const connected = useStore((s) => s.connection === 'open');
  const activePalettePiece = useStore((s) => s.activePalettePiece);
  const [kind, setKind] = useState<'map' | 'art' | 'document'>('map');
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const save = useSaveCommand();
  const query = search.trim().toLowerCase();
  const filtered = assets.filter((asset) => (kind === 'map' ? asset.assetKind === 'map' : asset.assetKind !== 'map' && asset.assetKind !== 'document') &&
    (!query || [asset.title, asset.category, ...asset.tags].some((value) => value?.toLowerCase().includes(query))));

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !campaignId) return;
    setUploading(true); setError(null); setMessage(null);
    try {
      await apiUpload<UploadAssetResponse>(`/api/campaigns/${campaignId}/assets`, file, { kind, dmOnly: 'false' });
      setMessage('Uploaded to the library. Choose Place when you are ready.');
    } catch (err) { setError(err instanceof ApiRequestError ? err.message : 'Upload failed.'); }
    finally { setUploading(false); if (input.current) input.current.value = ''; }
  }

  async function place(asset: AssetManifest, asMap = asset.assetKind === 'map') {
    setMessage(null);
    if (!asMap) {
      const state = useStore.getState();
      state.setActivePalettePiece({ builtin: null, assetId: asset.id, url: `/api/campaigns/${campaignId}/files/assets/${asset.file}`, layer: 'props', lockedToGrid: false });
      state.setEditorMode('build'); state.setBoardTool('stamp');
      setMessage('Click the map to place this prop. On a small screen, choose Back to table first.');
      return;
    }
    const width = 40 * useStore.getState().grid.cell;
    const height = asset.width && asset.height ? width * asset.height / asset.width : width;
    const position = centredPlacement(width, height);
    if (await save.run({ type: 'boardAdd', assetId: asset.id, ...position, w: width })) {
      setMessage('Map placed. Use Build + Select to move or resize it.');
    }
  }

  async function remove(asset: AssetManifest) {
    if (!campaignId || !window.confirm(`Delete “${asset.title}” from the library? This cannot be undone.`)) return;
    setError(null);
    try { await api.del(`/api/campaigns/${campaignId}/assets/${asset.id}`); }
    catch (err) { setError(err instanceof ApiRequestError ? err.message : 'Delete failed.'); }
  }

  return <section aria-label="Asset library" className={build ? 'flex flex-col' : 'flex flex-col h-full min-h-0'}>
    <div className="p-3 space-y-2" style={{ borderBottom: '1px solid var(--border-soft)' }}>
      <p className="eyebrow">Asset library</p>
      <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--mid)' }}>
        Show
        <select value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setMessage(null); }} className="flex-1 min-w-0 p-2 rounded border" style={{ background: 'var(--raised)', borderColor: 'var(--border)' }}>
          <option value="map">Maps · place a background</option>
          <option value="art">Props · place on the map</option>
          <option value="document">Files · view and share</option>
        </select>
      </label>
      <Input aria-label="Search asset library" placeholder="Search library…" value={search} onChange={(event) => setSearch(event.target.value)} />
      {kind !== 'document' && <>
        <Button variant="secondary" size="sm" className="w-full" loading={uploading} onClick={() => input.current?.click()}>Upload {kind === 'map' ? 'map' : 'prop'}</Button>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(event) => { void upload(event); }} />
        <p className="text-xs" style={{ color: 'var(--low)' }}>Maps and props are for everyone on the table. Choose Files to control which players can see a handout. The DM can access campaign files.</p>
      </>}
      {error && <p role="alert" className="text-xs" style={{ color: 'var(--garnet)' }}>{error}</p>}
      {message && <p role="status" className="text-xs" style={{ color: 'var(--mid)' }}>{message}</p>}
      {activePalettePiece?.assetId && <p className="text-xs" style={{ color: 'var(--ember)' }}>Prop ready. Click the map to place it; on a small screen choose Back to table first. Choose Select to stop placing.</p>}
    </div>
    <SaveFeedback save={save} conflicts={[]} latest={{}} onUseTable={() => {}} onKeepChanges={() => {}} />
    {kind === 'document' ? <DocumentsPanel search={search} /> : <div className={build ? 'p-3' : 'flex-1 min-h-0 overflow-y-auto p-3'}>
      {filtered.length === 0 ? <p className="text-xs py-4 text-center" style={{ color: 'var(--low)' }}>{query ? 'No matching assets.' : `No ${kind === 'map' ? 'maps' : 'props'} yet. Upload one above or generate one in Build.`}</p> :
        <div className="grid grid-cols-2 gap-2">{filtered.map((asset) => <article key={asset.id} className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--raised)' }}>
          <img src={`/api/campaigns/${campaignId}/files/assets/${asset.file}`} alt="" loading="lazy" className="w-full aspect-square object-cover" />
          <div className="p-2 space-y-1">
            <p className="text-sm break-words" style={{ color: 'var(--hi)' }}>{asset.title}</p>
            <p className="text-xs" style={{ color: 'var(--low)' }}>Audience when placed: everyone</p>
            <div className="flex flex-wrap gap-1">
              <Button variant="secondary" size="sm" disabled={!connected || save.saving || save.blocked} onClick={() => { void place(asset); }}>Place {asset.assetKind === 'map' ? 'map' : 'prop'}</Button>
              {asset.assetKind !== 'map' && <Button variant="ghost" size="sm" disabled={!connected || save.saving || save.blocked} onClick={() => { void place(asset, true); }}>Place as map</Button>}
              <Button variant="ghost" size="sm" aria-label={`Delete ${asset.title}`} onClick={() => { void remove(asset); }}>Delete</Button>
            </div>
          </div>
        </article>)}</div>}
    </div>}
  </section>;
}
