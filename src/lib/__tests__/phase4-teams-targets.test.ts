// Phase 4 derivations: the /teams overview band and the /targets readiness
// figures. Both are pure counts over data the pages already load — there is no
// performance metric on /teams, and target readiness is never expressed as a
// percentage, because a set of teams may mix KPI profiles and
// "מיועדות" + "יעד" is not a number.
import { describe, expect, it } from "vitest";
import type { BusinessUnit } from "@/lib/business-scope";
import { summarizeTeams, type TeamsOverviewInput } from "@/lib/teams-overview";
import {
  buildActivityCenterBoard,
  buildScopeTeamRows,
  groupScopeRows,
  targetReadiness,
  type ScopeHomeTeamInput,
} from "@/lib/scope-home";
import { canManageTeamRow } from "@/routes/_authenticated/teams";

// --------------------------------------------------------------- /teams

const TEAMS: TeamsOverviewInput[] = [
  { active: true, manager_id: "m1", kpi_profile: "renewals", member_count: 4, rep_count: 6 },
  { active: true, manager_id: null, kpi_profile: "renewals", member_count: 2, rep_count: 3 },
  { active: false, manager_id: "m2", kpi_profile: "generic_sales", member_count: 1, rep_count: 1 },
  // Unmanaged AND empty — counted as unmanaged, but not as an actionable gap.
  { active: true, manager_id: null, kpi_profile: null, member_count: 0, rep_count: 0 },
];

describe("summarizeTeams — organization counts over the loaded team rows", () => {
  const s = summarizeTeams(TEAMS);

  it("counts total, active and inactive teams", () => {
    expect(s.total).toBe(4);
    expect(s.active).toBe(3);
    expect(s.inactive).toBe(1);
  });

  it("counts unmanaged teams, and separately the staffed ones that need action", () => {
    expect(s.withoutManager).toBe(2);
    expect(s.withoutManagerStaffed).toBe(1);
  });

  it("sums representatives and login-account members separately", () => {
    expect(s.representatives).toBe(10);
    expect(s.members).toBe(7);
  });

  it("counts teams per KPI profile, defaulting a null profile", () => {
    expect(s.byProfile.renewals).toBe(2);
    // The null-profile team falls to the default (generic_sales) with the
    // inactive generic team.
    expect(s.byProfile.generic_sales).toBe(2);
  });

  it("an empty organization produces zeros, never NaN or a fabricated total", () => {
    const empty = summarizeTeams([]);
    expect(empty).toEqual({
      total: 0,
      active: 0,
      inactive: 0,
      withoutManager: 0,
      withoutManagerStaffed: 0,
      representatives: 0,
      members: 0,
      byProfile: { renewals: 0, generic_sales: 0 },
    });
  });
});

describe("regression — team management permissions are untouched by Phase 4", () => {
  it("an admin may manage every team", () => {
    expect(
      canManageTeamRow(
        { manager_id: "other" },
        { isAdmin: true, isManager: false, currentUserId: "me" },
      ),
    ).toBe(true);
  });
  it("a manager may manage only the team they personally manage", () => {
    expect(
      canManageTeamRow(
        { manager_id: "me" },
        { isAdmin: false, isManager: true, currentUserId: "me" },
      ),
    ).toBe(true);
    expect(
      canManageTeamRow(
        { manager_id: "other" },
        { isAdmin: false, isManager: true, currentUserId: "me" },
      ),
    ).toBe(false);
  });
  it("a non-manager may manage nothing", () => {
    expect(
      canManageTeamRow(
        { manager_id: "me" },
        { isAdmin: false, isManager: false, currentUserId: "me" },
      ),
    ).toBe(false);
  });
});

// -------------------------------------------------------------- /targets

// One activity, two centers (one populated, one EMPTY), a team attached
// straight to the activity, an orphan team, and a foreign activity's center
// that must never leak into this manager's board.
const ACT: BusinessUnit = { id: "ACT", name: "פעילות", unitType: "activity", parentId: null };
const C_FULL: BusinessUnit = { id: "C1", name: "מוקד מלא", unitType: "center", parentId: "ACT" };
const C_EMPTY: BusinessUnit = { id: "C2", name: "מוקד ריק", unitType: "center", parentId: "ACT" };
const ACT_OTHER: BusinessUnit = {
  id: "ACT2",
  name: "פעילות אחרת",
  unitType: "activity",
  parentId: null,
};
const C_FOREIGN: BusinessUnit = { id: "CX", name: "מוקד זר", unitType: "center", parentId: "ACT2" };
const UNITS = [ACT, C_FULL, C_EMPTY, ACT_OTHER, C_FOREIGN];

const TEAM_INPUTS: ScopeHomeTeamInput[] = [
  { id: "t1", name: "חידושים א", kpiProfile: "renewals", businessUnitId: "C1" },
  { id: "t2", name: "מכירות א", kpiProfile: "generic_sales", businessUnitId: "C1" },
  { id: "tdir", name: "צוות ישיר", kpiProfile: "generic_sales", businessUnitId: "ACT" },
  { id: "tforeign", name: "צוות בפעילות אחרת", kpiProfile: "generic_sales", businessUnitId: "CX" },
];
const REPS = [
  { id: "r1", teamId: "t1", currentResult: 10 },
  { id: "r2", teamId: "t1", currentResult: 5 },
  { id: "r3", teamId: "t2", currentResult: 8 },
  { id: "r4", teamId: "tdir", currentResult: 2 },
  { id: "r5", teamId: "tforeign", currentResult: 1 },
];
// t1 has an official team target, t2 does not. r2 and r3 have no personal target.
const rows = buildScopeTeamRows({
  teams: TEAM_INPUTS,
  reps: REPS,
  goalsByTeamId: new Map([
    ["t1", 100],
    ["tdir", 40],
  ]),
  goalsByRepId: new Map([
    ["r1", 50],
    ["r4", 40],
    ["r5", 10],
  ]),
});

