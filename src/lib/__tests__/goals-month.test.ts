import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { goalMonthKind } from "@/lib/goals-hooks";
import { computeCopyGoalsPreview } from "@/lib/goals.functions";
import { formatMonthIL } from "@/lib/format";

// ---------------------------------------------------------------------------
// Targets are monthly, and each month stands on its own. These tests pin the
// three places that promise breaks first: the month-kind badge on /targets,
// the copy-from-previous-month no-overwrite rule, and the month scoping of
// every goal read/write path (source-pinned, since vitest has no database).
// ---------------------------------------------------------------------------

describe("goalMonthKind", () => {
  const current = "2026-08-01";

  it("labels the current month as execution, not planning or history", () => {
    expect(goalMonthKind("2026-08-01", current)).toBe("current");
  });

  it("labels a later month as future planning", () => {
    expect(goalMonthKind("2026-09-01", current)).toBe("future");
    expect(goalMonthKind("2027-01-01", current)).toBe("future");
  });

  it("labels an earlier month as history", () => {
    expect(goalMonthKind("2026-07-01", current)).toBe("past");
    expect(goalMonthKind("2025-12-01", current)).toBe("past");
  });
});

describe("formatMonthIL", () => {
  it("renders a Hebrew month name with its year", () => {
    expect(formatMonthIL("2026-08-01")).toBe("אוגוסט 2026");
  });

  it("returns the input rather than 'Invalid Date' for garbage", () => {
    expect(formatMonthIL("לא חודש")).toBe("לא חודש");
  });
});

describe("computeCopyGoalsPreview — copying never overwrites an existing goal", () => {
  const base = {
    previousMonth: "2026-07-01",
    repNameById: new Map([
      ["r1", "יעל"],
      ["r2", "אורי"],
      ["r3", "דנה"],
    ]),
  };

  it("copies a team goal only when the destination month has none", () => {
    const preview = computeCopyGoalsPreview({
      ...base,
      prevTeamGoal: { target_value: 500 },
      curTeamGoal: null,
      prevRepGoals: [],
      curRepGoalIds: new Set(),
    });
    expect(preview.team_target_will_copy).toBe(500);
    expect(preview.team_target_skipped_reason).toBeNull();
  });

  it("NEVER overwrites an existing destination team goal — the critical negative", () => {
    const preview = computeCopyGoalsPreview({
      ...base,
      prevTeamGoal: { target_value: 500 },
      curTeamGoal: { target_value: 600 },
      prevRepGoals: [],
      curRepGoalIds: new Set(),
    });
    expect(preview.team_target_will_copy).toBeNull();
    expect(preview.team_target_skipped_reason).toBe("already_set");
  });

  it("reports honestly when the previous month simply had no team goal", () => {
    const preview = computeCopyGoalsPreview({
      ...base,
      prevTeamGoal: null,
      curTeamGoal: null,
      prevRepGoals: [],
      curRepGoalIds: new Set(),
    });
    expect(preview.team_target_will_copy).toBeNull();
    expect(preview.team_target_skipped_reason).toBe("no_previous");
  });

  it("copies only representatives missing a destination goal, and reports every skip", () => {
    const preview = computeCopyGoalsPreview({
      ...base,
      prevTeamGoal: null,
      curTeamGoal: null,
      prevRepGoals: [
        { representative_id: "r1", target_value: 100 },
        { representative_id: "r2", target_value: 120 },
        { representative_id: "r3", target_value: 90 },
      ],
      curRepGoalIds: new Set(["r2"]),
    });
    expect(preview.representatives_to_copy.map((r) => r.representative_id)).toEqual(["r1", "r3"]);
    expect(preview.representatives_skipped).toEqual([{ representative_id: "r2", name: "אורי" }]);
  });

  it("a fully-set destination month copies nothing at all", () => {
    const preview = computeCopyGoalsPreview({
      ...base,
      prevTeamGoal: { target_value: 500 },
      curTeamGoal: { target_value: 500 },
      prevRepGoals: [{ representative_id: "r1", target_value: 100 }],
      curRepGoalIds: new Set(["r1"]),
    });
    expect(preview.team_target_will_copy).toBeNull();
    expect(preview.representatives_to_copy).toEqual([]);
    expect(preview.representatives_skipped).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Month scoping, pinned against the source (vitest has no database):
//  * every goal write in goals.functions.ts filters/inserts by the submitted
//    month, so saving one month cannot touch another;
//  * every goal read hook filters by goal_month and defaults to the current
//    month, which is what makes the home/performance cards current-month
//    figures by construction;
//  * nothing computes achievement from the legacy representatives
//    .monthly_target column.
// ---------------------------------------------------------------------------

describe("month scoping (source-pinned)", () => {
  const goalsFns = readFileSync(resolve(__dirname, "../goals.functions.ts"), "utf8");
  const goalsHooks = readFileSync(resolve(__dirname, "../goals-hooks.ts"), "utf8");

  it("team-goal and representative-goal writes are keyed by the submitted month", () => {
    expect(goalsFns).toContain('.eq("goal_month", data.month)');
    expect(goalsFns).toContain("goal_month: data.month");
    expect(goalsFns).not.toContain('from("representatives").update');
  });

  it("every goal read hook filters by goal_month and defaults to the current month", () => {
    expect(goalsHooks.match(/goal_month: month/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(
      goalsHooks.match(/month: string = currentGoalMonth\(\)/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(4);
  });

  it("goals.functions.ts never writes the legacy representatives.monthly_target column", () => {
    expect(goalsFns).not.toContain("monthly_target");
  });
});
