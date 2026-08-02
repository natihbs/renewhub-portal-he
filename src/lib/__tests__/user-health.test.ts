import { describe, expect, it } from "vitest";
import { computeUserHealth } from "@/lib/user-health";

describe("computeUserHealth", () => {
  it("is healthy for a representative with a team-matching linked rep", () => {
    const h = computeUserHealth({
      roles: ["representative"],
      team_id: "t1",
      representative_link: { active: true, team_id: "t1" },
    });
    expect(h.status).toBe("healthy");
    expect(h.reasons).toEqual([]);
  });

  it("is healthy for a manager with a team and no rep link", () => {
    const h = computeUserHealth({ roles: ["manager"], team_id: "t1", representative_link: null });
    expect(h.status).toBe("healthy");
  });

  it("needs attention when no role is assigned", () => {
    const h = computeUserHealth({ roles: [], team_id: "t1", representative_link: null });
    expect(h.status).toBe("attention");
    expect(h.reasons).toContain("לא הוגדר תפקיד למשתמש");
  });

  it("needs attention when no team is assigned", () => {
    const h = computeUserHealth({ roles: ["manager"], team_id: null, representative_link: null });
    expect(h.status).toBe("attention");
  });

  it("needs attention when a representative has no linked representative record", () => {
    const h = computeUserHealth({ roles: ["representative"], team_id: "t1", representative_link: null });
    expect(h.status).toBe("attention");
    expect(h.reasons).toContain("לא קיים נציג מקושר לחשבון המשתמש");
  });

  it("is a configuration issue when multiple roles are assigned", () => {
    const h = computeUserHealth({ roles: ["admin", "manager"], team_id: "t1", representative_link: null });
    expect(h.status).toBe("issue");
  });

  it("is a configuration issue when a non-representative has a linked rep", () => {
    const h = computeUserHealth({ roles: ["manager"], team_id: "t1", representative_link: { active: true, team_id: "t1" } });
    expect(h.status).toBe("issue");
  });

  it("is a configuration issue when the linked rep's team disagrees with the profile's team", () => {
    const h = computeUserHealth({
      roles: ["representative"],
      team_id: "t1",
      representative_link: { active: true, team_id: "t2" },
    });
    expect(h.status).toBe("issue");
  });

  it("prioritizes issue over attention", () => {
    const h = computeUserHealth({ roles: ["admin", "manager"], team_id: null, representative_link: null });
    expect(h.status).toBe("issue");
  });
});
