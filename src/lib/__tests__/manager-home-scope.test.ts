// ManagerHome for business-scope managers (מנהל מוקד / מנהל פעילות / סמנכ"ל):
//   * the header identity is the business title — never "לא הוגדר צוות
//     לניהול", because no profile team + no direct teams.manager_id rows is a
//     VALID setup for a scope manager;
//   * the primary dashboard is the teams in scope, grouped by the manager's
//     hierarchy level, labeled by each team's OWN kpi_profile;
//   * missing representative targets are grouped by team;
//   * renewals and generic-sales figures are aggregated per profile, never
//     combined into one misleading total.
// Direct team managers, representatives and the admin keep their exact
// previous behavior.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  resolveBusinessScope,
  EXECUTIVE_SCOPE_LABEL,
  type BusinessUnit,
  type ScopeTeam,
} from "../business-scope";
import {
  aggregateByProfile,
  buildScopeTeamRows,
  groupScopeRows,
  isScopedManagerKind,
  managerHeaderPrimaryLine,
  missingTargetsByTeam,
  SCOPE_DIRECT_ACTIVITY_GROUP_LABEL,
  SCOPE_METRIC_LABELS,
  SCOPE_TARGETS_ACTION_LABEL,
  SCOPE_UNATTACHED_GROUP_LABEL,
  TEAM_TARGETS_ACTION_LABEL,
  type ScopeTeamRow,
} from "../scope-home";
import { NO_MANAGED_TEAM_LABEL } from "../workspace-context";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const homeSrc = read("../../routes/_authenticated/index.tsx");
const scopeHomeSrc = read("../scope-home.ts");
const scopeCardsSrc = read("../../components/ScopeHomeCards.tsx");
const scopeFnsSrc = read("../business-scope.functions.ts");

// ---------------------------------------------------------------- fixtures
// Mirrors the live QA setup: פעילות אלמנטרי → מוקד דירות וחידושים →
// {חידושי דירה (managed by חן), חידושי רכב (no manager)}, plus a second
// center and an unattached generic team for the wider scopes.

const LIRON = "user-liron";
const HEN = "user-hen";

const units: BusinessUnit[] = [
  { id: "act-elem", name: "אלמנטרי", unitType: "activity", parentId: null },
  { id: "cen-dira", name: "דירות וחידושים", unitType: "center", parentId: "act-elem" },
  { id: "cen-south", name: "מוקד דרום", unitType: "center", parentId: "act-elem" },
];

const teams: ScopeTeam[] = [
  { id: "t-dira", name: "חידושי דירה", managerId: HEN, businessUnitId: "cen-dira" },
  { id: "t-rechev", name: "חידושי רכב", managerId: null, businessUnitId: "cen-dira" },
  { id: "t-south", name: "צוות דרום", managerId: null, businessUnitId: "cen-south" },
  { id: "t-generic", name: "מכירות כללי", managerId: null, businessUnitId: null },
];

const centerScope = () =>
  resolveBusinessScope({
    role: "manager",
    userId: LIRON,
    teams,
    units,
    grants: [{ scopeType: "center", businessUnitId: "cen-dira" }],
  });

const activityScope = () =>
  resolveBusinessScope({
    role: "manager",
    userId: LIRON,
    teams,
    units,
    grants: [{ scopeType: "activity", businessUnitId: "act-elem" }],
  });

const executiveScope = () =>
  resolveBusinessScope({
    role: "manager",
    userId: LIRON,
    teams,
    units,
    grants: [{ scopeType: "executive", businessUnitId: null }],
  });

