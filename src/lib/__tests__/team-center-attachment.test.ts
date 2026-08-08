import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  centerOptionLabel,
  resolveBusinessScope,
  validateAttachTargetUnitType,
  TEAM_ATTACH_CENTER_ONLY_MESSAGE,
  type BusinessUnit,
  type ScopeTeam,
} from "@/lib/business-scope";
import {
  validateUnitDeletion,
  UNIT_NAME_REQUIRED_MESSAGE,
  DELETE_ACTIVITY_HAS_CENTERS_MESSAGE,
  DELETE_ACTIVITY_HAS_TEAMS_MESSAGE,
  DELETE_CENTER_HAS_TEAMS_MESSAGE,
  DELETE_UNIT_HAS_SCOPES_MESSAGE,
} from "@/lib/business-scope.functions";

// ---------------------------------------------------------------------------
// Teams attach to CENTERS only (live-QA product-model fix): a team's parent
// is a מוקד; the פעילות is inherited through the מוקד and is never a team's
// direct parent. UI offers centers only, the server function validates, and
// a narrow additive trigger enforces the same rule at the database — with no
// automatic rewrite of legacy rows.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const teamsPageSrc = read("../../routes/_authenticated/teams.tsx");
const scopeFnsSrc = read("../business-scope.functions.ts");
const migrationSrc = read(
  "../../../supabase/migrations/20260808170000_teams_attach_centers_only.sql",
);

const units: BusinessUnit[] = [
  { id: "act-elem", name: "אלמנטרי", unitType: "activity", parentId: null },
  { id: "cen-cars", name: "רכב", unitType: "center", parentId: "act-elem" },
  { id: "cen-dira", name: "דירות וחידושים", unitType: "center", parentId: "act-elem" },
];

// ------------------------------------------------------------- validation (B)
describe("B — center-only attachment rule", () => {
  it("null (detach) remains allowed", () => {
    expect(() => validateAttachTargetUnitType(null)).not.toThrow();
  });

  it("a center is accepted", () => {
    expect(() => validateAttachTargetUnitType("center")).not.toThrow();
  });

  it("an activity is rejected with the friendly Hebrew rule", () => {
    expect(() => validateAttachTargetUnitType("activity")).toThrowError(
      TEAM_ATTACH_CENTER_ONLY_MESSAGE,
    );
    expect(TEAM_ATTACH_CENTER_ONLY_MESSAGE).toBe(
      "צוות ניתן לשייך למוקד בלבד. הפעילות נקבעת דרך המוקד.",
    );
  });

  it("the server function validates the unit type before writing", () => {
    expect(scopeFnsSrc).toContain('.select("unit_type")');
    expect(scopeFnsSrc).toContain("validateAttachTargetUnitType(");
    // Unknown unit types fail the rule too — only an explicit center passes.
    expect(scopeFnsSrc).toContain('unit_type === "center" ? "center" : "activity"');
  });
});

// ---------------------------------------------------------------- migration
describe("B — database trigger (additive, idempotent, no data rewrite)", () => {
  it("rejects non-center parents with the same Hebrew rule", () => {
    expect(migrationSrc).toContain("CREATE OR REPLACE FUNCTION public.validate_team_business_unit");
    expect(migrationSrc).toContain("IS DISTINCT FROM 'center'");
    expect(migrationSrc).toContain("צוות ניתן לשייך למוקד בלבד. הפעילות נקבעת דרך המוקד.");
    expect(migrationSrc).toContain("DROP TRIGGER IF EXISTS trg_teams_business_unit_center_only");
  });

  it("carries no destructive statements and rewrites no existing data", () => {
    expect(migrationSrc.toUpperCase()).not.toContain("DROP TABLE");
    expect(migrationSrc.toUpperCase()).not.toContain("TRUNCATE");
    expect(migrationSrc.toUpperCase()).not.toContain("DELETE FROM");
    expect(migrationSrc.toUpperCase()).not.toContain("ALTER TYPE");
    expect(migrationSrc).not.toContain("UPDATE public.teams");
    expect(migrationSrc).not.toContain("app_role");
  });
});

