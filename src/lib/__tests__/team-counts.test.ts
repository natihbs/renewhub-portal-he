import { describe, it, expect } from "vitest";
import { aggregateTeamCounts } from "@/lib/team-admin.functions";

// Regression coverage for: "representative without a user account does not
// appear inside its assigned team." Root cause was listTeams/getTeamDetails
// deriving representative headcount from `profiles` (login accounts) instead
// of from representatives.team_id — a representative with no linked user_id
// has no `profiles` row at all, so it silently vanished from every
// profiles-derived count/list even though representatives.team_id was set
// correctly.

describe("aggregateTeamCounts — representative headcount is independent of profiles/login accounts", () => {
  it("counts a representative with no linked user account (no matching profiles row at all)", () => {
    const teamId = "team-1";
    const people: { team_id: string | null; active: boolean }[] = []; // no profiles row for this rep — it has no login account
    const representatives = [{ team_id: "team-1" }];

    const counts = aggregateTeamCounts(teamId, people, representatives);

    expect(counts.rep_count).toBe(1);
    expect(counts.member_count).toBe(0); // correctly zero — no login accounts, that's a separate metric
  });

  it("does not double count, and does not require a profiles row to exist for the same person", () => {
    const teamId = "team-1";
    // A manager's login account is on the team, but is NOT a representative row.
    const people = [{ team_id: "team-1", active: true }];
    const representatives = [
      { team_id: "team-1" }, // rep with no account
      { team_id: "team-1" }, // a second rep with no account
      { team_id: "team-2" }, // rep on a different team — must not be counted
    ];

    const counts = aggregateTeamCounts(teamId, people, representatives);

    expect(counts.rep_count).toBe(2);
    expect(counts.member_count).toBe(1);
    expect(counts.active_member_count).toBe(1);
  });

  it("counting a representative is unaffected by linking or unlinking a user account", () => {
    const teamId = "team-1";
    const representatives = [{ team_id: "team-1" }];

    // Before linking a user account: no profiles row exists for this rep yet.
    const before = aggregateTeamCounts(teamId, [], representatives);
    // After linking a user account: a profiles row now exists, but rep_count
    // must come from representatives.team_id regardless — linking must not
    // change or duplicate the team assignment.
    const after = aggregateTeamCounts(teamId, [{ team_id: "team-1", active: true }], representatives);
    // After later unlinking the account (profiles row's team_id cleared, or
    // profile removed) — rep_count must remain unchanged since it never
    // depended on the profiles row in the first place.
    const afterUnlink = aggregateTeamCounts(teamId, [], representatives);

    expect(before.rep_count).toBe(1);
    expect(after.rep_count).toBe(1);
    expect(afterUnlink.rep_count).toBe(1);
  });

  it("an empty team has zero counts without throwing", () => {
    const counts = aggregateTeamCounts("empty-team", [], []);
    expect(counts).toEqual({ member_count: 0, rep_count: 0, active_member_count: 0 });
  });
});
