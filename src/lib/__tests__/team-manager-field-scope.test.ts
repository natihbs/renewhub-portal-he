import { describe, it, expect } from "vitest";
import { managerAttemptedAdminOnlyTeamChange } from "@/lib/team-admin.functions";

// Regression coverage for the P2b fix to updateTeam: a manager may edit only
// their own team's description and KPI profile — name, department, manager
// assignment, and active status stay admin-only. This is the pure
// before/after comparison the handler uses to reject any attempted change to
// a restricted field, independent of whatever the UI currently sends.

function team(overrides: Partial<{ name: string; department: string | null; manager_id: string | null; active: boolean }> = {}) {
  return { name: "צוות רכב", department: "מכירות", manager_id: "mgr-1", active: true, ...overrides };
}

describe("managerAttemptedAdminOnlyTeamChange", () => {
  it("is false when nothing changes (a manager editing only description/kpi_profile resubmits the rest unchanged)", () => {
    expect(managerAttemptedAdminOnlyTeamChange(team(), team())).toBe(false);
  });

  it("is true when the team name changes", () => {
    expect(managerAttemptedAdminOnlyTeamChange(team(), team({ name: "שם חדש" }))).toBe(true);
  });

  it("is true when the department changes", () => {
    expect(managerAttemptedAdminOnlyTeamChange(team(), team({ department: "מחלקה אחרת" }))).toBe(true);
  });

  it("is true when the manager assignment changes", () => {
    expect(managerAttemptedAdminOnlyTeamChange(team(), team({ manager_id: "mgr-2" }))).toBe(true);
  });

  it("is true when the active status changes", () => {
    expect(managerAttemptedAdminOnlyTeamChange(team(), team({ active: false }))).toBe(true);
  });

  it("treats null and undefined department the same (no false positive from optional-field normalization)", () => {
    expect(managerAttemptedAdminOnlyTeamChange(team({ department: null }), team({ department: null }))).toBe(false);
  });
});
