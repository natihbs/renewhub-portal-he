import { describe, it, expect } from "vitest";
import { assertTeamIsActiveForNewAssignment, assertTeamIsActiveForOperationalWrite, isNewTeamAssignment } from "@/lib/team-assignment-guards";

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

// Regression coverage for the PR #19 review correction: updateUser
// (user-admin.functions.ts) originally gated on `if (profileUpdate.team_id)`
// alone — true for ANY non-null team_id in the payload, whether or not it
// actually differed from the user's existing team_id. An edit form that
// resubmits a user's current (possibly inactive) team_id alongside an
// unrelated field change — a rename, toggling active, must_change_password —
// would then incorrectly be rejected as a "new assignment into an inactive
// team." isNewTeamAssignment is the exact comparison updateUser now runs
// before ever calling assertTeamIsActiveForNewAssignment, covering all six
// scenarios from the review:
describe("isNewTeamAssignment — six review scenarios", () => {
  it("1. renaming a user who remains on an inactive team is NOT a new assignment (team_id resubmitted unchanged)", () => {
    expect(isNewTeamAssignment("inactive-team", "inactive-team")).toBe(false);
  });

  it("2. toggling active/must_change_password with team_id absent from the payload entirely is NOT a new assignment", () => {
    expect(isNewTeamAssignment("inactive-team", undefined)).toBe(false);
  });

  it("3. resubmitting the same team_id (active team) is NOT a new assignment", () => {
    expect(isNewTeamAssignment("active-team", "active-team")).toBe(false);
  });

  it("4. removing the user from an inactive team (team_id -> null) is NOT a new assignment", () => {
    expect(isNewTeamAssignment("inactive-team", null)).toBe(false);
  });

  it("5. transferring the user from an inactive team into a DIFFERENT (active) team IS a new assignment — gated on the destination's own active status, not the source's", () => {
    expect(isNewTeamAssignment("inactive-team", "active-team")).toBe(true);
  });

  it("6. transferring the user into a different, inactive team IS a new assignment (still correctly blocked downstream by assertTeamIsActiveForNewAssignment)", () => {
    expect(isNewTeamAssignment("some-other-team", "inactive-team")).toBe(true);
  });

  it("is a new assignment for a user with no current team at all (first-time assignment)", () => {
    expect(isNewTeamAssignment(null, "some-team")).toBe(true);
  });
});

describe("updateUser's full team-guard combination (isNewTeamAssignment + assertTeamIsActiveForNewAssignment)", () => {
  function maybeGate(currentTeamId: string | null, submittedTeamId: string | null | undefined, destTeam: { active: boolean } | null) {
    if (isNewTeamAssignment(currentTeamId, submittedTeamId)) {
      assertTeamIsActiveForNewAssignment(destTeam);
    }
  }

  it("1. rename while remaining on an inactive team: never even checks the team, so it can't be blocked", () => {
    expect(() => maybeGate("inactive-team", "inactive-team", { active: false })).not.toThrow();
  });

  it("2. unrelated field edit (team_id not part of the payload): never checks the team", () => {
    expect(() => maybeGate("inactive-team", undefined, { active: false })).not.toThrow();
  });

  it("3. resubmitting the same active team_id: allowed", () => {
    expect(() => maybeGate("active-team", "active-team", { active: true })).not.toThrow();
  });

  it("4. removal from an inactive team: allowed", () => {
    expect(() => maybeGate("inactive-team", null, { active: false })).not.toThrow();
  });

  it("5. transfer OUT of an inactive team INTO an active one: allowed", () => {
    expect(() => maybeGate("inactive-team", "active-team", { active: true })).not.toThrow();
  });

  it("6. an actual transfer into an inactive team: still blocked", () => {
    expect(() => maybeGate("active-team", "inactive-team", { active: false })).toThrow(/מושבת/);
  });
});
