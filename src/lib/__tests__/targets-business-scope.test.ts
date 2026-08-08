// /targets for business-scope managers: the page opens with the target
// status of every team in scope (grouped by the manager's hierarchy level,
// each team labeled by its own kpi_profile), then a team is selected for
// editing. Direct team managers keep the exact single-team flow, and every
// write remains authorized by the RLS scope funnel — the overview adds
// visibility, never reach.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveBusinessScope, type BusinessUnit, type ScopeTeam } from "../business-scope";
import {
  buildScopeTeamRows,
  groupScopeRows,
  isScopedManagerKind,
  missingTargetsByTeam,
  SCOPE_METRIC_LABELS,
  SCOPE_UNATTACHED_GROUP_LABEL,
} from "../scope-home";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const targetsSrc = read("../../routes/_authenticated/targets.tsx");
const goalsFnsSrc = read("../goals.functions.ts");

// ---------------------------------------------------------------- fixtures
// The live QA setup: פעילות אלמנטרי → מוקד דירות וחידושים → חידושי דירה
// (managed by חן, all targets set) + חידושי רכב (no manager, 9 reps, none
// with a target).

const HEN = "user-hen";
const LIRON = "user-liron";

const units: BusinessUnit[] = [
  { id: "act-elem", name: "אלמנטרי", unitType: "activity", parentId: null },
  { id: "cen-dira", name: "דירות וחידושים", unitType: "center", parentId: "act-elem" },
];

const teams: ScopeTeam[] = [
  { id: "t-dira", name: "חידושי דירה", managerId: HEN, businessUnitId: "cen-dira" },
  { id: "t-rechev", name: "חידושי רכב", managerId: null, businessUnitId: "cen-dira" },
  { id: "t-outside", name: "צוות מחוץ להיקף", managerId: null, businessUnitId: null },
];

const scopeTeamInputs = [
  {
    id: "t-dira",
    name: "חידושי דירה",
    kpiProfile: "renewals" as const,
    businessUnitId: "cen-dira",
  },
  {
    id: "t-rechev",
    name: "חידושי רכב",
    kpiProfile: "renewals" as const,
    businessUnitId: "cen-dira",
  },
];

const diraReps = Array.from({ length: 4 }, (_, i) => ({
  id: `dira-${i}`,
  teamId: "t-dira",
  currentResult: 10,
}));
const rechevReps = Array.from({ length: 9 }, (_, i) => ({
  id: `rechev-${i}`,
  teamId: "t-rechev",
  currentResult: 5,
}));

const goalsByTeamId = new Map<string, number>([["t-dira", 120]]);
const goalsByRepId = new Map<string, number>(diraReps.map((r) => [r.id, 30]));

const lironRows = () =>
  buildScopeTeamRows({
    teams: scopeTeamInputs,
    reps: [...diraReps, ...rechevReps],
    goalsByTeamId,
    goalsByRepId,
  });

describe("center manager (לירון) — scope-level target status", () => {
  it("sees exactly חידושי דירה + חידושי רכב, nothing outside the center", () => {
    const s = resolveBusinessScope({
      role: "manager",
      userId: LIRON,
      teams,
      units,
      grants: [{ scopeType: "center", businessUnitId: "cen-dira" }],
    });
    expect(s.teams.map((t) => t.id).sort()).toEqual(["t-dira", "t-rechev"]);
    expect(s.teams.map((t) => t.id)).not.toContain("t-outside");
  });

  it("missing targets are grouped by team — חידושי רכב 9, חידושי דירה 0", () => {
    const missing = missingTargetsByTeam(lironRows());
    expect(missing[0].line).toBe("חידושי רכב · 9 נציגים ללא יעד");
    expect(missing[0].repCount).toBe(9);
    expect(missing[1].line).toBe("חידושי דירה · 0 נציגים ללא יעד");
    expect(missing[1].repCount).toBe(4);
  });

  it("target completeness travels per team: set for דירה, unset for רכב", () => {
    const byId = new Map(lironRows().map((r) => [r.id, r]));
    expect(byId.get("t-dira")!.target).toBe(120);
    expect(byId.get("t-rechev")!.target).toBeNull();
  });
});

describe("activity manager (יונתן) — centers, teams and the PR #46 fallback", () => {
  it("groups the overview by center and keeps the unattached fallback", () => {
    const withOwned = [
      ...lironRows(),
      { ...lironRows()[0], id: "t-owned", name: "צוות ללא שיוך", businessUnitId: null },
    ];
    const groups = groupScopeRows({ kind: "activity", rows: withOwned, units });
    expect(groups.map((g) => g.label)).toEqual([
      "מוקד דירות וחידושים",
      SCOPE_UNATTACHED_GROUP_LABEL,
    ]);
  });

  it("activity scope never covers a team outside the activity", () => {
    const s = resolveBusinessScope({
      role: "manager",
      userId: "user-yonatan",
      teams,
      units,
      grants: [{ scopeType: "activity", businessUnitId: "act-elem" }],
    });
    expect(s.teams.map((t) => t.id).sort()).toEqual(["t-dira", "t-rechev"]);
    expect(s.teams.map((t) => t.id)).not.toContain("t-outside");
  });
});

