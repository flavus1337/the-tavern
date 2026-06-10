import crypto from 'node:crypto';
import { parseDiceExpression, executeRoll, randomId } from '@vtt/shared';
import type { RollLogEntry, RollVisibility } from '@vtt/shared';

export function roll(
  expression: string,
  opts: {
    userId: string;
    username: string;
    label?: string;
    visibility: RollVisibility;
  },
): { ok: true; entry: RollLogEntry } | { ok: false; error: string } {
  const parsed = parseDiceExpression(expression);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { parts, total } = executeRoll(parsed.roll, (max) => crypto.randomInt(max));

  const entry: RollLogEntry = {
    id: randomId('roll'),
    ts: new Date().toISOString(),
    userId: opts.userId,
    username: opts.username,
    expression: parsed.roll.normalized,
    label: opts.label,
    parts,
    total,
    visibility: opts.visibility,
  };

  return { ok: true, entry };
}
