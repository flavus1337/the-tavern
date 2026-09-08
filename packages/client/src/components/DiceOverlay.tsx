import { useEffect, useRef, useState } from 'react';
import type { RollLogEntry, RollPart } from '@vtt/shared';
import { useStore } from '../store';
import type { DiceScene, DieTheme } from '../lib/dice3d';
import { diceDelay, countDiceTotal } from '../lib/dicePlayback';
import { diceGrid, DICE_SPACING, DICE_ROWGAP, DICE_PX_PER_UNIT } from '../lib/diceLayout';

const DIE_THEME: DieTheme = 'bone';

interface TallyRow { label: string; val: number; base: boolean }
interface Plan {
  sides: number;
  finals: number[];        // one entry per die shown — each die settles on its own roll
  keptIndex: number;       // the single kept die (for crit/fumble), or -1 if not applicable
  dropIndices: number[];   // dice greyed out (dropped by keep-highest/lowest)
  pairs: boolean;          // advantage/disadvantage: stack each throw as a 2-row column
  rows: TallyRow[];
  total: number;
  crit: boolean;
  fumble: boolean;
}

const MAX_DICE = 10; // cap how many dice we render in the row

/** Turn a resolved roll into the spin + tally choreography. Returns null for modifier-only rolls. */
function plan(entry: RollLogEntry): Plan | null {
  const dice = entry.parts.filter((p): p is Extract<RollPart, { kind: 'dice' }> => p.kind === 'dice');
  const primary = dice[0];
  if (!primary) return null;

  // Show one die per roll in the primary group (e.g. 3d20 → 3 dice), capped at MAX_DICE.
  const finals = primary.rolls.slice(0, MAX_DICE);
  const dropped = primary.dropped ?? [];
  const dropIndices = dropped.filter((i) => i < finals.length);
  const keptIndices = finals.map((_, i) => i).filter((i) => !dropIndices.includes(i));

  // Advantage/disadvantage = dice in pairs (roll two, keep one). Stack each throw
  // as a 2-row column with its kept die lit and dropped die greyed.
  const pairs = finals.length === 2 && dropIndices.length === 1;

  // crit / fumble only when a single d20 is the result (lone d20 or the kept die of adv/dis)
  const keptIndex = keptIndices.length === 1 ? keptIndices[0]! : -1;
  const keptVal = keptIndex >= 0 ? finals[keptIndex] : null;
  const crit = primary.sides === 20 && keptVal === 20;
  const fumble = primary.sides === 20 && keptVal === 1;

  // tally rows, in expression order; first row is the base
  const rows: TallyRow[] = [];
  for (const p of entry.parts) {
    if (p.kind === 'dice') {
      const kept = p.dropped ? p.rolls.filter((_, i) => !p.dropped!.includes(i)) : p.rolls;
      const sum = kept.reduce((a, b) => a + b, 0);
      const advLabel = p.dropped && p.rolls.length === 2 ? ' (kept)' : '';
      rows.push({ label: `${p.count}d${p.sides}${advLabel}`, val: p.negative ? -sum : sum, base: rows.length === 0 });
    } else {
      rows.push({ label: p.value >= 0 ? 'Modifier' : 'Penalty', val: p.value, base: rows.length === 0 });
    }
  }

  return { sides: primary.sides, finals, keptIndex, dropIndices, pairs, rows, total: entry.total, crit, fumble };
}

interface DiceRun { id: string; controller: AbortController; scene: DiceScene | null }

