import type { Sharing, ShareScope } from '@vtt/shared';
import { useStore } from '../store';

const LABELS: Record<ShareScope, string> = {
  private: 'Private',
  dm: 'DM only',
  users: 'Specific',
  all: 'Everyone',
};

/**
 * Reusable sharing control. `scopes` chooses which options to show:
 * notes/documents use all four; tokens (control) drop 'dm' since the DM always
 * controls. The "Specific" checklist is populated from campaign members.
 */
export function SharePicker({
  sharing,
  onChange,
  scopes = ['private', 'dm', 'users', 'all'],
  privateLabel,
}: {
  sharing: Sharing;
  onChange: (s: Sharing) => void;
  scopes?: ShareScope[];
  privateLabel?: string;
}) {
  const members = useStore((s) => s.members);
  const self = useStore((s) => s.self);
  const others = members.filter((m) => m.userId !== self?.userId);

  function setScope(scope: ShareScope) {
    onChange({ scope, userIds: scope === 'users' ? sharing.userIds : [] });
  }
  function toggleUser(id: string) {
    const has = sharing.userIds.includes(id);
    onChange({
      scope: 'users',
      userIds: has ? sharing.userIds.filter((x) => x !== id) : [...sharing.userIds, id],
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex overflow-hidden rounded-[9px] border border-[var(--border)]">
        {scopes.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            className="flex-1 px-2 py-1.5 text-xs transition-colors"
            style={sharing.scope === s
              ? { background: 'var(--ember)', color: 'var(--ink)', fontWeight: 600 }
              : { color: 'var(--low)', background: 'transparent' }}
          >
            {s === 'private' && privateLabel ? privateLabel : LABELS[s]}
          </button>
        ))}
      </div>

      {sharing.scope === 'users' && (
        <div
          className="flex flex-col gap-1 rounded-[9px] p-2 max-h-40 overflow-y-auto"
          style={{ background: '#100c0a', border: '1px solid var(--border)' }}
        >
          {others.length === 0 ? (
            <p className="text-xs italic" style={{ color: 'var(--faint)' }}>No other members yet.</p>
          ) : (
            others.map((m) => (
              <label key={m.userId} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--mid)' }}>
                <input
                  type="checkbox"
                  checked={sharing.userIds.includes(m.userId)}
                  onChange={() => toggleUser(m.userId)}
                  style={{ accentColor: 'var(--ember)' }}
                />
                {m.username}
                {m.role === 'dm' && <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--faint)' }}>DM</span>}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Plain-English summary of who can see/control an entity. */
export function describeSharing(sharing: Sharing, members: { userId: string; username: string }[]): string {
  switch (sharing.scope) {
    case 'all':
      return 'Everyone';
    case 'dm':
      return 'DM only';
    case 'private':
      return 'Private';
    case 'users': {
      if (sharing.userIds.length === 0) return 'Private';
      const names = sharing.userIds.map((id) => members.find((m) => m.userId === id)?.username ?? '?');
      return names.length <= 2 ? names.join(', ') : `${names.length} people`;
    }
  }
}

/** Small inline badge showing the share state. */
export function ShareBadge({ sharing }: { sharing: Sharing }) {
  const members = useStore((s) => s.members);
  const shared = sharing.scope !== 'private';
  return (
    <span
      className="text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5"
      style={shared
        ? { background: '#69b7a61a', color: 'var(--teal)' }
        : { background: 'var(--raised)', color: 'var(--low)' }}
      title={describeSharing(sharing, members)}
    >
      {describeSharing(sharing, members)}
    </span>
  );
}
