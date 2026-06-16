import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
  type PointerEvent,
} from 'react';
import { BOARD_CELLS, clampToField } from '@vtt/shared';
import type { BoardItemView, ClientMessage, TokenView, GridState, MapPiece, MeasureKind, AoeTemplate, AoeKind } from '@vtt/shared';
import { useStore } from '../store';
import type { BoardView, BoardTool, EditorMode, AoeShape } from '../store';
import { BoardMoments } from './RollLog';
import { inkSprite } from '../lib/inkArt';

const TOKEN_CELLS: Record<TokenView['size'], number> = { S: 1, M: 1, L: 2, H: 3 };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Round a board-space coordinate to the nearest grid cell origin. */
function snapTo(value: number, cell: number, offset: number): number {
  return Math.round((value - offset) / cell) * cell + offset;
}

// Judgment call: keep codebase's wide clamp (0.05–8) instead of design's 0.3–2.4.
// The design's narrower range would break "fit" on very large boards.
// The zoom control just displays whatever the current scale is.
const SCALE_MIN = 0.05;
const SCALE_MAX = 8;
const FIT_MARGIN = 0.9;
// The board is a finite BOARD_CELLS × BOARD_CELLS square (no endless panning).
const MAP_CELLS = BOARD_CELLS;
const clampToBoard = clampToField;

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
  const mapLocked = useStore((s) => s.mapLocked);
  // DM always; players only when the DM unlocked this item. A locked map blocks
  // everyone (including the DM).
  const canManipulate = (isDm || item.playersCanMove) && !mapLocked;
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
    if (!canManipulate) return;
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
    if (!canManipulate) return;
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
      const cell = useStore.getState().grid.cell;
      setLocalPos(clampToBoard(origX + dx, origY + dy, displayW, displayH, cell));
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

    // Keep the optimistic local position/size after release — clearing it here
    // would snap the item back to the stale server position for a frame or two
    // until boardUpdated echoes the move. The effect below clears the overrides
    // once the item props change.
    if (mode === 'move' && localPos) {
      sendWs({ type: 'boardMove', itemId: item.id, x: localPos.x, y: localPos.y, w: localW ?? item.w });
    } else if (mode === 'resize' && localW !== null) {
      sendWs({ type: 'boardMove', itemId: item.id, x: item.x, y: item.y, w: localW });
    }
  }

  // Server confirmed (or someone else moved the item) — drop local overrides,
  // but never mid-drag.
  useEffect(() => {
    if (dragRef.current) return;
    setLocalPos(null);
    setLocalW(null);
  }, [item.x, item.y, item.w]);

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
        cursor: canManipulate ? (isDragging ? 'grabbing' : 'grab') : undefined,
        transition: isDragging ? undefined : 'box-shadow 0.15s',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onPointerDown={canManipulate ? onItemPointerDown : undefined}
      onPointerMove={canManipulate ? onPointerMove : undefined}
      onPointerUp={canManipulate ? onPointerUp : undefined}
      onPointerLeave={canManipulate ? onPointerUp : undefined}
      onMouseEnter={canManipulate ? () => setHovered(true) : undefined}
      onMouseLeave={canManipulate ? () => { setHovered(false); } : undefined}
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

      {/* Hover controls — outline + resize for anyone who can manipulate; ✕ and lock are DM-only */}
      {canManipulate && hovered && !isDragging && (
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
          {isDm && (
            /* Player-access lock toggle — top-left */
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                sendWs({ type: 'boardSetAccess', itemId: item.id, playersCanMove: !item.playersCanMove });
              }}
              style={{
                position: 'absolute',
                top: -handlePx / 2,
                left: -handlePx / 2,
                width: handlePx,
                height: handlePx,
                cursor: 'pointer',
                background: item.playersCanMove ? 'var(--teal)' : 'var(--raised)',
                color: item.playersCanMove ? '#0c2520' : 'var(--mid)',
                border: `${Math.max(1.5, 2 / scale)}px solid rgba(255,255,255,0.9)`,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 10px rgba(0,0,0,0.8)',
              }}
              aria-label={item.playersCanMove ? 'Lock item (players cannot move it)' : 'Unlock item (players can move it)'}
              title={item.playersCanMove ? 'Players can move this — click to lock' : 'Locked — click to let players move this'}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" style={{ width: '58%', height: '58%' }}>
                {item.playersCanMove ? (
                  <path d="M7 11V7a5 5 0 019.5-2M5 11h14v9a1 1 0 01-1 1H6a1 1 0 01-1-1v-9z" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <path d="M7 11V7a5 5 0 0110 0v4M5 11h14v9a1 1 0 01-1 1H6a1 1 0 01-1-1v-9z" strokeLinecap="round" strokeLinejoin="round" />
                )}
              </svg>
            </button>
          )}
          {/* Remove button — DM only */}
          {isDm && (
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
          )}
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
// Token
// ---------------------------------------------------------------------------

interface TokenElProps {
  token: TokenView;
  selfUserId: string | null;
  isDm: boolean;
  scale: number;
  grid: GridState;
  active: boolean; // tool allows selecting/moving (select or move tool)
}

