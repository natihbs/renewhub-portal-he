import { describe, it, expect } from "vitest";
import { computeTeamReconciliation } from "@/lib/team-admin.functions";

// Regression coverage for the Team Details inconsistency: setUserTeam used to write
// only profiles.team_id, leaving a linked representatives.team_id stale, so a
// rep-linked user could show under "חברי הצוות" but not "נציגים בצוות" for the
// same team. computeTeamReconciliation is the pure rule used by the one-time
// reconciliation of any such existing drift: representatives.team_id always wins.

function rep(over: Partial<{ id: string; user_id: string | null; team_id: string | null; name: string }>) {
  return { id: "r1", user_id: null, team_id: null, name: "נציג", ...over };
}
function profile(over: Partial<{ id: string; team_id: string | null }>) {
  return { id: "p1", team_id: null, ...over };
}

describe("computeTeamReconciliation — representatives.team_id is always the source of truth", () => {
  it("flags a mismatched pair and proposes aligning the profile to the representative", () => {
    const reps = [rep({ id: "rep-1", user_id: "user-1", team_id: "team-A", name: "בן" })];
    const profiles = [profile({ id: "user-1", team_id: "team-B" })];
    const changes = computeTeamReconciliation(reps, profiles);
    expect(changes).toEqual([
      { user_id: "user-1", representative_id: "rep-1", representative_name: "בן", from_team_id: "team-B", to_team_id: "team-A" },
    ]);
  });

  it("produces no change when the pair already agrees", () => {
    const reps = [rep({ id: "rep-1", user_id: "user-1", team_id: "team-A" })];
    const profiles = [profile({ id: "user-1", team_id: "team-A" })];
    expect(computeTeamReconciliation(reps, profiles)).toEqual([]);
  });

  it("ignores representatives without a linked user", () => {
    const reps = [rep({ id: "rep-1", user_id: null, team_id: "team-A" })];
    const profiles = [profile({ id: "user-1", team_id: "team-B" })];
    expect(computeTeamReconciliation(reps, profiles)).toEqual([]);
  });

  it("ignores a linked user whose profile row doesn't exist (shouldn't happen, but must not crash)", () => {
    const reps = [rep({ id: "rep-1", user_id: "ghost-user", team_id: "team-A" })];
    expect(computeTeamReconciliation(reps, [])).toEqual([]);
  });

  it("treats a representative unassigned from any team (null) as authoritative too — clears the profile's team", () => {
    const reps = [rep({ id: "rep-1", user_id: "user-1", team_id: null })];
    const profiles = [profile({ id: "user-1", team_id: "team-A" })];
    const changes = computeTeamReconciliation(reps, profiles);
    expect(changes).toEqual([
      { user_id: "user-1", representative_id: "rep-1", representative_name: "נציג", from_team_id: "team-A", to_team_id: null },
    ]);
  });

  it("reports every mismatch across multiple reps, independent of each other", () => {
    const reps = [
      rep({ id: "rep-1", user_id: "user-1", team_id: "team-A" }),
      rep({ id: "rep-2", user_id: "user-2", team_id: "team-A" }), // already matches
    ];
    const profiles = [
      profile({ id: "user-1", team_id: "team-B" }),
      profile({ id: "user-2", team_id: "team-A" }),
    ];
    const changes = computeTeamReconciliation(reps, profiles);
    expect(changes).toHaveLength(1);
    expect(changes[0].user_id).toBe("user-1");
  });
});
