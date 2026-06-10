import { useEffect } from 'react';
import type { RollLogEntry } from '@vtt/shared';
import { useStore } from '../store';

const TOAST_MS = 5000;

/**
 * Transient roll-result popups over the canvas area — visible to everyone on
 * every screen size, regardless of which sidebar tab is open. The full history
 * stays in the Dice tab's roll log.
 */
export function RollToasts() {
  const rollToasts = useStore((s) => s.rollToasts);

  if (rollToasts.length === 0) return null;

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2 pointer-events-none w-full px-4">
      {rollToasts.map((entry) => (
        <RollToast key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function RollToast({ entry }: { entry: RollLogEntry }) {
  const dismissRollToast = useStore((s) => s.dismissRollToast);

  useEffect(() => {
    const t = setTimeout(() => dismissRollToast(entry.id), TOAST_MS);
    return () => clearTimeout(t);
  }, [entry.id, dismissRollToast]);

  // nat 20 / nat 1 highlighting for a single d20.
  const singleD20 = entry.parts.length >= 1
    && entry.parts.filter((p) => p.kind === 'dice').length === 1
    && entry.parts.some((p) => p.kind === 'dice' && p.sides === 20 && p.rolls.length === 1);
  const d20Roll = singleD20
    ? (entry.parts.find((p) => p.kind === 'dice') as { rolls: number[] }).rolls[0]
    : null;
  const totalColor =
    d20Roll === 20 ? 'text-green-400' : d20Roll === 1 ? 'text-red-400' : 'text-zinc-100';

  return (
    <div
      role="status"
      className="pointer-events-auto flex items-center gap-3 bg-zinc-900/95 backdrop-blur border border-zinc-700 rounded-lg shadow-xl px-4 py-2.5 max-w-full animate-[toast-in_0.15s_ease-out]"
      onClick={() => dismissRollToast(entry.id)}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-indigo-400 shrink-0">
        <path d="M12 2l8.5 5v10L12 22l-8.5-5V7L12 2zM12 2v20M3.5 7L12 12l8.5-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="min-w-0">
        <p className="text-xs text-zinc-400 truncate">
          <span className="text-zinc-200 font-medium">{entry.username}</span>
          {' '}rolled {entry.expression}
          {entry.label ? ` — ${entry.label}` : ''}
          {entry.visibility === 'dm' && (
            <span className="ml-1.5 text-[10px] uppercase tracking-wider bg-violet-950 text-violet-300 rounded px-1 py-px">private</span>
          )}
        </p>
      </div>
      <span className={`text-xl font-bold tabular-nums shrink-0 ${totalColor}`}>{entry.total}</span>
    </div>
  );
}
