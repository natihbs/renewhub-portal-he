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

  it("gives an admin every route", () => {
    const ids = navItemsForRole("admin").map((i) => i.id);
    for (const item of NAV_ITEMS) expect(ids).toContain(item.id);
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
