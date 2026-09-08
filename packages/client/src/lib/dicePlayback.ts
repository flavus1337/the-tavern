export type DiceDisplay = 'instant' | 'compact' | 'cinematic';
const PREFERENCE_KEY = 'tavern.diceDisplay';
export function readDiceDisplay(): DiceDisplay {
  try {
    const value = localStorage.getItem(PREFERENCE_KEY);
    if (value === 'instant' || value === 'cinematic') return value;
  } catch { /* Storage can be disabled; the local preference still works. */ }
  return 'compact';
}
export function persistDiceDisplay(value: DiceDisplay) {
  try { localStorage.setItem(PREFERENCE_KEY, value); } catch { /* Keep the in-memory preference. */ }
}

/** Abort settles pending waits immediately instead of leaving a dismissed roll running. */
export function diceDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function countDiceTotal(total: number, publish: (value: number) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const start = performance.now();
    let frame = 0;
    const abort = () => { cancelAnimationFrame(frame); reject(signal.reason); };
    const step = (time: number) => {
      const progress = Math.min(1, (time - start) / 560);
      publish(Math.round((1 - (1 - progress) ** 3) * total));
      if (progress < 1) frame = requestAnimationFrame(step);
      else { signal.removeEventListener('abort', abort); resolve(); }
    };
    signal.addEventListener('abort', abort, { once: true });
    frame = requestAnimationFrame(step);
  });
}