// ---------------------------------------------------------------------- UI (A)
describe("A — attach dropdown offers centers only", () => {
  const attachSection = teamsPageSrc.slice(
    teamsPageSrc.indexOf("{/* Attach team */}"),
    teamsPageSrc.indexOf("{/* Assign manager scope */}"),
  );

  it('the label is "מוקד" and the dropdown maps centers, never all units', () => {
    expect(attachSection).toContain("<Label>מוקד</Label>");
    expect(attachSection).toContain("centers.map");
    expect(attachSection).not.toContain("(view.units ?? []).map");
    expect(attachSection).toContain('aria-label="בחירת מוקד"');
  });

  it('"ללא שיוך" (detach) stays offered', () => {
    expect(attachSection).toContain("ללא שיוך");
  });

  it("center options carry the parent activity for clarity", () => {
    expect(attachSection).toContain("centerOptionLabel(c, view.units ?? [])");
    expect(centerOptionLabel(units[2], units)).toBe("מוקד דירות וחידושים · פעילות אלמנטרי");
    expect(centerOptionLabel(units[1], units)).toBe("מוקד רכב · פעילות אלמנטרי");
  });

  it("a unit name that already carries its type word is not doubled", () => {
    const named: BusinessUnit[] = [
      { id: "a", name: "פעילות אלמנטרי", unitType: "activity", parentId: null },
      { id: "c", name: "מוקד צפון", unitType: "center", parentId: "a" },
    ];
    expect(centerOptionLabel(named[1], named)).toBe("מוקד צפון · פעילות אלמנטרי");
  });

  it("legacy activity-attached teams get a warning for a manual admin fix", () => {
    expect(teamsPageSrc).toContain("activityAttachedTeams");
    expect(teamsPageSrc).toContain("ויש להעבירם למוקד");
  });

  it("the create-unit flow is unchanged: activity is a root, a center needs its parent activity", () => {
    expect(teamsPageSrc).toContain("פעילות אב");
    expect(scopeFnsSrc).toContain("מוקד חייב להשתייך לפעילות");
    expect(scopeFnsSrc).toContain("פעילות היא יחידת שורש — ללא יחידת אב");
  });
});

// ------------------------------------------------------------ scope safety (C)
describe("C — scope behavior unchanged", () => {
  const HEN = "user-hen";
  const teams: ScopeTeam[] = [
    { id: "t-cars-1", name: "צוות רכב 1", managerId: null, businessUnitId: "cen-cars" },
    { id: "t-dira", name: "חידושי דירה", managerId: HEN, businessUnitId: "cen-dira" },
    { id: "t-ren-cars", name: "צוות חידושי רכב", managerId: null, businessUnitId: "cen-dira" },
  ];

  it("activity scope still covers all teams THROUGH its centers", () => {
    const s = resolveBusinessScope({
      role: "manager",
      userId: HEN,
      teams,
      units,
      grants: [{ scopeType: "activity", businessUnitId: "act-elem" }],
    });
    expect(s.teams.map((t) => t.id).sort()).toEqual(["t-cars-1", "t-dira", "t-ren-cars"]);
  });

  it("center scope covers only that center's teams (plus owned)", () => {
    const s = resolveBusinessScope({
      role: "manager",
      userId: "user-other",
      teams,
      units,
      grants: [{ scopeType: "center", businessUnitId: "cen-cars" }],
    });
    expect(s.teams.map((t) => t.id)).toEqual(["t-cars-1"]);
  });

  it("Hen without grants remains חידושי דירה only", () => {
    const s = resolveBusinessScope({ role: "manager", userId: HEN, teams, units, grants: [] });
    expect(s.teams.map((t) => t.name)).toEqual(["חידושי דירה"]);
  });

  it("representatives remain personal-only and admin remains מנהל מערכת", () => {
    const rep = resolveBusinessScope({
      role: "representative",
      userId: "r",
      teams,
      units,
      grants: [],
    });
    expect(rep.teams).toEqual([]);
    const admin = resolveBusinessScope({ role: "admin", userId: "a", teams, units, grants: [] });
    expect(admin.roleLabel).toBe("מנהל מערכת");
  });
});

