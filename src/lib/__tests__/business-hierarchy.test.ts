import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BUSINESS_ROLE_LABEL,
  EXECUTIVE_SCOPE_LABEL,
  IMPORT_SCOPE_ADMIN_LINE,
  IMPORT_SCOPE_LIMIT_LINE,
  importScopeNotice,
  resolveBusinessScope,
  teamsUnderUnit,
  type BusinessUnit,
  type ScopeTeam,
} from "@/lib/business-scope";

// ---------------------------------------------------------------------------
// Business hierarchy foundation: scope METADATA above teams — technical roles
// (admin / manager / representative) unchanged, admin stays the system
// administrator, teams.manager_id stays the authoritative team ownership.
// One resolution rule set (resolveBusinessScope) feeds the UI labels, the
// workspace switcher and the server function; RLS enforces the same coverage
// through the extended private.manages_team funnel.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const migrationSrc = read(
  "../../../supabase/migrations/20260808150000_business_hierarchy_foundation.sql",
);
const scopeSrc = read("../business-scope.ts");
const scopeFnsSrc = read("../business-scope.functions.ts");
const wsSrc = read("../workspace-context.tsx");
const homeSrc = read("../../routes/_authenticated/index.tsx");
const perfSrc = read("../../routes/_authenticated/performance.tsx");
const dataImportSrc = read("../../routes/_authenticated/data-import.tsx");
const teamsPageSrc = read("../../routes/_authenticated/teams.tsx");

// ------------------------------------------------------------------ fixtures
const HEN = "user-hen";
const units: BusinessUnit[] = [
  { id: "act-renewals", name: "חידושים", unitType: "activity", parentId: null },
  { id: "cen-north", name: "מוקד צפון", unitType: "center", parentId: "act-renewals" },
  { id: "cen-south", name: "מוקד דרום", unitType: "center", parentId: "act-renewals" },
];
const teams: ScopeTeam[] = [
  { id: "t-dira", name: "חידושי דירה", managerId: HEN, businessUnitId: "cen-north" },
  { id: "t-rechev", name: "חידושי רכב", managerId: "user-other", businessUnitId: "cen-north" },
  { id: "t-south", name: "צוות דרום", managerId: "user-south", businessUnitId: "cen-south" },
  { id: "t-generic", name: "צוות כללי", managerId: "user-generic", businessUnitId: null },
];

const resolveFor = (grants: Parameters<typeof resolveBusinessScope>[0]["grants"]) =>
  resolveBusinessScope({ role: "manager", userId: HEN, teams, units, grants });

// --------------------------------------------------------------- resolution
describe("B — scope resolution rules (single source of truth)", () => {
  it("a representative resolves to a personal scope with no team list", () => {
    const s = resolveBusinessScope({
      role: "representative",
      userId: "rep",
      teams,
      units,
      grants: [],
    });
    expect(s.kind).toBe("representative");
    expect(s.teams).toEqual([]);
    expect(s.roleLabel).toBe("נציג");
  });

  it("Hen (manager, no grants) sees only teams.manager_id teams — חידושי דירה by default", () => {
    const s = resolveFor([]);
    expect(s.kind).toBe("team_manager");
    expect(s.roleLabel).toBe("מנהל צוות");
    expect(s.teams.map((t) => t.name)).toEqual(["חידושי דירה"]);
    expect(s.scopeLabel).toBe("היקף צפייה: צוות חידושי דירה");
  });

  it("a center (מוקד) grant covers every team under that center, plus owned teams", () => {
    const s = resolveFor([{ scopeType: "center", businessUnitId: "cen-north" }]);
    expect(s.kind).toBe("center");
    expect(s.roleLabel).toBe("מנהל מוקד");
    expect(s.scopeLabel).toBe("היקף צפייה: מוקד צפון");
    expect(s.teams.map((t) => t.id).sort()).toEqual(["t-dira", "t-rechev"]);
    // The other center's team and the unattached team are NOT covered.
    expect(s.teams.map((t) => t.id)).not.toContain("t-south");
    expect(s.teams.map((t) => t.id)).not.toContain("t-generic");
  });

  it("an activity (פעילות) grant covers every team under the activity via its centers", () => {
    const s = resolveFor([{ scopeType: "activity", businessUnitId: "act-renewals" }]);
    expect(s.kind).toBe("activity");
    expect(s.roleLabel).toBe("מנהל פעילות");
    expect(s.scopeLabel).toBe("היקף צפייה: פעילות חידושים");
    expect(s.teams.map((t) => t.id).sort()).toEqual(["t-dira", "t-rechev", "t-south"]);
    expect(s.teams.map((t) => t.id)).not.toContain("t-generic");
  });

  it('an executive (סמנכ"ל / מנהל ממ"ט) grant is business-wide', () => {
    const s = resolveFor([{ scopeType: "executive", businessUnitId: null }]);
    expect(s.kind).toBe("executive");
    expect(s.roleLabel).toBe('סמנכ"ל / מנהל ממ"ט');
    expect(s.scopeLabel).toBe(EXECUTIVE_SCOPE_LABEL);
    expect(s.teams).toHaveLength(teams.length);
  });

  it("grants are ADDITIVE above teams.manager_id — owned teams stay covered outside the granted unit", () => {
    const ownsOutside: ScopeTeam[] = [
      ...teams,
      { id: "t-hen-extra", name: "צוות נוסף של חן", managerId: HEN, businessUnitId: null },
    ];
    const s = resolveBusinessScope({
      role: "manager",
      userId: HEN,
      teams: ownsOutside,
      units,
      grants: [{ scopeType: "center", businessUnitId: "cen-south" }],
    });
    expect(s.teams.map((t) => t.id).sort()).toEqual(["t-dira", "t-hen-extra", "t-south"]);
  });

  it("admin resolves as the system administrator — never a business-executive label", () => {
    const s = resolveBusinessScope({ role: "admin", userId: "admin-1", teams, units, grants: [] });
    expect(s.kind).toBe("admin");
    expect(s.roleLabel).toBe("מנהל מערכת");
    expect(s.roleLabel).not.toBe(BUSINESS_ROLE_LABEL.executive);
    expect(s.scopeLabel).toContain("מנהל מערכת");
    expect(s.scopeLabel).not.toContain('סמנכ"ל');
  });

  it("teamsUnderUnit: a team attached directly to an activity is covered by that activity", () => {
    const direct: ScopeTeam[] = [
      { id: "t-direct", name: "צוות ישיר", managerId: null, businessUnitId: "act-renewals" },
    ];
    expect(teamsUnderUnit("act-renewals", direct, units).map((t) => t.id)).toEqual(["t-direct"]);
  });
});

