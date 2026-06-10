import { lazy, Suspense, useRef, useState, useEffect, type PointerEvent } from 'react';
import type { AssetManifest, ClientMessage } from '@vtt/shared';
import { useStore } from '../store';

const PdfView = lazy(() => import('./PdfView').then((m) => ({ default: m.PdfView })));

const INLINE_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const INLINE_TEXT_MIMES = new Set(['text/plain', 'text/markdown']);

/**
 * Floating document panel, 520px wide, draggable by title bar, clamped within
 * the board area. Restyled to the Tavern "framed on a warm mat" design.
 */
export function DocumentViewer({ doc, panelId, stackIndex }: { doc: AssetManifest; panelId: string; stackIndex: number }) {
  const campaignId = useStore((s) => s.activeCampaignId);
  const closePanel = useStore((s) => s.closePanel);
  const bringPanelToFront = useStore((s) => s.bringPanelToFront);
  const connection = useStore((s) => s.connection);
  const self = useStore((s) => s.self);

  const [shared, setShared] = useState(false);

  const canShare = !shared && (self?.role === 'dm' || doc.ownerUsername === self?.username);

  const url = `/api/campaigns/${campaignId}/files/assets/${doc.file}`;

  // Panel position — staggered so multiple panels don't fully overlap
  const [pos, setPos] = useState(() => ({ x: 40 + (stackIndex % 5) * 36, y: 20 + (stackIndex % 5) * 28 }));
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function shareWithTable() {
    if (connection !== 'open') return;
    const conn = (window as unknown as { __vttConn?: { send: (msg: ClientMessage) => void } }).__vttConn;
    conn?.send({ type: 'shareDocument', assetId: doc.id });
    setShared(true);

    // Fire share toast
    useStore.getState().addShareToast?.(doc.title);
  }

  // Clamp panel within viewport minus 24px inset
  function clampPos(x: number, y: number): { x: number; y: number } {
    const pw = panelRef.current?.offsetWidth ?? 520;
    const ph = panelRef.current?.offsetHeight ?? 500;
    const maxX = window.innerWidth - pw - 24;
    const maxY = window.innerHeight - ph - 24;
    return {
      x: Math.max(24, Math.min(x, maxX)),
      y: Math.max(24, Math.min(y, maxY)),
    };
  }

  function onTitleBarPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    // Presses on the title bar's buttons/links must stay clicks — capturing
    // the pointer here would swallow them and start a drag instead.
    if ((e.target as HTMLElement).closest('button, a')) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
  }

  function onTitleBarPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPos(clampPos(dragRef.current.origX + dx, dragRef.current.origY + dy));
  }

  function onTitleBarPointerUp() {
    dragRef.current = null;
  }

  // Ext type label
  const extLabel = doc.mime === 'application/pdf' ? 'PDF'
    : INLINE_IMAGE_MIMES.has(doc.mime) ? 'Image'
    : INLINE_TEXT_MIMES.has(doc.mime) ? 'Text'
    : 'File';

  let body;
  if (doc.mime === 'application/pdf') {
    body = (
      <Suspense
        fallback={
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ fontSize: 13, color: 'var(--faint)', fontFamily: 'var(--mono)', animation: 'pulse 1.5s ease-in-out infinite' }}>Loading PDF…</p>
          </div>
        }
      >
        {/* Wrap PDF in the white "mat page" inset */}
        <div
          style={{
            background: '#f3ece1',
            borderRadius: 6,
            padding: '26px 30px',
            boxShadow: '0 14px 40px -8px #000b, 0 0 0 1px #00000022',
            maxWidth: 520,
            margin: '0 auto',
            color: '#241c15',
          }}
        >
          <PdfView url={url} title={doc.title} />
        </div>
      </Suspense>
    );
  } else if (INLINE_IMAGE_MIMES.has(doc.mime)) {
    body = (
      <div
        style={{
          background: '#f3ece1',
          borderRadius: 6,
          padding: 16,
          boxShadow: '0 14px 40px -8px #000b',
          maxWidth: 520,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <img src={url} alt={doc.title} style={{ maxWidth: '100%', maxHeight: 600, objectFit: 'contain', borderRadius: 4 }} />
      </div>
    );
  } else if (INLINE_TEXT_MIMES.has(doc.mime)) {
    body = (
      <div
        style={{
          background: '#f3ece1',
          borderRadius: 6,
          padding: '26px 30px',
          boxShadow: '0 14px 40px -8px #000b',
          maxWidth: 520,
          margin: '0 auto',
          color: '#241c15',
        }}
      >
        <iframe src={url} title={doc.title} style={{ width: '100%', minHeight: 400, border: 'none', background: 'transparent' }} />
      </div>
    );
  } else {
    body = (
      <div
        style={{
          background: '#f3ece1',
          borderRadius: 6,
          padding: '40px 30px',
          boxShadow: '0 14px 40px -8px #000b',
          maxWidth: 520,
          margin: '0 auto',
          textAlign: 'center',
          color: '#241c15',
        }}
      >
        <p style={{ fontSize: 13, marginBottom: 16, color: '#5a4632' }}>No preview for this file type.</p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 13, color: 'var(--ember)', textDecoration: 'underline' }}
        >
          Download {doc.title}
        </a>
      </div>
    );
  }

  // Reset shared state when doc changes
  useEffect(() => {
    setShared(false);
  }, [doc.id]);

  return (
    <div
      ref={panelRef}
      onPointerDownCapture={() => bringPanelToFront(panelId)}
      style={{
        position: 'absolute',
        zIndex: 8 + stackIndex,
        left: pos.x,
        top: pos.y,
        width: 520,
        maxWidth: 'calc(100% - 48px)',
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        boxShadow: '0 50px 100px -28px #000f, 0 0 0 1px rgba(0,0,0,0.3)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        maxHeight: '86vh',
      }}
    >
      {/* Title bar — draggable */}
      <div
        style={{
          height: 46, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 8px 0 16px',
          borderBottom: '1px solid var(--border-soft)',
          cursor: 'grab',
          background: 'rgba(255,255,255,0.03)',
          userSelect: 'none',
        }}
        onPointerDown={onTitleBarPointerDown}
        onPointerMove={onTitleBarPointerMove}
        onPointerUp={onTitleBarPointerUp}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--serif)', fontSize: 15, fontWeight: 600, color: 'var(--hi)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {doc.title}
          </span>
          {/* Shared mini-tag */}
          {(shared || doc.ownerUsername !== self?.username) && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--teal)', background: '#69b7a61a', padding: '2px 6px', borderRadius: 4, letterSpacing: '0.08em', flexShrink: 0 }}>
              shared
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          {/* Share button */}
          {canShare ? (
            <button
              type="button"
              onClick={shareWithTable}
              disabled={connection !== 'open'}
              style={{
                fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 600,
                color: 'var(--teal)',
                background: '#69b7a615',
                border: '1px solid #69b7a63a',
                padding: '6px 11px', borderRadius: 7,
                cursor: 'pointer',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#69b7a626'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '#69b7a615'; }}
              title="Share with table"
            >
              Share with table
            </button>
          ) : shared ? (
            <span style={{ fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 600, color: 'var(--low)', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', padding: '6px 11px', borderRadius: 7, whiteSpace: 'nowrap' }}>
              ✓ Shared with table
            </span>
          ) : null}

          {/* Open in tab */}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ width: 30, height: 30, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--low)', textDecoration: 'none', transition: 'all 0.12s' }}
            onMouseEnter={(e) => { Object.assign((e.currentTarget as HTMLElement).style, { background: 'rgba(255,255,255,0.06)', color: 'var(--hi)' }); }}
            onMouseLeave={(e) => { Object.assign((e.currentTarget as HTMLElement).style, { background: 'transparent', color: 'var(--low)' }); }}
            aria-label="Open in new tab"
            title="Open in new tab"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>

          {/* Close */}
          <button
            type="button"
            onClick={() => closePanel(panelId)}
            style={{ width: 30, height: 30, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--low)', background: 'none', border: 'none', cursor: 'pointer', transition: 'all 0.12s' }}
            onMouseEnter={(e) => { Object.assign((e.currentTarget as HTMLElement).style, { background: 'rgba(255,255,255,0.06)', color: 'var(--hi)' }); }}
            onMouseLeave={(e) => { Object.assign((e.currentTarget as HTMLElement).style, { background: 'transparent', color: 'var(--low)' }); }}
            aria-label="Close viewer"
            title="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* "Mat" content area */}
      <div
        style={{
          padding: 22,
          overflow: 'auto',
          flex: 1,
          minHeight: 0,
          background: 'radial-gradient(130% 70% at 50% 0, #2a1c15, #100b09)',
        }}
      >
        <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
          {doc.ownerUsername ? `by ${doc.ownerUsername} · ${extLabel}` : extLabel}
        </div>
        {body}
      </div>
    </div>
  );
}
