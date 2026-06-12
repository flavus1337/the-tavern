import { useEffect, useRef } from 'react';
import type { RollLogEntry, RollPart } from '@vtt/shared';
import { ScrollArea } from './ui/scroll-area';
import { useStore } from '../store';

interface RollLogProps {
  entries: RollLogEntry[];
}

export function RollLog({ entries }: RollLogProps) {
  if (entries.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px', color: 'var(--faint)', fontSize: 13, textAlign: 'center' }}>
        No rolls yet
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {entries.map((entry) => (
          <RollEntry key={entry.id} entry={entry} />
        ))}
      </div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// Detect nat-20 / nat-1 from a roll entry, respecting keep-highest
// ---------------------------------------------------------------------------

function getKeptD20Value(entry: RollLogEntry): number | null {
  const d20Parts = entry.parts.filter((p): p is RollPart & { kind: 'dice' } =>
    p.kind === 'dice' && p.sides === 20,
  );
  if (d20Parts.length !== 1) return null;
  const part = d20Parts[0];
  if (!part) return null;

  if (part.dropped && part.dropped.length > 0) {
    // Advantage roll: find the non-dropped index
    const keptIdx = part.rolls.findIndex((_, i) => !part.dropped!.includes(i));
    return keptIdx >= 0 ? (part.rolls[keptIdx] ?? null) : null;
  }
  // Normal single d20
  if (part.rolls.length === 1) return part.rolls[0] ?? null;
  return null;
}

// ---------------------------------------------------------------------------
// Nat-20 board moment: gold ring sweep
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Individual roll entry
// ---------------------------------------------------------------------------

function RollEntry({ entry }: { entry: RollLogEntry }) {
  const keptD20 = getKeptD20Value(entry);
  const isNat20 = keptD20 === 20;
  const isNat1 = keptD20 === 1;
  const isPrivate = entry.visibility === 'dm';

  // Fire board moment once on first render for nat 20
  const hasFiredRef = useRef(false);
  const addBoardMoment = useStore((s) => s.addBoardMoment ?? (() => {}));
  useEffect(() => {
    if (isNat20 && !hasFiredRef.current) {
      hasFiredRef.current = true;
      addBoardMoment(entry.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const borderColor = isNat20
    ? '#e8b76555'
    : isNat1
    ? '#b6485a44'
    : isPrivate
    ? 'var(--border)'
    : 'var(--border)';

  const borderStyle = isPrivate ? 'dashed' : 'solid';

  return (
    <div
      className={`log-entry-animate ${isNat1 ? 'log-entry-shake' : ''}`}
      style={{
        background: 'var(--surface2)',
        border: `1px ${borderStyle} ${borderColor}`,
        borderRadius: 11,
        padding: '13px 14px',
        position: 'relative',
        animation: isNat1
          ? 'log-in 0.26s ease-out, shake 0.4s ease-out 0.05s'
          : 'log-in 0.26s ease-out',
      }}
    >
      {/* Gold / garnet left rule */}
      {(isNat20 || isNat1) && (
        <div
          style={{
            position: 'absolute',
            left: 0, top: 10, bottom: 10,
            width: 3,
            borderRadius: 3,
            background: isNat20 ? 'var(--gold)' : 'var(--garnet)',
            boxShadow: isNat20 ? '0 0 10px #e8b76577' : undefined,
          }}
          aria-hidden="true"
        />
      )}

      {/* Row 1: who + timestamp */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--mid)', fontWeight: 700 }}>
            {entry.username}
          </span>
          {isPrivate && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--faint)', border: '1px solid var(--border)', padding: '1px 5px', borderRadius: 4 }}>
              private
            </span>
          )}
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>
          {relativeTime(entry.ts)}
        </span>
      </div>

      {/* Row 2: expression + label */}
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--low)', marginBottom: 9 }}>
        {entry.expression}
        {entry.label && <span> · {entry.label}</span>}
      </div>

      {/* Row 3: pips */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap', marginBottom: 11 }}>
        {entry.parts.map((part, i) => (
          <PartPips key={i} part={part} />
        ))}
      </div>

      {/* Row 4: total + badge */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{
          fontFamily: 'var(--serif)',
          fontSize: 32,
          fontWeight: 600,
          lineHeight: 1,
          color: isNat20 ? 'var(--gold)' : isNat1 ? 'var(--garnet)' : 'var(--hi)',
        }}>
          {entry.total}
        </span>
        {isNat20 && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '3px 7px', borderRadius: 5, fontWeight: 600, color: 'var(--gold)', background: '#e8b76519' }}>
            CRITICAL HIT
          </span>
        )}
        {isNat1 && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '3px 7px', borderRadius: 5, fontWeight: 600, color: 'var(--garnet)', background: '#b6485a1f' }}>
            CRITICAL MISS
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pip rendering
// ---------------------------------------------------------------------------

function PartPips({ part }: { part: RollPart }) {
  if (part.kind === 'modifier') {
    return (
      <span style={{
        fontFamily: 'var(--mono)', fontSize: 12,
        color: 'var(--low)',
        background: 'transparent',
        border: 'none',
        padding: '0 3px',
        minWidth: 'auto',
      }}>
        {part.value >= 0 ? `+${part.value}` : String(part.value)}
      </span>
    );
  }

  // Dice part
  const droppedSet = new Set(part.dropped ?? []);
  // Advantage-style roll: some dice were dropped — the kept one gets an
  // explicit highlight so both throws read at a glance.
  const hasDropped = droppedSet.size > 0;

  return (
    <>
      {part.rolls.map((roll, i) => {
        const isDropped = droppedSet.has(i);
        const isMax = roll === part.sides;
        const isMin = roll === 1;
        const isKeptOfPair = hasDropped && !isDropped;

        // Crit colors win; otherwise the kept die of an advantage pair is ember.
        const tone = !isDropped && isMax ? 'gold' : !isDropped && isMin ? 'garnet' : isKeptOfPair ? 'ember' : 'plain';
        const bg = tone === 'gold' ? '#e8b76524' : tone === 'garnet' ? '#b6485a22' : tone === 'ember' ? '#e08a4b1f' : 'rgba(255,255,255,0.05)';
        const border = tone === 'gold' ? '#e8b76577' : tone === 'garnet' ? '#b6485a66' : tone === 'ember' ? '#e08a4b88' : 'rgba(255,255,255,0.08)';
        const color = tone === 'gold' ? 'var(--gold)' : tone === 'garnet' ? '#e08a8a' : tone === 'ember' ? 'var(--ember)' : 'var(--hi)';

        return (
          <span
            key={i}
            style={{
              minWidth: 25, height: 25,
              padding: '0 6px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 7,
              fontFamily: 'var(--mono)',
              fontSize: 12,
              fontWeight: 600,
              opacity: isDropped ? 0.35 : 1,
              textDecoration: isDropped ? 'line-through' : undefined,
              background: bg,
              border: `1px solid ${border}`,
              boxShadow: isKeptOfPair && tone === 'ember' ? '0 0 0 1px #e08a4b33' : undefined,
              color,
            }}
            title={`d${part.sides}${isDropped ? ' — dropped' : hasDropped ? ' — kept' : ''}`}
          >
            {roll}
          </span>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Nat-20 board moment component — rendered over the canvas area from here
// ---------------------------------------------------------------------------
export function BoardMoments() {
  const boardMoments = useStore((s) => s.boardMoments ?? []);
  const removeBoardMoment = useStore((s) => s.removeBoardMoment ?? (() => {}));

  return (
    <>
      {boardMoments.map((id) => (
        <Nat20BoardMomentWrapper key={id} id={id} onDone={() => removeBoardMoment(id)} />
      ))}
    </>
  );
}

function Nat20BoardMomentWrapper({ onDone }: { id: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 900);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <>
      <div
        className="crit-glow"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle at center, #e8b76518, transparent 55%)',
          animation: 'glow-fade 800ms ease-out forwards',
          pointerEvents: 'none',
          zIndex: 99,
        }}
        aria-hidden="true"
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Relative timestamp
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 5) return 'now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}
