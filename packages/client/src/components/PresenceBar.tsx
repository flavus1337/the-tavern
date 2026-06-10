import { useRef, useEffect } from 'react';
import type { PresenceEntry } from '@vtt/shared';

// Avatar gradient per role/index
const PLAYER_GRADIENTS = [
  'linear-gradient(135deg,#5b86c2,#41609c)',
  'linear-gradient(135deg,#5bb3a3,#3f8c7f)',
  'linear-gradient(135deg,#c79a4b,#a07a32)',
];
const DM_GRADIENT = 'linear-gradient(135deg,#c2596a,#9c4150)';

function avatarGradient(role: string, playerIdx: number): string {
  if (role === 'dm') return DM_GRADIENT;
  return PLAYER_GRADIENTS[playerIdx % PLAYER_GRADIENTS.length] ?? DM_GRADIENT;
}

interface PresenceBarProps {
  entries: PresenceEntry[];
  onJoin?: (entry: PresenceEntry) => void;
}

export function PresenceBar({ entries, onJoin }: PresenceBarProps) {
  // Track previous user IDs to detect joins
  const prevIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentIds = new Set(entries.map((e) => e.userId));
    if (prevIds.current.size > 0) {
      // Detect newly joined users
      for (const entry of entries) {
        if (!prevIds.current.has(entry.userId) && entry.connected) {
          onJoin?.(entry);
        }
      }
    }
    prevIds.current = currentIds;
  }, [entries, onJoin]);

  const connected = entries.filter((e) => e.connected);
  const count = connected.length;

  // Separate DM from players for gradient assignment
  let playerIdx = 0;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--border-soft)',
        borderRadius: 999,
        padding: '4px 12px 4px 4px',
        gap: 9,
      }}
      aria-label={`${count} player${count !== 1 ? 's' : ''} at the table`}
    >
      {/* Avatar stack */}
      <div style={{ display: 'flex' }}>
        {entries.map((entry, i) => {
          const idx = entry.role === 'player' ? playerIdx++ : 0;
          return (
            <PresenceAvatar
              key={entry.userId}
              entry={entry}
              gradient={avatarGradient(entry.role, idx)}
              isNew={i === entries.length - 1} // Newest joins at end
            />
          );
        })}
      </div>

      {/* "N at the table" label */}
      <span
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 11,
          color: 'var(--low)',
          whiteSpace: 'nowrap',
        }}
      >
        {count} at the table
      </span>
    </div>
  );
}

interface PresenceAvatarProps {
  entry: PresenceEntry;
  gradient: string;
  isNew?: boolean;
}

function PresenceAvatar({ entry, gradient, isNew }: PresenceAvatarProps) {
  const initials = entry.username.slice(0, 2).toUpperCase();

  return (
    <div
      title={`${entry.username}${entry.role === 'dm' ? ' (DM)' : ''}${!entry.connected ? ' — away' : ''}`}
      style={{
        width: 26, height: 26,
        borderRadius: '50%',
        background: gradient,
        border: '1.5px solid var(--bg)',
        marginLeft: -8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--mono)',
        fontSize: 10,
        fontWeight: 600,
        color: '#fff',
        flexShrink: 0,
        opacity: entry.connected ? 1 : 0.4,
        animation: isNew ? 'presence-join 250ms cubic-bezier(.2,.9,.3,1.3) both' : undefined,
        transformOrigin: 'center',
      }}
      className={isNew ? 'presence-join-animate' : undefined}
      aria-label={`${entry.username}${entry.role === 'dm' ? ', DM' : ''}${!entry.connected ? ', disconnected' : ''}`}
    >
      {initials}
    </div>
  );
}