describe("targetReadiness — truthful counts, never a cross-profile percentage", () => {
  it("splits teams with and without an official target", () => {
    const r = targetReadiness(rows);
    expect(r.teamCount).toBe(4);
    expect(r.teamsWithTarget).toBe(2); // t1, tdir
    expect(r.teamsMissingTarget).toBe(2); // t2, tforeign
  });

  it("counts representatives missing a personal target from the same rows", () => {
    const r = targetReadiness(rows);
    expect(r.repCount).toBe(5);
    expect(r.repsMissingPersonalTarget).toBe(2); // r2, r3
  });

  it("reports every KPI profile present, so the UI labels per profile", () => {
    expect(targetReadiness(rows).kpiProfiles).toEqual(["renewals", "generic_sales"]);
    expect(targetReadiness(rows.filter((r) => r.kpiProfile === "renewals")).kpiProfiles).toEqual([
      "renewals",
    ]);
  });

  it("exposes no percentage field at all — readiness is counts only", () => {
    expect(Object.keys(targetReadiness(rows)).some((k) => /pct|percent|rate/i.test(k))).toBe(false);
  });

  it("an empty set is all zeros with no profiles — never 0% and never NaN", () => {
    expect(targetReadiness([])).toEqual({
      teamCount: 0,
      teamsWithTarget: 0,
      teamsMissingTarget: 0,
      repCount: 0,
      repsMissingPersonalTarget: 0,
      kpiProfiles: [],
    });
  });
});

describe("CENTER manager targets — flat team hierarchy over the center's own teams", () => {
  // A center manager's covered rows are their center's teams; the board lists
  // them flat (the center IS the scope), exactly like ManagerHome.
  const centerRows = rows.filter((r) => r.businessUnitId === "C1");

  it("shows only that center's teams", () => {
    expect(centerRows.map((r) => r.id).sort()).toEqual(["t1", "t2"]);
  });

  it("groupScopeRows keeps the center listing flat with no group label", () => {
    const groups = groupScopeRows({ kind: "center", rows: centerRows, units: UNITS });
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBeNull();
  });

  it("readiness for the center counts only its own teams and reps", () => {
    const r = targetReadiness(centerRows);
    expect(r.teamCount).toBe(2);
    expect(r.teamsWithTarget).toBe(1); // t1 only
    expect(r.repsMissingPersonalTarget).toBe(2); // r2, r3
    expect(r.kpiProfiles).toEqual(["renewals", "generic_sales"]); // kept separate
  });

  it("a team with no official target is reported missing, never as 0", () => {
    const t2 = centerRows.find((r) => r.id === "t2")!;
    expect(t2.target).toBeNull();
    expect(t2.pct).toBeNull();
  });
});

describe("ACTIVITY manager targets — center board, subtree-safe (PR #53 rule)", () => {
  const board = buildActivityCenterBoard({ units: UNITS, rows, activityUnitId: "ACT" });

  it("includes every valid center of the activity, empty ones included", () => {
    expect(board.centers.map((c) => c.centerId).sort()).toEqual(["C1", "C2"]);
  });

  it("excludes a foreign activity's center", () => {
    expect(board.centers.some((c) => c.centerId === "CX")).toBe(false);
  });

  it("each center drills down to only its own teams", () => {
    const full = board.centers.find((c) => c.centerId === "C1")!;
    expect(full.teams.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  });

  it("the empty center has no teams, no aggregates and no fabricated readiness", () => {
    const empty = board.centers.find((c) => c.centerId === "C2")!;
    expect(empty.hasTeams).toBe(false);
    expect(empty.teams).toEqual([]);
    expect(empty.profileAggregates).toEqual([]);
    const r = targetReadiness(empty.teams);
    expect(r.teamCount).toBe(0);
    expect(r.teamsWithTarget).toBe(0);
    expect(r.kpiProfiles).toEqual([]);
  });

  it("per-center readiness reports missing team targets and missing personal targets", () => {
    const full = board.centers.find((c) => c.centerId === "C1")!;
    const r = targetReadiness(full.teams);
    expect(r.teamsMissingTarget).toBe(1); // t2
    expect(r.repsMissingPersonalTarget).toBe(2); // r2, r3
  });

  it("mixed KPI profiles inside one center stay separated", () => {
    const full = board.centers.find((c) => c.centerId === "C1")!;
    expect(full.profileAggregates.map((a) => a.kpiProfile)).toEqual(["renewals", "generic_sales"]);
    // 100 (renewals book) and no generic target are never combined.
    expect(full.profileAggregates.map((a) => a.target)).toEqual([100, null]);
  });

  it("direct and out-of-subtree covered teams do not disappear", () => {
    expect(board.directRows.map((r) => r.id)).toEqual(["tdir"]);
    expect(board.unattachedRows.map((r) => r.id)).toEqual(["tforeign"]);
  });

  it("no team is placed in more than one bucket", () => {
    const placed = [
      ...board.centers.flatMap((c) => c.teams.map((t) => t.id)),
      ...board.directRows.map((r) => r.id),
      ...board.unattachedRows.map((r) => r.id),
    ];
    expect(placed.sort()).toEqual(["t1", "t2", "tdir", "tforeign"]);
    expect(new Set(placed).size).toBe(placed.length);
  });
});
