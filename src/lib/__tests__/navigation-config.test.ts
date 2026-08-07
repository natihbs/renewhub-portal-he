import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveAppRole, navItemsForRole, navLabel, quickActionsForRole, NAV_ITEMS,
} from "@/lib/navigation-config";

describe("resolveAppRole", () => {
  it("resolves Live Mode roles from real Supabase roles, admin taking priority", () => {
    expect(resolveAppRole({ isDemo: false, demoRole: "rep", isAdmin: true, isManager: true })).toBe("admin");
    expect(resolveAppRole({ isDemo: false, demoRole: "rep", isAdmin: false, isManager: true })).toBe("manager");
    expect(resolveAppRole({ isDemo: false, demoRole: "rep", isAdmin: false, isManager: false })).toBe("representative");
  });

  it("never trusts the demo role switcher in Live Mode", () => {
    expect(resolveAppRole({ isDemo: false, demoRole: "manager", isAdmin: false, isManager: false })).toBe("representative");
  });

  it("resolves Demo Mode from the local switcher only, manager -> admin superset", () => {
    expect(resolveAppRole({ isDemo: true, demoRole: "manager", isAdmin: false, isManager: false })).toBe("admin");
    expect(resolveAppRole({ isDemo: true, demoRole: "rep", isAdmin: false, isManager: false })).toBe("representative");
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

  it("gives an admin every route except business-performance AI", () => {
    const ids = navItemsForRole("admin").map((i) => i.id);
    for (const item of NAV_ITEMS.filter((i) => i.id !== "ai-insights")) {
      expect(ids).toContain(item.id);
    }
  });

  // Admin is a system administrator ("מנהל מערכת"), not a business owner.
  // /ai-insights is business-performance AI, so it is not offered in admin
  // navigation — but the route itself stays unguarded, so an admin can still
  // reach it directly for support/QA. This test pins the nav decision only.
  it("does not offer business-performance AI in admin navigation, but keeps it for manager and representative", () => {
    expect(navItemsForRole("admin").map((i) => i.id)).not.toContain("ai-insights");
    expect(navItemsForRole("manager").map((i) => i.id)).toContain("ai-insights");
    expect(navItemsForRole("representative").map((i) => i.id)).toContain("ai-insights");
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

  it("labels the teams destination \"הצוות שלי\" for a manager, but the generic label for an admin", () => {
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
    expect(src).toContain('"מנהל מערכת"');
    expect(src).toContain('"מנהל צוות"');
    expect(src).not.toMatch(/\?\s*"מנהל"\s*:/);
  });

  it("titles the admin management group ניהול מערכת, not ניהול ארגוני", () => {
    expect(src).toContain('admin: "ניהול מערכת"');
    expect(src).toContain('manager: "ניהול הצוות"');
    expect(src).toContain('representative: "ניווט"');
    expect(src).not.toContain("ניהול ארגוני");
  });
});
