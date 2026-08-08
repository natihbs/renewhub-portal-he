import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CREATE_ROLE_HELPER_TEXT,
  CREATE_ROLE_OPTIONS,
  EDIT_SCOPE_HELPER_TEXT,
  EXECUTIVE_SCOPE_TARGET_LABEL,
  effectiveBusinessTitle,
} from "@/lib/business-scope";

// ---------------------------------------------------------------------------
// /users business titles: technical roles stay exactly admin / manager /
// representative — the business ladder (מנהל צוות / מנהל מוקד / מנהל פעילות /
// סמנכ"ל) is a DISPLAY concept derived from user_business_scopes. Creation
// offers business-friendly titles that all map to role=manager, and the list
// shows each manager's EFFECTIVE title (live QA: לירון ג׳ורנו, a manager with
// a center grant on דירות וחידושים, must show מנהל מוקד · דירות וחידושים).
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const usersPageSrc = read("../../routes/_authenticated/users.tsx");
const fnsSrc = read("../user-admin.functions.ts");

// ------------------------------------------------------ effective titles (C)
describe("C — effective business title mapping", () => {
  it("manager without scope displays מנהל צוות", () => {
    expect(effectiveBusinessTitle({ roles: ["manager"], grants: [] })).toBe("מנהל צוות");
  });

  it("the live-QA case: manager + center scope on דירות וחידושים → מנהל מוקד · דירות וחידושים", () => {
    expect(
      effectiveBusinessTitle({
        roles: ["manager"],
        grants: [{ scopeType: "center", unitName: "דירות וחידושים" }],
      }),
    ).toBe("מנהל מוקד · דירות וחידושים");
  });

  it("manager + activity scope → מנהל פעילות · <activity>", () => {
    expect(
      effectiveBusinessTitle({
        roles: ["manager"],
        grants: [{ scopeType: "activity", unitName: "אלמנטרי" }],
      }),
    ).toBe("מנהל פעילות · אלמנטרי");
  });

  it('manager + executive scope → סמנכ"ל / מנהל ממ"ט · כלל הפעילות העסקית', () => {
    expect(
      effectiveBusinessTitle({
        roles: ["manager"],
        grants: [{ scopeType: "executive", unitName: null }],
      }),
    ).toBe('סמנכ"ל / מנהל ממ"ט · כלל הפעילות העסקית');
    expect(EXECUTIVE_SCOPE_TARGET_LABEL).toBe("כלל הפעילות העסקית");
  });

  it("multiple grants report the highest (executive > activity > center)", () => {
    expect(
      effectiveBusinessTitle({
        roles: ["manager"],
        grants: [
          { scopeType: "center", unitName: "מוקד צפון" },
          { scopeType: "activity", unitName: "אלמנטרי" },
        ],
      }),
    ).toBe("מנהל פעילות · אלמנטרי");
  });

  it("admin displays מנהל מערכת and never an executive title — even with a stray grant", () => {
    expect(effectiveBusinessTitle({ roles: ["admin"], grants: [] })).toBe("מנהל מערכת");
    expect(
      effectiveBusinessTitle({
        roles: ["admin", "manager"],
        grants: [{ scopeType: "executive", unitName: null }],
      }),
    ).toBe("מנהל מערכת");
  });

  it("representative displays נציג", () => {
    expect(effectiveBusinessTitle({ roles: ["representative"], grants: [] })).toBe("נציג");
    expect(effectiveBusinessTitle({ roles: [], grants: [] })).toBe("נציג");
  });

  it("listUsers and getUserDetails derive the title from user_business_scopes + business_units", () => {
    expect(fnsSrc).toContain("readScopeGrantsForTitles");
    expect(fnsSrc).toContain('from("user_business_scopes")');
    expect(fnsSrc).toContain('from("business_units")');
    expect(fnsSrc).toContain("business_title: effectiveBusinessTitle({");
    // Display only — this module writes nothing to the scope tables.
    expect(fnsSrc).not.toContain('from("user_business_scopes")\n    .insert');
  });

  it("the users table and details drawer render the effective title", () => {
    expect(usersPageSrc).toContain("user.business_title ?? roleLabel[user.roles[0]]");
    expect(usersPageSrc).toContain("d.user.business_title ??");
  });
});

