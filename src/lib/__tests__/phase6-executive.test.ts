// PHASE 6 — the EXECUTIVE management experience.
//
// An executive (סמנכ"ל / מנהל ממ"ט) is not a bigger team manager: they manage
// the BUSINESS STRUCTURE. Their first visual hierarchy is ACTIVITIES, and the
// drill-down runs ACTIVITY → CENTERS → TEAMS → נציגים. That is an information-
// architecture claim, and these tests hold it to two rules:
//
//   1. NOTHING IN SCOPE DISAPPEARS. Every covered team lands in exactly one
//      bucket of the board, empty activities and empty centers included —
//      structure that exists is structure that is shown.
//   2. NO NUMBER IS INVENTED. Renewals and generic sales are never summed or
//      averaged into one figure, a missing target is never a zero, and an
//      empty unit is never poor performance.
//
// The Center, Activity, Team-Manager and account-identity behaviors are
// regression surface here: Phase 6 must not have moved them.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BusinessUnit } from "../business-scope";
import { BUSINESS_ROLE_LABEL, resolveBusinessScope, type ScopeTeam } from "../business-scope";
import { accountIdentity, TECHNICAL_ROLE_LABEL } from "../account-identity";
import { kpiProfileMix, MIXED_PROFILE_AGGREGATE_LABEL } from "../performance-domain";
import {
  activityStructureSummary,
  buildActivityCenterBoard,
  buildExecutiveActivityBoard,
  buildScopeTeamRows,
  executiveStructureSummary,
  groupScopeRows,
  isScopedManagerKind,
  targetReadiness,
  type ScopeHomeTeamInput,
  type ScopeTeamRow,
} from "../scope-home";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const homeSrc = read("../../routes/_authenticated/index.tsx");
const targetsSrc = read("../../routes/_authenticated/targets.tsx");
const performanceSrc = read("../../routes/_authenticated/performance.tsx");
const scopeCardsSrc = read("../../components/ScopeHomeCards.tsx");

// ---------------------------------------------------------------- fixtures
//
// A business shaped to exercise every structural fact an executive can meet:
//   פעילות אלמנטרי  → מוקד דירות (2 teams, mixed profiles) + מוקד רכב (EMPTY)
//   פעילות בריאות   → no centers at all (EMPTY activity)
//   מוקד יתום       → a center whose parentId points at NO activity, carrying
//                     a real team — the case the old grouped view dropped
//   plus one team attached straight to an activity, and one with no unit.

const ACT_ELEM: BusinessUnit = {
  id: "act-1",
  name: "אלמנטרי",
  unitType: "activity",
  parentId: null,
};
const ACT_HEALTH: BusinessUnit = {
  id: "act-2",
  name: "בריאות",
  unitType: "activity",
  parentId: null,
};
const CEN_FULL: BusinessUnit = {
  id: "cen-1",
  name: "דירות",
  unitType: "center",
  parentId: "act-1",
};
const CEN_EMPTY: BusinessUnit = { id: "cen-2", name: "רכב", unitType: "center", parentId: "act-1" };
const CEN_ORPHAN: BusinessUnit = { id: "cen-3", name: "יתום", unitType: "center", parentId: null };

const UNITS: BusinessUnit[] = [ACT_ELEM, ACT_HEALTH, CEN_FULL, CEN_EMPTY, CEN_ORPHAN];

const TEAM_INPUTS: ScopeHomeTeamInput[] = [
  { id: "t-ren", name: "חידושי דירה", kpiProfile: "renewals", businessUnitId: "cen-1" },
  { id: "t-sales", name: "מכירות דירה", kpiProfile: "generic_sales", businessUnitId: "cen-1" },
  { id: "t-orphan", name: "צוות יתום", kpiProfile: "renewals", businessUnitId: "cen-3" },
  { id: "t-direct", name: "צוות ישיר", kpiProfile: "generic_sales", businessUnitId: "act-1" },
  { id: "t-loose", name: "צוות ללא יחידה", kpiProfile: "renewals", businessUnitId: null },
];