describe("header identity — the business title replaces the missing-team warning", () => {
  it("center manager without direct team shows מנהל מוקד · <center>, never the warning (לירון)", () => {
    const s = centerScope();
    expect(s.title).toBe("מנהל מוקד · דירות וחידושים");
    expect(managerHeaderPrimaryLine(s, NO_MANAGED_TEAM_LABEL)).toBe("מנהל מוקד · דירות וחידושים");
    expect(managerHeaderPrimaryLine(s, NO_MANAGED_TEAM_LABEL)).not.toContain(NO_MANAGED_TEAM_LABEL);
    expect(s.scopeLabel).toBe("היקף צפייה: מוקד דירות וחידושים");
  });

  it("activity manager shows מנהל פעילות · <activity> with the activity scope line", () => {
    const s = activityScope();
    expect(s.title).toBe("מנהל פעילות · אלמנטרי");
    expect(s.scopeLabel).toBe("היקף צפייה: פעילות אלמנטרי");
    expect(managerHeaderPrimaryLine(s, NO_MANAGED_TEAM_LABEL)).toBe("מנהל פעילות · אלמנטרי");
  });

  it("executive shows the standalone title with the business-wide scope line", () => {
    const s = executiveScope();
    expect(s.title).toBe('סמנכ"ל / מנהל ממ"ט');
    expect(s.scopeLabel).toBe(EXECUTIVE_SCOPE_LABEL);
    expect(EXECUTIVE_SCOPE_LABEL).toBe("היקף צפייה: כלל הפעילות העסקית");
    expect(managerHeaderPrimaryLine(s, NO_MANAGED_TEAM_LABEL)).toBe('סמנכ"ל / מנהל ממ"ט');
  });

  it("direct team manager keeps the workspace-derived label (חן)", () => {
    const s = resolveBusinessScope({ role: "manager", userId: HEN, teams, units, grants: [] });
    expect(s.kind).toBe("team_manager");
    expect(managerHeaderPrimaryLine(s, "חידושי דירה")).toBe("חידושי דירה");
  });

  it("manager with no scope and no team still gets the honest warning", () => {
    const s = resolveBusinessScope({
      role: "manager",
      userId: "user-nobody",
      teams,
      units,
      grants: [],
    });
    expect(s.kind).toBe("team_manager");
    expect(managerHeaderPrimaryLine(s, NO_MANAGED_TEAM_LABEL)).toBe(NO_MANAGED_TEAM_LABEL);
  });

  it("executive is a manager scope, not the admin — and the admin is not a scoped manager", () => {
    expect(isScopedManagerKind("executive")).toBe(true);
    expect(isScopedManagerKind("admin")).toBe(false);
    expect(isScopedManagerKind("team_manager")).toBe(false);
    expect(isScopedManagerKind("representative")).toBe(false);
    // HomePage still routes by TECHNICAL role: admin → AdminHome, manager →
    // ManagerHome. An executive (role=manager) can never reach AdminHome.
    expect(homeSrc).toContain('if (role === "admin") return <AdminHome />;');
    const s = resolveBusinessScope({ role: "admin", userId: "a", teams, units, grants: [] });
    expect(s.title).toBe("מנהל מערכת");
  });

  it("the home header resolves through the scoped-title helper with the old label as fallback", () => {
    expect(homeSrc).toContain("managerHeaderPrimaryLine(");
    expect(homeSrc).toContain("managerScopeLabel({ workspace, managedTeams, ready })");
  });
});

// ---------------------------------------------------------------- dashboard

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
  {
    id: "t-south",
    name: "צוות דרום",
    kpiProfile: "generic_sales" as const,
    businessUnitId: "cen-south",
  },
  {
    id: "t-generic",
    name: "מכירות כללי",
    kpiProfile: "generic_sales" as const,
    businessUnitId: null,
  },
];

const rep = (id: string, teamId: string, currentResult: number) => ({ id, teamId, currentResult });

const reps = [
  rep("r1", "t-dira", 40),
  rep("r2", "t-dira", 20),
  rep("r3", "t-rechev", 10),
  rep("r4", "t-rechev", 5),
  rep("r5", "t-south", 30),
];

const goalsByTeamId = new Map<string, number>([
  ["t-dira", 100],
  ["t-south", 60],
]);
const goalsByRepId = new Map<string, number>([
  ["r1", 50],
  ["r2", 50],
  ["r5", 60],
]);

const rows = () =>
  buildScopeTeamRows({ teams: scopeTeamInputs, reps, goalsByTeamId, goalsByRepId });

