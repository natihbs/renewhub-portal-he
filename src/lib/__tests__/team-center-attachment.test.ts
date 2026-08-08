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