const REPS = [
  ...Array.from({ length: 4 }, (_, i) => ({
    id: `r-ren-${i}`,
    teamId: "t-ren",
    currentResult: 10,
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `r-sal-${i}`,
    teamId: "t-sales",
    currentResult: 5,
  })),
  { id: "r-orp-0", teamId: "t-orphan", currentResult: 7 },
  { id: "r-dir-0", teamId: "t-direct", currentResult: 9 },
  { id: "r-loo-0", teamId: "t-loose", currentResult: 3 },
];

// t-ren has an assigned book of 100; t-sales a sales target of 20; t-orphan,
// t-direct and t-loose have NO official team target at all.
const GOALS_BY_TEAM = new Map<string, number>([
  ["t-ren", 100],
  ["t-sales", 20],
]);
// Every representative has a personal target except the two on t-sales.
const GOALS_BY_REP = new Map<string, number>(
  REPS.filter((r) => r.id !== "r-sal-1" && r.id !== "r-sal-2").map((r) => [r.id, 5]),
);

const rows = (): ScopeTeamRow[] =>
  buildScopeTeamRows({
    teams: TEAM_INPUTS,
    reps: REPS,
    goalsByTeamId: GOALS_BY_TEAM,
    goalsByRepId: GOALS_BY_REP,
  });

const board = () => buildExecutiveActivityBoard({ units: UNITS, rows: rows() });
const activityById = (id: string) => board().activities.find((a) => a.activityId === id)!;

// ============================================================ Executive Home

