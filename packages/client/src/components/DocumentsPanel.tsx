import { useRef, type ChangeEvent, useState } from 'react';
import type { AssetManifest, UploadAssetResponse, ClientMessage } from '@vtt/shared';
import { api, apiUpload, ApiRequestError } from '../lib/api';
import { useStore } from '../store';
import { ScrollArea } from './ui/scroll-area';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

export function DocumentsPanel() {
  const campaignId = useStore((s) => s.activeCampaignId);
  const documents = useStore((s) => s.documents);
  const self = useStore((s) => s.self);
  const uploadsLocked = useStore((s) => s.uploadsLocked);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setViewingDocument = useStore((s) => s.setViewingDocument);
  const viewingDocument = useStore((s) => s.viewingDocument);
  const connection = useStore((s) => s.connection);

  function shareDocument(assetId: string) {
    const conn = (window as unknown as { __vttConn?: { send: (msg: ClientMessage) => void } }).__vttConn;
    conn?.send({ type: 'shareDocument', assetId });
  }

  const isDm = self?.role === 'dm';
  const uploadBlocked = !isDm && uploadsLocked;

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
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
      else setError('Delete failed');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Upload button */}
      <div style={{ padding: 14, borderBottom: '1px solid var(--border-soft)' }}>
        <button
          type="button"
          onClick={() => !uploadBlocked && fileInputRef.current?.click()}
          disabled={uploadBlocked || uploading}
          style={{
            width: '100%',
            padding: 11,
            border: '1px dashed var(--border)',
            borderRadius: 10,
            background: 'transparent',
            color: uploadBlocked ? 'var(--faint)' : 'var(--mid)',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            cursor: uploadBlocked || uploading ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => {
            if (!uploadBlocked && !uploading) {
              const el = e.currentTarget;
              el.style.borderColor = 'var(--ember)';
              el.style.color = 'var(--ember)';
            }
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget;
            el.style.borderColor = 'var(--border)';
            el.style.color = uploadBlocked ? 'var(--faint)' : 'var(--mid)';
          }}
          title={uploadBlocked ? 'The DM has locked uploads' : undefined}
          aria-label="Upload file"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M16 12l-4-4-4 4M12 8v8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {uploading ? 'Uploading…' : uploadBlocked ? 'Uploads locked' : '⤓ Upload File'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => { void handleUpload(e); }}
        />
        {error && (
          <p role="alert" style={{ fontSize: 12, color: 'var(--garnet)', marginTop: 6 }}>{error}</p>
        )}
      </div>

      {/* Document list — sectioned: yours vs shared with you */}
      <ScrollArea className="flex-1">
        <div style={{ padding: '12px 14px' }}>
          {documents.length === 0 ? (
            /* Explainer — only when list is empty */
            <p style={{ fontSize: 13, color: 'var(--faint)', lineHeight: 1.6, textAlign: 'center', padding: '30px 10px' }}>
              Upload a file — a character sheet, a handout — and only you see it until you{' '}
              <em style={{ fontStyle: 'italic' }}>share it with the table.</em>
            </p>
          ) : (
            (() => {
              const mine = documents.filter((d) => d.ownerUsername === self?.username);
              const sharedWithMe = documents.filter((d) => d.ownerUsername !== self?.username);
              const sectionLabel = (text: string) => (
                <p
                  style={{
                    fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.14em',
                    textTransform: 'uppercase', color: 'var(--faint)', fontWeight: 500,
                    margin: '4px 0 8px',
                  }}
                >
                  {text}
                </p>
              );
              const renderDoc = (doc: AssetManifest) => (
                <DocumentItem
                  key={doc.id}
                  doc={doc}
                  campaignId={campaignId ?? ''}
                  isActive={viewingDocument?.id === doc.id}
                  canDelete={isDm || doc.ownerUsername === self?.username}
                  canShare={connection === 'open' && (isDm || doc.ownerUsername === self?.username)}
                  sharedByOther={doc.ownerUsername !== self?.username}
                  onDelete={() => { void handleDelete(doc.id); }}
                  onView={() => setViewingDocument(doc)}
                  onShare={() => shareDocument(doc.id)}
                />
              );
              return (
                <>
                  {mine.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {sectionLabel('Your files')}
                      {mine.map(renderDoc)}
                    </div>
                  )}
                  {sharedWithMe.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: mine.length > 0 ? 18 : 0 }}>
                      {sectionLabel('Shared with you')}
                      {sharedWithMe.map(renderDoc)}
                    </div>
                  )}
                </>
              );
            })()
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

