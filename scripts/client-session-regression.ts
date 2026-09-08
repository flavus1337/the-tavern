import assert from 'node:assert/strict';
import { clockSample, playbackPosition } from '../packages/client/src/lib/media';
import { calibratedGrid, gridOffset, snapToGrid } from '../packages/client/src/lib/grid';

import { centredPlacement } from '../packages/client/src/lib/view';
import { useStore } from '../packages/client/src/store';

const grid = calibratedGrid(101, 109, 88, 2);
assert.deepEqual(grid, { cell: 44, offsetX: 13, offsetY: 21, visible: true });
assert.deepEqual(calibratedGrid(101, 109, 88.9, 2), grid, 'Calibrate from the final rounded cell size');
assert.equal(calibratedGrid(101, 109, 2, 2).cell, 8);
assert.equal(calibratedGrid(101, 109, 2000, 2).cell, 512);
assert.equal(gridOffset(-31, 44), 13);
assert.equal(gridOffset(109, 44), 21);
for (const scale of [0.2, 0.5, 1, 2, 4]) {
  for (const [point, offset] of [[95, 13], [119, 21], [-20, 13]]) {
    const snapped = snapToGrid(point!, grid.cell, offset!);
    const tileIndex = (snapped - gridOffset(offset!, grid.cell)) / grid.cell;
    assert.equal(Number.isInteger(tileIndex), true);
    const pan = 37;
    const drawnIntersection = pan + (gridOffset(offset!, grid.cell) + tileIndex * grid.cell) * scale;
    assert.equal(pan + snapped * scale, drawnIntersection, 'Rendered origin and snapped positions agree at every zoom');
  }
}
console.log('Client session regression passed: calibrated grid, normalized offsets, and snapped intersections at five zoom levels.');

Object.assign(globalThis, { document: { querySelector: () => ({ getBoundingClientRect: () => ({ width: 800, height: 600 }) }) } });
useStore.setState({ grid: { ...useStore.getState().grid, ...grid }, boardView: { x: 0, y: 0, scale: 1 } });
assert.deepEqual(centredPlacement(88, 88), { x: 365, y: 241 });
assert.deepEqual(centredPlacement(88, 88, { cell: 44, offsetX: 0, offsetY: 0 }), { x: 352, y: 264 });
console.log('PASS centered placement uses the current or explicitly requested reset grid.');

const accepted = { action: 'play', time: 42, atMs: 10_000 };
// Two browsers with different wall clocks and opposite 20/140 ms transit delays.
const skewA = 5_000, skewB = -8_000;
const sampleA = clockSample(10_000 + skewA, 10_160 + skewA, 10_020);
const sampleB = clockSample(10_000 + skewB, 10_160 + skewB, 10_140);
const positionA = playbackPosition(accepted, sampleA.offset, 15_000 + skewA);
const positionB = playbackPosition(accepted, sampleB.offset, 15_000 + skewB);
const settledDifferenceMs = Math.abs(positionA - positionB) * 1000;
assert.ok(settledDifferenceMs < 250);
assert.equal(playbackPosition({ ...accepted, action: 'pause' }, sampleA.offset, 50_000), 42);
assert.equal(playbackPosition(accepted, 0, 9_000), 42, 'Do not move before an accepted playhead');
console.log(`PASS modeled playhead difference under opposing 20/140ms delays and clock skew: ${settledDifferenceMs.toFixed(0)}ms (not a browser measurement).`);