describe("scope team rows — each team speaks its own KPI language", () => {
  it("a renewals team computes אחוז חידוש from closed/assigned", () => {
    const dira = rows().find((r) => r.id === "t-dira")!;
    expect(dira.kpiProfile).toBe("renewals");
    expect(dira.target).toBe(100);
    expect(dira.completed).toBe(60);
    expect(dira.pct).toBe(60);
    expect(SCOPE_METRIC_LABELS.renewals).toEqual({
      target: "מיועדות חודשיות",
      result: "חידושים שנסגרו",
      rate: "אחוז חידוש",
    });
  });

  it("a generic_sales team computes אחוז עמידה from ביצוע/יעד", () => {
    const south = rows().find((r) => r.id === "t-south")!;
    expect(south.kpiProfile).toBe("generic_sales");
    expect(south.pct).toBe(50);
    expect(SCOPE_METRIC_LABELS.generic_sales).toEqual({
      target: "יעד",
      result: "ביצוע",
      rate: "אחוז עמידה",
    });
  });

  it("no target denominator → pct null, never 0%", () => {
    const rechev = rows().find((r) => r.id === "t-rechev")!;
    expect(rechev.target).toBeNull();
    expect(rechev.completed).toBe(15);
    expect(rechev.pct).toBeNull();
  });

  it("counts representatives without a positive official target per team", () => {
    const byId = new Map(rows().map((r) => [r.id, r]));
    expect(byId.get("t-dira")!.missingTargets).toBe(0);
    expect(byId.get("t-rechev")!.missingTargets).toBe(2);
    expect(byId.get("t-south")!.missingTargets).toBe(0);
  });
});

describe("missing targets are grouped by team", () => {
  it('produces per-team lines like "חידושי רכב · 2 נציגים ללא יעד", worst first', () => {
    const missing = missingTargetsByTeam(rows());
    expect(missing[0].line).toBe("חידושי רכב · 2 נציגים ללא יעד");
    const diraLine = missing.find((m) => m.teamId === "t-dira")!;
    expect(diraLine.line).toBe("חידושי דירה · 0 נציגים ללא יעד");
    // The denominator travels with the count.
    expect(missing[0].repCount).toBe(2);
  });
});