// ------------------------------------------------------------- creation UX (B)
describe("B — business-friendly creation titles map onto the unchanged role enum", () => {
  const byValue = new Map(CREATE_ROLE_OPTIONS.map((o) => [o.value, o]));

  it("offers exactly the six business titles", () => {
    expect(CREATE_ROLE_OPTIONS.map((o) => o.label)).toEqual([
      "מנהל מערכת",
      "מנהל צוות",
      "מנהל מוקד",
      "מנהל פעילות",
      'סמנכ"ל / מנהל ממ"ט',
      "נציג",
    ]);
  });

  it("maps מנהל מערכת → admin and נציג → representative", () => {
    expect(byValue.get("admin")?.role).toBe("admin");
    expect(byValue.get("representative")?.role).toBe("representative");
  });

  it("maps every managerial business title → technical role manager", () => {
    for (const value of ["team_manager", "center_manager", "activity_manager", "executive"]) {
      expect(byValue.get(value)?.role).toBe("manager");
    }
  });

  it("no new role enum values exist — only admin/manager/representative are ever sent", () => {
    for (const o of CREATE_ROLE_OPTIONS) {
      expect(["admin", "manager", "representative"]).toContain(o.role);
    }
  });

  it("post-create notices direct the admin to the hierarchy card, per business level", () => {
    expect(byValue.get("center_manager")?.postCreateNotice).toBe(
      "המשתמש נוצר כמנהל. יש לשייך אותו למוקד במסך היררכיה עסקית.",
    );
    expect(byValue.get("activity_manager")?.postCreateNotice).toBe(
      "המשתמש נוצר כמנהל. יש לשייך אותו לפעילות במסך היררכיה עסקית.",
    );
    expect(byValue.get("executive")?.postCreateNotice).toBe(
      "המשתמש נוצר כמנהל. יש להקצות לו היקף כלל-עסקי במסך היררכיה עסקית.",
    );
    // Plain roles carry no notice — nothing fake is stored or implied.
    expect(byValue.get("admin")?.postCreateNotice).toBeUndefined();
    expect(byValue.get("team_manager")?.postCreateNotice).toBeUndefined();
    expect(byValue.get("representative")?.postCreateNotice).toBeUndefined();
  });

  it("the create dialog uses the options, the helper text, and derives the technical role", () => {
    expect(usersPageSrc).toContain("CREATE_ROLE_OPTIONS.map((o) => (");
    expect(usersPageSrc).toContain("{CREATE_ROLE_HELPER_TEXT}");
    expect(CREATE_ROLE_HELPER_TEXT).toBe(
      "התפקידים הניהוליים משתמשים בהרשאת מנהל. שיוך למוקד, פעילות או כלל הפעילות מתבצע במסך היררכיה עסקית.",
    );
    expect(usersPageSrc).toContain("const role: AppRole = roleOption.role;");
    expect(usersPageSrc).toContain("roleOption.postCreateNotice");
  });
});

// --------------------------------------------------------------- edit dialog (D)
describe("D — edit dialog shows the effective title and directs scope changes away", () => {
  it("shows the current business title and the hierarchy helper", () => {
    expect(usersPageSrc).toContain("תפקיד עסקי נוכחי: {user.business_title}");
    expect(usersPageSrc).toContain("{EDIT_SCOPE_HELPER_TEXT}");
    expect(EDIT_SCOPE_HELPER_TEXT).toBe("שינוי היקף ניהולי מתבצע במסך היררכיה עסקית.");
  });

  it("the edit dialog never writes user_business_scopes", () => {
    expect(usersPageSrc).not.toContain('from("user_business_scopes")');
    expect(usersPageSrc).not.toContain("setUserBusinessScope");
  });
});

// -------------------------------------------------------------- regression
describe("regression — flows and boundaries unchanged", () => {
  it("representative creation still requires and links a representative profile", () => {
    expect(usersPageSrc).toContain('toast.error("יש לבחור נציג מהמערכת")');
    expect(usersPageSrc).toContain('role === "representative" && !repId.trim()');
  });

  it("password reset flow is untouched", () => {
    expect(usersPageSrc).toContain("ResetPasswordDialog");
    expect(fnsSrc).toContain("export const resetPassword");
  });

  it("no role enum change anywhere in the module", () => {
    expect(fnsSrc).toContain('type AppRole = "admin" | "manager" | "representative"');
    expect(fnsSrc).not.toContain("ALTER TYPE");
  });

  it("no CRM/worklist/queue/customer/policy/call-outcome vocabulary", () => {
    for (const term of [
      "worklist",
      "call_outcome",
      "customer_id",
      "next customer",
      "policy_number",
    ]) {
      expect(usersPageSrc.toLowerCase()).not.toContain(term);
      expect(fnsSrc.toLowerCase()).not.toContain(term);
    }
  });
});