interface DocumentItemProps {
  doc: AssetManifest;
  campaignId: string;
  isActive: boolean;
  canDelete: boolean;
  canShare: boolean;
  sharedByOther: boolean;
  onDelete: () => void;
  onView: () => void;
  onShare: () => void;
}

function DocumentItem({ doc, campaignId, isActive, canDelete, canShare, sharedByOther, onDelete, onView, onShare }: DocumentItemProps) {
  const extLabel = doc.mime === 'application/pdf' ? 'PDF'
    : doc.mime.startsWith('image/') ? 'Image'
    : doc.mime.startsWith('text/') ? 'Text'
    : 'File';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        padding: '11px 12px',
        background: 'var(--surface2)',
        border: `1px solid ${isActive ? 'var(--ember)' : 'var(--border)'}`,
        borderRadius: 10,
        cursor: 'pointer',
        transition: 'border-color 0.15s',
        ...(isActive ? { background: '#e08a4b0a' } : {}),
      }}
      onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.borderColor = '#473b34'; }}
      onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
    >
      {/* Page icon */}
      <button
        type="button"
        onClick={onView}
        style={{ display: 'flex', alignItems: 'center', gap: 11, flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
        aria-label={`View ${doc.title}`}
      >
        {/* White folded-corner page icon */}
        <div
          style={{
            width: 32, height: 38,
            flexShrink: 0,
            borderRadius: 4,
            background: '#f3ece1',
            position: 'relative',
            display: 'flex',
            alignItems: 'flex-end',
            padding: 4,
          }}
        >
          {/* Folded corner */}
          <div
            style={{
              position: 'absolute', right: 0, top: 0,
              borderWidth: '0 9px 9px 0',
              borderStyle: 'solid',
              borderColor: `transparent var(--surface2) transparent transparent`,
            }}
          />
          {/* Three gray lines (document lines) */}
          <div style={{ width: '100%', height: 3, background: '#c9b9a6', borderRadius: 2, boxShadow: '0 -5px #c9b9a6, 0 -10px #c9b9a6' }} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--hi)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {doc.title}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>
              {doc.ownerUsername ? `by ${doc.ownerUsername} · ${extLabel}` : extLabel}
            </p>
            {sharedByOther && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--teal)', background: '#69b7a61a', padding: '2px 6px', borderRadius: 4, letterSpacing: '0.08em' }}>
                shared
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Action icons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        <button
          type="button"
          onClick={onShare}
          disabled={!canShare}
          style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: canShare ? 'var(--low)' : 'var(--faint)', background: 'none', border: 'none', cursor: canShare ? 'pointer' : 'not-allowed', transition: 'all 0.12s', opacity: canShare ? 1 : 0.4 }}
          onMouseEnter={(e) => { if (canShare) (e.currentTarget as HTMLElement).style.color = 'var(--teal)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--low)'; }}
          aria-label={`Share ${doc.title} with the table`}
          title="Share with table"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path d="M8.7 10.7l6.6-3.4M8.7 13.3l6.6 3.4M21 5a3 3 0 11-6 0 3 3 0 016 0zM9 12a3 3 0 11-6 0 3 3 0 016 0zm12 7a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <a
          href={`/api/campaigns/${campaignId}/files/assets/${doc.file}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--low)', textDecoration: 'none', transition: 'color 0.12s' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--mid)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--low)'; }}
          aria-label={`Open ${doc.title}`}
          title="Open in new tab"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--faint)', background: 'none', border: 'none', cursor: 'pointer', transition: 'color 0.12s' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--garnet)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--faint)'; }}
            aria-label={`Delete ${doc.title}`}
            title="Delete"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
