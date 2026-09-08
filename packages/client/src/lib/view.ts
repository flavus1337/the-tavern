import type { GridState } from '@vtt/shared';
import { useStore } from '../store';
import { snapToGrid } from './grid';

/** Board-space coordinate at the centre of the visible canvas. */
export function viewportCenterBoard(): { x: number; y: number } {
  const el = document.querySelector('[aria-label="Campaign map canvas"]') as HTMLElement | null;
  const view = useStore.getState().boardView;
  const rect = el?.getBoundingClientRect();
  const cx = rect ? rect.width / 2 : 400;
  const cy = rect ? rect.height / 2 : 300;
  return { x: (cx - view.x) / view.scale, y: (cy - view.y) / view.scale };
}

/** Top-left for a w×h thing centred in the current view, snapped to the grid. */
export function centredPlacement(w: number, h: number, grid: Pick<GridState, 'cell' | 'offsetX' | 'offsetY'> = useStore.getState().grid): { x: number; y: number } {
  const c = viewportCenterBoard();
  return { x: snapToGrid(c.x - w / 2, grid.cell, grid.offsetX), y: snapToGrid(c.y - h / 2, grid.cell, grid.offsetY) };
}