describe("executive board — the business as it is BUILT", () => {
  it("leads with ACTIVITIES, sorted, one entry per activity UNIT", () => {
    expect(board().activities.map((a) => a.activityName)).toEqual([
      "פעילות אלמנטרי",
      "פעילות בריאות",
    ]);
  });

  it("keeps an activity that has no centers — an empty activity is a fact, not a failure", () => {
    const health = activityById("act-2");
    expect(health.centerCount).toBe(0);
    expect(health.teamCount).toBe(0);
    expect(health.hasTeams).toBe(false);
    // No target, no result, no percentage is claimed for it.
    expect(health.profileAggregates).toEqual([]);
    expect(health.missingRepresentativeTargets).toBe(0);
  });

  it("keeps an EMPTY center inside a populated activity", () => {
    const elem = activityById("act-1");
    const empty = elem.centers.find((c) => c.centerId === "cen-2")!;
    expect(empty.hasTeams).toBe(false);
    expect(empty.teamCount).toBe(0);
    expect(empty.profileAggregates).toEqual([]);
    expect(elem.centersWithoutTeams).toBe(1);
  });

  it("teams under a center that hangs off NO activity stay visible in the unattached bucket", () => {
    // This is the defect the old grouped view carried: the orphan center is a
    // known unit, so the row was neither placed under an activity nor counted
    // as unattached — it vanished from the board while still inflating the
    // totals printed beside it.
    expect(
      board()
        .unattachedRows.map((r) => r.id)
        .sort(),
    ).toEqual(["t-loose", "t-orphan"]);
    const dropped = groupScopeRows({ kind: "executive", rows: rows(), units: UNITS })
      .flatMap((g) => [...g.rows, ...(g.subgroups ?? []).flatMap((s) => s.rows)])
      .map((r) => r.id);
    expect(dropped).not.toContain("t-orphan");
  });

  it("places every covered team in EXACTLY one bucket", () => {
    const b = board();
    const placed = [
      ...b.activities.flatMap((a) => [...a.centers.flatMap((c) => c.teams), ...a.directRows]),
      ...b.unattachedRows,
    ].map((r) => r.id);
    expect(placed.sort()).toEqual(TEAM_INPUTS.map((t) => t.id).sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("never attaches a team to an activity it does not belong to", () => {
    const health = activityById("act-2");
    expect([...health.centers.flatMap((c) => c.teams), ...health.directRows]).toEqual([]);
    const elem = activityById("act-1");
    expect(elem.directRows.map((r) => r.id)).toEqual(["t-direct"]);
  });

  it("summarises an activity PER KPI PROFILE — מיועדות and יעד are never one number", () => {
    const elem = activityById("act-1");
    const profiles = elem.profileAggregates.map((a) => a.kpiProfile);
    expect(profiles).toEqual(["renewals", "generic_sales"]);
    const renewals = elem.profileAggregates.find((a) => a.kpiProfile === "renewals")!;
    const generic = elem.profileAggregates.find((a) => a.kpiProfile === "generic_sales")!;
    expect(renewals.target).toBe(100);
    // The activity's generic teams are t-sales (20) and t-direct (no target),
    // so the generic target is the targeted team's alone — never 100 + 20.
    expect(generic.target).toBe(20);
    expect(elem.profileAggregates.some((a) => a.target === 120)).toBe(false);
  });

  it("a team with no official target has pct null and is left out of the rate", () => {
    const direct = activityById("act-1").directRows[0];
    expect(direct.target).toBeNull();
    expect(direct.pct).toBeNull();
    const generic = activityById("act-1").profileAggregates.find(
      (a) => a.kpiProfile === "generic_sales",
    )!;
    expect(generic.teamCount).toBe(2);
    expect(generic.teamsWithTarget).toBe(1);
  });
});

describe("executive structure summary — the hero figures", () => {
  it("counts the full covered population, so the headline matches the board", () => {
    const s = executiveStructureSummary(board());
    expect(s.activityCount).toBe(2);
    expect(s.centerCount).toBe(2); // only centers that hang off an activity
    expect(s.teamCount).toBe(TEAM_INPUTS.length);
    expect(s.repCount).toBe(REPS.length);
  });

  it("reports REAL structural gaps rather than performance verdicts", () => {
    const s = executiveStructureSummary(board());
    expect(s.activitiesWithoutCenters).toBe(1);
    expect(s.centersWithoutTeams).toBe(1);
    expect(s.unattachedTeamCount).toBe(2);
  });

  it("carries no combined percentage and no combined target", () => {
    const s = executiveStructureSummary(board());
    expect(Object.keys(s).sort()).toEqual(
      [
        "activitiesWithoutCenters",
        "activityCount",
        "centerCount",
        "centersWithoutTeams",
        "repCount",
        "teamCount",
        "unattachedTeamCount",
      ].sort(),
    );
  });

  it("an empty business is empty, not badly performing", () => {
    const s = executiveStructureSummary(buildExecutiveActivityBoard({ units: [], rows: [] }));
    expect(s).toEqual({
      activityCount: 0,
      centerCount: 0,
      teamCount: 0,
      repCount: 0,
      activitiesWithoutCenters: 0,
      centersWithoutTeams: 0,
      unattachedTeamCount: 0,
    });
  });
});

describe("executive Home wiring", () => {
  it("renders the ACTIVITY board, not the old grouped team list", () => {
    expect(homeSrc).toContain('const executiveManager = scope?.kind === "executive"');
    expect(homeSrc).toContain(
      "buildExecutiveActivityBoard({ units: scope.units, rows: scopeRows })",
    );
    expect(homeSrc).toContain("<ExecutiveActivityBoardCard");
    // The grouped ScopeOverviewCard is now the CENTER manager's board only.
    expect(homeSrc).toContain("{scopedManager && !structureFirst && (");
  });

  it("leads with structure — no org-wide ring, no org-wide target", () => {
    expect(homeSrc).toContain('<HeroStat label="פעילויות"');
    expect(homeSrc).toContain('<HeroStat label="נציגים פעילים"');
    expect(homeSrc).toContain("const structureFirst = activityManager || executiveManager");
  });

  it("drills ACTIVITY → CENTERS → TEAMS, and a team hands off to its representatives", () => {
    // The activity surface expands into the SAME center surface the activity
    // manager's board uses, which expands into the team rows.
    expect(scopeCardsSrc).toContain("function ExecutiveActivitySurface");
    expect(scopeCardsSrc).toContain("<ActivityCenterSurface");
    // Selecting a team scopes the workspace, which is what drives the
    // representative-level panel below.
    expect(homeSrc).toContain("onSelectTeam={setWorkspaceTeam}");
  });

  it("keeps the management-level attention rail instead of ranking reps across activities", () => {
    expect(homeSrc).toContain("{structureFirst ? (");
    expect(homeSrc).toContain('<SectionHeading title="תשומת לב ניהולית" />');
  });
});

// ========================================================= Executive targets

describe("executive /targets", () => {
  it("opens on ACTIVITIES and reuses the identical board derivation", () => {
    expect(targetsSrc).toContain("buildExecutiveActivityBoard({ units: scope.units, rows })");
    expect(targetsSrc).toContain("<ExecutiveTargetsBoard");
  });

  it("readiness is counts only — never a cross-profile percentage", () => {
    const elem = activityById("act-1");
    const readiness = targetReadiness([
      ...elem.centers.flatMap((c) => c.teams),
      ...elem.directRows,
    ]);
    expect(readiness.teamCount).toBe(3);
    expect(readiness.teamsWithTarget).toBe(2);
    expect(readiness.teamsMissingTarget).toBe(1);
    expect(readiness.kpiProfiles).toEqual(["renewals", "generic_sales"]);
    expect(Object.keys(readiness)).not.toContain("pct");
  });

  it("a missing target reads לא הוגדר, and is never counted as 0", () => {
    const boardsSrc = read("../../components/TargetScopeBoards.tsx");
    expect(boardsSrc).toContain('{hasTarget ? formatNum(row.target as number) : "לא הוגדר"}');
    const direct = activityById("act-1").directRows[0];
    expect(direct.target).toBeNull();
    expect(direct.pct).toBeNull();
  });

  it("an activity with no teams states the structural fact instead of 0 מתוך 0", () => {
    const boardsSrc = read("../../components/TargetScopeBoards.tsx");
    expect(boardsSrc).toContain("ACTIVITY_NO_TEAMS_TARGETS_MESSAGE");
    expect(activityById("act-2").hasTeams).toBe(false);
  });

  it("month controls, official targets and copy-goal semantics are untouched", () => {
    expect(targetsSrc).toContain("<MonthCommandBar");
    expect(targetsSrc).toContain("copyGoalsFromPreviousMonth");
    expect(targetsSrc).toContain("setRepresentativeGoals");
    expect(targetsSrc).toContain("invalidateRepresentativeGoalReaders");
    expect(targetsSrc).not.toContain("kpi_values");
  });
});

// ===================================================== Executive performance

describe("/performance never reports a cross-profile total", () => {
  it("a single-profile population is unchanged", () => {
    const mix = kpiProfileMix(["renewals", "renewals", "renewals"]);
    expect(mix).toEqual({ profiles: ["renewals"], mixed: false });
  });

  it("a mixed population is detected, renewals first", () => {
    expect(kpiProfileMix(["generic_sales", "renewals"])).toEqual({
      profiles: ["renewals", "generic_sales"],
      mixed: true,
    });
  });

  it("an empty or unknown population claims nothing", () => {
    expect(kpiProfileMix([])).toEqual({ profiles: [], mixed: false });
    expect(kpiProfileMix([null, undefined])).toEqual({ profiles: [], mixed: false });
  });

  it("the summary band suppresses the combined ring, target and forecast when mixed", () => {
    expect(performanceSrc).toContain("const measuredMix = useMemo(");
    expect(performanceSrc).toContain("value={measuredMix.mixed ? null : summary.avgPct}");
    expect(performanceSrc).toContain("MIXED_PROFILE_AGGREGATE_LABEL");
    expect(performanceSrc).toContain("MIXED_PROFILE_AGGREGATE_NOTICE");
    expect(MIXED_PROFILE_AGGREGATE_LABEL).toBe("לא זמין");
  });

  it("the mix is measured from the DATA, never from the viewer's role", () => {
    expect(performanceSrc).not.toContain('kind === "executive"');
    expect(performanceSrc).toContain('.filter((e) => e.status !== "no_target")');
    expect(performanceSrc).toContain("profileByTeamId.get(e.rep.teamId)");
  });
});

// ============================================================== regressions

describe("regression — team manager keeps TEAM → REPRESENTATIVES", () => {
  it("a manager with no grants is not a scoped kind and gets no scope board", () => {
    const scope = resolveBusinessScope({
      role: "manager",
      userId: "u-1",
      teams: [{ id: "t-1", name: "צוות", managerId: "u-1", businessUnitId: null }] as ScopeTeam[],
      units: UNITS,
      grants: [],
    });
    expect(scope.kind).toBe("team_manager");
    expect(isScopedManagerKind(scope.kind)).toBe(false);
    expect(scope.teams.map((t) => t.id)).toEqual(["t-1"]);
  });

  it("the single-team home layout is still gated on NOT being a scope manager", () => {
    expect(homeSrc).toContain('{!scopedManager && workspace.type === "team" && (');
    expect(homeSrc).toContain("{!scopedManager && (");
  });
});

describe("regression — center home stays team-centric", () => {
  it("a center's grouping is still flat teams", () => {
    const centerRows = rows().filter((r) => r.businessUnitId === "cen-1");
    const groups = groupScopeRows({ kind: "center", rows: centerRows, units: UNITS });
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBeNull();
    expect(groups[0].rows.map((r) => r.id).sort()).toEqual(["t-ren", "t-sales"]);
  });

  it("the center board title and the grouped card are unchanged", () => {
    expect(homeSrc).toContain("title={centerManager ? CENTER_TEAMS_TITLE : undefined}");
    expect(homeSrc).toContain("<ScopeOverviewCard");
  });
});

describe("regression — activity home stays center-centric", () => {
  it("the activity board still filters to its own subtree by id", () => {
    const b = buildActivityCenterBoard({ units: UNITS, rows: rows(), activityUnitId: "act-1" });
    expect(b.centers.map((c) => c.centerId).sort()).toEqual(["cen-1", "cen-2"]);
    // The orphan center is NOT this activity's, so its team stays unattached
    // rather than being adopted.
    expect(b.centers.some((c) => c.centerId === "cen-3")).toBe(false);
    expect(b.unattachedRows.map((r) => r.id).sort()).toEqual(["t-loose", "t-orphan"]);
    expect(b.directRows.map((r) => r.id)).toEqual(["t-direct"]);
  });

  it("its structure summary is unchanged", () => {
    const s = activityStructureSummary(
      buildActivityCenterBoard({ units: UNITS, rows: rows(), activityUnitId: "act-1" }),
    );
    expect(s.centerCount).toBe(2);
    expect(s.centersWithoutTeams).toBe(1);
    expect(s.teamCount).toBe(TEAM_INPUTS.length);
  });
});

describe("regression — account identity and scope resolution", () => {
  const executiveScope = () =>
    resolveBusinessScope({
      role: "manager",
      userId: "u-x",
      teams: TEAM_INPUTS.map((t) => ({
        id: t.id,
        name: t.name,
        managerId: null,
        businessUnitId: t.businessUnitId,
      })) as ScopeTeam[],
      units: UNITS,
      grants: [{ scopeType: "executive", businessUnitId: null }],
    });

  it("an executive is still the technical role manager with an executive scope", () => {
    const scope = executiveScope();
    expect(scope.kind).toBe("executive");
    expect(scope.teams).toHaveLength(TEAM_INPUTS.length);
    const identity = accountIdentity({ roles: ["manager"], scope });
    expect(identity.compact).toBe(BUSINESS_ROLE_LABEL.executive);
    expect(identity.technicalLabel).toBe(TECHNICAL_ROLE_LABEL.manager);
    expect(identity.isPendingBusinessTitle).toBe(false);
  });

  it("no fake unit is attached to an executive", () => {
    const scope = executiveScope();
    expect(scope.unitId).toBeNull();
    expect(scope.unitName).toBeNull();
  });

  it("an admin is still a system administrator, never an executive", () => {
    const identity = accountIdentity({ roles: ["admin"], scope: null });
    expect(identity.compact).toBe(TECHNICAL_ROLE_LABEL.admin);
    expect(identity.businessLabel).toBeNull();
  });

  it("the user-scoped cache isolation is left intact", () => {
    const hooksSrc = read("../business-scope-hooks.ts");
    expect(hooksSrc).toContain('queryKey: ["business-scope", userId] as const');
    expect(hooksSrc).toContain("enabled: !isDemo && !!userId");
  });
});
