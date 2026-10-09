import { describe, expect, it } from "vitest";
import {
  INITIAL_GAME,
  MATRIX,
  availableCells,
  enumerateSequences,
  isAvailable,
  isComplete,
  isLocked,
  restart,
  select,
  total,
  undo,
  type Cell,
  type GameState,
} from "@/lib/engine";

function play(cells: Cell[]): GameState {
  return cells.reduce<GameState>((state, cell) => {
    const r = select(state, cell);
    if (!r.ok) throw new Error(`illegal move ${JSON.stringify(cell)}: ${r.reason}`);
    return r.state;
  }, INITIAL_GAME);
}

describe("matrix", () => {
  it("is exactly 1..16 in row-major order", () => {
    expect(MATRIX.flat()).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });
});

describe("exhaustive enumeration", () => {
  const sequences = enumerateSequences();

  it("finds exactly 576 ordered sequences (16·9·4·1)", () => {
    expect(sequences).toHaveLength(576);
    const keys = new Set(sequences.map((s) => s.map((c) => `${c.row}${c.col}`).join("-")));
    expect(keys.size).toBe(576);
  });

  it("has 24 distinct unordered sets (4! permutations)", () => {
    const sets = new Set(
      sequences.map((s) => s.map((c) => MATRIX[c.row][c.col]).sort((a, b) => a - b).join(",")),
    );
    expect(sets.size).toBe(24);
  });

  it.each(sequences.map((s, i) => [i, s] as const))("sequence #%i uses 4 unique rows, 4 unique columns and sums to 34", (_, seq) => {
    expect(seq).toHaveLength(4);
    expect(new Set(seq.map((c) => c.row)).size).toBe(4);
    expect(new Set(seq.map((c) => c.col)).size).toBe(4);
    const state = play(seq);
    expect(isComplete(state)).toBe(true);
    expect(total(state)).toBe(34);
    expect(availableCells(state)).toHaveLength(0);
  });
});

describe("invalid selections", () => {
  const first: Cell = { row: 1, col: 2 }; // 7

  it("rejects a cell in the same row or column as a selection", () => {
    const s = play([first]);
    for (let i = 0; i < 4; i++) {
      if (i !== 2) expect(select(s, { row: 1, col: i })).toEqual({ ok: false, reason: "locked" });
      if (i !== 1) expect(select(s, { row: i, col: 2 })).toEqual({ ok: false, reason: "locked" });
    }
  });

  it("rejects selecting the same cell twice", () => {
    expect(select(play([first]), first)).toEqual({ ok: false, reason: "already-selected" });
  });

  it("rejects out-of-bounds and non-integer cells", () => {
    for (const cell of [{ row: -1, col: 0 }, { row: 0, col: 4 }, { row: 4, col: 4 }, { row: 0.5, col: 1 }]) {
      expect(select(INITIAL_GAME, cell)).toEqual({ ok: false, reason: "out-of-bounds" });
    }
  });

  it("rejects any fifth selection", () => {
    const done = play([{ row: 0, col: 0 }, { row: 1, col: 1 }, { row: 2, col: 2 }, { row: 3, col: 3 }]);
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 4; col++) expect(select(done, { row, col }).ok).toBe(false);
  });

  it("does not mutate state on rejection", () => {
    const s = play([first]);
    const before = JSON.stringify(s);
    select(s, { row: 1, col: 0 });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("undo", () => {
  it("restores availability exactly, at every depth of every sequence", () => {
    for (const seq of enumerateSequences()) {
      let state = INITIAL_GAME;
      const snapshots: string[][] = [];
      for (const cell of seq) {
        snapshots.push(availableCells(state).map((c) => `${c.row}${c.col}`));
        const r = select(state, cell);
        if (!r.ok) throw new Error("unexpected");
        state = r.state;
      }
      for (let depth = seq.length - 1; depth >= 0; depth--) {
        state = undo(state);
        expect(state.selections).toEqual(seq.slice(0, depth));
        expect(availableCells(state).map((c) => `${c.row}${c.col}`)).toEqual(snapshots[depth]);
      }
    }
  });

  it("unlocks the row and column of the undone cell", () => {
    const s = undo(play([{ row: 0, col: 0 }]));
    expect(isLocked(s, { row: 0, col: 3 })).toBe(false);
    expect(isAvailable(s, { row: 3, col: 0 })).toBe(true);
    expect(availableCells(s)).toHaveLength(16);
  });

  it("is a no-op on an empty game", () => {
    expect(undo(INITIAL_GAME)).toBe(INITIAL_GAME);
  });
});

describe("restart", () => {
  it("clears all previous selections", () => {
    const s = play([{ row: 0, col: 1 }, { row: 2, col: 3 }]);
    const fresh = restart();
    expect(fresh.selections).toHaveLength(0);
    expect(availableCells(fresh)).toHaveLength(16);
    expect(total(fresh)).toBe(0);
    expect(s.selections).toHaveLength(2); // previous state untouched (immutable)
  });
});
