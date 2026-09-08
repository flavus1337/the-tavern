import { clampToField } from '@vtt/shared';
import type { TokenView, GridState } from '@vtt/shared';
import { snapToGrid } from './grid';

export const TOKEN_CELLS: Record<TokenView['size'], number> = { S: 1, M: 1, L: 2, H: 3 };
export function tokenControl(token: TokenView, userId: string | null, isDm: boolean) {
  const mine = !!token.ownerUserId && token.ownerUserId === userId;
  const edit = isDm || mine;
  const move = edit || token.sharing.scope === 'all' ||
    (token.sharing.scope === 'users' && !!userId && token.sharing.userIds.includes(userId));
  return { mine, edit, move };
}
export function stepToken(token: TokenView, grid: GridState, dx: number, dy: number) {
  let x = token.x + dx * grid.cell, y = token.y + dy * grid.cell;
  if (grid.snap) { x = snapToGrid(x, grid.cell, grid.offsetX); y = snapToGrid(y, grid.cell, grid.offsetY); }
  const size = TOKEN_CELLS[token.size] * grid.cell;
  return clampToField(x, y, size, size, grid.cell);
}