/** Server results are always in the log. Cinematic presentation is optional. */
export function DiceOverlay() {
  const rollQueue = useStore((s) => s.rollQueue);
  const diceDisplay = useStore((s) => s.diceDisplay);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [failed, setFailed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runRef = useRef<DiceRun | null>(null);
  const [active, setActive] = useState<{ entry: RollLogEntry; plan: Plan } | null>(null);
  const [shownRows, setShownRows] = useState(0);
  const [totalShown, setTotalShown] = useState<number | null>(null);
  const [showTotal, setShowTotal] = useState(false);
  const [outcome, setOutcome] = useState<'crit' | 'fumble' | null>(null);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => setFailed(false), [diceDisplay]);

  useEffect(() => {
    const entry = rollQueue[0];
    if (!entry) { setActive(null); return; }
    const p = plan(entry);
    if (diceDisplay !== 'cinematic' || reduced || failed || !p) {
      if (diceDisplay !== 'instant') useStore.getState().showRollToast(entry);
      useStore.getState().shiftRollQueue(entry.id);
      return;
    }
    const run: DiceRun = { id: entry.id, controller: new AbortController(), scene: null };
    runRef.current = run;
    setActive({ entry, plan: p });
    setShownRows(0); setTotalShown(null); setShowTotal(false); setOutcome(null);
    void play(entry, p, run);
    return () => {
      run.controller.abort();
      run.scene?.dispose();
      if (runRef.current === run) runRef.current = null;
    };
  }, [rollQueue, diceDisplay, reduced, failed]);

  async function play(entry: RollLogEntry, p: Plan, run: DiceRun) {
    const signal = run.controller.signal;
    try {
      await diceDelay(0, signal); // let the canvas mount
      const { DiceScene } = await import('../lib/dice3d');
      signal.throwIfAborted();
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('Dice canvas unavailable');
      const scene = new DiceScene(canvas);
      run.scene = scene;
      useStore.getState().dismissRollToast(entry.id);
      await scene.roll({ sides: p.sides, theme: DIE_THEME, finals: p.finals, pairs: p.pairs });
      signal.throwIfAborted();
      p.dropIndices.forEach((i) => scene.dropDie(i));
      if (p.crit) scene.setOutcome(p.keptIndex, 'crit');
      else if (p.fumble) scene.setOutcome(p.keptIndex, 'fumble');
      if (p.crit) setOutcome('crit');
      else if (p.fumble) setOutcome('fumble');
      for (let i = 0; i < p.rows.length; i++) {
        signal.throwIfAborted();
        setShownRows(i + 1);
        await diceDelay(230, signal);
      }
      setShowTotal(true);
      await countDiceTotal(p.total, setTotalShown, signal);
      await diceDelay(p.crit || p.fumble ? 2200 : 1400, signal);
    } catch {
      if (!signal.aborted) {
        useStore.getState().showRollToast(entry);
        setFailed(true);
      }
    } finally {
      run.scene?.dispose();
      if (runRef.current === run) {
        runRef.current = null;
        setActive(null);
        useStore.getState().shiftRollQueue(entry.id);
      }
    }
  }

  function dismiss() {
    const run = runRef.current;
    if (!run) return;
    run.controller.abort();
    run.scene?.dispose();
    runRef.current = null;
    setActive(null);
    useStore.getState().shiftRollQueue(run.id);
  }

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    const onResize = () => {
      try { runRef.current?.scene?.resize(); }
      catch { setFailed(true); }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); };
  }, [active]);

  if (!active) return failed ? <div role="status" className="fixed right-4 bottom-20 z-40 max-w-xs rounded-lg border p-3 text-xs"
    style={{ background: 'var(--surface2)', borderColor: 'var(--border)', color: 'var(--mid)' }}>
    3D dice are unavailable. Results appear in compact notifications and the log.
    <button type="button" className="mt-2 block underline" onClick={() => setFailed(false)}>Try 3D on the next roll</button>
  </div> : null;
  const { entry, plan: p } = active;
  const priv = entry.visibility === 'dm';
  const fx = outcome;
  const totalColor = fx === 'crit' ? 'var(--gold)' : fx === 'fumble' ? 'var(--garnet)' : 'var(--hi)';
  // Fixed die size: the canvas grows with the dice grid so dice never shrink.
  const grid = diceGrid(p.finals.length, p.pairs);
  const canvasW = Math.min(760, Math.round(grid.cols * DICE_SPACING * DICE_PX_PER_UNIT));
  const canvasH = Math.round(grid.rows * DICE_ROWGAP * DICE_PX_PER_UNIT);

  return (
    <div
      onClick={dismiss}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center cursor-pointer"
      style={{
        background: 'radial-gradient(120% 120% at 50% 42%,#1a0f08e0,#060403f5 70%)',
        backdropFilter: 'blur(7px) saturate(0.8)', WebkitBackdropFilter: 'blur(7px) saturate(0.8)',
        animation: 'glow-fade 0.3s reverse',
      }}
      role="status"
      aria-live="polite"
    >
      {/* crit / fumble burst */}
      {fx && (
        <div
          aria-hidden
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 560, height: 560, zIndex: -1,
            background: fx === 'crit'
              ? 'radial-gradient(circle,#e8b76555,transparent 62%)'
              : 'radial-gradient(circle,#b6485a4d,transparent 62%)',
          }}
        />
      )}

      <div className="flex flex-col items-center gap-1.5 text-center px-6" style={{ maxWidth: 560 }}>
        {/* roller banner */}
        <div
          className="flex items-center gap-2"
          style={{
            fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase',
            color: priv ? 'var(--low)' : 'var(--teal)', animation: 'ro-up 0.4s 0.05s ease both',
          }}
        >
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: priv ? 'var(--low)' : 'var(--teal)',
            boxShadow: priv ? 'none' : '0 0 8px var(--teal)',
          }} />
          {entry.username} rolled{priv ? ' · private' : ''}
        </div>

        <div style={{ fontFamily: 'var(--serif)', fontSize: 30, fontWeight: 600, color: 'var(--hi)', letterSpacing: '-0.01em', animation: 'ro-up 0.4s 0.12s ease both' }}>
          {entry.label || `${entry.expression} Roll`}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--low)', letterSpacing: '0.04em', marginBottom: 4, animation: 'ro-up 0.4s 0.18s ease both' }}>
          {entry.expression}
        </div>

        {/* 3D dice */}
        <canvas key={entry.id} ref={canvasRef} style={{ width: canvasW, height: canvasH, maxWidth: '92vw', margin: '4px 0' }} />

        {/* tally */}
        <div className="flex flex-col gap-0.5" style={{ width: 280, marginTop: 6 }}>
          {p.rows.slice(0, shownRows).map((r, i) => {
            const sign = r.base ? '' : r.val >= 0 ? '+' : '−';
            const mag = r.base ? r.val : Math.abs(r.val);
            return (
              <div
                key={i}
                className="flex justify-between items-baseline rounded-lg"
                style={{
                  padding: '7px 14px', fontSize: 14, color: r.base ? 'var(--hi)' : 'var(--mid)',
                  background: r.base ? '#ffffff08' : 'transparent', fontWeight: r.base ? 600 : 400,
                  animation: 'ro-up 0.28s ease both',
                }}
              >
                <span style={{ fontFamily: 'var(--sans)' }}>{r.label}</span>
                <span style={{
                  fontFamily: 'var(--mono)', fontWeight: 600,
                  fontSize: r.base ? 15 : 14,
                  color: r.base ? 'var(--gold)' : !r.base && r.val < 0 ? 'var(--garnet)' : 'var(--hi)',
                }}>
                  {sign}{mag}
                </span>
              </div>
            );
          })}
        </div>

        {/* total */}
        {showTotal && (
          <>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--faint)', marginTop: 16 }}>
              Total
            </div>
            <div style={{
              fontFamily: 'var(--serif)', fontWeight: 700, fontSize: 84, lineHeight: 0.95, color: totalColor,
              textShadow: fx === 'crit' ? '0 0 40px #e8b76577' : fx === 'fumble' ? '0 0 36px #b6485a66' : '0 4px 30px #000',
              animation: 'ro-pop 0.45s cubic-bezier(.3,1.6,.5,1)',
            }}>
              {totalShown ?? '—'}
            </div>
            {fx && (
              <div style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 20, marginTop: 2, color: fx === 'crit' ? 'var(--gold)' : 'var(--garnet)' }}>
                {fx === 'crit' ? 'Critical Hit!' : 'Critical Miss'}
              </div>
            )}
          </>
        )}

        <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--faint)', marginTop: 24, animation: 'ro-up 0.4s 1.4s ease both' }}>
          Click anywhere to dismiss
        </div>
      </div>
    </div>
  );
}
