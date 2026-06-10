import { useState, useRef, type ChangeEvent } from 'react';
import type { AssetManifest, UploadAssetResponse, ClientMessage } from '@vtt/shared';
import { api, apiUpload, ApiRequestError } from '../../lib/api';
import { useStore } from '../../store';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';

export function AssetPicker() {
  const campaignId = useStore((s) => s.activeCampaignId);
  const assets = useStore((s) => s.assets) ?? [];
  const board = useStore((s) => s.board);
  const boardView = useStore((s) => s.boardView);
  const connection = useStore((s) => s.connection);

  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dmOnly, setDmOnly] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function sendWs(msg: ClientMessage): void {
    const conn = (window as unknown as { __vttConn?: { send: (msg: ClientMessage) => void } }).__vttConn;
    conn?.send(msg);
  }

  /**
   * Compute the center of the current viewport in board-space coordinates,
   * so the new item is placed at the visible center.
   */
  function viewportCenter(): { x: number; y: number } {
    // The board stage transform is: translate(x, y) scale(s), origin 0 0.
    // The canvas area width/height — we approximate with window size here because
    // we don't have a ref to the container. Acceptable for placement purposes.
    const vw = window.innerWidth * 0.65; // rough canvas area (sidebar ~35%)
    const vh = window.innerHeight - 48; // minus header
    const { x, y, scale } = boardView;
    // viewport center in board-space: (vw/2 - x) / scale, (vh/2 - y) / scale
    return {
      x: (vw / 2 - x) / scale,
      y: (vh / 2 - y) / scale,
    };
  }

  function pinToBoard(assetId: string) {
    const center = viewportCenter();
    sendWs({ type: 'boardAdd', assetId, x: center.x, y: center.y });
  }

  function clearBoard() {
    if (board.length === 0) return;
    if (!window.confirm('Remove all items from the board? This cannot be undone.')) return;
    for (const item of board) {
      sendWs({ type: 'boardRemove', itemId: item.id });
    }
  }

  // Collect all tags
  const allTags = Array.from(new Set(assets.flatMap((a) => a.tags)));

  const filtered = assets.filter((a) => {
    if (a.assetKind === 'document') return false;
    const matchSearch = !search || a.title.toLowerCase().includes(search.toLowerCase());
    const matchTag = !activeTag || a.tags.includes(activeTag);
    return matchSearch && matchTag;
  });

  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete(asset: AssetManifest) {
    if (!campaignId) return;
    if (!window.confirm(`Delete "${asset.title}"? This cannot be undone.`)) return;
    setDeleteError(null);
    try {
      await api.del(`/api/campaigns/${campaignId}/assets/${asset.id}`);
      // The server pushes assetsUpdated (and boardUpdated if needed) via WebSocket
    } catch (err) {
      if (err instanceof ApiRequestError) setDeleteError(err.message);
      else setDeleteError('Delete failed');
    }
  }

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !campaignId) return;
    setUploading(true);
    setUploadError(null);
    try {
      const fields: Record<string, string> = { dmOnly: dmOnly ? 'true' : 'false' };
      await apiUpload<UploadAssetResponse>(`/api/campaigns/${campaignId}/assets`, file, fields);
      // The server will push assetsUpdated via WebSocket
    } catch (err) {
      if (err instanceof ApiRequestError) setUploadError(err.message);
      else setUploadError('Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 space-y-2 border-b border-zinc-800">
        <Input
          placeholder="Search assets…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-sm"
        />
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                  activeTag === tag
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {/* Upload */}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={dmOnly}
              onChange={(e) => setDmOnly(e.target.checked)}
              className="rounded"
            />
            DM only
          </label>
          <Button
            size="sm"
            variant="secondary"
            loading={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="flex-1"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M16 12l-4-4-4 4M12 8v8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Upload Image
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => { void handleUpload(e); }}
          />
        </div>

        {uploadError && (
          <p role="alert" className="text-xs text-red-400">{uploadError}</p>
        )}
        {deleteError && (
          <p role="alert" className="text-xs text-red-400">{deleteError}</p>
        )}

        {board.length > 0 && (
          <Button
            size="sm"
            variant="destructive"
            className="w-full"
            onClick={clearBoard}
            disabled={connection !== 'open'}
          >
            Clear board
          </Button>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {filtered.length === 0 ? (
          <p className="text-xs text-zinc-500 text-center py-8">
            {assets.length === 0 ? 'No assets yet. Upload one above.' : 'No assets match.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filtered.map((asset) => (
              <AssetThumb
                key={asset.id}
                asset={asset}
                campaignId={campaignId ?? ''}
                onPin={() => pinToBoard(asset.id)}
                onDelete={() => { void handleDelete(asset); }}
                disabled={connection !== 'open'}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface AssetThumbProps {
  asset: AssetManifest;
  campaignId: string;
  onPin: () => void;
  onDelete: () => void;
  disabled: boolean;
}

function AssetThumb({ asset, campaignId, onPin, onDelete, disabled }: AssetThumbProps) {
  return (
    <div className="relative group bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
      <img
        src={`/api/campaigns/${campaignId}/files/assets/${asset.file}`}
        alt={asset.title}
        className="w-full aspect-square object-cover"
        loading="lazy"
      />
      {asset.dmOnly && (
        <div className="absolute top-1 right-1">
          <span title="DM only" aria-label="DM only">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 text-violet-400">
              <path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 00-5.25 5.25v3a3 3 0 00-3 3v6.75a3 3 0 003 3h10.5a3 3 0 003-3v-6.75a3 3 0 00-3-3v-3c0-2.9-2.35-5.25-5.25-5.25zm3.75 8.25v-3a3.75 3.75 0 10-7.5 0v3h7.5z" clipRule="evenodd" />
            </svg>
          </span>
        </div>
      )}
      <div className="p-1.5">
        <p className="text-xs text-zinc-300 truncate">{asset.title}</p>
        <div className="flex gap-1 mt-1">
          <Button
            size="sm"
            className="flex-1 text-xs py-1"
            onClick={onPin}
            disabled={disabled}
          >
            Pin to board
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="text-xs py-1 px-2"
            onClick={onDelete}
            aria-label={`Delete ${asset.title}`}
            title="Delete asset"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14M10 11v6M14 11v6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
        </div>
      </div>
    </div>
  );
}