describe("hierarchy grouping per scope level", () => {
  it("center manager gets a flat team listing (the center is the group)", () => {
    const centerRows = rows().filter((r) => r.businessUnitId === "cen-dira");
    const groups = groupScopeRows({ kind: "center", rows: centerRows, units });
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBeNull();
    expect(groups[0].rows.map((r) => r.name)).toEqual(["חידושי דירה", "חידושי רכב"]);
  });

  it("activity manager groups teams by center, with direct attachments labeled honestly", () => {
    const activityRows = rows().filter((r) =>
      ["cen-dira", "cen-south"].includes(r.businessUnitId ?? ""),
    );
    const directRow: ScopeTeamRow = {
      ...activityRows[0],
      id: "t-direct",
      name: "צוות ישיר",
      businessUnitId: "act-elem",
    };
    const groups = groupScopeRows({
      kind: "activity",
      rows: [...activityRows, directRow],
      units,
    });
    expect(groups.map((g) => g.label)).toEqual([
      "מוקד דירות וחידושים",
      "מוקד דרום",
      SCOPE_DIRECT_ACTIVITY_GROUP_LABEL,
    ]);
    expect(groups[0].rows.map((r) => r.id).sort()).toEqual(["t-dira", "t-rechev"]);
  });

  it("executive groups by activity with centers as subgroups, plus the unattached remainder", () => {
    const groups = groupScopeRows({ kind: "executive", rows: rows(), units });
    expect(groups.map((g) => g.label)).toEqual(["פעילות אלמנטרי", SCOPE_UNATTACHED_GROUP_LABEL]);
    const elem = groups[0];
    expect((elem.subgroups ?? []).map((s) => s.label)).toEqual([
      "מוקד דירות וחידושים",
      "מוקד דרום",
    ]);
    const unattached = groups[1];
    expect(unattached.rows.map((r) => r.id)).toEqual(["t-generic"]);
  });

  it("drops empty groups instead of rendering headers over nothing", () => {
    const onlyDira = rows().filter((r) => r.businessUnitId === "cen-dira");
    const groups = groupScopeRows({ kind: "activity", rows: onlyDira, units });
    expect(groups.map((g) => g.label)).toEqual(["מוקד דירות וחידושים"]);
  });

  // PR #45 follow-up: a covered team with NO hierarchy attachment (e.g. one
  // the activity manager also owns via teams.manager_id) was in scope, in the
  // switcher and in the aggregates — but in no visible group. It now lands in
  // an honest "ללא שיוך להיררכיה" fallback, always last, never duplicated.
  it("activity grouping includes an unattached fallback so no covered team disappears", () => {
    const activityRows = rows().filter((r) =>
      ["cen-dira", "cen-south"].includes(r.businessUnitId ?? ""),
    );
    const ownedUnattached: ScopeTeamRow = {
      ...activityRows[0],
      id: "t-owned",
      name: "צוות בבעלות ישירה",
      businessUnitId: null,
    };
    const groups = groupScopeRows({
      kind: "activity",
      rows: [...activityRows, ownedUnattached],
      units,
    });
    expect(groups.map((g) => g.label)).toEqual([
      "מוקד דירות וחידושים",
      "מוקד דרום",
      SCOPE_UNATTACHED_GROUP_LABEL,
    ]);
    const fallback = groups[groups.length - 1];
    expect(fallback.rows.map((r) => r.id)).toEqual(["t-owned"]);
    // Grouping priority: centers → direct-to-activity → unattached, and every
    // covered row appears exactly once across all groups.
    const allGrouped = groups.flatMap((g) => g.rows.map((r) => r.id));
    expect(allGrouped.sort()).toEqual(["t-dira", "t-owned", "t-rechev", "t-south"]);
    expect(new Set(allGrouped).size).toBe(allGrouped.length);
  });

  it("a team already under a center or directly attached is never duplicated into the fallback", () => {
    const activityRows = rows().filter((r) =>
      ["cen-dira", "cen-south"].includes(r.businessUnitId ?? ""),
    );
    const directRow: ScopeTeamRow = {
      ...activityRows[0],
      id: "t-direct",
      name: "צוות ישיר",
      businessUnitId: "act-elem",
    };
    const groups = groupScopeRows({
      kind: "activity",
      rows: [...activityRows, directRow],
      units,
    });
    // No unattached rows → no fallback group at all.
    expect(groups.map((g) => g.label)).toEqual([
      "מוקד דירות וחידושים",
      "מוקד דרום",
      SCOPE_DIRECT_ACTIVITY_GROUP_LABEL,
    ]);
    const allGrouped = groups.flatMap((g) => g.rows.map((r) => r.id));
    expect(new Set(allGrouped).size).toBe(allGrouped.length);
    expect(allGrouped).toContain("t-direct");
  });

  it("a row attached to an unknown unit id falls back instead of vanishing", () => {
    const ghost: ScopeTeamRow = {
      ...rows()[0],
      id: "t-ghost",
      name: "צוות רפאים",
      businessUnitId: "unit-deleted",
    };
    const groups = groupScopeRows({ kind: "activity", rows: [ghost], units });
    expect(groups.map((g) => g.label)).toEqual([SCOPE_UNATTACHED_GROUP_LABEL]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["t-ghost"]);
  });

  it("center and executive grouping are unchanged by the activity fallback", () => {
    // Center: still one flat, label-less group — even for an unattached row.
    const centerGroups = groupScopeRows({
      kind: "center",
      rows: rows().filter((r) => r.businessUnitId === "cen-dira"),
      units,
    });
    expect(centerGroups).toHaveLength(1);
    expect(centerGroups[0].label).toBeNull();
    // Executive: keeps its own pre-existing unattached remainder group.
    const execGroups = groupScopeRows({ kind: "executive", rows: rows(), units });
    expect(execGroups.map((g) => g.label)).toEqual([
      "פעילות אלמנטרי",
      SCOPE_UNATTACHED_GROUP_LABEL,
    ]);
    expect(execGroups[1].rows.map((r) => r.id)).toEqual(["t-generic"]);
  });

  it("aggregates still count every covered row exactly once, grouped or fallback", () => {
    const activityRows = rows().filter((r) =>
      ["cen-dira", "cen-south"].includes(r.businessUnitId ?? ""),
    );
    const ownedUnattached: ScopeTeamRow = {
      ...activityRows.find((r) => r.id === "t-south")!,
      id: "t-owned",
      name: "צוות בבעלות ישירה",
      businessUnitId: null,
    };
    const all = [...activityRows, ownedUnattached];
    const aggs = aggregateByProfile(all);
    const total = aggs.reduce((a, g) => a + g.teamCount, 0);
    expect(total).toBe(all.length);
    // The generic aggregate counts t-south AND the unattached copy once each.
    const generic = aggs.find((a) => a.kpiProfile === "generic_sales")!;
    expect(generic.teamCount).toBe(2);
    expect(generic.completed).toBe(60);
  });
});

