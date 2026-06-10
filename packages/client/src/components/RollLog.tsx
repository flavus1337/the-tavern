import type { RollLogEntry, RollPart } from '@vtt/shared';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';

interface RollLogProps {
  entries: RollLogEntry[];
}

export function RollLog({ entries }: RollLogProps) {
  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-zinc-600 text-sm">
        No rolls yet
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-2">
        {entries.map((entry) => (
          <RollEntry key={entry.id} entry={entry} />
        ))}
      </div>
    </ScrollArea>
  );
}

function RollEntry({ entry }: { entry: RollLogEntry }) {
  // Check for nat 20 / nat 1 on a single d20 roll
  const singleD20 = entry.parts.length === 1 && entry.parts[0]?.kind === 'dice' && entry.parts[0].sides === 20 && entry.parts[0].count === 1;
  const singleRoll = singleD20 && entry.parts[0]?.kind === 'dice' ? entry.parts[0].rolls[0] : null;
  const isNat20 = singleRoll === 20;
  const isNat1 = singleRoll === 1;

  return (
    <div
      className={`
        p-2.5 rounded-lg border text-sm
        ${isNat20 ? 'bg-green-950/40 border-green-800' : ''}
        ${isNat1 ? 'bg-red-950/40 border-red-900' : ''}
        ${!isNat20 && !isNat1 ? 'bg-zinc-900 border-zinc-800' : ''}
      `}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-zinc-200 text-xs">{entry.username}</span>
          {entry.label && <span className="text-zinc-500 text-xs">· {entry.label}</span>}
        </div>
        <div className="flex items-center gap-1">
          {entry.visibility === 'dm' && (
            <Badge variant="dm" className="text-xs">Private</Badge>
          )}
          <span className="text-zinc-600 text-xs">{relativeTime(entry.ts)}</span>
        </div>
      </div>

      {/* Expression */}
      <div className="text-xs text-zinc-500 mb-1.5 font-mono">{entry.expression}</div>

      {/* Dice chips */}
      <div className="flex flex-wrap gap-1 mb-1.5">
        {entry.parts.map((part, i) => (
          <PartChip key={i} part={part} />
        ))}
      </div>

      {/* Total */}
      <div className={`text-lg font-bold ${isNat20 ? 'text-green-400' : isNat1 ? 'text-red-400' : 'text-zinc-100'}`}>
        {entry.total}
        {isNat20 && <span className="text-xs font-normal text-green-500 ml-1">NAT 20!</span>}
        {isNat1 && <span className="text-xs font-normal text-red-500 ml-1">NAT 1</span>}
      </div>
    </div>
  );
}

function PartChip({ part }: { part: RollPart }) {
  if (part.kind === 'modifier') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 bg-zinc-800 text-zinc-400 text-xs rounded font-mono">
        {part.value >= 0 ? `+${part.value}` : String(part.value)}
      </span>
    );
  }

  return (
    <>
      {part.rolls.map((roll, i) => (
        <span
          key={i}
          className={`inline-flex items-center px-1.5 py-0.5 text-xs rounded font-mono border ${
            roll === part.sides
              ? 'bg-green-900 border-green-700 text-green-200'
              : roll === 1
              ? 'bg-red-900 border-red-700 text-red-200'
              : 'bg-zinc-800 border-zinc-700 text-zinc-300'
          }`}
          title={`d${part.sides}`}
        >
          {part.negative ? '-' : i > 0 || part.negative ? '' : ''}{roll}
        </span>
      ))}
    </>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}
