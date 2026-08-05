import { describe, it, expect } from "vitest";
import { computeTeamDeletionBlockers, formatTeamDeletionBlockedMessage } from "@/lib/team-admin.functions";

// Regression coverage for the P1 fix: deleteTeam used to check only `profiles`
// before hard-deleting a team, while `representatives.team_id`,
// `kpi_values.team_id` (ON DELETE SET NULL) and `team_goals.team_id` (ON
// DELETE CASCADE) would silently detach/destroy dependent rows. This exercises
// the pure gate function (computeTeamDeletionBlockers) that the handler now
// calls before ever issuing the DELETE — every scenario the sprint asked for,
// isolated from the network calls that gather the underlying counts.
//
// The DB-level guarantee (a team with dependents can never actually be
// deleted, and a rejected delete leaves every dependent row untouched, even if
// this application check were ever bypassed) was verified separately via a
// local Postgres replay of supabase/migrations/20260805170000_teams_fk_restrict_on_delete.sql
// against all four teams.id-referencing FKs.

function zeroCounts() {
  return {
    profiles: 0,
    representatives: 0,
    team_goals: 0,
    kpi_values: 0,
    representative_goals: 0,
    competition_scores: 0,
  };
}

describe("computeTeamDeletionBlockers", () => {
  it("a team with an assigned profile (user) cannot be deleted", () => {
    const blockers = computeTeamDeletionBlockers({ ...zeroCounts(), profiles: 2 });
    expect(blockers).toEqual([{ type: "profiles", label: "משתמשים משויכים", count: 2 }]);
  });

  it("a team with a representative who has no login account cannot be deleted (representatives is checked directly, not derived from profiles)", () => {
    const blockers = computeTeamDeletionBlockers({ ...zeroCounts(), representatives: 1 });
    expect(blockers).toEqual([{ type: "representatives", label: "נציגים משויכים", count: 1 }]);
  });

  it("a team with team_goals rows cannot be deleted", () => {
    const blockers = computeTeamDeletionBlockers({ ...zeroCounts(), team_goals: 3 });
    expect(blockers).toEqual([{ type: "team_goals", label: "יעדי צוות שנקבעו", count: 3 }]);
  });

  it("a team with kpi_values history cannot be deleted, even if its representatives have since moved to another team (denormalized historical attribution)", () => {
    const blockers = computeTeamDeletionBlockers({ ...zeroCounts(), kpi_values: 5 });
    expect(blockers).toEqual([{ type: "kpi_values", label: "רשומות ביצועים היסטוריות", count: 5 }]);
  });

  it("a team whose representatives have representative_goals or competition_scores (no direct team_id column) cannot be deleted", () => {
    const blockers = computeTeamDeletionBlockers({ ...zeroCounts(), representative_goals: 4, competition_scores: 2 });
    expect(blockers).toEqual([
      { type: "representative_goals", label: "יעדים אישיים של נציגי הצוות", count: 4 },
      { type: "competition_scores", label: "תוצאות תחרויות של נציגי הצוות", count: 2 },
    ]);
  });

  it("a truly empty team (zero rows in every dependency) can be deleted", () => {
    expect(computeTeamDeletionBlockers(zeroCounts())).toEqual([]);
  });

  it("reports every blocking dependency at once, in a stable order, not just the first one found", () => {
    const blockers = computeTeamDeletionBlockers({
      profiles: 1,
      representatives: 2,
      team_goals: 3,
      kpi_values: 4,
      representative_goals: 5,
      competition_scores: 6,
    });
    expect(blockers.map((b) => b.type)).toEqual([
      "profiles", "representatives", "team_goals", "kpi_values", "representative_goals", "competition_scores",
    ]);
  });

  it("is pure — never mutates the counts object it receives", () => {
    const counts = { ...zeroCounts(), profiles: 1 };
    const snapshot = { ...counts };
    computeTeamDeletionBlockers(counts);
    expect(counts).toEqual(snapshot);
  });
});

describe("formatTeamDeletionBlockedMessage", () => {
  it("names the team and lists every blocking type with its count, recommending deactivation instead", () => {
    const msg = formatTeamDeletionBlockedMessage("צוות רכב", [
      { type: "profiles", label: "משתמשים משויכים", count: 2 },
      { type: "kpi_values", label: "רשומות ביצועים היסטוריות", count: 10 },
    ]);
    expect(msg).toContain("צוות רכב");
    expect(msg).toContain("משתמשים משויכים (2)");
    expect(msg).toContain("רשומות ביצועים היסטוריות (10)");
    expect(msg).toContain("השבתת צוות");
  });
});
