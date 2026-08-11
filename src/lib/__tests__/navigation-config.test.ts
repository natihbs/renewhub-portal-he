import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  accountIdentity,
  TECHNICAL_ROLE_LABEL,
  UNRESOLVED_MANAGER_LABEL,
} from "../account-identity";
import { BUSINESS_ROLE_LABEL } from "../business-scope";
import {
  resolveAppRole,
  navItemsForRole,
  navLabel,
  quickActionsForRole,
  NAV_ITEMS,
  applyAdminView,
  ADMIN_VIEW_OPTIONS,
  ADMIN_VIEW_BANNER,
  workspaceSelectorBehavior,
} from "@/lib/navigation-config";

describe("resolveAppRole", () => {
  it("resolves Live Mode roles from real Supabase roles, admin taking priority", () => {
    expect(resolveAppRole({ isDemo: false, demoRole: "rep", isAdmin: true, isManager: true })).toBe(
      "admin",
    );
    expect(
      resolveAppRole({ isDemo: false, demoRole: "rep", isAdmin: false, isManager: true }),
    ).toBe("manager");
    expect(
      resolveAppRole({ isDemo: false, demoRole: "rep", isAdmin: false, isManager: false }),
    ).toBe("representative");
  });

  it("never trusts the demo role switcher in Live Mode", () => {
    expect(
      resolveAppRole({ isDemo: false, demoRole: "manager", isAdmin: false, isManager: false }),
    ).toBe("representative");
  });

  it("resolves Demo Mode from the local switcher only, manager -> admin superset", () => {
    expect(
      resolveAppRole({ isDemo: true, demoRole: "manager", isAdmin: false, isManager: false }),
    ).toBe("admin");
    expect(
      resolveAppRole({ isDemo: true, demoRole: "rep", isAdmin: false, isManager: false }),
    ).toBe("representative");
  });
});

describe("navItemsForRole", () => {
  it("gives a representative only rep-visible items — no management routes", () => {
    const items = navItemsForRole("representative");
    const ids = items.map((i) => i.id);
    expect(ids).not.toContain("users");
    expect(ids).not.toContain("admin");
    expect(ids).not.toContain("teams");
    expect(ids).not.toContain("representatives");
    expect(ids).not.toContain("data-import");
    expect(ids).toContain("home");
    expect(ids).toContain("performance");
    expect(ids).toContain("targets");
  });

  it("gives a manager team-management routes (including their own team and data import, since the route/server already allow them) but not admin-only ones", () => {
    const ids = navItemsForRole("manager").map((i) => i.id);
    expect(ids).toContain("representatives");
    expect(ids).toContain("targets");
    expect(ids).toContain("teams");
    expect(ids).toContain("data-import");
    expect(ids).not.toContain("users");
    expect(ids).not.toContain("admin");
  });

  // Admin is a system administrator ("מנהל מערכת"). The default admin
  // navigation is system-only: business areas are reachable by URL for
  // support/QA (no route was deleted, no guard changed) and through the
  // admin-only business-view switcher, but they are not admin's own nav.
  it("gives an admin system-administration navigation only", () => {
    const ids = navItemsForRole("admin").map((i) => i.id);
    for (const id of [
      "home",
      "users",
      "teams",
      "representatives",
      "data-import",
      "admin",
      "changelog",
    ]) {
      expect(ids).toContain(id);
    }
    for (const id of [
      "performance",
      "targets",
      "feedback",
      "competitions",
      "knowledge",
      "ai-insights",
      "communications",
    ]) {
      expect(ids).not.toContain(id);
    }
  });

  it("keeps business navigation for manager and representative", () => {
    const managerIds = navItemsForRole("manager").map((i) => i.id);
    for (const id of [
      "performance",
      "targets",
      "feedback",
      "competitions",
      "knowledge",
      "ai-insights",
      "communications",
    ]) {
      expect(managerIds).toContain(id);
    }
    const repIds = navItemsForRole("representative").map((i) => i.id);
    for (const id of [
      "performance",
      "targets",
      "feedback",
      "competitions",
      "knowledge",
      "ai-insights",
    ]) {
      expect(repIds).toContain(id);
    }
  });
});