// ------------------------------------------------- unit edit/delete (admin)
describe("edit/delete business units — admin-only, guarded, never cascading", () => {
  it("empty name is blocked with the Hebrew error", () => {
    expect(UNIT_NAME_REQUIRED_MESSAGE).toBe("יש להזין שם יחידה");
    expect(scopeFnsSrc).toContain("throw new Error(UNIT_NAME_REQUIRED_MESSAGE)");
  });

  it("editing changes the name only — the unit type is immutable", () => {
    const fn = scopeFnsSrc.slice(
      scopeFnsSrc.indexOf("export const updateBusinessUnit"),
      scopeFnsSrc.indexOf("export const deleteBusinessUnit"),
    );
    expect(fn).toContain("await requireAdmin(ctx)");
    expect(fn).toContain("const patch: Record<string, unknown> = { name: data.name };");
    // No type write anywhere in the update patch.
    expect(fn).not.toContain("patch.unit_type");
    expect(fn).toContain('"business_unit.updated"');
  });

  it("a center's parent may change only to an activity", () => {
    expect(scopeFnsSrc).toContain("פעילות אב חייבת להיות יחידת פעילות");
    const fn = scopeFnsSrc.slice(
      scopeFnsSrc.indexOf("export const updateBusinessUnit"),
      scopeFnsSrc.indexOf("export const deleteBusinessUnit"),
    );
    expect(fn).toContain('existing.unit_type === "center"');
  });

  it("delete guards: an empty center passes", () => {
    expect(() =>
      validateUnitDeletion({
        unitType: "center",
        childCenters: 0,
        linkedTeams: 0,
        activeGrants: 0,
      }),
    ).not.toThrow();
  });

  it("delete guards: a center with linked teams is blocked", () => {
    expect(() =>
      validateUnitDeletion({
        unitType: "center",
        childCenters: 0,
        linkedTeams: 2,
        activeGrants: 0,
      }),
    ).toThrowError(DELETE_CENTER_HAS_TEAMS_MESSAGE);
    expect(DELETE_CENTER_HAS_TEAMS_MESSAGE).toBe("לא ניתן למחוק מוקד שמשויכים אליו צוותים");
  });

  it("delete guards: a unit with active scope grants is blocked", () => {
    expect(() =>
      validateUnitDeletion({
        unitType: "center",
        childCenters: 0,
        linkedTeams: 0,
        activeGrants: 1,
      }),
    ).toThrowError(DELETE_UNIT_HAS_SCOPES_MESSAGE);
    expect(() =>
      validateUnitDeletion({
        unitType: "activity",
        childCenters: 0,
        linkedTeams: 0,
        activeGrants: 1,
      }),
    ).toThrowError(DELETE_UNIT_HAS_SCOPES_MESSAGE);
    expect(DELETE_UNIT_HAS_SCOPES_MESSAGE).toBe("לא ניתן למחוק יחידה שיש לה היקפי ניהול פעילים");
  });

  it("delete guards: an activity with centers is blocked", () => {
    expect(() =>
      validateUnitDeletion({
        unitType: "activity",
        childCenters: 1,
        linkedTeams: 0,
        activeGrants: 0,
      }),
    ).toThrowError(DELETE_ACTIVITY_HAS_CENTERS_MESSAGE);
    expect(DELETE_ACTIVITY_HAS_CENTERS_MESSAGE).toBe("לא ניתן למחוק פעילות שיש תחתיה מוקדים");
  });

  it("delete guards: an activity with legacy directly-linked teams is blocked too", () => {
    expect(() =>
      validateUnitDeletion({
        unitType: "activity",
        childCenters: 0,
        linkedTeams: 1,
        activeGrants: 0,
      }),
    ).toThrowError(DELETE_ACTIVITY_HAS_TEAMS_MESSAGE);
  });

  it("delete removes exactly one business_units row — never teams/reps/goals/feedback/performance", () => {
    const fn = scopeFnsSrc.slice(scopeFnsSrc.indexOf("export const deleteBusinessUnit"));
    expect(fn).toContain("await requireAdmin(ctx)");
    expect(fn).toContain("validateUnitDeletion(");
    expect(fn).toContain('"business_unit.deleted"');
    // The whole module performs exactly two deletes: replacing a user's scope
    // grants (setUserBusinessScope) and this single business_units row.
    expect(scopeFnsSrc.match(/\.delete\(\)/g)).toHaveLength(2);
    for (const table of [
      "representatives",
      "kpi_values",
      "feedback",
      "representative_goals",
      "team_goals",
      "import_history",
    ]) {
      expect(scopeFnsSrc).not.toContain(`from("${table}")`);
    }
  });

  it("the UI carries the Hebrew edit/delete flows with confirmation", () => {
    expect(teamsPageSrc).toContain("עריכת פעילות");
    expect(teamsPageSrc).toContain("עריכת מוקד");
    expect(teamsPageSrc).toContain("שמירת שינויים");
    expect(teamsPageSrc).toContain("ביטול");
    expect(teamsPageSrc).toContain("מחיקת פעילות");
    expect(teamsPageSrc).toContain("מחיקת מוקד");
    expect(teamsPageSrc).toContain(
      "הפעולה תמחק את היחידה מההיררכיה העסקית. לא ניתן לבטל פעולה זו.",
    );
    expect(teamsPageSrc).toContain('aria-label="עריכה"');
    expect(teamsPageSrc).toContain('aria-label="מחיקה"');
  });

  it("edit/delete are admin-only: server-checked, and the card itself is admin-gated", () => {
    // Managers and representatives hit the same server rejection…
    expect(scopeFnsSrc).toContain("רק מנהל מערכת יכול להגדיר את ההיררכיה העסקית");
    // …and never see the controls (the hierarchy card renders for admin only).
    expect(teamsPageSrc).toContain("{isAdmin && <BusinessHierarchyCard");
  });
});

// -------------------------------------------------------------- boundaries
describe("boundaries — roles and product surface unchanged", () => {
  it("no technical role enum changes in the migration", () => {
    expect(migrationSrc).not.toContain("ALTER TYPE");
    expect(migrationSrc).not.toContain("app_role");
  });

  it("no worklist/queue/customer/CRM/call-outcome vocabulary", () => {
    for (const src of [migrationSrc, teamsPageSrc]) {
      for (const term of ["worklist", "call_outcome", "customer_id", "next customer"]) {
        expect(src.toLowerCase()).not.toContain(term);
      }
    }
  });
});
