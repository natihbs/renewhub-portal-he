import { describe, expect, it } from "vitest";
import { createCommitment } from "@/lib/commitment";
import { INITIAL_EXPERIMENT, experimentReducer as r, type ExperimentState } from "@/lib/experiment";
import { total } from "@/lib/engine";

async function inChamber(): Promise<ExperimentState> {
  const c = await createCommitment();
  return r(r(INITIAL_EXPERIMENT, { type: "seal", commitment: c }), { type: "begin" });
}

const diagonal = [{ row: 0, col: 0 }, { row: 1, col: 1 }, { row: 2, col: 2 }, { row: 3, col: 3 }];

describe("experiment flow", () => {
  it("walks intro → sealed → chamber → calculation → reveal", async () => {
    let s = await inChamber();
    expect(s.screen).toBe("chamber");
    for (const cell of diagonal) s = r(s, { type: "select", cell });
    s = r(s, { type: "calculate" });
    expect(s.screen).toBe("calculation");
    expect(total(s.game)).toBe(34);
    s = r(s, { type: "reveal" });
    expect(s.screen).toBe("reveal");
  });

  it("never replaces the commitment during gameplay", async () => {
    let s = await inChamber();
    const original = s.commitment;
    const other = await createCommitment();
    s = r(s, { type: "seal", commitment: other });
    s = r(s, { type: "new-session", commitment: other });
    s = r(s, { type: "select", cell: diagonal[0] });
    s = r(s, { type: "restart" });
    s = r(s, { type: "undo" });
    expect(s.commitment).toBe(original);
  });

  it("cannot calculate before four selections", async () => {
    let s = await inChamber();
    s = r(s, { type: "select", cell: diagonal[0] });
    expect(r(s, { type: "calculate" }).screen).toBe("chamber");
  });

  it("ignores illegal selections", async () => {
    let s = await inChamber();
    s = r(s, { type: "select", cell: { row: 0, col: 0 } });
    const locked = r(s, { type: "select", cell: { row: 0, col: 3 } });
    expect(locked).toBe(s);
  });

  it("restart clears the previous game state but keeps the session", async () => {
    let s = await inChamber();
    for (const cell of diagonal) s = r(s, { type: "select", cell });
    s = r(s, { type: "calculate" });
    const restarted = r(s, { type: "restart" });
    expect(restarted.screen).toBe("chamber");
    expect(restarted.game.selections).toHaveLength(0);
    expect(restarted.commitment).toBe(s.commitment);
  });

  it("starts a distinct new session after the reveal", async () => {
    let s = await inChamber();
    for (const cell of diagonal) s = r(s, { type: "select", cell });
    s = r(r(s, { type: "calculate" }), { type: "reveal" });
    const next = await createCommitment();
    const fresh = r(s, { type: "new-session", commitment: next });
    expect(fresh.screen).toBe("sealed");
    expect(fresh.commitment).toBe(next);
    expect(fresh.previous).toEqual({ sessionId: s.commitment!.sessionId, hash: s.commitment!.hash });
    expect(fresh.game.selections).toHaveLength(0);
  });
});
