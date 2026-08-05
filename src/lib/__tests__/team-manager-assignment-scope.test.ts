import { describe, it, expect } from "vitest";
import { canManagerPerformTeamAssignment } from "@/lib/team-admin.functions";

// Regression coverage for the P2b fix to setUserTeam: a manager used to be
// blocked entirely from assigning users (assertAdmin), or — if that had
// instead been loosened naively — could have silently pulled a user out of a
// team they don't manage, or dropped them into one, since the original
// handler never checked which team(s) a manager actually manages before
// writing. canManagerPerformTeamAssignment is the pure decision the handler
// now applies to every team a reassignment actually touches.

describe("canManagerPerformTeamAssignment", () => {
  it("allows assigning a currently-unassigned user into a team the manager manages", () => {
    // unassigned -> no prior team, so teamIdsInvolved is just the destination.
    expect(canManagerPerformTeamAssignment(["team-a"], new Set(["team-a"]))).toBe(true);
  });

  it("allows removing a user from a team the manager manages (destination unassigned)", () => {
    expect(canManagerPerformTeamAssignment(["team-a"], new Set(["team-a"]))).toBe(true);
  });

  it("denies assigning a user into a team the manager does NOT manage", () => {
    expect(canManagerPerformTeamAssignment(["team-b"], new Set(["team-a"]))).toBe(false);
  });

  it("denies pulling a user out of a team the manager does not manage, even into a team they do manage", () => {
    // teamIdsInvolved = [currentTeam (not managed), destinationTeam (managed)]
    expect(canManagerPerformTeamAssignment(["team-other", "team-a"], new Set(["team-a"]))).toBe(false);
  });

  it("denies a cross-team transfer where neither team is managed by this manager", () => {
    expect(canManagerPerformTeamAssignment(["team-x", "team-y"], new Set(["team-a"]))).toBe(false);
  });

  it("allows a no-op reassignment within the manager's own team", () => {
    expect(canManagerPerformTeamAssignment(["team-a"], new Set(["team-a", "team-b"]))).toBe(true);
  });

  it("trivially allows an operation touching zero teams (both sides unassigned — never actually called this way, but must not be a footgun)", () => {
    expect(canManagerPerformTeamAssignment([], new Set())).toBe(true);
  });
});