// ------------------------------------------------------------ import notice
describe("D — visible import scope on /data-import", () => {
  it("Hen's manager notice: limit line + the exact available team names", () => {
    const lines = importScopeNotice(resolveFor([]));
    expect(lines[0]).toBe("הייבוא מוגבל להיקף הניהול שלך");
    expect(lines[1]).toBe("צוותים זמינים: חידושי דירה");
    expect(IMPORT_SCOPE_LIMIT_LINE).toBe("הייבוא מוגבל להיקף הניהול שלך");
  });

  it("a center-scoped manager's notice lists the covered teams", () => {
    const lines = importScopeNotice(
      resolveFor([{ scopeType: "center", businessUnitId: "cen-north" }]),
    );
    expect(lines[1]).toContain("חידושי דירה");
    expect(lines[1]).toContain("חידושי רכב");
  });

  it("the admin notice states the system-administrator fact", () => {
    const s = resolveBusinessScope({ role: "admin", userId: "a", teams, units, grants: [] });
    expect(importScopeNotice(s)).toEqual(["מנהל מערכת — ניתן לייבא לכל הצוותים"]);
    expect(IMPORT_SCOPE_ADMIN_LINE).toBe("מנהל מערכת — ניתן לייבא לכל הצוותים");
  });

  it("a representative gets no import notice (and the page still blocks them)", () => {
    const s = resolveBusinessScope({
      role: "representative",
      userId: "r",
      teams,
      units,
      grants: [],
    });
    expect(importScopeNotice(s)).toEqual([]);
    expect(dataImportSrc).toContain("אזור למנהלים בלבד");
  });

  it("/data-import renders the scope card from the resolved scope", () => {
    expect(dataImportSrc).toContain("function ImportScopeCard");
    expect(dataImportSrc).toContain("scope.importNotice.map");
    expect(dataImportSrc).toContain("<ImportScopeCard />");
  });
});

// ------------------------------------------------------------- UI indicators
describe("D — visible scope labels on manager screens only", () => {
  it("ManagerHome header shows the היקף צפייה line for managers only", () => {
    expect(homeSrc).toContain('role === "manager" && businessScope?.scopeLabel');
  });

  it("/performance shows the scope label near the header", () => {
    expect(perfSrc).toContain("businessScope?.scopeLabel");
  });

  it("RepresentativeHome gets no business-scope machinery — only its own team label", () => {
    const repHome = homeSrc.slice(
      homeSrc.indexOf("function RepresentativeHome"),
      homeSrc.indexOf("function TopPerformersCard"),
    );
    expect(repHome).not.toContain("businessScope");
    expect(repHome).not.toContain("BusinessHierarchy");
  });

  it("the admin configuration card is admin-gated on the teams page", () => {
    expect(teamsPageSrc).toContain("{isAdmin && <BusinessHierarchyCard");
  });
});

