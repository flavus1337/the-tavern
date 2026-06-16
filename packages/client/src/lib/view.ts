import { useStore } from '../store';

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
export function centredPlacement(w: number, h: number): { x: number; y: number } {
  const grid = useStore.getState().grid;
  const c = viewportCenterBoard();
  const snap = (v: number) => Math.round(v / grid.cell) * grid.cell;
  return { x: snap(c.x - w / 2), y: snap(c.y - h / 2) };
}
