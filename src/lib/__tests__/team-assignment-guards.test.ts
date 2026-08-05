import { describe, it, expect } from "vitest";
import { assertTeamIsActiveForNewAssignment, assertTeamIsActiveForOperationalWrite } from "@/lib/team-assignment-guards";

// Regression coverage for the PR #18 review correction ("P1 - INACTIVE TEAM
// MUST REJECT NEW ASSIGNMENTS"): the original implementation only ever
// filtered active-only teams out of assignment PICKERS client-side — nothing
// stopped a direct server call (setUserTeam, createRepresentative,
// updateRepresentative, setRepresentativeTeam, updateRepresentativeMetrics,
// updateUser, setTeamGoal, setRepresentativeGoals,
// copyGoalsFromPreviousMonth's apply step) from assigning into, or writing
// operational data for, a deactivated team. These two guards are what every
// one of those handlers now calls before writing.

describe("assertTeamIsActiveForNewAssignment", () => {
  it("does not throw for an active team", () => {
    expect(() => assertTeamIsActiveForNewAssignment({ active: true })).not.toThrow();
  });

  it("throws a Hebrew, actionable message for an inactive team", () => {
    expect(() => assertTeamIsActiveForNewAssignment({ active: false })).toThrow(/מושבת/);
  });

  it("throws when the team was not found at all (never silently allows a dangling reference)", () => {
    expect(() => assertTeamIsActiveForNewAssignment(null)).toThrow(/לא נמצא/);
    expect(() => assertTeamIsActiveForNewAssignment(undefined)).toThrow(/לא נמצא/);
  });
});

describe("assertTeamIsActiveForOperationalWrite", () => {
  it("does not throw for an active team", () => {
    expect(() => assertTeamIsActiveForOperationalWrite({ active: true })).not.toThrow();
  });

  it("throws a Hebrew, actionable message for an inactive team (Targets writes)", () => {
    expect(() => assertTeamIsActiveForOperationalWrite({ active: false })).toThrow(/מושבת/);
  });

  it("throws when the team was not found at all", () => {
    expect(() => assertTeamIsActiveForOperationalWrite(null)).toThrow(/לא נמצא/);
  });
});
