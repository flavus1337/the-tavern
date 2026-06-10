// Dice expression parser — pure, RNG injected.
// Grammar: expression = term (('+'|'-') term)*
//   term = NdX[kh|kl] | dX[kh|kl] (N defaults 1) | integer modifier
//   X ∈ {4,6,8,10,12,20,100}
//   kh suffix = keep highest (rolls N dice, keeps the single highest result)
//   kl suffix = keep lowest  (rolls N dice, keeps the single lowest result)
// Limits: N ≤ 100 per term, ≤ 10 terms total, modifier |value| ≤ 1000.
// Case-insensitive, whitespace-tolerant.

import type { DieSides, RollPart } from './protocol.js';

const VALID_SIDES: ReadonlySet<number> = new Set([4, 6, 8, 10, 12, 20, 100]);
const MAX_DICE_PER_TERM = 100;
const MAX_TERMS = 10;
const MAX_MODIFIER = 1000;

export interface ParsedTermDice {
  kind: 'dice';
  count: number;
  sides: DieSides;
  negative: boolean;
  /** When true: roll `count` dice but only keep the single highest result. */
  keepHighest?: boolean;
  keepLowest?: boolean;
}

export interface ParsedTermModifier {
  kind: 'modifier';
  /** Signed value; negative terms are already negated. */
  value: number;
}

export type ParsedTerm = ParsedTermDice | ParsedTermModifier;