// -------------------------------------------------------------- enforcement
describe("F/G — server-side enforcement funnels and ownership", () => {
  it("the migration extends the manages_team funnel ADDITIVELY — manager_id stays the first clause", () => {
    expect(migrationSrc).toContain("CREATE OR REPLACE FUNCTION private.manages_team");
    expect(migrationSrc).toContain("t.manager_id = auth.uid()");
    expect(migrationSrc).toContain("private.team_in_business_scope(_team_id, auth.uid())");
  });

  it("the rep-level funnel routes through manages_team so both agree on one scope", () => {
    expect(migrationSrc).toContain("CREATE OR REPLACE FUNCTION private.rep_in_my_team");
    expect(migrationSrc).toContain("r.id = _rep AND private.manages_team(r.team_id)");
  });

  it("scope grants are admin-write-only at the database", () => {
    expect(migrationSrc).toContain('"user_business_scopes admin all"');
    expect(migrationSrc).toContain("private.is_admin(auth.uid())");
  });

  it("the migration is additive and idempotent — no destructive statements, no role-enum change", () => {
    expect(migrationSrc).toContain("CREATE TABLE IF NOT EXISTS public.business_units");
    expect(migrationSrc).toContain("CREATE TABLE IF NOT EXISTS public.user_business_scopes");
    expect(migrationSrc).toContain("ADD COLUMN IF NOT EXISTS business_unit_id");
    expect(migrationSrc.toUpperCase()).not.toContain("DROP TABLE");
    expect(migrationSrc.toUpperCase()).not.toContain("TRUNCATE");
    expect(migrationSrc.toUpperCase()).not.toContain("DELETE FROM");
    expect(migrationSrc.toUpperCase()).not.toContain("ALTER TYPE");
    expect(migrationSrc).not.toContain("app_role");
  });

  it("getBusinessScope degrades to plain teams.manager_id scope when the migration is absent", () => {
    expect(scopeFnsSrc).toContain("return { units: [], grantRows: [] }");
    expect(scopeFnsSrc).toContain('.select("id, name, manager_id")');
    expect(scopeFnsSrc).toContain("HIERARCHY_TABLES_MISSING_MESSAGE");
  });

  it("the admin configuration writes are role-checked server-side and audited", () => {
    expect(scopeFnsSrc).toContain("await requireAdmin(ctx)");
    expect(scopeFnsSrc).toContain('"business_unit.created"');
    expect(scopeFnsSrc).toContain('"team.business_unit_set"');
    expect(scopeFnsSrc).toContain('"user.business_scope_set"');
    expect(scopeFnsSrc).toContain("רק מנהל מערכת יכול להגדיר את ההיררכיה העסקית");
  });

  it("attachTeamToUnit only writes business_unit_id — teams.manager_id is never touched", () => {
    expect(scopeFnsSrc).toContain(".update({ business_unit_id: data.unitId })");
    expect(scopeFnsSrc).not.toContain("update({ manager_id");
  });
});

// ---------------------------------------------------------------- workspace
describe("B — workspace switcher follows the resolved scope", () => {
  it("manager options keep teams.manager_id first and add scope-covered teams", () => {
    expect(wsSrc).toContain("t.managerId === userId || scopeIds.has(t.id)");
  });

  it("a manager with no grants keeps exactly today's behavior (empty scope set)", () => {
    expect(wsSrc).toContain("scopeTeamIds?: string[]");
  });
});

// -------------------------------------------------------------- boundaries
describe("I — technical roles and product surface unchanged", () => {
  it("the technical role vocabulary in the domain is exactly admin/manager/representative", () => {
    expect(scopeSrc).toContain('role: "admin" | "manager" | "representative"');
  });

  it("admin stays מנהל מערכת; the business titles are distinct labels", () => {
    expect(BUSINESS_ROLE_LABEL.admin).toBe("מנהל מערכת");
    expect(BUSINESS_ROLE_LABEL.team_manager).toBe("מנהל צוות");
    expect(BUSINESS_ROLE_LABEL.center).toBe("מנהל מוקד");
    expect(BUSINESS_ROLE_LABEL.activity).toBe("מנהל פעילות");
    expect(BUSINESS_ROLE_LABEL.executive).toBe('סמנכ"ל / מנהל ממ"ט');
    expect(BUSINESS_ROLE_LABEL.representative).toBe("נציג");
  });

  it("no worklist/queue/customer/CRM/call-outcome vocabulary in the new modules", () => {
    for (const src of [scopeSrc, scopeFnsSrc, migrationSrc]) {
      for (const term of [
        "worklist",
        "call_outcome",
        "customer_id",
        "next customer",
        "policy_number",
      ]) {
        expect(src.toLowerCase()).not.toContain(term);
      }
    }
  });
});