function TokenEl({ token, selfUserId, isDm, scale, grid, active }: TokenElProps) {
  const setSelectedTokenId = useStore((s) => s.setSelectedTokenId);
  const openTokenPanel = useStore((s) => s.openTokenPanel);
  const selectedId = useStore((s) => s.selectedTokenId);
  const [localPos, setLocalPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; alt: boolean } | null>(null);

  const mine = !!token.ownerUserId && token.ownerUserId === selfUserId;
  // Move/control: DM, owner, or anyone the token is shared-to-control.
  const sharedControl =
    token.sharing.scope === 'all' ||
    (token.sharing.scope === 'users' && !!selfUserId && token.sharing.userIds.includes(selfUserId));
  const canMove = isDm || mine || sharedControl;
  // Edit/remove (properties, deletion) stays owner + DM only.
  const canEdit = isDm || mine;
  const cells = TOKEN_CELLS[token.size];
  const px = grid.cell * cells;
  const selected = selectedId === token.id;

  const x = localPos?.x ?? token.x;
  const y = localPos?.y ?? token.y;

  // Clear optimistic position once the server echoes (never mid-drag).
  useEffect(() => {
    if (dragRef.current) return;
    setLocalPos(null);
  }, [token.x, token.y]);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!active || e.button !== 0) return;
    e.stopPropagation();
    setSelectedTokenId(token.id);
    if (!canMove) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: token.x, oy: token.y, alt: e.altKey };
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    dragRef.current.alt = e.altKey;
    setLocalPos({
      x: dragRef.current.ox + (e.clientX - dragRef.current.sx) / scale,
      y: dragRef.current.oy + (e.clientY - dragRef.current.sy) / scale,
    });
  }
  function onPointerUp() {
    const d = dragRef.current;
    dragRef.current = null;
    setIsDragging(false);
    if (!d || !localPos) return;
    let nx = localPos.x;
    let ny = localPos.y;
    if (grid.snap && !d.alt) {
      nx = snapTo(localPos.x, grid.cell, grid.offsetX);
      ny = snapTo(localPos.y, grid.cell, grid.offsetY);
    }
    ({ x: nx, y: ny } = clampToBoard(nx, ny, px, px, grid.cell));
    setLocalPos({ x: nx, y: ny });
    sendWs({ type: 'tokenMove', tokenId: token.id, x: nx, y: ny });
  }

  const cls = `tok ${token.shape} ${mine ? 'mine' : token.allegiance} ${selected ? 'sel' : ''} ${isDragging ? 'drag' : ''}`;
  const hpRatio = token.maxHp && token.hp != null ? token.hp / token.maxHp : null;
  const hpCls = hpRatio == null ? '' : hpRatio > 0.7 ? '' : hpRatio >= 0.34 ? 'hurt' : 'low';

  return (
    <div
      className={cls}
      style={{
        left: x, top: y, width: px, height: px,
        // Hovered/selected tokens float above the rest so their name label is
        // never hidden behind a neighbouring token.
        zIndex: isDragging ? 100000 : (hovered || selected) ? 50000 + token.z : 1000 + token.z,
        cursor: active ? (canMove ? (isDragging ? 'grabbing' : 'grab') : 'pointer') : 'default',
      }}
      onPointerDown={active ? onPointerDown : undefined}
      onPointerMove={canMove ? onPointerMove : undefined}
      onPointerUp={canMove ? onPointerUp : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="tok-ground" />
      <div
        className="tok-face"
        style={token.imageUrl ? { backgroundImage: `url(${token.imageUrl})` }
          : { background: token.fill ?? 'linear-gradient(135deg,#5b86c2,#41609c)' }}
      >
        {!token.imageUrl && <span className="glyph" style={{ fontSize: px * 0.42 }}>{initials(token.name)}</span>}
      </div>
      {token.maxHp != null && token.hp != null && (
        <div className={`tok-hp ${hpCls}`}><i style={{ width: `${Math.max(0, Math.min(100, (hpRatio ?? 0) * 100))}%` }} /></div>
      )}
      {mine && <div className="tok-you">YOU</div>}
      {selected && <div className="tok-sel" />}
      <div className="tok-name">{token.name}</div>

      {/* Owner/DM edit/remove on selected (no combat toolbar) */}
      {selected && canEdit && !isDragging && (
        <div
          style={{ position: 'absolute', left: '50%', top: -38 / scale, transform: 'translateX(-50%)',
            display: 'flex', gap: 4 / scale, background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 8 / scale, padding: 4 / scale, boxShadow: '0 6px 16px -6px #000c', zoom: 1 }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={(e) => { e.stopPropagation(); openTokenPanel(token.id); }}
            style={{ fontSize: 11 / scale, padding: `${3 / scale}px ${7 / scale}px`, borderRadius: 6 / scale,
              background: 'var(--raised)', color: 'var(--mid)', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>Edit</button>
          <button type="button" onClick={(e) => { e.stopPropagation(); sendWs({ type: 'tokenRemove', tokenId: token.id }); setSelectedTokenId(null); }}
            style={{ fontSize: 11 / scale, padding: `${3 / scale}px ${7 / scale}px`, borderRadius: 6 / scale,
              background: 'var(--garnet)', color: '#fff', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Map piece (build-mode terrain/prop)
// ---------------------------------------------------------------------------

const HANDLES: Array<{ k: string; cx: number; cy: number; cursor: string }> = [
  { k: 'nw', cx: 0, cy: 0, cursor: 'nwse-resize' }, { k: 'n', cx: 0.5, cy: 0, cursor: 'ns-resize' },
  { k: 'ne', cx: 1, cy: 0, cursor: 'nesw-resize' }, { k: 'e', cx: 1, cy: 0.5, cursor: 'ew-resize' },
  { k: 'se', cx: 1, cy: 1, cursor: 'nwse-resize' }, { k: 's', cx: 0.5, cy: 1, cursor: 'ns-resize' },
  { k: 'sw', cx: 0, cy: 1, cursor: 'nesw-resize' }, { k: 'w', cx: 0, cy: 0.5, cursor: 'ew-resize' },
];

interface PieceElProps {
  piece: MapPiece;
  scale: number;     // view scale
  grid: GridState;
  interactive: boolean;  // build mode + select tool
  erasing: boolean;      // build mode + erase tool
}

interface PieceT { x: number; y: number; w: number; h: number; rotation: number }

function PieceEl({ piece, scale, grid, interactive, erasing }: PieceElProps) {
  const selectedId = useStore((s) => s.selectedPieceId);
  const setSelectedPieceId = useStore((s) => s.setSelectedPieceId);
  const [local, setLocal] = useState<PieceT | null>(null);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<null | {
    mode: 'move' | 'resize' | 'rotate';
    sx: number; sy: number;
    ox: number; oy: number; ow: number; oh: number; orot: number;
    cxBoard: number; cyBoard: number; // piece centre in board space
    cur: PieceT;                       // live transform (read on release — never stale)
  }>(null);

  const selected = selectedId === piece.id;
  const x = local?.x ?? piece.x;
  const y = local?.y ?? piece.y;
  const w = local?.w ?? piece.w;
  const h = local?.h ?? piece.h;
  const rotation = local?.rotation ?? piece.rotation;

  // Drop the optimistic transform once the server echoes (never mid-drag).
  useEffect(() => {
    if (drag.current) return;
    setLocal(null);
  }, [piece.x, piece.y, piece.w, piece.h, piece.rotation]);

  function canvasRect() {
    return document.querySelector('[aria-label="Campaign map canvas"]')!.getBoundingClientRect();
  }

  function begin(mode: 'move' | 'resize' | 'rotate', e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.stopPropagation();
    // ponytail: capture on the root (never unmounts) — the grabbed handle does, which dropped capture.
    rootRef.current?.setPointerCapture(e.pointerId);
    drag.current = {
      mode, sx: e.clientX, sy: e.clientY,
      ox: piece.x, oy: piece.y, ow: piece.w, oh: piece.h, orot: piece.rotation,
      cxBoard: piece.x + piece.w / 2, cyBoard: piece.y + piece.h / 2,
      cur: { x: piece.x, y: piece.y, w: piece.w, h: piece.h, rotation: piece.rotation },
    };
    setDragging(true);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (erasing) { e.stopPropagation(); sendWs({ type: 'pieceRemove', id: piece.id }); return; }
    if (!interactive) return;
    setSelectedPieceId(piece.id);
    begin('move', e);
  }
  function startResize(e: PointerEvent<HTMLDivElement>) { begin('resize', e); }
  function startRotate(e: PointerEvent<HTMLDivElement>) { begin('rotate', e); }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    let t: PieceT;
    if (d.mode === 'move') {
      t = { x: d.ox + (e.clientX - d.sx) / scale, y: d.oy + (e.clientY - d.sy) / scale, w: d.ow, h: d.oh, rotation: d.orot };
    } else if (d.mode === 'resize') {
      // ponytail: uniform scale from centre by pointer distance — lock-aspect default.
      const half0 = Math.hypot(d.ow, d.oh) / 2;
      const rect = canvasRect();
      const bv = useStore.getState().boardView;
      const px = (e.clientX - rect.left - bv.x) / scale;
      const py = (e.clientY - rect.top - bv.y) / scale;
      const k = Math.max(0.15, Math.hypot(px - d.cxBoard, py - d.cyBoard) / Math.max(8, half0));
      const nw = Math.max(8, d.ow * k), nh = Math.max(8, d.oh * k);
      t = { x: d.cxBoard - nw / 2, y: d.cyBoard - nh / 2, w: nw, h: nh, rotation: d.orot };
    } else {
      const rect = canvasRect();
      const bv = useStore.getState().boardView;
      const px = (e.clientX - rect.left - bv.x) / scale;
      const py = (e.clientY - rect.top - bv.y) / scale;
      const ang = Math.atan2(py - d.cyBoard, px - d.cxBoard) * 180 / Math.PI + 90;
      t = { x: d.ox, y: d.oy, w: d.ow, h: d.oh, rotation: Math.round(ang) };
    }
    if (d.mode === 'move') {
      const cl = clampToBoard(t.x, t.y, t.w, t.h, grid.cell);
      t = { ...t, x: cl.x, y: cl.y };
    }
    d.cur = t;
    setLocal(t);
  }
  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d) return;
    const t = d.cur;
    if (d.mode === 'move') {
      let nx = t.x, ny = t.y;
      if (piece.lockedToGrid || grid.snap) {
        nx = snapTo(t.x, grid.cell, grid.offsetX);
        ny = snapTo(t.y, grid.cell, grid.offsetY);
      }
      ({ x: nx, y: ny } = clampToBoard(nx, ny, t.w, t.h, grid.cell));
      setLocal({ ...t, x: nx, y: ny });
      sendWs({ type: 'pieceMove', id: piece.id, x: nx, y: ny });
    } else if (d.mode === 'resize') {
      sendWs({ type: 'pieceUpdate', id: piece.id, w: Math.round(t.w), h: Math.round(t.h) });
    } else {
      sendWs({ type: 'pieceUpdate', id: piece.id, rotation: t.rotation });
    }
  }

  const cellsW = w / grid.cell;
  const perCell = grid.unit === 'ft' ? 5 : 1.5;
  const sizeLabel = `${cellsW.toFixed(1)}× · ${Math.round(cellsW * perCell)} ${grid.unit}`;
  const hPx = Math.max(8, 16 / scale);

  return (
    <div
      ref={rootRef}
      style={{
        position: 'absolute', left: x, top: y, width: w, height: h,
        transform: `rotate(${rotation}deg)`, transformOrigin: 'center',
        zIndex: 500 + piece.z,
        cursor: erasing ? 'crosshair' : interactive ? 'grab' : 'default',
        pointerEvents: interactive || erasing ? 'auto' : 'none',
        touchAction: 'none', userSelect: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {piece.builtin ? (
        <div style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: inkSprite(piece.builtin, 32, 0) }} />
      ) : piece.imageUrl ? (
        <img src={piece.imageUrl} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none' }} />
      ) : null}

      {/* Persistent selection ring so it's clear a piece is selected. */}
      {selected && interactive && (
        <div style={{ position: 'absolute', inset: -2 / scale, border: `${Math.max(1, 2 / scale)}px solid var(--ember)`, boxShadow: '0 0 0 1px #fff8', pointerEvents: 'none', borderRadius: 2 / scale }} />
      )}

      {/* Rotation readout while rotating — clear "you are rotating" indication. */}
      {selected && interactive && dragging && drag.current?.mode === 'rotate' && (
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: `translate(-50%,-50%) rotate(${-rotation}deg) scale(${1 / scale})`, background: 'var(--ember)', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
          {Math.round(rotation)}°
        </div>
      )}

      {selected && interactive && (drag.current?.mode !== 'move' || !dragging) && (
        <>
          {/* rotate grip + stem */}
          <div style={{ position: 'absolute', left: '50%', top: -28 / scale, bottom: '100%', width: Math.max(1, 1.5 / scale), marginLeft: -Math.max(1, 1.5 / scale) / 2, background: 'var(--ember)', pointerEvents: 'none' }} />
          <div
            onPointerDown={startRotate}
            title="Rotate"
            style={{ position: 'absolute', left: '50%', top: -28 / scale, width: hPx, height: hPx, marginLeft: -hPx / 2, borderRadius: '50%', background: 'var(--ember)', border: `${Math.max(1, 1.5 / scale)}px solid #fff`, cursor: 'grab' }}
          />
          {HANDLES.map((hd) => (
            <div
              key={hd.k}
              onPointerDown={startResize}
              style={{
                position: 'absolute', left: `${hd.cx * 100}%`, top: `${hd.cy * 100}%`,
                width: hPx, height: hPx, marginLeft: -hPx / 2, marginTop: -hPx / 2,
                background: '#fff', border: `${Math.max(1, 1.5 / scale)}px solid var(--ember)`,
                cursor: hd.cursor, borderRadius: Math.max(1, 2 / scale),
              }}
            />
          ))}
          {/* size chip */}
          <div style={{ position: 'absolute', left: '50%', top: `calc(100% + ${8 / scale}px)`, transform: `translateX(-50%) scale(${1 / scale})`, transformOrigin: 'top center', background: 'var(--ember)', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>
            {sizeLabel}
          </div>
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
  const tokens = useStore((s) => s.tokens);
  const grid = useStore((s) => s.grid);
  const boardTool = useStore((s) => s.boardTool);
  const ownMeasure = useStore((s) => s.ownMeasure);
  const setOwnMeasure = useStore((s) => s.setOwnMeasure);
  const sharedMeasures = useStore((s) => s.sharedMeasures);
  const setSelectedTokenId = useStore((s) => s.setSelectedTokenId);
  const pieces = useStore((s) => s.pieces);
  const aoes = useStore((s) => s.aoes);
  const editorMode = useStore((s) => s.editorMode);
  const activePalettePiece = useStore((s) => s.activePalettePiece);
  const layerVisible = useStore((s) => s.layerVisible);
  const setSelectedPieceId = useStore((s) => s.setSelectedPieceId);
  const setBoardTool = useStore((s) => s.setBoardTool);

  const isDm = self?.role === 'dm';
  const selfUserId = self?.userId ?? null;
  const isBuild = editorMode === 'build' && isDm;
  const aoeShape = useStore((s) => s.aoeShape);
  const measuring = boardTool === 'measure';
  const aoeing = boardTool === 'aoe';
  // Ruler + AoE share the same drag→broadcast machinery; this is the shape they emit.
  const measureKind: MeasureKind | null = measuring ? 'ruler' : aoeing ? aoeShape : null;
  const stamping = isBuild && boardTool === 'stamp' && !!activePalettePiece;
  const erasing = isBuild && boardTool === 'erase';
  const calibrating = isBuild && boardTool === 'calibrate';
  // Tokens are interactive with the Select tool (and only in play, to keep build focused on the map).
  const tokensActive = boardTool === 'select' && !isBuild;
  const piecesInteractive = isBuild && boardTool === 'select';

  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [calibBox, setCalibBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [calibPrompt, setCalibPrompt] = useState(false);
  const [calibCells, setCalibCells] = useState('2');
  const calibRef = useRef<{ sx: number; sy: number } | null>(null);

  function applyCalibration() {
    if (!calibBox) return;
    const n = Math.max(1, parseInt(calibCells, 10) || 1);
    const cell = Math.max(8, calibBox.w / n);
    const offsetX = ((calibBox.x % cell) + cell) % cell;
    const offsetY = ((calibBox.y % cell) + cell) % cell;
    sendWs({ type: 'setGrid', grid: { cell: Math.round(cell), offsetX: Math.round(offsetX), offsetY: Math.round(offsetY), visible: true } });
    setCalibBox(null); setCalibPrompt(false); setBoardTool('select');
  }

  const [view, setViewInternal] = useState<BoardView>({ x: 0, y: 0, scale: 1 });
  // The board is a hard boundary: can't zoom out past it fitting, can't pan past its edges.
  const clampView = useCallback((v: BoardView): BoardView => {
    const c = containerRef.current;
    if (!c) return v;
    const cell = useStore.getState().grid.cell;
    const S0 = MAP_CELLS * cell;
    const cw = c.clientWidth, ch = c.clientHeight;
    // Leave a margin so the wooden table edge stays visible on every side at min
    // zoom (otherwise the field fills the short axis and the border is clipped).
    const M = 60;
    const fitScale = Math.max(0.02, Math.min((cw - 2 * M) / S0, (ch - 2 * M) / S0));
    const scale = Math.min(SCALE_MAX, Math.max(fitScale, v.scale));
    const S = S0 * scale;
    // Edges flush when the board overflows the viewport; centred when it fits.
    const clampAxis = (pos: number, vp: number) =>
      S >= vp ? Math.min(0, Math.max(vp - S, pos)) : (vp - S) / 2;
    return { scale, x: clampAxis(v.x, cw), y: clampAxis(v.y, ch) };
  }, []);
  const setView = useCallback(
    (updater: BoardView | ((prev: BoardView) => BoardView)) => {
      setViewInternal((prev) => {
        const next = clampView(typeof updater === 'function' ? updater(prev) : updater);
        setBoardView(next);
        return next;
      });
    },
    [setBoardView, clampView],
  );

  const draggingCanvas = useRef(false);
  const measuringRef = useRef(false);
  const lastPointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setBoardView(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving the ruler/AoE tools wipes our drawing (and tells the table to drop it).
  useEffect(() => {
    if (boardTool !== 'measure' && boardTool !== 'aoe' && ownMeasure) {
      setOwnMeasure(null);
      sendWs({ type: 'measure', kind: 'clear' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardTool]);

  function screenToBoard(clientX: number, clientY: number): { x: number; y: number } {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - view.x) / view.scale, y: (clientY - rect.top - view.y) / view.scale };
  }

  // ---------------------------------------------------------------------------
  // Fit helper
  // ---------------------------------------------------------------------------

  // Centre the bounded map area at a scale showing ~45 cells.
  function fitCanvas() {
    const container = containerRef.current;
    if (!container) return;
    const { clientWidth: cw, clientHeight: ch } = container;
    const scale = clampScale(Math.min(cw, ch) / (45 * grid.cell));
    const mid = (MAP_CELLS * grid.cell) / 2;
    setView({ scale, x: cw / 2 - mid * scale, y: ch / 2 - mid * scale });
  }

  function fitBoard() {
    const container = containerRef.current;
    if (!container) return;
    const { clientWidth: cw, clientHeight: ch } = container;

    if (board.length === 0) {
      fitCanvas();
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
    if (fittedOnce.current) return;
    fittedOnce.current = true;
    if (board.length > 0) fitBoard(); else fitCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.length]);

  // ---------------------------------------------------------------------------
  // Pan + wheel zoom
  // ---------------------------------------------------------------------------

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    // Presses on overlay buttons (empty-state CTA, zoom controls, tool dock)
    // must stay clicks — capturing here would retarget the click to the canvas.
    if ((e.target as HTMLElement).closest('button, a')) return;

    if (stamping && activePalettePiece) {
      const p = screenToBoard(e.clientX, e.clientY);
      const size = Math.round(grid.cell * 1.5);
      const lp = activePalettePiece;
      let px = p.x - size / 2, py = p.y - size / 2;
      if (lp.lockedToGrid || grid.snap) {
        px = snapTo(px, grid.cell, grid.offsetX);
        py = snapTo(py, grid.cell, grid.offsetY);
      }
      sendWs({ type: 'pieceAdd', builtin: lp.builtin, assetId: lp.assetId, x: px, y: py, w: size, h: size, rotation: 0, layer: lp.layer, lockedToGrid: lp.lockedToGrid });
      return; // stay armed for rapid placement
    }

    if (calibrating) {
      const p = screenToBoard(e.clientX, e.clientY);
      calibRef.current = { sx: p.x, sy: p.y };
      setCalibBox({ x: p.x, y: p.y, w: 0, h: 0 });
      setCalibPrompt(false);
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      return;
    }

    if (measureKind) {
      const p = screenToBoard(e.clientX, e.clientY);
      measuringRef.current = true;
      setOwnMeasure({ kind: measureKind, x1: p.x, y1: p.y, x2: p.x, y2: p.y });
      // Ruler broadcasts live; an AoE is only a local preview until released.
      if (measuring) sendWs({ type: 'measure', kind: 'ruler', x1: p.x, y1: p.y, x2: p.x, y2: p.y });
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      return;
    }

    // Clicking empty board space clears any selection.
    setSelectedTokenId(null);
    setSelectedPieceId(null);
    draggingCanvas.current = true;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    if (calibRef.current) {
      const p = screenToBoard(e.clientX, e.clientY);
      const s = calibRef.current;
      setCalibBox({ x: Math.min(s.sx, p.x), y: Math.min(s.sy, p.y), w: Math.abs(p.x - s.sx), h: Math.abs(p.y - s.sy) });
      return;
    }
    if (stamping && activePalettePiece) {
      const p = screenToBoard(e.clientX, e.clientY);
      const size = Math.round(grid.cell * 1.5);
      let px = p.x - size / 2, py = p.y - size / 2;
      if (activePalettePiece.lockedToGrid || grid.snap) {
        px = snapTo(px, grid.cell, grid.offsetX);
        py = snapTo(py, grid.cell, grid.offsetY);
      }
      setGhost({ x: px, y: py });
      return;
    }
    if (ghost) setGhost(null);
    if (measuringRef.current) {
      const p = screenToBoard(e.clientX, e.clientY);
      const m = useStore.getState().ownMeasure;
      if (!m) return;
      setOwnMeasure({ kind: m.kind, x1: m.x1, y1: m.y1, x2: p.x, y2: p.y });
      if (measuring) sendWs({ type: 'measure', kind: 'ruler', x1: m.x1, y1: m.y1, x2: p.x, y2: p.y });
      return;
    }
    if (!draggingCanvas.current) return;
    const dx = e.clientX - lastPointer.current.x;
    const dy = e.clientY - lastPointer.current.y;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  }

  function handlePointerUp() {
    if (calibRef.current) {
      calibRef.current = null;
      if (calibBox && calibBox.w > 4) setCalibPrompt(true);
      return;
    }
    if (measuringRef.current) {
      measuringRef.current = false;
      // Releasing an AoE drag commits a persistent template (everyone sees it,
      // and you can place more). The ruler just stays as the live measure.
      if (aoeing) {
        const m = useStore.getState().ownMeasure;
        if (m && Math.hypot(m.x2 - m.x1, m.y2 - m.y1) > 4) {
          sendWs({ type: 'aoeAdd', kind: m.kind as AoeKind, x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2 });
        }
        setOwnMeasure(null);
      }
    }
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
  const sortedTokens = [...tokens].sort((a, b) => a.z - b.z);
  const sortedPieces = [...pieces].sort((a, b) => a.z - b.z).filter((p) => layerVisible[p.layer]);
  const isEmpty = board.length === 0 && tokens.length === 0 && pieces.length === 0;
  const cursor = measuring || aoeing || stamping || erasing || calibrating ? 'crosshair' : draggingCanvas.current ? 'grabbing' : 'grab';
  // Two transform stages share this transform so the grid can sit between the
  // background (below) and the pieces/tokens (above).
  const stageStyle: React.CSSProperties = {
    position: 'absolute', top: 0, left: 0,
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
    transformOrigin: '0 0', willChange: 'transform',
  };

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden select-none"
      style={{
        touchAction: 'none',
        cursor,
        // Board lamp glow + vignette (grid is its own dynamic layer below).
        background: `
          radial-gradient(1100px 760px at 46% 36%, #3a210f55, transparent 72%),
          radial-gradient(1500px 1080px at 50% 50%, transparent 52%, #000000b0),
          var(--bg)
        `,
        backgroundSize: 'cover, cover, cover',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onWheel={handleWheel}
      aria-label="Campaign map canvas"
    >
      {/* Background stage — sits BELOW the grid so the grid shows on the map.
          In build mode the DM can move/resize the background too. */}
      <div style={stageStyle}>
        {(layerVisible.background) && sortedItems.map((item) => (
          <BoardItemEl key={item.id} item={item} isDm={isDm} scale={view.scale} />
        ))}
      </div>

      {/* Bounded grid (board space) — a finite MAP_CELLS × MAP_CELLS play area */}
      <div style={stageStyle}>
        <BoundedGrid grid={grid} scale={view.scale} />
      </div>

      {/* Content stage — pieces + tokens live ABOVE the grid */}
      <div style={stageStyle}>
        {sortedPieces.map((piece) => (
          <PieceEl
            key={piece.id}
            piece={piece}
            scale={view.scale}
            grid={grid}
            interactive={piecesInteractive}
            erasing={erasing}
          />
        ))}
        {/* Stamp ghost preview */}
        {stamping && ghost && activePalettePiece && (() => {
          const gStyle: React.CSSProperties = {
            position: 'absolute', left: ghost.x, top: ghost.y,
            width: Math.round(grid.cell * 1.5), height: Math.round(grid.cell * 1.5),
            opacity: 0.55, pointerEvents: 'none', filter: 'drop-shadow(0 0 6px #e0824c88)',
          };
          return activePalettePiece.builtin ? (
            <div aria-hidden="true" style={gStyle} dangerouslySetInnerHTML={{ __html: inkSprite(activePalettePiece.builtin, 32, 0) }} />
          ) : activePalettePiece.url ? (
            <div aria-hidden="true" style={gStyle}>
              <img src={activePalettePiece.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
          ) : null;
        })()}
        {sortedTokens.map((token) => (
          <TokenEl
            key={token.id}
            token={token}
            selfUserId={selfUserId}
            isDm={isDm}
            scale={view.scale}
            grid={grid}
            active={tokensActive}
          />
        ))}
        {children}
      </div>

      {/* Measurement rulers (screen-space overlay) */}
      <MeasureOverlay
        view={view} grid={grid} own={ownMeasure} shared={sharedMeasures}
        aoes={aoes} selfUserId={selfUserId} canEditAoe={aoeing} isDm={isDm}
        onRemoveAoe={(id) => sendWs({ type: 'aoeRemove', id })}
      />

      {/* Grid calibration box + prompt (build mode) */}
      {calibBox && (
        <>
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: calibBox.x * view.scale + view.x,
              top: calibBox.y * view.scale + view.y,
              width: calibBox.w * view.scale,
              height: calibBox.h * view.scale,
              border: '2px solid var(--gold)',
              background: '#e8b76522',
              pointerEvents: 'none',
            }}
          />
          {calibPrompt && (
            <div
              style={{
                position: 'absolute',
                left: Math.min(calibBox.x * view.scale + view.x, (containerRef.current?.clientWidth ?? 400) - 220),
                top: (calibBox.y + calibBox.h) * view.scale + view.y + 8,
                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
                padding: 10, zIndex: 6, boxShadow: '0 12px 30px -12px #000b', display: 'flex', alignItems: 'center', gap: 8,
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span style={{ fontSize: 12, color: 'var(--mid)' }}>Cells across</span>
              <input
                type="number" min={1} value={calibCells}
                onChange={(e) => setCalibCells(e.target.value)}
                autoFocus
                style={{ width: 56, padding: '4px 8px', borderRadius: 7, background: '#100c0a', border: '1px solid var(--border)', color: 'var(--hi)', fontFamily: 'var(--mono)' }}
              />
              <button type="button" onClick={applyCalibration}
                style={{ padding: '5px 12px', borderRadius: 7, background: 'var(--ember)', color: 'var(--ink)', border: 'none', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>Apply</button>
              <button type="button" onClick={() => { setCalibBox(null); setCalibPrompt(false); }}
                style={{ padding: '5px 8px', borderRadius: 7, background: 'transparent', color: 'var(--low)', border: 'none', cursor: 'pointer', fontSize: 12 }}>✕</button>
            </div>
          )}
        </>
      )}

      {isEmpty && !isBuild && <EmptyCanvas isDm={isDm} />}

      {/* Nat-20 board moments */}
      <BoardMoments />

      {/* Tool dock — play vs build tools */}
      <ToolDock build={isBuild} />

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
// Bounded grid — a finite MAP_CELLS × MAP_CELLS box in board space
// ---------------------------------------------------------------------------

export const MAP_SIZE = (cell: number) => MAP_CELLS * cell;

function BoundedGrid({ grid, scale }: { grid: GridState; scale: number }) {
  if (!grid.visible) return null;
  const S = MAP_CELLS * grid.cell;
  // Draw lines 1/scale board-px wide so that, once the stage scales by `scale`,
  // every line is exactly 1 screen-px. A flat `1px` board line becomes a
  // sub-pixel fraction at most zooms and flickers into a stray "weird line"
  // wherever it happens to snap to a device-pixel boundary.
  const lw = 1 / scale;
  // `u` = one screen-pixel in board units, so the table edge keeps a constant
  // visual weight at any zoom. The play area is the field box [0,S]; the wooden
  // frame is painted just outside it with stacked spread-shadows: a warm
  // candlelit lip, a few wood tones stepping darker for a bevelled moulding,
  // then a soft cast shadow so the table sits above the dark void.
  const u = 1 / scale;
  const tableEdge = [
    `inset 0 0 ${10 * u}px ${0}px #00000047`,   // play area gently recessed
    `0 0 0 ${1 * u}px #f0c98a66`,               // warm inner lip catching the candlelight
    `0 0 0 ${3 * u}px #8a5e36`,                 // light wood bevel
    `0 0 0 ${11 * u}px #5d3f25`,                // main plank tone
    `0 0 0 ${16 * u}px #3a2616`,                // shaded wood
    `0 0 0 ${18 * u}px #150c06`,                // dark outer rim
    `0 ${10 * u}px ${28 * u}px ${4 * u}px #000000bf`, // table casts onto the void
  ].join(', ');
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute', left: 0, top: 0, width: S, height: S, pointerEvents: 'none',
        backgroundImage: `linear-gradient(0deg, ${grid.color} ${lw}px, transparent ${lw}px), linear-gradient(90deg, ${grid.color} ${lw}px, transparent ${lw}px)`,
        backgroundSize: `${grid.cell}px ${grid.cell}px, ${grid.cell}px ${grid.cell}px`,
        borderRadius: `${5 * u}px`,
        boxShadow: tableEdge,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Measurement overlay — own ruler (ember) + shared rulers (teal)
// ---------------------------------------------------------------------------

interface MeasureShape { kind: MeasureKind; x1: number; y1: number; x2: number; y2: number }

function MeasureOverlay({
  view, grid, own, shared, aoes, selfUserId, canEditAoe, isDm, onRemoveAoe,
}: {
  view: BoardView;
  grid: GridState;
  own: MeasureShape | null;
  shared: Record<string, MeasureShape & { by: string }>;
  aoes: AoeTemplate[];
  selfUserId: string | null;
  canEditAoe: boolean;
  isDm: boolean;
  onRemoveAoe: (id: string) => void;
}) {
  const sharedList = Object.values(shared);
  if (!own && sharedList.length === 0 && aoes.length === 0) return null;

  const sc = (bx: number, by: number) => ({ x: bx * view.scale + view.x, y: by * view.scale + view.y });
  const perCell = grid.unit === 'ft' ? 5 : 1.5;
  const fmt = (cells: number) => `${(cells * perCell).toFixed(grid.unit === 'ft' ? 0 : 1)} ${grid.unit}`;

  // A rounded label chip centred on (x,y).
  function Pill({ x, y, txt, color }: { x: number; y: number; txt: string; color: string }) {
    const fs = 16;
    const w = Math.max(56, txt.length * fs * 0.6 + 16);
    const h = fs + 11;
    return (
      <g transform={`translate(${x}, ${y})`}>
        <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={7} fill="#000000cc" />
        <text x={0} y={fs * 0.35} textAnchor="middle" fontFamily="var(--mono)" fontSize={fs} fontWeight={600} fill={color}>{txt}</text>
      </g>
    );
  }

  function ShapeEl({ s, isShared, by }: { s: MeasureShape; isShared?: boolean; by?: string }) {
    const color = isShared ? 'var(--teal)' : 'var(--ember)';
    const a = sc(s.x1, s.y1);
    const b = sc(s.x2, s.y2);
    const distB = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    const cells = distB / grid.cell;
    const tag = by ? ` · ${by}` : '';
    const area = { fill: color, fillOpacity: 0.16, stroke: color, strokeWidth: 2 } as const;

    if (s.kind === 'ruler') {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const cls = isShared ? 'shared' : '';
      return (
        <g>
          <line className={`meas-line ${cls}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          <circle className={`meas-end ${cls}`} cx={a.x} cy={a.y} r={4} />
          <circle className={`meas-end ${cls}`} cx={b.x} cy={b.y} r={4} />
          <Pill x={mid.x} y={mid.y - 18} txt={`${fmt(cells)}${tag}`} color={color} />
        </g>
      );
    }

    if (s.kind === 'circle') {
      const r = distB * view.scale;
      return (
        <g>
          <circle cx={a.x} cy={a.y} r={r} {...area} />
          <circle cx={a.x} cy={a.y} r={3} fill={color} />
          <Pill x={a.x} y={a.y - r - 14} txt={`${fmt(cells)} R${tag}`} color={color} />
        </g>
      );
    }

    if (distB < 1) return null; // cone/line/square need a drag direction to size

    const ux = (s.x2 - s.x1) / distB, uy = (s.y2 - s.y1) / distB; // unit direction
    const px = -uy, py = ux;                                       // perpendicular

    if (s.kind === 'cone') {
      // 5e cone: at distance L the width equals L, so the far edge spans ±L/2.
      const L = distB, hw = L / 2;
      const fx = s.x1 + ux * L, fy = s.y1 + uy * L;
      const p1 = sc(fx + px * hw, fy + py * hw);
      const p2 = sc(fx - px * hw, fy - py * hw);
      const fc = sc(fx, fy);
      return (
        <g>
          <polygon points={`${a.x},${a.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`} {...area} strokeLinejoin="round" />
          <Pill x={fc.x} y={fc.y} txt={`${fmt(cells)}${tag}`} color={color} />
        </g>
      );
    }

    if (s.kind === 'line') {
      const hw = grid.cell / 2; // one cell wide (5 ft / 1.5 m)
      const ex = s.x1 + ux * distB, ey = s.y1 + uy * distB;
      const c1 = sc(s.x1 + px * hw, s.y1 + py * hw);
      const c2 = sc(s.x1 - px * hw, s.y1 - py * hw);
      const c3 = sc(ex - px * hw, ey - py * hw);
      const c4 = sc(ex + px * hw, ey + py * hw);
      const mid = sc(s.x1 + ux * distB / 2, s.y1 + uy * distB / 2);
      return (
        <g>
          <polygon points={`${c1.x},${c1.y} ${c2.x},${c2.y} ${c3.x},${c3.y} ${c4.x},${c4.y}`} {...area} strokeLinejoin="round" />
          <Pill x={mid.x} y={mid.y} txt={`${fmt(cells)}${tag}`} color={color} />
        </g>
      );
    }

    // square / cube — centred on the origin, half-extent = drag distance.
    const tl = sc(s.x1 - distB, s.y1 - distB);
    const br = sc(s.x1 + distB, s.y1 + distB);
    return (
      <g>
        <rect x={tl.x} y={tl.y} width={br.x - tl.x} height={br.y - tl.y} {...area} />
        <circle cx={a.x} cy={a.y} r={3} fill={color} />
        <Pill x={a.x} y={tl.y - 14} txt={`${fmt(2 * cells)}${tag}`} color={color} />
      </g>
    );
  }

  // A small ✕ button at an AoE's origin, shown to those who may remove it.
  function RemoveHandle({ a }: { a: AoeTemplate }) {
    const p = sc(a.x1, a.y1);
    return (
      <g transform={`translate(${p.x}, ${p.y})`} style={{ pointerEvents: 'auto', cursor: 'pointer' }}
        onPointerDown={(e) => { e.stopPropagation(); onRemoveAoe(a.id); }}>
        <circle r={9} fill="#1a1310ee" stroke="var(--ember)" strokeWidth={1.5} />
        <path d="M-3.5 -3.5 L3.5 3.5 M3.5 -3.5 L-3.5 3.5" stroke="#f4efe9" strokeWidth={1.6} strokeLinecap="round" />
      </g>
    );
  }

  return (
    <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none', width: '100%', height: '100%' }}>
      {/* Persisted AoE templates — visible to everyone, your own ember, others teal */}
      {aoes.map((a) => <ShapeEl key={a.id} s={a} isShared={a.ownerUserId !== selfUserId} />)}
      {sharedList.map((s) => <ShapeEl key={s.by} s={s} isShared by={s.by} />)}
      {own && <ShapeEl s={own} />}
      {/* Removal affordances only while the AoE tool is active, for owner or DM */}
      {canEditAoe && aoes.filter((a) => isDm || a.ownerUserId === selfUserId).map((a) => (
        <RemoveHandle key={`rm-${a.id}`} a={a} />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Tool dock — Select / Move / Measure (top-center floating)
// ---------------------------------------------------------------------------

function ToolDock({ build }: { build: boolean }) {
  const boardTool = useStore((s) => s.boardTool);
  const setBoardTool = useStore((s) => s.setBoardTool);
  const aoeShape = useStore((s) => s.aoeShape);
  const setAoeShape = useStore((s) => s.setAoeShape);
  const openTokenPanel = useStore((s) => s.openTokenPanel);

  const SELECT = { id: 'select' as BoardTool, label: 'Select', icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M4 3l7 17 2.5-6.5L20 11 4 3z" strokeLinejoin="round" /></svg>
  ) };
  const PAN = { id: 'move' as BoardTool, label: 'Pan', icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ) };
  const MEASURE = { id: 'measure' as BoardTool, label: 'Measure', icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M3 7l14 14 4-4L7 3 3 7zM8 6l2 2M11 9l2 2M14 12l2 2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ) };
  const STAMP = { id: 'stamp' as BoardTool, label: 'Stamp', icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><path d="M5 20h14M8 16l-2 .5a1 1 0 0 1-1.2-1.2L5.5 13 14 4.5a2.1 2.1 0 0 1 3 3L8.5 16Z" strokeLinejoin="round" /></svg>
  ) };
  const ERASE = { id: 'erase' as BoardTool, label: 'Erase', icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><path d="M6 16l-2-2a1.8 1.8 0 0 1 0-2.6l7-7a1.8 1.8 0 0 1 2.6 0l4 4a1.8 1.8 0 0 1 0 2.6L11 18H7z" strokeLinejoin="round" /><path d="M9 19h11" /></svg>
  ) };
  const AOE = { id: 'aoe' as BoardTool, label: 'AoE', icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="w-4 h-4"><circle cx="12" cy="12" r="8.5" strokeDasharray="2.5 2.5" /><path d="M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z" /></svg>
  ) };

  const tools: Array<{ id: BoardTool; label: string; icon: ReactNode }> = build
    ? [SELECT, PAN, STAMP, ERASE, MEASURE, AOE]
    : [SELECT, PAN, MEASURE, AOE];

  // AoE template shapes shown as a sub-row while the AoE tool is active.
  const AOE_SHAPES: Array<{ id: AoeShape; label: string; icon: ReactNode }> = [
    { id: 'circle', label: 'Circle / sphere', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><circle cx="12" cy="12" r="8" /></svg> },
    { id: 'cone', label: 'Cone', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><path d="M12 4l7 16H5L12 4z" strokeLinejoin="round" /></svg> },
    { id: 'line', label: 'Line', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><rect x="9.5" y="3.5" width="5" height="17" rx="1.5" /></svg> },
    { id: 'square', label: 'Square / cube', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><rect x="4.5" y="4.5" width="15" height="15" rx="1.5" /></svg> },
  ];

  const rowStyle: React.CSSProperties = {
    display: 'flex', gap: 2, background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 10, padding: 4, boxShadow: '0 12px 30px -12px #000b',
  };

  return (
    <div
      style={{
        position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, zIndex: 5,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={rowStyle}>
      {tools.map((t) => {
        const active = boardTool === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setBoardTool(t.id)}
            title={t.label}
            aria-label={t.label}
            aria-pressed={active}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 7,
              border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              background: active ? 'var(--ember)' : 'transparent',
              color: active ? 'var(--ink)' : 'var(--mid)',
              transition: 'background 0.12s, color 0.12s',
            }}
          >
            {t.icon}
            {t.label}
          </button>
        );
      })}

      {!build && <div style={{ width: 1, height: 18, background: 'var(--border)', alignSelf: 'center', margin: '0 2px' }} aria-hidden="true" />}

      {!build && <button
        type="button"
        onClick={() => openTokenPanel(null)}
        title="Add a token"
        aria-label="Add a token"
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 7,
          border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
          background: 'transparent', color: 'var(--mid)', transition: 'background 0.12s, color 0.12s',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLElement).style.color = 'var(--hi)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--mid)'; }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>
        Token
      </button>}
      </div>

      {boardTool === 'aoe' && (
        <div style={rowStyle}>
          {AOE_SHAPES.map((sh) => {
            const active = aoeShape === sh.id;
            return (
              <button
                key={sh.id}
                type="button"
                onClick={() => setAoeShape(sh.id)}
                title={sh.label}
                aria-label={sh.label}
                aria-pressed={active}
                style={{
                  display: 'flex', alignItems: 'center', padding: '6px 9px', borderRadius: 7,
                  border: 'none', cursor: 'pointer',
                  background: active ? 'var(--ember)' : 'transparent',
                  color: active ? 'var(--ink)' : 'var(--mid)',
                  transition: 'background 0.12s, color 0.12s',
                }}
              >
                {sh.icon}
              </button>
            );
          })}
          <div style={{ width: 1, height: 18, background: 'var(--border)', alignSelf: 'center', margin: '0 2px' }} aria-hidden="true" />
          <button
            type="button"
            onClick={() => sendWs({ type: 'aoeClear' })}
            title="Clear AoE templates"
            aria-label="Clear AoE templates"
            style={{
              display: 'flex', alignItems: 'center', padding: '6px 9px', borderRadius: 7,
              border: 'none', cursor: 'pointer', background: 'transparent', color: 'var(--mid)',
              transition: 'background 0.12s, color 0.12s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--ember)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--mid)'; }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="w-4 h-4"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      )}
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