// ---------------------------------------------------------------------------
// Admin business-view switcher — presentation only, never a permission or an
// identity. applyAdminView is the single rule every surface goes through.
// ---------------------------------------------------------------------------
describe("applyAdminView", () => {
  it("lets a real admin present as any offered view mode", () => {
    expect(applyAdminView("admin", "admin")).toBe("admin");
    expect(applyAdminView("admin", "manager")).toBe("manager");
    expect(applyAdminView("admin", "representative")).toBe("representative");
  });

  it("is inert for a real manager — their experience never changes", () => {
    expect(applyAdminView("manager", "admin")).toBe("manager");
    expect(applyAdminView("manager", "representative")).toBe("manager");
    expect(applyAdminView("manager", "manager")).toBe("manager");
  });

  it("is inert for a real representative — their experience never changes", () => {
    expect(applyAdminView("representative", "admin")).toBe("representative");
    expect(applyAdminView("representative", "manager")).toBe("representative");
  });

  it("presents admin-as-manager with exactly the real manager navigation", () => {
    const presented = navItemsForRole(applyAdminView("admin", "manager")).map((i) => i.id);
    const real = navItemsForRole("manager").map((i) => i.id);
    expect(presented).toEqual(real);
  });

  it("offers every switcher option with a Hebrew label, מנהל מערכת first as the default", () => {
    expect(ADMIN_VIEW_OPTIONS[0]).toEqual({ value: "admin", label: "מנהל מערכת" });
    for (const o of ADMIN_VIEW_OPTIONS) {
      expect(["admin", "manager", "representative"]).toContain(o.value);
      expect(o.label).toMatch(/[֐-׿]/);
    }
  });

  it("states in every banner that system-administrator permissions are kept", () => {
    expect(ADMIN_VIEW_BANNER.manager).toBe("מצב צפייה כמנהל צוות · הרשאות מנהל מערכת נשמרות");
    expect(ADMIN_VIEW_BANNER.representative).toBe("מצב צפייה כנציג · הרשאות מנהל מערכת נשמרות");
  });
});

describe("navLabel", () => {
  it("uses the role-specific override where one exists", () => {
    const performance = NAV_ITEMS.find((i) => i.id === "performance")!;
    expect(navLabel(performance, "manager")).toBe("ביצועים");
    expect(navLabel(performance, "representative")).toBe("הביצועים שלי");
  });

  it("falls back to the default label when no override exists", () => {
    const home = NAV_ITEMS.find((i) => i.id === "home")!;
    expect(navLabel(home, "admin")).toBe("דף הבית");
    expect(navLabel(home, "representative")).toBe("דף הבית");
  });

  it('labels the teams destination "הצוות שלי" for a manager, but the generic label for an admin', () => {
    const teams = NAV_ITEMS.find((i) => i.id === "teams")!;
    expect(navLabel(teams, "manager")).toBe("הצוות שלי");
    expect(navLabel(teams, "admin")).toBe("ניהול צוותים");
  });
});

describe("quickActionsForRole", () => {
  it("gives a representative no management quick actions", () => {
    const actions = quickActionsForRole("representative");
    expect(actions.every((a) => a.roles.includes("representative"))).toBe(true);
    expect(actions.some((a) => a.id === "add-representative")).toBe(false);
    expect(actions.some((a) => a.id === "import-data")).toBe(false);
  });

  it("gives a manager team actions, including data import, but not admin-only ones", () => {
    const ids = quickActionsForRole("manager").map((a) => a.id);
    expect(ids).toContain("add-representative");
    expect(ids).toContain("manage-targets");
    expect(ids).toContain("import-data");
    expect(ids).not.toContain("add-announcement");
  });

  it("gives an admin system quick actions only — no business actions by default", () => {
    const ids = quickActionsForRole("admin").map((a) => a.id);
    expect(ids).toContain("add-representative");
    expect(ids).toContain("add-announcement");
    expect(ids).toContain("import-data");
    for (const id of ["manage-targets", "add-feedback", "create-competition", "open-knowledge"]) {
      expect(ids).not.toContain(id);
    }
  });
});

