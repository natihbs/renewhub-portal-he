// The activity manager's center board — the hierarchy level they actually
// manage from. The board starts from center UNITS (not from teams), so an
// empty center is a first-class, honestly-empty entry; performance stays
// per-KPI-profile; and nothing in scope leaks into a center it does not
// belong to. The center-manager and executive groupings must stay untouched.
import { describe, expect, it } from "vitest";
import type { BusinessUnit } from "@/lib/business-scope";
import {
  activityStructureSummary,
  aggregateByProfile,
  buildActivityCenterBoard,
  buildScopeTeamRows,
  CENTER_NO_TEAMS_MESSAGE,
  groupScopeRows,
  missingTargetsByTeam,
  type ScopeHomeTeamInput,
} from "@/lib/scope-home";

// Fixture mirroring the live QA shape WITHOUT hard-coding product names:
// one activity with two centers — one carrying two renewals teams, one with
// zero teams — plus a team attached straight to the activity and a covered
// team outside the hierarchy entirely.
const ACTIVITY: BusinessUnit = {
  id: "act-1",
  name: "אלמנטרי",
  unitType: "activity",
  parentId: null,
};
const CENTER_FULL: BusinessUnit = {
  id: "cen-1",
  name: "דירות וחידושים",
  unitType: "center",
  parentId: "act-1",
};
const CENTER_EMPTY: BusinessUnit = {
  id: "cen-2",
  name: "רכב",
  unitType: "center",
  parentId: "act-1",
};
const UNITS: BusinessUnit[] = [ACTIVITY, CENTER_FULL, CENTER_EMPTY];

const TEAMS: ScopeHomeTeamInput[] = [
  { id: "t-a", name: "חידושי דירה", kpiProfile: "renewals", businessUnitId: "cen-1" },
  { id: "t-b", name: "חידושי רכב", kpiProfile: "renewals", businessUnitId: "cen-1" },
  { id: "t-direct", name: "צוות ישיר", kpiProfile: "generic_sales", businessUnitId: "act-1" },
  { id: "t-loose", name: "צוות חיצוני", kpiProfile: "generic_sales", businessUnitId: null },
];

const REPS = [
  ...Array.from({ length: 8 }, (_, i) => ({ id: `ra${i}`, teamId: "t-a", currentResult: 5 })),
  ...Array.from({ length: 5 }, (_, i) => ({ id: `rb${i}`, teamId: "t-b", currentResult: 4 })),
  { id: "rd0", teamId: "t-direct", currentResult: 10 },
  { id: "rl0", teamId: "t-loose", currentResult: 7 },
];

// Official targets: team t-a has an assigned book of 100 (renewals), t-b has
// none; the direct generic team has 50. Rep targets: everyone but two t-b
// reps has one.
const goalsByTeamId = new Map<string, number>([
  ["t-a", 100],
  ["t-direct", 50],
]);
const goalsByRepId = new Map<string, number>([
  ...Array.from({ length: 8 }, (_, i) => [`ra${i}`, 10] as const),
  ...Array.from({ length: 3 }, (_, i) => [`rb${i}`, 10] as const),
  ["rd0", 50],
  ["rl0", 20],
]);

const rows = buildScopeTeamRows({ teams: TEAMS, reps: REPS, goalsByTeamId, goalsByRepId });
const board = buildActivityCenterBoard({ units: UNITS, rows });

