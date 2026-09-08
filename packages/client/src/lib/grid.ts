/** Equivalent grid origins stay within one cell, including negative offsets. */
export function gridOffset(offset: number, cell: number): number {
  return ((offset % cell) + cell) % cell;
}

export function snapToGrid(value: number, cell: number, offset: number): number {
  const origin = gridOffset(offset, cell);
  return Math.round((value - origin) / cell) * cell + origin;
}

export function calibratedGrid(x: number, y: number, width: number, cells: number) {
  // Match the server's cell bounds before calculating either origin.
  const cell = Math.min(512, Math.max(8, Math.round(width / Math.max(1, cells))));
  return { cell, offsetX: gridOffset(x, cell), offsetY: gridOffset(y, cell), visible: true };
}

/** Dense overview grids recede while normal tactical cells keep their contrast. */
export function gridOpacity(cell: number, scale: number): number {
  return Math.min(1, Math.max(0.12, cell * scale / 24));
}