describe("per-profile aggregation — never one combined total", () => {
  it("a mixed scope produces one aggregate per profile, renewals first", () => {
    const aggs = aggregateByProfile(rows());
    expect(aggs.map((a) => a.kpiProfile)).toEqual(["renewals", "generic_sales"]);
    const renewals = aggs[0];
    expect(renewals.teamCount).toBe(2);
    expect(renewals.teamsWithTarget).toBe(1);
    expect(renewals.target).toBe(100);
    expect(renewals.completed).toBe(75); // both teams' results are reported…
    expect(renewals.pct).toBe(60); // …but only targeted teams enter the rate
    const generic = aggs[1];
    expect(generic.target).toBe(60);
    expect(generic.completed).toBe(30);
    expect(generic.pct).toBe(50);
  });

  it("a single-profile scope produces exactly one aggregate", () => {
    const aggs = aggregateByProfile(rows().filter((r) => r.kpiProfile === "renewals"));
    expect(aggs).toHaveLength(1);
    expect(aggs[0].kpiProfile).toBe("renewals");
  });

  it("no targets anywhere → target and pct stay null rather than 0", () => {
    const aggs = aggregateByProfile(
      rows()
        .filter((r) => r.kpiProfile === "renewals")
        .map((r) => ({ ...r, target: null, pct: null })),
    );
    expect(aggs[0].target).toBeNull();
    expect(aggs[0].pct).toBeNull();
    expect(aggs[0].completed).toBe(75);
  });
});

describe("wiring — the scoped dashboard renders for scope managers only", () => {
  it("ManagerHome renders the scope cards behind the scoped-manager flag", () => {
    const managerHome = homeSrc.slice(
      homeSrc.indexOf("function ManagerHome"),
      homeSrc.indexOf("function RepresentativeHome"),
    );
    expect(managerHome).toContain("isScopedManagerKind(scope?.kind)");
    expect(managerHome).toContain("<ScopeOverviewCard");
    expect(managerHome).toContain("<ScopeMissingTargetsCard");
    expect(managerHome).toContain("{scopedManager && (");
    // Direct team managers keep their unchanged primary layout.
    expect(managerHome).toContain('{!scopedManager && workspace.type === "team" && (');
  });

  it('quick action reads "יעדי צוותים" for scope managers, "יעדי הצוות" otherwise', () => {
    expect(SCOPE_TARGETS_ACTION_LABEL).toBe("יעדי צוותים");
    expect(TEAM_TARGETS_ACTION_LABEL).toBe("יעדי הצוות");
    expect(homeSrc).toContain(
      "scopedManager ? SCOPE_TARGETS_ACTION_LABEL : TEAM_TARGETS_ACTION_LABEL",
    );
  });

  it("RepresentativeHome stays personal-only — no scope dashboard", () => {
    const repHome = homeSrc.slice(
      homeSrc.indexOf("function RepresentativeHome"),
      homeSrc.indexOf("function TopPerformersCard"),
    );
    expect(repHome).not.toContain("ScopeOverviewCard");
    expect(repHome).not.toContain("useBusinessScope");
  });

  it("AdminHome stays a system console — no scope dashboard", () => {
    const adminHome = homeSrc.slice(
      homeSrc.indexOf("function AdminHome"),
      homeSrc.indexOf("function SystemGapsCard"),
    );
    expect(adminHome).not.toContain("ScopeOverviewCard");
  });

  it("the scope payload carries units and team attachments read-only (no writes)", () => {
    expect(scopeFnsSrc).toContain("units: BusinessUnit[];");
    expect(scopeFnsSrc).toContain("teamUnits: { id: string; businessUnitId: string | null }[];");
    expect(scopeFnsSrc).not.toContain('from("business_units").insert');
    expect(scopeFnsSrc).not.toContain('from("teams").update');
  });

  it("no roles/RLS/auth surface and no CRM vocabulary in the new modules", () => {
    for (const src of [scopeHomeSrc, scopeCardsSrc]) {
      expect(src).not.toContain("ALTER ");
      expect(src).not.toContain("user_roles");
      for (const term of ["crm", "worklist", "queue", "policy_number", "call_outcome"]) {
        expect(src.toLowerCase()).not.toContain(term);
      }
    }
  });
});
