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
const board = buildActivityCenterBoard({ units: UNITS, rows, activityUnitId: ACTIVITY.id });

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
      activityUnitId: "act-9",
    });
    const aggs = mixed.centers[0].profileAggregates;
    expect(aggs.map((a) => a.kpiProfile)).toEqual(["renewals", "generic_sales"]);
    // Two separate targets — 60 and 40 are never combined into 100.
    expect(aggs.map((a) => a.target)).toEqual([60, 40]);
  });
});

// --------------------------------------------------------------------------
// Multi-activity isolation. scope.units is the ORG-WIDE business_units list
// (the table is authenticated-readable), so the board must select this
// manager's subtree BY ID. Without this, another activity's centers would
// render as phantom "empty centers" on their dashboard and inflate the
// structural counts.
// --------------------------------------------------------------------------
describe("two activities — a manager sees only their own activity's centers", () => {
  const ACT_A: BusinessUnit = { id: "A", name: "פעילות א", unitType: "activity", parentId: null };
  const A1: BusinessUnit = { id: "A1", name: "מוקד א1", unitType: "center", parentId: "A" };
  const A2: BusinessUnit = { id: "A2", name: "מוקד א2", unitType: "center", parentId: "A" };
  const ACT_B: BusinessUnit = { id: "B", name: "פעילות ב", unitType: "activity", parentId: null };
  const B1: BusinessUnit = { id: "B1", name: "מוקד ב1", unitType: "center", parentId: "B" };
  // The payload the client actually receives: every unit in the organization.
  const ORG_UNITS: BusinessUnit[] = [ACT_A, A1, A2, ACT_B, B1];

  // Manager of activity A. Their covered teams include one team in A1, one
  // attached straight to A, and — via teams.manager_id — one team that lives
  // under ANOTHER activity's center (B1), plus one with no attachment at all.
  const twoActRows = buildScopeTeamRows({
    teams: [
      { id: "ta1", name: "צוות א1", kpiProfile: "generic_sales", businessUnitId: "A1" },
      { id: "tdirect", name: "צוות ישיר א", kpiProfile: "generic_sales", businessUnitId: "A" },
      { id: "tforeign", name: "צוות זר", kpiProfile: "generic_sales", businessUnitId: "B1" },
      { id: "tnone", name: "צוות ללא שיוך", kpiProfile: "generic_sales", businessUnitId: null },
    ],
    reps: [
      { id: "p1", teamId: "ta1", currentResult: 3 },
      { id: "p2", teamId: "ta1", currentResult: 3 },
      { id: "p3", teamId: "tdirect", currentResult: 4 },
      { id: "p4", teamId: "tforeign", currentResult: 5 },
      { id: "p5", teamId: "tnone", currentResult: 6 },
    ],
    goalsByTeamId: new Map(),
    goalsByRepId: new Map(),
  });
  const boardA = buildActivityCenterBoard({
    units: ORG_UNITS,
    rows: twoActRows,
    activityUnitId: "A",
  });

  it("includes A1 and A2 and does NOT include another activity's center B1", () => {
    expect(boardA.centers.map((c) => c.centerId).sort()).toEqual(["A1", "A2"]);
    expect(boardA.centers.some((c) => c.centerId === "B1")).toBe(false);
  });

  it("centerCount counts only centers under the resolved activity", () => {
    expect(activityStructureSummary(boardA).centerCount).toBe(2);
  });

  it("the empty-center count uses only this activity's centers", () => {
    // A2 is empty; B1 is empty too but belongs to another activity and must
    // never inflate this manager's structural attention figure.
    expect(activityStructureSummary(boardA).centersWithoutTeams).toBe(1);
  });

  it("a covered team pointing at a FOREIGN center is not attached to it", () => {
    for (const c of boardA.centers) {
      expect(c.teams.some((t) => t.id === "tforeign")).toBe(false);
    }
  });

  it("that foreign-center team falls into unattachedRows, still visible", () => {
    expect(boardA.unattachedRows.map((r) => r.id).sort()).toEqual(["tforeign", "tnone"]);
  });

  it("teams attached straight to the manager's own activity stay in directRows", () => {
    expect(boardA.directRows.map((r) => r.id)).toEqual(["tdirect"]);
  });

  it("teamCount and repCount still cover the FULL scope, foreign-attached included", () => {
    const s = activityStructureSummary(boardA);
    expect(s.teamCount).toBe(4); // 1 in A1 + 1 direct + 2 unattached
    expect(s.repCount).toBe(5);
  });

  it("no team is placed in more than one bucket", () => {
    const placed = [
      ...boardA.centers.flatMap((c) => c.teams.map((t) => t.id)),
      ...boardA.directRows.map((r) => r.id),
      ...boardA.unattachedRows.map((r) => r.id),
    ];
    expect(placed.sort()).toEqual(["ta1", "tdirect", "tforeign", "tnone"]);
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("a manager with no resolved unit gets no centers and loses no teams", () => {
    const none = buildActivityCenterBoard({
      units: ORG_UNITS,
      rows: twoActRows,
      activityUnitId: null,
    });
    expect(none.centers).toEqual([]);
    expect(none.directRows).toEqual([]);
    expect(none.unattachedRows).toHaveLength(4);
    expect(activityStructureSummary(none).teamCount).toBe(4);
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