describe("executive — business-wide targets, still a manager", () => {
  it("gets the activity → center grouping and is not a scoped-admin hybrid", () => {
    const groups = groupScopeRows({ kind: "executive", rows: lironRows(), units });
    expect(groups[0].label).toBe("פעילות אלמנטרי");
    expect((groups[0].subgroups ?? []).map((s) => s.label)).toEqual(["מוקד דירות וחידושים"]);
    expect(isScopedManagerKind("executive")).toBe(true);
    expect(isScopedManagerKind("admin")).toBe(false);
  });

  it("the targets page routes by TECHNICAL role — an executive lands in the manager view", () => {
    // role=representative → read-only personal view; everyone else (manager,
    // incl. executive-scope managers, and admin) → ManagerAdminTargetsView.
    expect(targetsSrc).toContain(
      '{role === "representative" ? <RepresentativeTargetsView /> : <ManagerAdminTargetsView />}',
    );
    // The scope overview renders only for scoped MANAGER kinds — the admin's
    // resolved kind is "admin", so the admin view is unchanged.
    expect(targetsSrc).toContain("isScopedManagerKind(scope?.kind)");
    expect(targetsSrc).toContain("{scopedManager && scope && (");
  });
});

describe("direct team manager (חן) — unchanged flow", () => {
  it("resolves to team_manager kind, so no scope overview renders for her", () => {
    const s = resolveBusinessScope({ role: "manager", userId: HEN, teams, units, grants: [] });
    expect(s.kind).toBe("team_manager");
    expect(isScopedManagerKind(s.kind)).toBe(false);
    expect(s.teams.map((t) => t.id)).toEqual(["t-dira"]);
  });

  it("keeps the original page description and picker flow for non-scoped managers", () => {
    expect(targetsSrc).toContain(
      "יעד חודשי רשמי לצוות ולכל נציג — המקור היחיד לחישובי עמידה ביעד, קצב ותחזית.",
    );
    // Team selection still comes ONLY from the workspace options — which are
    // scope-limited — for scoped and direct managers alike.
    expect(targetsSrc).toContain('options.filter((o) => o.type === "team")');
  });
});

describe("scope-aware UX on /targets", () => {
  it('scoped managers get the plural "יעדים בהיקף" overview before team selection', () => {
    expect(targetsSrc).toContain("יעדים בהיקף");
    expect(targetsSrc).toContain("function ScopeTargetsOverview");
    // The overview reuses the scope-home domain — one implementation of
    // grouping/missing-targets shared with ManagerHome.
    expect(targetsSrc).toContain("buildScopeTeamRows({");
    expect(targetsSrc).toContain("groupScopeRows({ kind: scope.kind as ScopedManagerKind");
    expect(targetsSrc).toContain("missingTargetsByTeam(rows)");
    // Selecting a team from the overview goes through the workspace switcher.
    expect(targetsSrc).toContain("onSelectTeam(row.id)");
  });
});

describe("KPI-profile wording on the edit panel", () => {
  it("renewals labels are מיועדות חודשיות / חידושים שנסגרו / אחוז חידוש", () => {
    expect(SCOPE_METRIC_LABELS.renewals).toEqual({
      target: "מיועדות חודשיות",
      result: "חידושים שנסגרו",
      rate: "אחוז חידוש",
    });
    expect(targetsSrc).toContain('const isRenewals = kpiProfile === "renewals"');
    expect(targetsSrc).toContain('{isRenewals ? metricLabels.target : "יעד צוות"}');
    expect(targetsSrc).toContain('isRenewals ? SCOPE_METRIC_LABELS.renewals.target : "יעד אישי"');
    expect(targetsSrc).toContain(
      'isRenewals ? SCOPE_METRIC_LABELS.renewals.result : "ביצוע נוכחי"',
    );
    expect(targetsSrc).toContain('isRenewals ? SCOPE_METRIC_LABELS.renewals.rate : "עמידה ביעד"');
  });

  it("generic_sales labels are יעד / ביצוע / אחוז עמידה", () => {
    expect(SCOPE_METRIC_LABELS.generic_sales).toEqual({
      target: "יעד",
      result: "ביצוע",
      rate: "אחוז עמידה",
    });
  });

  it("the overview never mixes profiles — each row carries its own labels", () => {
    expect(targetsSrc).toContain("SCOPE_METRIC_LABELS[row.kpiProfile]");
    expect(targetsSrc).toContain("KPI_PROFILE_LABEL[row.kpiProfile]");
  });
});

describe("source of truth and write authorization", () => {
  it("targets still read/write team_goals and representative_goals only", () => {
    expect(goalsFnsSrc).toContain('from("team_goals")');
    expect(goalsFnsSrc).toContain('from("representative_goals")');
    // kpi_values must never become the renewals denominator on this surface.
    expect(targetsSrc).not.toContain("kpi_values");
    expect(goalsFnsSrc).not.toContain("kpi_values");
  });

  it("every goal write is authorized through the RLS-scoped teams read (the scope funnel)", () => {
    expect(goalsFnsSrc).toContain("async function assertCanManageTeam");
    expect(goalsFnsSrc).toContain(
      'await ctx.supabase.from("teams").select("id").eq("id", teamId).maybeSingle()',
    );
    // No widened authorization was added in code: out-of-scope teams stay
    // invisible to the RLS read and the write is rejected.
    expect(goalsFnsSrc).toContain("הוא אינו בניהולך");
    for (const fn of ["getTargetWorkspace", "setTeamGoal", "setRepresentativeGoals"]) {
      expect(goalsFnsSrc).toContain(`export const ${fn}`);
    }
  });

  it("no migrations, no role/RLS surface, no CRM vocabulary", () => {
    expect(targetsSrc).not.toContain("ALTER ");
    expect(targetsSrc).not.toContain("user_roles");
    expect(goalsFnsSrc).not.toContain("ALTER ");
    for (const term of ["crm", "worklist", "queue", "policy_number", "call_outcome"]) {
      expect(targetsSrc.toLowerCase()).not.toContain(term);
    }
  });
});
