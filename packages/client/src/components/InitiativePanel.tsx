import type { ClientMessage, InitiativeState, InitiativeEntry } from '@vtt/shared';
import { randomId } from '@vtt/shared';
import { useStore } from '../store';
import { sortedInitiative, activeEntry } from '../lib/initiative';

function sendWs(msg: ClientMessage): void {
  const conn = (window as unknown as { __vttConn?: { send: (msg: ClientMessage) => void } }).__vttConn;
  conn?.send(msg);
}

/**
 * Initiative + turn tracker. The turn order is visible to everyone; only the DM
 * gets the controls (start/advance, add tokens, roll, edit, clear). The DM sends
 * the whole InitiativeState on every change (setInitiative is DM-only server-side).
 */
export function InitiativePanel() {
  const initiative = useStore((s) => s.initiative);
  const tokens = useStore((s) => s.tokens);
  const self = useStore((s) => s.self);
  const isDm = self?.role === 'dm';

  const order = sortedInitiative(initiative);
  const active = activeEntry(initiative);
  const update = (next: InitiativeState) => sendWs({ type: 'setInitiative', initiative: next });

  // DM actions ------------------------------------------------------------
  function start() {
    update({ ...initiative, active: true, round: Math.max(1, initiative.round), turnIndex: 0 });
  }
  function end() {
    update({ ...initiative, active: false });
  }
  function step(dir: 1 | -1) {
    const n = order.length;
    if (n === 0) return;
    let idx = initiative.turnIndex + dir;
    let round = initiative.round;
    if (idx >= n) { idx = 0; round += 1; }
    if (idx < 0) { idx = n - 1; round = Math.max(1, round - 1); }
    update({ ...initiative, active: true, turnIndex: idx, round });
  }
  function addAllTokens() {
    const have = new Set(initiative.entries.map((e) => e.tokenId));
    const additions: InitiativeEntry[] = tokens
      .filter((t) => !have.has(t.id))
      .map((t) => ({ id: randomId('ini'), tokenId: t.id, name: t.name, initiative: 0, ownerUserId: t.ownerUserId }));
    if (additions.length === 0) return;
    update({ ...initiative, entries: [...initiative.entries, ...additions] });
  }
  function rollAll() {
    const entries = initiative.entries.map((e) => {
      const tok = e.tokenId ? tokens.find((t) => t.id === e.tokenId) : undefined;
      const dex = tok?.statBlock?.dex ?? null;
      const mod = dex != null ? Math.floor((dex - 10) / 2) : 0;
      return { ...e, initiative: 1 + Math.floor(Math.random() * 20) + mod };
    });
    update({ ...initiative, entries });
  }
  function setEntryInit(id: string, value: number) {
    update({ ...initiative, entries: initiative.entries.map((e) => (e.id === id ? { ...e, initiative: value } : e)) });
  }
  function removeEntry(id: string) {
    update({ ...initiative, entries: initiative.entries.filter((e) => e.id !== id) });
  }
  function clearAll() {
    update({ active: false, round: 0, turnIndex: 0, entries: [] });
  }

  const btn = (label: string, onClick: () => void, opts: { primary?: boolean; disabled?: boolean } = {}) => (
    <button
      type="button"
      onClick={onClick}
      disabled={opts.disabled}
      className="px-2.5 py-1.5 text-xs rounded-[7px] transition-colors disabled:opacity-40"
      style={{
        border: '1px solid var(--border)', cursor: 'pointer', whiteSpace: 'nowrap',
        background: opts.primary ? 'var(--ember)' : 'var(--raised)',
        color: opts.primary ? 'var(--ink)' : 'var(--mid)',
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header / round */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <p className="eyebrow" style={{ margin: 0 }}>Initiative</p>
        {initiative.active && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ember)' }}>Round {initiative.round}</span>
        )}
      </div>

      {/* DM controls */}
      {isDm && (
        <div className="flex flex-wrap gap-1.5 px-4 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          {!initiative.active
            ? btn('▶ Start', start, { primary: true, disabled: order.length === 0 })
            : btn('■ End', end)}
          {btn('‹ Prev', () => step(-1), { disabled: order.length === 0 })}
          {btn('Next ›', () => step(1), { disabled: order.length === 0 })}
          {btn('+ Tokens', addAllTokens)}
          {btn('⤳ Roll', rollAll, { disabled: order.length === 0 })}
          {btn('Clear', clearAll, { disabled: order.length === 0 })}
        </div>
      )}

      {/* Order */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {order.length === 0 ? (
          <p className="px-4 py-6 text-sm" style={{ color: 'var(--low)' }}>
            {isDm ? 'No combatants yet. Add tokens, roll, then start combat.' : 'No combat in progress.'}
          </p>
        ) : (
          <ul className="flex flex-col">
            {order.map((e) => {
              const isActive = active?.id === e.id;
              return (
                <li
                  key={e.id}
                  className="flex items-center gap-2 px-4 py-2"
                  style={{
                    borderBottom: '1px solid var(--border-soft)',
                    background: isActive ? '#e8b76514' : 'transparent',
                    borderLeft: `3px solid ${isActive ? 'var(--gold)' : 'transparent'}`,
                  }}
                >
                  <span style={{
                    fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 14, width: 26, textAlign: 'center',
                    color: isActive ? 'var(--gold)' : 'var(--mid)',
                  }}>
                    {e.initiative}
                  </span>
                  <span className="flex-1 truncate text-sm" style={{ color: isActive ? 'var(--hi)' : 'var(--mid)' }}>
                    {isActive && <span style={{ color: 'var(--gold)' }}>▶ </span>}
                    {e.name}
                  </span>
                  {isDm && (
                    <>
                      <input
                        type="number"
                        value={e.initiative}
                        onChange={(ev) => setEntryInit(e.id, Number(ev.target.value))}
                        aria-label={`${e.name} initiative`}
                        className="w-12 px-1.5 py-1 text-xs text-center rounded-[6px]"
                        style={{ background: '#100c0a', border: '1px solid var(--border)', color: 'var(--hi)' }}
                      />
                      <button
                        type="button"
                        onClick={() => removeEntry(e.id)}
                        aria-label={`Remove ${e.name}`}
                        className="px-1.5 py-1 text-xs rounded-[6px]"
                        style={{ background: 'transparent', color: 'var(--low)', border: 'none', cursor: 'pointer' }}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
