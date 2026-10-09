/**
 * The selection engine for EXPERIMENT 001.
 *
 * The matrix is fixed and public. Each selection locks its row and column, so
 * a completed game always contains exactly one cell from every row and every
 * column. Because value(row, col) = 4·row + col + 1, any such set sums to
 * 4·(0+1+2+3) + (0+1+2+3) + 4 = 34. Nothing here is hidden or manipulated.
 */

export const SIZE = 4;
export const REQUIRED_SELECTIONS = SIZE;

export const MATRIX: readonly (readonly number[])[] = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
];

export interface Cell {
  readonly row: number;
  readonly col: number;
}

export interface GameState {
  /** Ordered list of chosen cells, oldest first. */
  readonly selections: readonly Cell[];
}

export type SelectResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: "out-of-bounds" | "already-selected" | "locked" | "complete" };

export const INITIAL_GAME: GameState = { selections: [] };

export function valueOf(cell: Cell): number {
  return MATRIX[cell.row][cell.col];
}

export function inBounds(cell: Cell): boolean {
  return (
    Number.isInteger(cell.row) &&
    Number.isInteger(cell.col) &&
    cell.row >= 0 &&
    cell.row < SIZE &&
    cell.col >= 0 &&
    cell.col < SIZE
  );
}

export function isSelected(state: GameState, cell: Cell): boolean {
  return state.selections.some((s) => s.row === cell.row && s.col === cell.col);
}

/** A cell is locked when it shares a row or column with an existing selection (and is not itself selected). */
export function isLocked(state: GameState, cell: Cell): boolean {
  if (isSelected(state, cell)) return false;
  return state.selections.some((s) => s.row === cell.row || s.col === cell.col);
}

export function isComplete(state: GameState): boolean {
  return state.selections.length >= REQUIRED_SELECTIONS;
}

export function isAvailable(state: GameState, cell: Cell): boolean {
  return inBounds(cell) && !isComplete(state) && !isSelected(state, cell) && !isLocked(state, cell);
}

export function availableCells(state: GameState): Cell[] {
  const cells: Cell[] = [];
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      if (isAvailable(state, { row, col })) cells.push({ row, col });
    }
  }
  return cells;
}

export function select(state: GameState, cell: Cell): SelectResult {
  if (!inBounds(cell)) return { ok: false, reason: "out-of-bounds" };
  if (isComplete(state)) return { ok: false, reason: "complete" };
  if (isSelected(state, cell)) return { ok: false, reason: "already-selected" };
  if (isLocked(state, cell)) return { ok: false, reason: "locked" };
  return { ok: true, state: { selections: [...state.selections, { row: cell.row, col: cell.col }] } };
}

export function undo(state: GameState): GameState {
  if (state.selections.length === 0) return state;
  return { selections: state.selections.slice(0, -1) };
}

export function restart(): GameState {
  return INITIAL_GAME;
}

export function selectedValues(state: GameState): number[] {
  return state.selections.map(valueOf);
}

export function total(state: GameState): number {
  return selectedValues(state).reduce((a, b) => a + b, 0);
}

/** Every ordered sequence of four legal selections (16 · 9 · 4 · 1 = 576). */
export function enumerateSequences(): Cell[][] {
  const out: Cell[][] = [];
  const walk = (state: GameState) => {
    if (isComplete(state)) {
      out.push([...state.selections]);
      return;
    }
    for (const cell of availableCells(state)) {
      const r = select(state, cell);
      if (r.ok) walk(r.state);
    }
  };
  walk(INITIAL_GAME);
  return out;
}