describe("buildActivityCenterBoard — centers from UNITS, teams one level down", () => {
  it("returns every center unit of the activity, INCLUDING the empty one", () => {
    expect(board.centers.map((c) => c.centerId).sort()).toEqual(["cen-1", "cen-2"]);
  });

  it("labels centers with the מוקד type word", () => {
    const names = board.centers.map((c) => c.centerName);
    expect(names).toContain("מוקד דירות וחידושים");
    expect(names).toContain("מוקד רכב");
  });

  it("a center with teams carries correct team and representative counts", () => {
    const full = board.centers.find((c) => c.centerId === "cen-1")!;
    expect(full.hasTeams).toBe(true);
    expect(full.teamCount).toBe(2);
    expect(full.repCount).toBe(13);
  });

  it("the empty center is included with hasTeams=false and NO fabricated performance", () => {
    const empty = board.centers.find((c) => c.centerId === "cen-2")!;
    expect(empty.hasTeams).toBe(false);
    expect(empty.teamCount).toBe(0);
    expect(empty.repCount).toBe(0);
    expect(empty.teams).toEqual([]);
    // No profile aggregates at all — not a 0% row, not a 0 target.
    expect(empty.profileAggregates).toEqual([]);
    expect(empty.missingRepresentativeTargets).toBe(0);
  });

  it("teams are assigned to the correct center only — drill-down shows ONLY that center's teams", () => {
    const full = board.centers.find((c) => c.centerId === "cen-1")!;
    expect(full.teams.map((t) => t.id).sort()).toEqual(["t-a", "t-b"]);
    // Neither the direct-activity team nor the unattached team leaks in.
    expect(full.teams.some((t) => t.id === "t-direct" || t.id === "t-loose")).toBe(false);
  });

  it("directly-attached and unattached teams stay visible in their own honest buckets", () => {
    expect(board.directRows.map((r) => r.id)).toEqual(["t-direct"]);
    expect(board.unattachedRows.map((r) => r.id)).toEqual(["t-loose"]);
  });

  it("center performance aggregates use only that center's teams, per profile", () => {
    const full = board.centers.find((c) => c.centerId === "cen-1")!;
    expect(full.profileAggregates).toHaveLength(1);
    const agg = full.profileAggregates[0];
    expect(agg.kpiProfile).toBe("renewals");
    expect(agg.teamCount).toBe(2);
    expect(agg.teamsWithTarget).toBe(1); // only t-a has an assigned book
    expect(agg.target).toBe(100);
    expect(agg.completed).toBe(60); // 8*5 + 5*4 — results exist regardless of targets
    // Rate over TARGETED teams only: 40/100.
    expect(agg.pct).toBe(40);
  });

  it("missing representative targets roll up per center from real rep goals", () => {
    const full = board.centers.find((c) => c.centerId === "cen-1")!;
    expect(full.missingRepresentativeTargets).toBe(2); // rb3, rb4
  });
});

describe("activityStructureSummary — the structure-first hero figures", () => {
  it("counts centers, all covered teams, all covered reps and empty centers", () => {
    const s = activityStructureSummary(board);
    expect(s).toEqual({
      centerCount: 2,
      teamCount: 4, // 2 center teams + direct + unattached: totals match the board
      repCount: 15,
      centersWithoutTeams: 1,
    });
  });
});

describe("mixed KPI profiles stay separated at every level", () => {
  it("a center containing renewals AND generic teams gets two aggregates, never one sum", () => {
    const mixedRows = buildScopeTeamRows({
      teams: [
        { id: "m1", name: "חידושים", kpiProfile: "renewals", businessUnitId: "cen-9" },
        { id: "m2", name: "מכירות", kpiProfile: "generic_sales", businessUnitId: "cen-9" },
      ],
      reps: [
        { id: "x1", teamId: "m1", currentResult: 30 },
        { id: "x2", teamId: "m2", currentResult: 20 },
      ],
      goalsByTeamId: new Map([
        ["m1", 60],
        ["m2", 40],
      ]),
      goalsByRepId: new Map(),
    });
    const mixed = buildActivityCenterBoard({
      units: [{ id: "cen-9", name: "מעורב", unitType: "center", parentId: "act-9" }],
      rows: mixedRows,
    });
    const aggs = mixed.centers[0].profileAggregates;
    expect(aggs.map((a) => a.kpiProfile)).toEqual(["renewals", "generic_sales"]);
    // Two separate targets — 60 and 40 are never combined into 100.
    expect(aggs.map((a) => a.target)).toEqual([60, 40]);
  });
});

describe("regressions — other levels keep their existing behavior", () => {
  it("center-manager grouping stays a flat listing (the center IS the scope)", () => {
    const groups = groupScopeRows({ kind: "center", rows, units: UNITS });
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBeNull();
    expect(groups[0].rows).toHaveLength(rows.length);
  });

  it("executive grouping is unchanged: activity → centers, empty centers still omitted there", () => {
    const groups = groupScopeRows({ kind: "executive", rows, units: UNITS });
    const activityGroup = groups.find((g) => g.key === "act-1")!;
    expect(activityGroup.subgroups?.map((s) => s.key)).toEqual(["cen-1"]);
    // The unattached team keeps its own executive group.
    expect(groups.some((g) => g.key === "unattached")).toBe(true);
  });

  it("missing targets stay truthful and per-team", () => {
    const missing = missingTargetsByTeam(rows);
    const tb = missing.find((m) => m.teamId === "t-b")!;
    expect(tb.missing).toBe(2);
    expect(tb.repCount).toBe(5);
  });

  it("aggregateByProfile itself never mixes profiles", () => {
    const aggs = aggregateByProfile(rows);
    expect(aggs.map((a) => a.kpiProfile)).toEqual(["renewals", "generic_sales"]);
  });

  it("the empty-center message is the honest structural wording, not a metric", () => {
    expect(CENTER_NO_TEAMS_MESSAGE).toBe("אין צוותים משויכים למוקד");
  });
});
