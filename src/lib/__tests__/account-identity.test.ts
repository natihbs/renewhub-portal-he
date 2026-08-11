// Global account identity — the top-right header, the account menu and the
// profile dialog.
//
// The bug: those surfaces printed the TECHNICAL role, so a center manager, an
// activity manager and an executive were all announced as "מנהל צוות". The
// technical role is a permission level (admin / manager / representative); the
// business level lives in the resolved business scope and is derived, never
// stored. These tests pin both the mapping and the truthful fallbacks.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  accountIdentity,
  NO_ROLE_LABEL,
  TECHNICAL_ROLE_LABEL,
  UNRESOLVED_MANAGER_LABEL,
} from "@/lib/account-identity";
import { BUSINESS_ROLE_LABEL } from "@/lib/business-scope";

const appShell = readFileSync(resolve(__dirname, "../../components/layout/AppShell.tsx"), "utf8");

describe("compact identity — the business level, not the technical role", () => {
  it("a plain team manager is מנהל צוות", () => {
    const i = accountIdentity({
      roles: ["manager"],
      scope: { kind: "team_manager", title: "מנהל צוות" },
    });
    expect(i.compact).toBe("מנהל צוות");
    expect(i.technicalLabel).toBe("מנהל");
  });

  it("a center manager is מנהל מוקד — never מנהל צוות", () => {
    const i = accountIdentity({
      roles: ["manager"],
      scope: { kind: "center", title: "מנהל מוקד · דירות וחידושים" },
    });
    expect(i.compact).toBe("מנהל מוקד");
    expect(i.compact).not.toBe("מנהל צוות");
  });

  it("an activity manager is מנהל פעילות — never מנהל צוות", () => {
    const i = accountIdentity({
      roles: ["manager"],
      scope: { kind: "activity", title: "מנהל פעילות · אלמנטרי" },
    });
    expect(i.compact).toBe("מנהל פעילות");
    expect(i.compact).not.toBe("מנהל צוות");
  });

  it('an executive is סמנכ"ל / מנהל ממ"ט — never מנהל צוות', () => {
    const i = accountIdentity({
      roles: ["manager"],
      scope: { kind: "executive", title: 'סמנכ"ל / מנהל ממ"ט' },
    });
    expect(i.compact).toBe('סמנכ"ל / מנהל ממ"ט');
    expect(i.compact).not.toBe("מנהל צוות");
  });

  it("an admin is מנהל מערכת", () => {
    const i = accountIdentity({ roles: ["admin"], scope: { kind: "admin", title: "מנהל מערכת" } });
    expect(i.compact).toBe("מנהל מערכת");
  });

  it("a representative is נציג", () => {
    const i = accountIdentity({
      roles: ["representative"],
      scope: { kind: "representative", title: "נציג" },
    });
    expect(i.compact).toBe("נציג");
  });

  it("an account with no role says so", () => {
    expect(accountIdentity({ roles: [], scope: null }).compact).toBe(NO_ROLE_LABEL);
  });

  it("uses the canonical business labels, not its own copies", () => {
    for (const kind of ["team_manager", "center", "activity", "executive"] as const) {
      expect(accountIdentity({ roles: ["manager"], scope: { kind, title: "" } }).compact).toBe(
        BUSINESS_ROLE_LABEL[kind],
      );
    }
  });
});

describe("expanded identity — the full resolved title where truthful", () => {
  it("a center manager shows the unit", () => {
    expect(
      accountIdentity({
        roles: ["manager"],
        scope: { kind: "center", title: "מנהל מוקד · דירות וחידושים" },
      }).full,
    ).toBe("מנהל מוקד · דירות וחידושים");
  });

  it("an activity manager shows the activity", () => {
    expect(
      accountIdentity({
        roles: ["manager"],
        scope: { kind: "activity", title: "מנהל פעילות · אלמנטרי" },
      }).full,
    ).toBe("מנהל פעילות · אלמנטרי");
  });

  it("an executive gets NO fabricated unit", () => {
    const i = accountIdentity({
      roles: ["manager"],
      scope: { kind: "executive", title: 'סמנכ"ל / מנהל ממ"ט' },
    });
    expect(i.full).toBe('סמנכ"ל / מנהל ממ"ט');
    expect(i.full).not.toContain("·");
  });

  it("falls back to the compact label when the title is empty", () => {
    expect(
      accountIdentity({ roles: ["manager"], scope: { kind: "center", title: "  " } }).full,
    ).toBe("מנהל מוקד");
  });

  it("an admin's business identity is not invented", () => {
    const i = accountIdentity({ roles: ["admin"], scope: { kind: "admin", title: "מנהל מערכת" } });
    expect(i.businessLabel).toBeNull();
  });

  it("a representative's business identity is not invented", () => {
    const i = accountIdentity({
      roles: ["representative"],
      scope: { kind: "representative", title: "נציג" },
    });
    expect(i.businessLabel).toBeNull();
  });
});

