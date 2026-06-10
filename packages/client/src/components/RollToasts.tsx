import { useEffect } from 'react';
import type { RollLogEntry, RollPart } from '@vtt/shared';
import { useStore, type JoinToast, type ShareToast } from '../store';

const ROLL_TOAST_MS = 3400;
const JOIN_TOAST_MS = 3400;
const SHARE_TOAST_MS = 3400;

/**
 * Transient roll-result, presence-join, and document-share toasts over the canvas, bottom-center.
 */
export function RollToasts() {
  const rollToasts = useStore((s) => s.rollToasts);
  const joinToasts = useStore((s) => s.joinToasts);
  const shareToasts = useStore((s) => s.shareToasts);

  const all = [
    ...rollToasts.map((e) => ({ type: 'roll' as const, data: e, id: e.id })),
    ...joinToasts.map((j) => ({ type: 'join' as const, data: j, id: j.id })),
    ...shareToasts.map((s) => ({ type: 'share' as const, data: s, id: s.id })),
  ];

  if (all.length === 0) return null;

  return (
    <div
      className="absolute bottom-[22px] left-1/2 -translate-x-1/2 z-30 flex flex-col-reverse items-center gap-[10px] pointer-events-none w-full px-4"
      aria-live="polite"
      aria-label="Recent notifications"
    >
      {all.map((item) =>
        item.type === 'roll' ? (
          <RollToastItem key={item.id} entry={item.data as RollLogEntry} />
        ) : item.type === 'join' ? (
          <JoinToastItem key={item.id} toast={item.data as JoinToast} />
        ) : (
          <ShareToastItem key={item.id} toast={item.data as ShareToast} />
        ),
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roll toast
// ---------------------------------------------------------------------------

function RollToastItem({ entry }: { entry: RollLogEntry }) {
  const dismissRollToast = useStore((s) => s.dismissRollToast);

  useEffect(() => {
    const t = setTimeout(() => dismissRollToast(entry.id), ROLL_TOAST_MS);
    return () => clearTimeout(t);
  }, [entry.id, dismissRollToast]);

  // Determine if nat 20 or nat 1. For kh rolls, use the kept die.
  const d20Parts = entry.parts.filter((p): p is RollPart & { kind: 'dice'; sides: 20 } =>
    p.kind === 'dice' && p.sides === 20,
  );
  let keptD20Value: number | null = null;
  if (d20Parts.length === 1) {
    const part = d20Parts[0];
    if (part) {
      if (part.dropped && part.dropped.length > 0) {
        // find the non-dropped index
        const keptIdx = part.rolls.findIndex((_, i) => !part.dropped!.includes(i));
        keptD20Value = keptIdx >= 0 ? (part.rolls[keptIdx] ?? null) : null;
      } else if (part.rolls.length === 1) {
        keptD20Value = part.rolls[0] ?? null;
      }
    }
  }

  const isNat20 = keptD20Value === 20;
  const isNat1 = keptD20Value === 1;
  const isAdv = d20Parts.length === 1 && (d20Parts[0]?.dropped?.length ?? 0) > 0;

  // Icon: d20 face
  const iconStyle: React.CSSProperties = {
    width: 26, height: 26, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
    background: isNat20 ? '#e8b76522' : isNat1 ? '#b6485a22' : '#ffffff0a',
    color: isNat20 ? 'var(--gold)' : isNat1 ? 'var(--garnet)' : 'var(--ember)',
    fontSize: 14,
  };

  const totalStyle: React.CSSProperties = {
    fontFamily: 'var(--serif)',
    fontSize: 18,
    fontWeight: 600,
    color: isNat20 ? 'var(--gold)' : isNat1 ? 'var(--garnet)' : 'var(--hi)',
    flexShrink: 0,
    fontVariantNumeric: 'tabular-nums',
  };

  return (
    <div
      role="status"
      className="log-entry-animate pointer-events-auto flex items-center gap-[11px] rounded-[11px] px-4 py-[10px] max-w-full"
      style={{
        background: 'var(--surface2)',
        border: `1px solid ${isNat20 ? '#e8b76555' : isNat1 ? '#b6485a55' : 'var(--border)'}`,
        boxShadow: '0 18px 40px -14px #000c',
        animation: 'toast-in 0.3s cubic-bezier(.2,.9,.3,1.2) both',
        fontSize: 13,
        color: 'var(--mid)',
      }}
      onClick={() => dismissRollToast(entry.id)}
    >
      {/* Icon chip */}
      <div style={iconStyle} aria-hidden="true">
        {isNat20 ? '★' : isNat1 ? '☠' : '⚄'}
      </div>

      <div className="min-w-0">
        <p className="truncate">
          <strong style={{ color: 'var(--hi)', fontWeight: 600 }}>{entry.username}</strong>
          {' rolled '}
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
            {isAdv ? '2d20 adv' : entry.expression}
          </span>
          {entry.label ? ` — ${entry.label}` : ''}
          {entry.visibility === 'dm' && (
            <span style={{ marginLeft: 6, fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--faint)', border: '1px solid var(--border)', padding: '1px 5px', borderRadius: 4 }}>
              private
            </span>
          )}
        </p>
      </div>

      <div style={totalStyle}>{entry.total}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Share toast
// ---------------------------------------------------------------------------

function ShareToastItem({ toast }: { toast: ShareToast }) {
  const dismissShareToast = useStore((s) => s.dismissShareToast);

  useEffect(() => {
    const t = setTimeout(() => dismissShareToast(toast.id), SHARE_TOAST_MS);
    return () => clearTimeout(t);
  }, [toast.id, dismissShareToast]);

  return (
    <div
      role="status"
      className="pointer-events-auto flex items-center gap-[11px] rounded-[11px] px-4 py-[10px] max-w-full"
      style={{
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        boxShadow: '0 18px 40px -14px #000c',
        animation: 'toast-in 0.3s cubic-bezier(.2,.9,.3,1.2) both',
        fontSize: 13,
        color: 'var(--mid)',
      }}
      onClick={() => dismissShareToast(toast.id)}
    >
      <div
        style={{
          width: 26, height: 26, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          background: '#69b7a622',
          color: 'var(--teal)',
          fontSize: 14,
        }}
        aria-hidden="true"
      >
        ⌖
      </div>
      <p>
        <strong style={{ color: 'var(--hi)', fontWeight: 600 }}>{toast.docTitle}</strong>
        {' shared with the table.'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Join toast
// ---------------------------------------------------------------------------

function JoinToastItem({ toast }: { toast: JoinToast }) {
  const dismissJoinToast = useStore((s) => s.dismissJoinToast);

  useEffect(() => {
    const t = setTimeout(() => dismissJoinToast(toast.id), JOIN_TOAST_MS);
    return () => clearTimeout(t);
  }, [toast.id, dismissJoinToast]);

  return (
    <div
      role="status"
      className="pointer-events-auto flex items-center gap-[11px] rounded-[11px] px-4 py-[10px] max-w-full"
      style={{
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        boxShadow: '0 18px 40px -14px #000c',
        animation: 'toast-in 0.3s cubic-bezier(.2,.9,.3,1.2) both',
        fontSize: 13,
        color: 'var(--mid)',
      }}
      onClick={() => dismissJoinToast(toast.id)}
    >
      {/* Join icon chip — teal */}
      <div
        style={{
          width: 26, height: 26, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          background: '#69b7a622',
          color: 'var(--teal)',
          fontSize: 14,
        }}
        aria-hidden="true"
      >
        ⚇
      </div>
      <p>
        <strong style={{ color: 'var(--hi)', fontWeight: 600 }}>{toast.entry.username}</strong>
        {' joined the table.'}
      </p>
    </div>
  );
}