export interface ParsedRoll {
  terms: ParsedTerm[];
  normalized: string;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

type TokenSign = '+' | '-';

/**
 * Tokenizes and parses a dice expression.
 * Returns ok=true with a ParsedRoll or ok=false with an error message.
 */
export function parseDiceExpression(
  expr: string,
): { ok: true; roll: ParsedRoll } | { ok: false; error: string } {
  // Normalize: lowercase, collapse whitespace inside, trim.
  const raw = expr.toLowerCase().replace(/\s+/g, '').trim();

  if (raw.length === 0) {
    return { ok: false, error: 'empty expression' };
  }

  const terms: ParsedTerm[] = [];

  // We iterate through the string consuming term by term.
  // A term starts with an optional sign (implied '+' for the first token).
  let pos = 0;

  const peek = () => (pos < raw.length ? raw[pos] : null);

  function consumeSign(): TokenSign {
    const ch = peek();
    if (ch === '+' || ch === '-') {
      pos++;
      return ch;
    }
    return '+';
  }

  function consumeDigits(): string {
    let digits = '';
    while (pos < raw.length && raw[pos] !== undefined && /\d/.test(raw[pos] as string)) {
      digits += raw[pos];
      pos++;
    }
    return digits;
  }

  // First term may not have a leading sign.
  let firstTerm = true;

  while (pos < raw.length) {
    if (terms.length >= MAX_TERMS) {
      return { ok: false, error: `too many terms (max ${MAX_TERMS})` };
    }

    // Consume sign (mandatory between terms, optional at start).
    let sign: TokenSign;
    if (!firstTerm) {
      const ch = peek();
      if (ch !== '+' && ch !== '-') {
        return { ok: false, error: `expected '+' or '-' at position ${pos}` };
      }
      sign = consumeSign();
    } else {
      sign = consumeSign(); // handles optional leading sign
      firstTerm = false;
    }

    const negative = sign === '-';

    // Look ahead to determine term type.
    // Cases: dX[kh], NdX[kh], N (modifier)
    const leadingDigits = consumeDigits();

    if (peek() === 'd') {
      // Dice term: [N]dX[kh]
      pos++; // consume 'd'
      const sidesStr = consumeDigits();

      if (sidesStr.length === 0) {
        return { ok: false, error: `missing die size after 'd' at position ${pos}` };
      }

      const sides = parseInt(sidesStr, 10);
      const count = leadingDigits.length > 0 ? parseInt(leadingDigits, 10) : 1;

      if (!VALID_SIDES.has(sides)) {
        return {
          ok: false,
          error: `invalid die size d${sides}; allowed: 4,6,8,10,12,20,100`,
        };
      }

      if (count < 1) {
        return { ok: false, error: `dice count must be ≥ 1` };
      }

      if (count > MAX_DICE_PER_TERM) {
        return { ok: false, error: `too many dice in one term (max ${MAX_DICE_PER_TERM})` };
      }

      // Check for optional 'kh' / 'kl' suffix (keep highest / lowest)
      let keepHighest = false;
      let keepLowest = false;
      if (pos + 1 < raw.length && raw[pos] === 'k' && raw[pos + 1] === 'h') {
        keepHighest = true;
        pos += 2; // consume 'kh'
      } else if (pos + 1 < raw.length && raw[pos] === 'k' && raw[pos + 1] === 'l') {
        keepLowest = true;
        pos += 2; // consume 'kl'
      }

      const term: ParsedTermDice = { kind: 'dice', count, sides: sides as DieSides, negative };
      if (keepHighest) term.keepHighest = true;
      if (keepLowest) term.keepLowest = true;
      terms.push(term);
    } else {
      // Modifier term.
      if (leadingDigits.length === 0) {
        return { ok: false, error: `unexpected character at position ${pos}` };
      }

      const absValue = parseInt(leadingDigits, 10);

      if (absValue > MAX_MODIFIER) {
        return { ok: false, error: `modifier value ${absValue} exceeds max ${MAX_MODIFIER}` };
      }

      const value = negative ? -absValue : absValue;
      terms.push({ kind: 'modifier', value });
    }
  }

  if (terms.length === 0) {
    return { ok: false, error: 'no terms parsed' };
  }

  const roll: ParsedRoll = {
    terms,
    normalized: normalizeExpression({ terms, normalized: '' }),
  };
  // Fix: compute normalized properly after building terms.
  return { ok: true, roll: { ...roll, normalized: normalizeExpression(roll) } };
}

// ---------------------------------------------------------------------------
// Normalizer
// ---------------------------------------------------------------------------

export function normalizeExpression(roll: ParsedRoll): string {
  const parts: string[] = [];

  for (let i = 0; i < roll.terms.length; i++) {
    const term = roll.terms[i];
    if (term === undefined) continue;

    if (term.kind === 'dice') {
      const suffix = term.keepHighest ? 'kh' : term.keepLowest ? 'kl' : '';
      const diceStr = `${term.count}d${term.sides}${suffix}`;
      if (i === 0) {
        parts.push(term.negative ? `-${diceStr}` : diceStr);
      } else {
        parts.push(term.negative ? `-${diceStr}` : `+${diceStr}`);
      }
    } else {
      // modifier
      if (i === 0) {
        parts.push(String(term.value));
      } else {
        parts.push(term.value >= 0 ? `+${term.value}` : String(term.value));
      }
    }
  }

  return parts.join('');
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Executes a parsed roll with the provided RNG.
 * rng(maxExclusive) must return an integer in [0, maxExclusive).
 * Die result = rng(sides) + 1.
 * Negative dice terms: the dice part carries `negative: true`; the rolled
 * values are kept positive in the `rolls` array, and the contribution to
 * total is subtracted.
 *
 * keepHighest/keepLowest terms: all N dice are rolled and appear in `rolls`,
 * but only the highest (kh) or lowest (kl) contributes to the total. `dropped`
 * contains the 0-based indices of dice that were dropped.
 */
export function executeRoll(
  roll: ParsedRoll,
  rng: (maxExclusive: number) => number,
): { parts: RollPart[]; total: number } {
  const parts: RollPart[] = [];
  let total = 0;

  for (const term of roll.terms) {
    if (term.kind === 'dice') {
      const rolls: number[] = [];
      for (let i = 0; i < term.count; i++) {
        rolls.push(rng(term.sides) + 1);
      }

      if (term.keepHighest || term.keepLowest) {
        // Find the index of the kept die (last occurrence if tied).
        let keptIdx = 0;
        for (let i = 1; i < rolls.length; i++) {
          const better = term.keepHighest
            ? (rolls[i] as number) >= (rolls[keptIdx] as number)
            : (rolls[i] as number) <= (rolls[keptIdx] as number);
          if (better) keptIdx = i;
        }
        const keptValue = rolls[keptIdx] as number;
        const dropped = rolls.map((_, i) => i).filter((i) => i !== keptIdx);

        parts.push({
          kind: 'dice',
          count: term.count,
          sides: term.sides,
          rolls,
          negative: term.negative,
          dropped,
        });
        total += term.negative ? -keptValue : keptValue;
      } else {
        const diceSum = rolls.reduce((s, v) => s + v, 0);
        parts.push({
          kind: 'dice',
          count: term.count,
          sides: term.sides,
          rolls,
          negative: term.negative,
        });
        total += term.negative ? -diceSum : diceSum;
      }
    } else {
      parts.push({ kind: 'modifier', value: term.value });
      total += term.value;
    }
  }

  return { parts, total };
}
