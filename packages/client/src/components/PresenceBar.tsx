import type { PresenceEntry } from '@vtt/shared';

interface PresenceBarProps {
  entries: PresenceEntry[];
}

export function PresenceBar({ entries }: PresenceBarProps) {
  return (
    <div
      className="flex items-center gap-1.5"
      aria-label="Connected players"
    >
      {entries.map((entry) => (
        <PresenceAvatar key={entry.userId} entry={entry} />
      ))}
    </div>
  );
}

function PresenceAvatar({ entry }: { entry: PresenceEntry }) {
  const initials = entry.username.slice(0, 2).toUpperCase();
  const isDm = entry.role === 'dm';

  return (
    <div className="relative" title={`${entry.username}${isDm ? ' (DM)' : ''}${!entry.connected ? ' — away' : ''}`}>
      <div
        className={`
          w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
          border transition-opacity
          ${isDm ? 'bg-violet-800 border-violet-600 text-violet-100' : 'bg-indigo-800 border-indigo-600 text-indigo-100'}
          ${!entry.connected ? 'opacity-40' : 'opacity-100'}
        `}
        aria-label={`${entry.username}${isDm ? ', DM' : ''}${!entry.connected ? ', disconnected' : ''}`}
      >
        {initials}
      </div>
      {isDm && entry.connected && (
        <span
          className="absolute -top-1 -right-1 text-yellow-400 leading-none"
          aria-hidden="true"
          title="Dungeon Master"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
            <path d="M8 1l1.8 3.6L14 5.5l-3 2.9.7 4.1L8 10.3l-3.7 2.2.7-4.1L2 5.5l4.2-.9z" />
          </svg>
        </span>
      )}
    </div>
  );
}
