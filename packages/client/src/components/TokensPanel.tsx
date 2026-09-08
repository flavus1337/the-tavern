import { useState, type KeyboardEvent } from 'react';
import { useStore } from '../store';
import { tokenControl, stepToken } from '../lib/tokenControl';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { SaveFeedback, useSaveCommand } from './SaveFeedback';

/** Equivalent controls for tokens that are small, off-screen, or used without a pointer. */
export function TokensPanel() {
  const tokens = useStore((state) => state.tokens);
  const selectedId = useStore((state) => state.selectedTokenId);
  const self = useStore((state) => state.self);
  const connected = useStore((state) => state.connection === 'open');
  const grid = useStore((state) => state.grid);
  const [search, setSearch] = useState('');
  const save = useSaveCommand();
  const token = tokens.find((item) => item.id === selectedId);
  const access = token ? tokenControl(token, self?.userId ?? null, self?.role === 'dm') : null;
  const movementAvailable = !!access?.move && connected && !save.blocked;
  const canMove = movementAvailable && !save.saving;
  const filtered = tokens.filter((item) => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  async function move(dx: number, dy: number) {
    if (!canMove) return;
    const state = useStore.getState();
    const current = state.tokens.find((item) => item.id === selectedId);
    if (!current) return;
    const position = stepToken(current, state.grid, dx, dy);
    await save.run({ type: 'tokenMove', tokenId: current.id, ...position });
  }
  function moveByKey(event: KeyboardEvent<HTMLDivElement>) {
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    if (!event.repeat) void move(...direction);
  }
  return <section className="flex flex-col gap-3 p-3 min-h-0 overflow-y-auto">
    <label className="text-xs" htmlFor="token-search">Find a token</label>
    <Input id="token-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Token name" />
    <label className="text-xs" htmlFor="table-token-list">Tokens on the table ({filtered.length})</label>
    <select id="table-token-list" size={7} value={selectedId ?? ''} disabled={save.saving || save.blocked}
      onChange={(event) => { useStore.getState().setSelectedTokenId(event.target.value); save.clearError(); }}
      className="w-full min-h-40 rounded-lg border p-1 text-sm"
      style={{ background: 'var(--surface2)', color: 'var(--hi)', borderColor: 'var(--border)' }}>
      <option value="" disabled>Select a token</option>
      {filtered.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
    {token && <>
      <p className="text-sm font-semibold" style={{ color: 'var(--hi)' }}>{token.name}</p>
      <p className="text-xs" style={{ color: 'var(--low)' }}>Position {Math.round(token.x)}, {Math.round(token.y)}
        {token.hp !== null && token.maxHp !== null ? ` · HP ${token.hp}/${token.maxHp}` : ''}
        {token.conditions.length ? ` · ${token.conditions.join(', ')}` : ''}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!access?.edit} onClick={() => useStore.getState().openTokenPanel(token.id)}>Edit token</Button>
      </div>
      <div role="group" aria-label={`Move ${token.name} by one grid cell`} onKeyDown={moveByKey}
        className="grid grid-cols-3 gap-2 self-start">
        <span /><Button size="sm" disabled={!movementAvailable} aria-disabled={!canMove} className={save.saving ? 'opacity-50' : undefined} onClick={() => void move(0, -1)} aria-label="Move token up">↑ Up</Button><span />
        <Button size="sm" disabled={!movementAvailable} aria-disabled={!canMove} className={save.saving ? 'opacity-50' : undefined} onClick={() => void move(-1, 0)} aria-label="Move token left">← Left</Button>
        <Button size="sm" disabled={!movementAvailable} aria-disabled={!canMove} className={save.saving ? 'opacity-50' : undefined} onClick={() => void move(0, 1)} aria-label="Move token down">↓ Down</Button>
        <Button size="sm" disabled={!movementAvailable} aria-disabled={!canMove} className={save.saving ? 'opacity-50' : undefined} onClick={() => void move(1, 0)} aria-label="Move token right">Right →</Button>
      </div>
      <p className="text-xs" style={{ color: 'var(--low)' }}>{access?.move
        ? `Focus a move button and use arrow keys. Each move is one cell (${grid.cell}px), confirmed by the table.`
        : 'The owner or DM can grant you control of this token.'}</p>
    </>}
    <SaveFeedback save={save} conflicts={[]} latest={{}} onUseTable={() => {}} onKeepChanges={() => {}} />
    <Button size="sm" variant="secondary" onClick={() => useStore.getState().openTokenPanel(null)}>Add token</Button>
  </section>;
}
