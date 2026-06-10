import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
  type PointerEvent,
} from 'react';
import type { BoardItemView, ClientMessage } from '@vtt/shared';
import { useStore } from '../store';
import type { BoardView } from '../store';
import { BoardMoments } from './RollLog';

// Judgment call: keep codebase's wide clamp (0.05–8) instead of design's 0.3–2.4.
// The design's narrower range would break "fit" on very large boards.
// The zoom control just displays whatever the current scale is.
const SCALE_MIN = 0.05;
const SCALE_MAX = 8;
const FIT_MARGIN = 0.9;

interface CanvasViewerProps {
  children?: ReactNode;
}

function clampScale(s: number): number {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, s));
}

function sendWs(msg: ClientMessage): void {
  const conn = (window as unknown as { __vttConn?: { send: (msg: ClientMessage) => void } }).__vttConn;
  conn?.send(msg);
}

// ---------------------------------------------------------------------------
// Individual board item
// ---------------------------------------------------------------------------

interface BoardItemProps {
  item: BoardItemView;
  isDm: boolean;
  scale: number;
}

function BoardItemEl({ item, isDm, scale }: BoardItemProps) {
  const [hovered, setHovered] = useState(false);
  const [localPos, setLocalPos] = useState<{ x: number; y: number } | null>(null);
  const [localW, setLocalW] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const dragRef = useRef<{
    mode: 'move' | 'resize';
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
    origW: number;
    naturalAspect: number;
  } | null>(null);

  const naturalAspect =
    item.naturalWidth && item.naturalHeight ? item.naturalHeight / item.naturalWidth : 1;

  const displayX = localPos?.x ?? item.x;
  const displayY = localPos?.y ?? item.y;
  const displayW = localW ?? item.w;
  const displayH = displayW * naturalAspect;

  const handlePx = Math.round(24 / scale);

  function onItemPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!isDm) return;
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragRef.current = {
      mode: 'move',
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: item.x,
      origY: item.y,
      origW: item.w,
      naturalAspect,
    };
  }

  function onResizePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!isDm) return;
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      mode: 'resize',
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: item.x,
      origY: item.y,
      origW: item.w,
      naturalAspect,
    };
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const { mode, startClientX, startClientY, origX, origY, origW } = dragRef.current;
    const dx = (e.clientX - startClientX) / scale;
    const dy = (e.clientY - startClientY) / scale;

    if (mode === 'move') {
      setLocalPos({ x: origX + dx, y: origY + dy });
    } else {
      const newW = Math.min(8000, Math.max(40, origW + dx));
      setLocalW(newW);
    }
  }

  function onPointerUp() {
    if (!dragRef.current) return;
    const { mode } = dragRef.current;
    dragRef.current = null;
    setIsDragging(false);

    if (mode === 'move' && localPos) {
      sendWs({ type: 'boardMove', itemId: item.id, x: localPos.x, y: localPos.y, w: localW ?? item.w });
      setLocalPos(null);
    } else if (mode === 'resize' && localW !== null) {
      sendWs({ type: 'boardMove', itemId: item.id, x: item.x, y: item.y, w: localW });
      setLocalW(null);
    }
  }

  const shadowLifted = isDragging
    ? '0 40px 80px -16px #000f'
    : hovered
    ? '0 30px 60px -16px #000e, 0 3px 0 #00000055, inset 0 0 0 1px #e0824c40'
    : '0 26px 54px -18px #000d, 0 3px 0 #00000055, inset 0 0 0 1px #ffffff0d';

  return (
    <div
      style={{
        position: 'absolute',
        left: displayX,
        top: displayY,
        width: displayW,
        height: displayH,
        zIndex: isDragging ? 9999 : item.z,
        borderRadius: 10,
        // No overflow:hidden — the ✕ / resize handles sit on the corners like
        // stickers and must not be clipped. The img clips its own corners.
        border: '1px solid rgba(0,0,0,0.5)',
        boxShadow: shadowLifted,
        cursor: isDm ? (isDragging ? 'grabbing' : 'grab') : undefined,
        transition: isDragging ? undefined : 'box-shadow 0.15s',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onPointerDown={isDm ? onItemPointerDown : undefined}
      onPointerMove={isDm ? onPointerMove : undefined}
      onPointerUp={isDm ? onPointerUp : undefined}
      onPointerLeave={isDm ? onPointerUp : undefined}
      onMouseEnter={isDm ? () => setHovered(true) : undefined}
      onMouseLeave={isDm ? () => { setHovered(false); } : undefined}
    >
      <img
        src={item.url}
        alt={item.title}
        draggable={false}
        style={{ width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none', display: 'block', borderRadius: 10 }}
      />

      {/* Bottom-left label chip */}
      <div
        style={{
          position: 'absolute', left: 10, bottom: 10,
          fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
          color: 'rgba(244,239,233,0.85)',
          background: 'rgba(0,0,0,0.55)',
          padding: '4px 9px', borderRadius: 6,
          backdropFilter: 'blur(4px)',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      >
        Map · {item.title}
      </div>

      {/* DM controls */}
      {isDm && hovered && !isDragging && (
        <>
          {/* Ember outline on hover */}
          <div
            style={{
              position: 'absolute', inset: 0,
              border: `${Math.max(1, 2 / scale)}px solid rgba(224,138,75,0.4)`,
              borderRadius: 10,
              pointerEvents: 'none',
            }}
          />
          {/* Remove button */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              sendWs({ type: 'boardRemove', itemId: item.id });
            }}
            style={{
              position: 'absolute',
              top: -handlePx / 2,
              right: -handlePx / 2,
              width: handlePx,
              height: handlePx,
              fontSize: Math.max(8, 12 / scale),
              lineHeight: `${handlePx}px`,
              textAlign: 'center',
              cursor: 'pointer',
              background: 'var(--garnet)',
              color: '#fff',
              border: `${Math.max(1.5, 2 / scale)}px solid rgba(255,255,255,0.9)`,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 10px rgba(0,0,0,0.8)',
            }}
            aria-label={`Remove ${item.title} from board`}
            title="Remove from board"
          >
            ✕
          </button>
          {/* Resize handle */}
          <div
            onPointerDown={onResizePointerDown}
            style={{
              position: 'absolute',
              bottom: -handlePx / 2,
              right: -handlePx / 2,
              width: handlePx,
              height: handlePx,
              cursor: 'nwse-resize',
              background: 'var(--ember)',
              border: `${Math.max(1.5, 2 / scale)}px solid rgba(255,255,255,0.9)`,
              borderRadius: Math.max(3, 5 / scale),
              boxShadow: '0 2px 10px rgba(0,0,0,0.8)',
            }}
            aria-label="Resize"
            title="Resize"
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main CanvasViewer
// ---------------------------------------------------------------------------

export function CanvasViewer({ children }: CanvasViewerProps) {
  const board = useStore((s) => s.board);
  const self = useStore((s) => s.self);
  const setBoardView = useStore((s) => s.setBoardView);

  const isDm = self?.role === 'dm';

  const [view, setViewInternal] = useState<BoardView>({ x: 0, y: 0, scale: 1 });
  const setView = useCallback(
    (updater: BoardView | ((prev: BoardView) => BoardView)) => {
      setViewInternal((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        setBoardView(next);
        return next;
      });
    },
    [setBoardView],
  );

  const draggingCanvas = useRef(false);
  const lastPointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setBoardView(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Fit helper
  // ---------------------------------------------------------------------------

  function fitBoard() {
    const container = containerRef.current;
    if (!container) return;
    const { clientWidth: cw, clientHeight: ch } = container;

    if (board.length === 0) {
      setView({ x: 0, y: 0, scale: 1 });
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const item of board) {
      const aspect = item.naturalWidth && item.naturalHeight
        ? item.naturalHeight / item.naturalWidth
        : 1;
      const h = item.w * aspect;
      minX = Math.min(minX, item.x);
      minY = Math.min(minY, item.y);
      maxX = Math.max(maxX, item.x + item.w);
      maxY = Math.max(maxY, item.y + h);
    }
    const bw = maxX - minX;
    const bh = maxY - minY;
    if (bw === 0 || bh === 0) return;

    const scale = clampScale(Math.min(cw / bw, ch / bh) * FIT_MARGIN);
    const x = (cw - bw * scale) / 2 - minX * scale;
    const y = (ch - bh * scale) / 2 - minY * scale;
    setView({ x, y, scale });
  }

  const fittedOnce = useRef(false);
  useEffect(() => {
    if (!fittedOnce.current && board.length > 0) {
      fittedOnce.current = true;
      fitBoard();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.length]);

  // ---------------------------------------------------------------------------
  // Pan + wheel zoom
  // ---------------------------------------------------------------------------

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    // Presses on overlay buttons (empty-state CTA, zoom controls) must stay
    // clicks — capturing here would retarget the click to the canvas.
    if ((e.target as HTMLElement).closest('button, a')) return;
    draggingCanvas.current = true;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!draggingCanvas.current) return;
    const dx = e.clientX - lastPointer.current.x;
    const dy = e.clientY - lastPointer.current.y;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  }

  function handlePointerUp() {
    draggingCanvas.current = false;
  }

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const factor = Math.min(1.25, Math.max(0.8, Math.exp(-e.deltaY * 0.001)));
    setView((v) => {
      const newScale = clampScale(v.scale * factor);
      const scaleDelta = newScale / v.scale;
      const newX = mouseX - scaleDelta * (mouseX - v.x);
      const newY = mouseY - scaleDelta * (mouseY - v.y);
      return { x: newX, y: newY, scale: newScale };
    });
  }

  const sortedItems = [...board].sort((a, b) => a.z - b.z);
  const isEmpty = board.length === 0;

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden select-none"
      style={{
        touchAction: 'none',
        cursor: draggingCanvas.current ? 'grabbing' : 'grab',
        // Board lamp glow + vignette + 44px grid
        background: `
          radial-gradient(1100px 760px at 46% 36%, #3a210f55, transparent 72%),
          radial-gradient(1500px 1080px at 50% 50%, transparent 52%, #000000b0),
          linear-gradient(0deg, rgba(255,255,255,0.025) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px),
          var(--bg)
        `,
        backgroundSize: 'cover, cover, 44px 44px, 44px 44px, cover',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onWheel={handleWheel}
      aria-label="Campaign map canvas"
    >
      {isEmpty ? (
        <EmptyCanvas isDm={isDm} />
      ) : (
        <div
          style={{
            position: 'absolute', top: 0, left: 0,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: '0 0',
            willChange: 'transform',
          }}
        >
          {sortedItems.map((item) => (
            <BoardItemEl key={item.id} item={item} isDm={isDm} scale={view.scale} />
          ))}
          {children}
        </div>
      )}

      {/* Nat-20 board moments */}
      <BoardMoments />

      {/* Zoom controls — bottom-left floating */}
      <ZoomControls
        scale={view.scale}
        onZoomIn={() => setView((v) => ({ ...v, scale: clampScale(v.scale * 1.2) }))}
        onZoomOut={() => setView((v) => ({ ...v, scale: clampScale(v.scale / 1.2) }))}
        onFit={fitBoard}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty board state
// ---------------------------------------------------------------------------

function EmptyCanvas({ isDm }: { isDm: boolean }) {
  // The DM CTA switches to the DM tab in the sidebar (via a custom event)
  function handleDmCta() {
    window.dispatchEvent(new CustomEvent('vtt:switch-sidebar-tab', { detail: 'dm' }));
  }

  return (
    <div
      style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 8, textAlign: 'center',
        pointerEvents: isDm ? 'auto' : 'none',
      }}
    >
      {/* Line-art d20 motif */}
      <svg
        viewBox="0 0 100 100" width="64" height="64"
        fill="none" stroke="currentColor"
        strokeLinecap="round" strokeLinejoin="round"
        style={{ opacity: 0.25, marginBottom: 8, color: 'var(--mid)' }}
        aria-hidden="true"
      >
        <path d="M50 4 L90 27 L90 73 L50 96 L10 73 L10 27 Z" strokeWidth="3" />
        <path d="M50 4 L72 38 L50 60 L28 38 Z" strokeWidth="2.4" />
        <path d="M28 38 L10 27 M72 38 L90 27 M50 60 L50 96 M28 38 L18 70 L50 60 M72 38 L82 70 L50 60 M18 70 L10 73 M82 70 L90 73" strokeWidth="1.7" strokeOpacity="0.55" />
      </svg>

      <p style={{ fontFamily: 'var(--serif)', fontSize: 23, color: 'var(--mid)' }}>
        The table is set.
      </p>
      <p style={{ fontSize: 14, color: 'var(--faint)' }}>
        {isDm ? '' : 'Your DM is preparing the first map.'}
      </p>

      {isDm && (
        <button
          type="button"
          onClick={handleDmCta}
          style={{
            marginTop: 14,
            padding: '10px 18px',
            borderRadius: 9,
            fontSize: 13,
            fontWeight: 600,
            background: 'var(--ember)',
            color: 'var(--ink)',
            border: 'none',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--ember-h)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--ember)'; }}
        >
          Pin your first asset
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zoom controls
// ---------------------------------------------------------------------------

interface ZoomControlsProps {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}

function ZoomControls({ scale, onZoomIn, onZoomOut, onFit }: ZoomControlsProps) {
  const pct = Math.round(scale * 100);

  const btnStyle: React.CSSProperties = {
    width: 30, height: 30,
    borderRadius: 7,
    border: 'none',
    background: 'transparent',
    color: 'var(--mid)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 15,
    transition: 'background 0.12s, color 0.12s',
  };

  return (
    <div
      style={{
        position: 'absolute', left: 18, bottom: 18,
        display: 'flex', alignItems: 'center', gap: 2,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 4,
        zIndex: 4,
        boxShadow: '0 12px 30px -12px #000b',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={onZoomOut}
        style={btnStyle}
        onMouseEnter={(e) => { Object.assign((e.currentTarget as HTMLElement).style, { background: 'rgba(255,255,255,0.06)', color: 'var(--hi)' }); }}
        onMouseLeave={(e) => { Object.assign((e.currentTarget as HTMLElement).style, { background: 'transparent', color: 'var(--mid)' }); }}
        aria-label="Zoom out"
        title="Zoom out"
      >
        −
      </button>

      <span
        style={{
          fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--low)',
          padding: '0 6px', minWidth: 44, textAlign: 'center',
        }}
      >
        {pct}%
      </span>

      <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 3px' }} aria-hidden="true" />

      <button
        type="button"
        onClick={onZoomIn}
        style={btnStyle}
        onMouseEnter={(e) => { Object.assign((e.currentTarget as HTMLElement).style, { background: 'rgba(255,255,255,0.06)', color: 'var(--hi)' }); }}
        onMouseLeave={(e) => { Object.assign((e.currentTarget as HTMLElement).style, { background: 'transparent', color: 'var(--mid)' }); }}
        aria-label="Zoom in"
        title="Zoom in"
      >
        +
      </button>

      <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 3px' }} aria-hidden="true" />

      <button
        type="button"
        onClick={onFit}
        style={btnStyle}
        onMouseEnter={(e) => { Object.assign((e.currentTarget as HTMLElement).style, { background: 'rgba(255,255,255,0.06)', color: 'var(--hi)' }); }}
        onMouseLeave={(e) => { Object.assign((e.currentTarget as HTMLElement).style, { background: 'transparent', color: 'var(--mid)' }); }}
        aria-label="Fit board to screen"
        title="Fit all"
      >
        ⤢
      </button>
    </div>
  );
}
