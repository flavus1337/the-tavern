import { lazy, Suspense } from 'react';
import type { AssetManifest, ClientMessage } from '@vtt/shared';
import { useStore } from '../store';
import { Button } from './ui/button';

// pdf.js is heavy — load it only when a PDF is actually opened.
const PdfView = lazy(() => import('./PdfView').then((m) => ({ default: m.PdfView })));

const INLINE_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const INLINE_TEXT_MIMES = new Set(['text/plain', 'text/markdown']);

/**
 * Non-modal document viewer rendered over the canvas area only — the sidebar
 * (dice, docs, DM panel) stays fully interactive while a document is open.
 */
export function DocumentViewer({ doc }: { doc: AssetManifest }) {
  const campaignId = useStore((s) => s.activeCampaignId);
  const setViewingDocument = useStore((s) => s.setViewingDocument);
  const connection = useStore((s) => s.connection);

  const url = `/api/campaigns/${campaignId}/files/assets/${doc.file}`;

  function shareWithTable() {
    const conn = (window as unknown as { __vttConn?: { send: (msg: ClientMessage) => void } }).__vttConn;
    conn?.send({ type: 'shareDocument', assetId: doc.id });
  }

  let body;
  if (doc.mime === 'application/pdf') {
    body = (
      <Suspense
        fallback={<p className="flex-1 text-sm text-zinc-500 text-center py-16 animate-pulse bg-zinc-950">Loading PDF…</p>}
      >
        <PdfView url={url} title={doc.title} />
      </Suspense>
    );
  } else if (INLINE_IMAGE_MIMES.has(doc.mime)) {
    body = (
      <div className="flex-1 min-h-0 flex items-center justify-center p-4 overflow-auto bg-zinc-950">
        <img src={url} alt={doc.title} className="max-w-full max-h-full object-contain" />
      </div>
    );
  } else if (INLINE_TEXT_MIMES.has(doc.mime)) {
    body = <iframe src={url} title={doc.title} className="flex-1 w-full bg-zinc-950" />;
  } else {
    body = (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-zinc-950">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10 text-zinc-600">
          <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="text-sm text-zinc-400">No preview available for this file type.</p>
        <Button size="sm" variant="secondary" onClick={() => { window.location.href = url; }}>
          Download {doc.title}
        </Button>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-zinc-900 border-r border-zinc-800">
      {/* Viewer header */}
      <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-zinc-800 bg-zinc-950 shrink-0">
        <p className="text-sm font-medium text-zinc-200 truncate">{doc.title}</p>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="secondary"
            onClick={shareWithTable}
            disabled={connection !== 'open'}
            title="Open this document for everyone at the table"
          >
            Share with table
          </Button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
            aria-label="Open in new tab"
            title="Open in new tab"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
          <button
            type="button"
            onClick={() => setViewingDocument(null)}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
            aria-label="Close viewer (back to canvas)"
            title="Close (back to canvas)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
      {body}
    </div>
  );
}
