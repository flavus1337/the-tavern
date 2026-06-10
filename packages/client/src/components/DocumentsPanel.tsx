import { useRef, type ChangeEvent } from 'react';
import type { AssetManifest, UploadAssetResponse, ClientMessage } from '@vtt/shared';
import { api, apiUpload, ApiRequestError } from '../lib/api';
import { useStore } from '../store';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import { useState } from 'react';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

export function DocumentsPanel() {
  const campaignId = useStore((s) => s.activeCampaignId);
  const documents = useStore((s) => s.documents);
  const self = useStore((s) => s.self);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setViewingDocument = useStore((s) => s.setViewingDocument);
  const connection = useStore((s) => s.connection);

  function shareDocument(assetId: string) {
    const conn = (window as unknown as { __vttConn?: { send: (msg: ClientMessage) => void } }).__vttConn;
    conn?.send({ type: 'shareDocument', assetId });
  }

  const isDm = self?.role === 'dm';

  async function handleUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !campaignId) return;

    if (file.size > MAX_FILE_SIZE) {
      setError('File too large. Maximum 25MB.');
      return;
    }

    setUploading(true);
    setError(null);
    try {
      await apiUpload<UploadAssetResponse>(`/api/campaigns/${campaignId}/documents`, file);
      // Server pushes documentsUpdated via WS
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
      else setError('Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDelete(assetId: string) {
    if (!campaignId) return;
    setError(null);
    try {
      await api.del(`/api/campaigns/${campaignId}/assets/${assetId}`);
      // Server pushes documentsUpdated via WS
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
      else setError('Delete failed');
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Upload bar */}
      <div className="p-3 border-b border-zinc-800 space-y-2">
        <Button
          size="sm"
          variant="secondary"
          loading={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="w-full"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M16 12l-4-4-4 4M12 8v8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Upload File
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => { void handleUpload(e); }}
        />
        {error && (
          <p role="alert" className="text-xs text-red-400">{error}</p>
        )}
      </div>

      {/* Document list */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {documents.length === 0 ? (
            <p className="text-xs text-zinc-500 text-center py-8">
              No documents yet. Upload a file (character sheet, handout, …) — only you see it until you share it with the table.
            </p>
          ) : (
            documents.map((doc) => (
              <DocumentItem
                key={doc.id}
                doc={doc}
                campaignId={campaignId ?? ''}
                canDelete={isDm || doc.ownerUsername === self?.username}
                canShare={connection === 'open' && (isDm || doc.ownerUsername === self?.username)}
                sharedByOther={doc.ownerUsername !== self?.username}
                onDelete={() => { void handleDelete(doc.id); }}
                onView={() => setViewingDocument(doc)}
                onShare={() => shareDocument(doc.id)}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

interface DocumentItemProps {
  doc: AssetManifest;
  campaignId: string;
  canDelete: boolean;
  canShare: boolean;
  sharedByOther: boolean;
  onDelete: () => void;
  onView: () => void;
  onShare: () => void;
}

function DocumentItem({ doc, campaignId, canDelete, canShare, sharedByOther, onDelete, onView, onShare }: DocumentItemProps) {
  return (
    <div className="flex items-center gap-2 p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg">
      <button
        type="button"
        onClick={onView}
        className="flex items-center gap-2 flex-1 min-w-0 text-left rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
        aria-label={`View ${doc.title}`}
        title="View document"
      >
        <div className="w-8 h-8 rounded bg-zinc-800 flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 text-zinc-400">
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm text-zinc-200 truncate hover:text-white transition-colors">{doc.title}</p>
            {sharedByOther && <Badge>shared</Badge>}
          </div>
          {doc.ownerUsername && (
            <p className="text-xs text-zinc-500">by {doc.ownerUsername}</p>
          )}
        </div>
      </button>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onShare}
          disabled={!canShare}
          className="p-1.5 text-zinc-400 hover:text-indigo-400 disabled:opacity-40 rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
          aria-label={`Share ${doc.title} with the table`}
          title="Share with table"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path d="M8.7 10.7l6.6-3.4M8.7 13.3l6.6 3.4M21 5a3 3 0 11-6 0 3 3 0 016 0zM9 12a3 3 0 11-6 0 3 3 0 016 0zm12 7a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <a
          href={`/api/campaigns/${campaignId}/files/assets/${doc.file}`}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
          aria-label={`Open ${doc.title}`}
          title="Open in new tab"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="p-1.5 text-zinc-600 hover:text-red-400 rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
            aria-label={`Delete ${doc.title}`}
            title="Delete"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
