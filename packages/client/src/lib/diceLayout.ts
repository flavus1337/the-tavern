// Pure dice-grid geometry, shared by the overlay (canvas sizing) and the 3D
// scene (camera + placement). No three import here, so the overlay can size the
// canvas without pulling three.js into the main bundle.

export const MAX_DICE_COLS = 5;     // dice per row before wrapping to a new row
export const DICE_SPACING = 3.1;    // world units between die centres (x)
export const DICE_ROWGAP = 3.3;     // world units between die centres (y)
export const DICE_PX_PER_UNIT = 46; // on-screen px per world unit → fixed die size

/**
 * Grid for `n` dice. Normal rolls wrap left-to-right at MAX_DICE_COLS. Advantage
 * pairs put each throw in its own column (2 stacked rows), wrapping by throw.
 */
export function diceGrid(n: number, pairs: boolean): { cols: number; rows: number } {
  if (pairs) {
    const throws = Math.max(1, Math.ceil(n / 2));
    const throwRows = Math.ceil(throws / MAX_DICE_COLS);
    return { cols: Math.ceil(throws / throwRows), rows: 2 * throwRows };
  }
  // balance rows so e.g. 6 dice → 3+3, not 5+1
  const rows = Math.ceil(Math.max(1, n) / MAX_DICE_COLS);
  return { cols: Math.ceil(Math.max(1, n) / rows), rows };
}
