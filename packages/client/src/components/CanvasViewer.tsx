import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
  type PointerEvent,
} from 'react';
import type { BoardItemView, ClientMessage } from '@vtt/shared';
import { Button } from './ui/button';
import { useStore } from '../store';
import type { BoardView } from '../store';

const SCALE_MIN = 0.05;
const SCALE_MAX = 8;
const ZOOM_STEP = 1.25;
const FIT_MARGIN = 0.9; // 10% margin = 90% of viewport used

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
// Individual board item (DM-only controls)
// ---------------------------------------------------------------------------

interface BoardItemProps {
  item: BoardItemView;
  isDm: boolean;
  scale: number; // current canvas scale, used to keep handles pixel-constant
}

function BoardItemEl({ item, isDm, scale }: BoardItemProps) {
  const [hovered, setHovered] = useState(false);
  // Local drag/resize state (optimistic)
  const [localPos, setLocalPos] = useState<{ x: number; y: number } | null>(null);
  const [localW, setLocalW] = useState<number | null>(null);

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

  // Handle pixel size — remain constant regardless of canvas zoom.
  const handlePx = Math.round(20 / scale);

  function onItemPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!isDm) return;
    e.stopPropagation(); // don't start canvas pan
    if (e.button !== 0) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
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
      // Resize: proportional w change from dx
      const newW = Math.min(8000, Math.max(40, origW + dx));
      setLocalW(newW);
    }
  }

  function onPointerUp() {
    if (!dragRef.current) return;
    const { mode, naturalAspect: _a } = dragRef.current;
    dragRef.current = null;

    if (mode === 'move' && localPos) {
      sendWs({ type: 'boardMove', itemId: item.id, x: localPos.x, y: localPos.y, w: localW ?? item.w });
      setLocalPos(null);
    } else if (mode === 'resize' && localW !== null) {
      sendWs({ type: 'boardMove', itemId: item.id, x: item.x, y: item.y, w: localW });
      setLocalW(null);
    }
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: displayX,
        top: displayY,
        width: displayW,
        height: displayH,
        zIndex: item.z,
      }}
      onPointerDown={isDm ? onItemPointerDown : undefined}
      onPointerMove={isDm ? onPointerMove : undefined}
      onPointerUp={isDm ? onPointerUp : undefined}
      onPointerLeave={isDm ? onPointerUp : undefined}
      onMouseEnter={isDm ? () => setHovered(true) : undefined}
      onMouseLeave={isDm ? () => setHovered(false) : undefined}
    >
      <img
        src={item.url}
        alt={item.title}
        draggable={false}
        className="block select-none"
        style={{ width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none' }}
      />

      {/* DM controls: outline + remove + resize */}
      {isDm && hovered && (
        <>
          {/* Thin indigo outline */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              border: `${Math.max(1, 2 / scale)}px solid rgb(99 102 241)`,
              pointerEvents: 'none',
            }}
          />
          {/* Remove button — top-right */}
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
            }}
            className="bg-red-600 hover:bg-red-500 text-white rounded-full leading-none flex items-center justify-center"
            aria-label={`Remove ${item.title} from board`}
            title="Remove from board"
          >
            ✕
          </button>
          {/* Resize handle — bottom-right */}
          <div
            onPointerDown={onResizePointerDown}
            style={{
              position: 'absolute',
              bottom: -handlePx / 2,
              right: -handlePx / 2,
              width: handlePx,
              height: handlePx,
              cursor: 'nwse-resize',
            }}
            className="bg-indigo-500 rounded-sm"
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
  // Keep store in sync whenever view changes.
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

  // Sync store once on mount.
  useEffect(() => {
    setBoardView(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Fit / 1:1 helpers
  // ---------------------------------------------------------------------------

  function fitBoard() {
    const container = containerRef.current;
    if (!container) return;
    const { clientWidth: cw, clientHeight: ch } = container;

    if (board.length === 0) {
      setView({ x: 0, y: 0, scale: 1 });
      return;
    }

    // Compute bounding box of all items (using natural aspect for height).
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

  function resetTo100() {
    const container = containerRef.current;
    if (!container) return;
    const { clientWidth: cw, clientHeight: ch } = container;

    if (board.length === 0) {
      setView({ x: 0, y: 0, scale: 1 });
      return;
    }

    // Center on board content at 1:1.
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
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const x = cw / 2 - cx;
    const y = ch / 2 - cy;
    setView({ x, y, scale: 1 });
  }

  // ---------------------------------------------------------------------------
  // Canvas pan + wheel zoom (only triggered when NOT on an item)
  // ---------------------------------------------------------------------------

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
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

    // Proportional to scroll delta: trackpads (many small deltas) zoom gently,
    // a mouse-wheel notch (~±100) gives ~10%. Clamped so no single event jumps.
    const factor = Math.min(1.25, Math.max(0.8, Math.exp(-e.deltaY * 0.001)));
    setView((v) => {
      const newScale = clampScale(v.scale * factor);
      const scaleDelta = newScale / v.scale;
      const newX = mouseX - scaleDelta * (mouseX - v.x);
      const newY = mouseY - scaleDelta * (mouseY - v.y);
      return { x: newX, y: newY, scale: newScale };
    });
  }

  // ---------------------------------------------------------------------------
  // Zoom toolbar helpers (anchored at viewport center)
  // ---------------------------------------------------------------------------

  function zoomIn() {
    const container = containerRef.current;
    if (!container) return;
    const cx = container.clientWidth / 2;
    const cy = container.clientHeight / 2;
    setView((v) => {
      const newScale = clampScale(v.scale * ZOOM_STEP);
      const scaleDelta = newScale / v.scale;
      return { x: cx - scaleDelta * (cx - v.x), y: cy - scaleDelta * (cy - v.y), scale: newScale };
    });
  }

  function zoomOut() {
    const container = containerRef.current;
    if (!container) return;
    const cx = container.clientWidth / 2;
    const cy = container.clientHeight / 2;
    setView((v) => {
      const newScale = clampScale(v.scale / ZOOM_STEP);
      const scaleDelta = newScale / v.scale;
      return { x: cx - scaleDelta * (cx - v.x), y: cy - scaleDelta * (cy - v.y), scale: newScale };
    });
  }

  const sortedItems = [...board].sort((a, b) => a.z - b.z);
  const isEmpty = board.length === 0;

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden bg-zinc-950 select-none"
      style={{ touchAction: 'none' }}
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
          className="absolute top-0 left-0"
          style={{
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

      {/* Zoom toolbar — always visible when board has content */}
      {!isEmpty && (
        <div className="absolute bottom-4 right-4 flex flex-col gap-1.5 z-10">
          <Button
            size="sm"
            variant="secondary"
            onClick={fitBoard}
            title="Fit board to screen"
            aria-label="Fit board to screen"
            className="px-2.5"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path d="M4 8V4m0 0h4M4 4l5 5M20 8V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5M20 16v4m0 0h-4m4 0l-5-5" strokeLinecap="round" />
            </svg>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={resetTo100}
            title="100% zoom"
            aria-label="Reset to 100% zoom"
            className="px-2.5 font-mono"
          >
            1:1
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={zoomIn}
            aria-label="Zoom in"
            className="px-2.5"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35M11 8v6M8 11h6" strokeLinecap="round" />
            </svg>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={zoomOut}
            aria-label="Zoom out"
            className="px-2.5"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35M8 11h6" strokeLinecap="round" />
            </svg>
          </Button>
        </div>
      )}

      {/* Zoom % indicator */}
      {!isEmpty && (
        <div className="absolute bottom-4 left-4 text-xs text-zinc-600 font-mono z-10">
          {Math.round(view.scale * 100)}%
        </div>
      )}
    </div>
  );
}

function EmptyCanvas({ isDm }: { isDm: boolean }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {/* Subtle grid */}
      <svg className="absolute inset-0 w-full h-full opacity-5" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#71717a" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
      <div className="relative text-center">
        <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-3">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-zinc-700">
            <path d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="text-zinc-600 font-medium">Nothing shared yet</p>
        <p className="text-zinc-700 text-sm mt-1">
          {isDm ? 'Pin an image from the DM panel' : 'The DM will share a map when ready'}
        </p>
      </div>
    </div>
  );
}