describe("loading and error truthfulness", () => {
  it("an unresolved technical manager is a neutral מנהל — never מנהל צוות", () => {
    const i = accountIdentity({ roles: ["manager"], scope: null });
    expect(i.compact).toBe(UNRESOLVED_MANAGER_LABEL);
    expect(i.compact).toBe("מנהל");
    expect(i.compact).not.toBe("מנהל צוות");
    expect(i.full).not.toBe("מנהל צוות");
    expect(i.businessLabel).toBeNull();
    expect(i.isPendingBusinessTitle).toBe(true);
  });

  it("a scope ERROR degrades the same way and fabricates no level", () => {
    // useBusinessScope returns scope: null on error, exactly as while loading.
    const i = accountIdentity({ roles: ["manager"], scope: null });
    for (const invented of ["מנהל צוות", "מנהל מוקד", "מנהל פעילות", 'סמנכ"ל / מנהל ממ"ט']) {
      expect(i.compact).not.toBe(invented);
      expect(i.full).not.toBe(invented);
    }
  });

  it("a scope that is not a managerial kind is ignored, not displayed", () => {
    const i = accountIdentity({
      roles: ["manager"],
      scope: { kind: "representative", title: "נציג" },
    });
    expect(i.compact).toBe("מנהל");
    expect(i.isPendingBusinessTitle).toBe(true);
  });

  it("admin and representative never wait on the scope", () => {
    expect(accountIdentity({ roles: ["admin"], scope: null }).compact).toBe("מנהל מערכת");
    expect(accountIdentity({ roles: ["admin"], scope: null }).isPendingBusinessTitle).toBe(false);
    expect(accountIdentity({ roles: ["representative"], scope: null }).compact).toBe("נציג");
    expect(accountIdentity({ roles: ["representative"], scope: null }).isPendingBusinessTitle).toBe(
      false,
    );
  });
});

describe("technical roles are untouched", () => {
  it("a center/activity/executive manager is still technically a manager", () => {
    for (const kind of ["center", "activity", "executive"] as const) {
      const i = accountIdentity({ roles: ["manager"], scope: { kind, title: "x" } });
      expect(i.technicalLabel).toBe(TECHNICAL_ROLE_LABEL.manager);
      expect(i.technicalLabel).toBe("מנהל");
    }
  });

  it("the three technical labels are exactly the permission levels", () => {
    expect(TECHNICAL_ROLE_LABEL).toEqual({
      admin: "מנהל מערכת",
      manager: "מנהל",
      representative: "נציג",
    });
  });

  it("the helper derives nothing but a label — no role, no scope, no write", () => {
    const src = readFileSync(resolve(__dirname, "../account-identity.ts"), "utf8");
    expect(src).not.toContain("user_business_scopes");
    expect(src).not.toContain("supabase");
    expect(src).not.toContain("useQuery");
    expect(src).not.toMatch(/localStorage|sessionStorage/);
  });
});

describe("AppShell wiring — no hard-coded technical-manager identity remains", () => {
  it("neither account surface maps roles straight to a business title", () => {
    expect(appShell).not.toContain('roles.includes("manager") ? "מנהל צוות"');
    expect(appShell).not.toContain("מנהל צוות");
  });

  it("the header trigger shows the compact business level", () => {
    expect(appShell).toContain("accountIdentity({ roles, scope })");
    expect(appShell).toContain("{identity.compact}");
  });

  it("the account menu shows the full resolved title", () => {
    expect(appShell).toContain("{identity.full}");
  });

  it("the profile dialog separates permission from business title", () => {
    expect(appShell).toContain("הרשאת מערכת");
    expect(appShell).toContain("{identity.technicalLabel}");
    expect(appShell).toContain("תפקיד עסקי");
    expect(appShell).toContain("{identity.businessLabel}");
    // While the scope is still resolving, the dialog says so rather than
    // printing a level.
    expect(appShell).toContain("identity.isPendingBusinessTitle");
  });
});