// ---------------------------------------------------------------------------
// Role-label discipline (pinned against the component source, following the
// repo's readFileSync pattern): the technical role names stay `admin` /
// `manager`, but every user-facing label must say "מנהל מערכת" / "מנהל צוות".
// A bare "מנהל" as a role label is ambiguous — it reads as a business manager
// and was exactly how admin drifted into being treated as a VP.
// ---------------------------------------------------------------------------
describe("role labels in AppShell", () => {
  const src = readFileSync(resolve(__dirname, "../../components/layout/AppShell.tsx"), "utf8");

  it("labels the roles מנהל מערכת / מנהל צוות / נציג in the profile and switcher", () => {
    // The rule is unchanged; its implementation moved. AppShell no longer maps
    // a technical role to a business title inline — that mapping was what
    // announced every center/activity/executive manager as "מנהל צוות" — so
    // the labels now come from accountIdentity + BUSINESS_ROLE_LABEL, and this
    // pins the same two things there: an admin is a SYSTEM administrator, and
    // a bare "מנהל" is only ever the neutral fallback for a technical manager
    // whose business scope has not resolved, never a business identity.
    expect(src).toContain("accountIdentity({ roles, scope })");
    expect(src).not.toMatch(/\?\s*"מנהל"\s*:/);
    expect(TECHNICAL_ROLE_LABEL.admin).toBe("מנהל מערכת");
    expect(BUSINESS_ROLE_LABEL.team_manager).toBe("מנהל צוות");
    expect(BUSINESS_ROLE_LABEL.admin).toBe("מנהל מערכת");
    expect(accountIdentity({ roles: ["admin"], scope: null }).compact).toBe("מנהל מערכת");
    expect(
      accountIdentity({ roles: ["manager"], scope: { kind: "team_manager", title: "מנהל צוות" } })
        .compact,
    ).toBe("מנהל צוות");
    expect(accountIdentity({ roles: ["representative"], scope: null }).compact).toBe("נציג");
    // "מנהל" alone is the unresolved-scope fallback and nothing else.
    expect(UNRESOLVED_MANAGER_LABEL).toBe("מנהל");
    expect(accountIdentity({ roles: ["manager"], scope: null }).businessLabel).toBeNull();
  });

  it("titles the admin management group ניהול מערכת, not ניהול ארגוני", () => {
    expect(src).toContain('admin: "ניהול מערכת"');
    expect(src).toContain('manager: "ניהול הצוות"');
    expect(src).toContain('representative: "ניווט"');
    expect(src).not.toContain("ניהול ארגוני");
  });
});

// ---------------------------------------------------------------------------
// Workspace selector by admin view mode — one pure rule (see its doc block).
// The invariant that matters most: for every non-admin the answer is always
// "existing", so a real manager's or representative's selector cannot change.
// ---------------------------------------------------------------------------
describe("workspaceSelectorBehavior", () => {
  it("hides the selector on the admin system console — the page is not scoped by team", () => {
    expect(workspaceSelectorBehavior({ realRole: "admin", viewRole: "admin", pathname: "/" })).toBe(
      "hidden",
    );
  });

  it("keeps the full selector on admin system pages that genuinely narrow by workspace", () => {
    for (const pathname of ["/users", "/representatives", "/teams", "/performance"]) {
      expect(workspaceSelectorBehavior({ realRole: "admin", viewRole: "admin", pathname })).toBe(
        "existing",
      );
    }
  });

  it("offers teams only in admin-as-manager view — כלל הארגון is not a manager scope", () => {
    for (const pathname of ["/", "/performance", "/targets"]) {
      expect(workspaceSelectorBehavior({ realRole: "admin", viewRole: "manager", pathname })).toBe(
        "teams-only",
      );
    }
  });

  it("hides the selector entirely in admin-as-representative view", () => {
    for (const pathname of ["/", "/performance", "/feedback"]) {
      expect(
        workspaceSelectorBehavior({ realRole: "admin", viewRole: "representative", pathname }),
      ).toBe("hidden");
    }
  });

  it("never changes anything for a real manager, whatever the stored view mode claims", () => {
    for (const viewRole of ["admin", "manager", "representative"] as const) {
      for (const pathname of ["/", "/performance"]) {
        expect(workspaceSelectorBehavior({ realRole: "manager", viewRole, pathname })).toBe(
          "existing",
        );
      }
    }
  });

  it("never changes anything for a real representative", () => {
    for (const viewRole of ["admin", "manager", "representative"] as const) {
      expect(
        workspaceSelectorBehavior({ realRole: "representative", viewRole, pathname: "/" }),
      ).toBe("existing");
    }
  });
});
