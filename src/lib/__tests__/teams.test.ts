import { describe, it, expect } from "vitest";
import { teamsFromReps } from "@/lib/store";
import { resolveTeam, normalizeName } from "@/lib/import-store";
import type { Rep } from "@/lib/seed";

// Regression coverage for Part 1 (remove the legacy car/home team model) and
// Part 3 (import team resolution). These are pure-function tests that don't
// require a live Supabase/RLS environment — see supabase/tests/ for the
// RLS/multi-user scenarios that do.

function rep(over: Partial<Rep> & Pick<Rep, "id">): Rep {
  return {
    name: over.id,
    teamId: null,
    teamName: "ללא צוות",
    monthlyTarget: 100,
    currentResult: 0,
    ...over,
  };
}

describe("teamsFromReps — no hardcoded car/home", () => {
  it("groups an arbitrary number of teams, not just two", () => {
    const reps: Rep[] = [
      rep({ id: "r1", teamId: "t-alpha", teamName: "Alpha Squad" }),
      rep({ id: "r2", teamId: "t-beta", teamName: "Beta Squad" }),
      rep({ id: "r3", teamId: "t-gamma", teamName: "Gamma Squad" }),
      rep({ id: "r4", teamId: "t-alpha", teamName: "Alpha Squad" }),
    ];

    const groups = teamsFromReps(reps);
    expect(groups.map((g) => g.teamId).sort()).toEqual(["t-alpha", "t-beta", "t-gamma"]);
  });

  it("never special-cases 'car' or 'home' — a team named exactly that is treated like any other id", () => {
    const reps: Rep[] = [
      rep({ id: "r1", teamId: "car", teamName: "Car (renamed as a generic id)" }),
      rep({ id: "r2", teamId: "retention-eu", teamName: "EU Retention" }),
    ];
    const groups = teamsFromReps(reps).map((g) => g.teamId).sort();
    expect(groups).toEqual(["car", "retention-eu"]);
  });

  it("excludes unassigned (teamId: null) reps from the team groups", () => {
    const reps: Rep[] = [
      rep({ id: "r1", teamId: null, teamName: "ללא צוות" }),
      rep({ id: "r2", teamId: "t-x", teamName: "Team X" }),
    ];
    expect(teamsFromReps(reps)).toEqual([{ teamId: "t-x", teamName: "Team X" }]);
  });
});

describe("resolveTeam — import-time team resolution against the real cloud teams list", () => {
  const teams = [
    { id: "t-1", name: "חידושי רכב" },
    { id: "t-2", name: "חידושי דירה" },
    { id: "t-3", name: "Retention - North" },
  ];

  it("resolves an exact (normalized) match", () => {
    expect(resolveTeam("חידושי רכב", teams)).toEqual({ teamId: "t-1", teamName: "חידושי רכב" });
  });

  it("resolves a loose/substring match either direction", () => {
    expect(resolveTeam("צוות חידושי רכב", teams)).toEqual({ teamId: "t-1", teamName: "חידושי רכב" });
    expect(resolveTeam("Retention", teams)).toEqual({ teamId: "t-3", teamName: "Retention - North" });
  });

  it("never guesses car/home for unrecognized text — returns null instead", () => {
    expect(resolveTeam("Completely Unknown Team", teams)).toEqual({ teamId: null, teamName: null });
    expect(resolveTeam("car", teams)).toEqual({ teamId: null, teamName: null }); // no team literally named "car" in this org
    expect(resolveTeam(null, teams)).toEqual({ teamId: null, teamName: null });
    expect(resolveTeam("", teams)).toEqual({ teamId: null, teamName: null });
  });

  it("works against an arbitrary (non car/home) team catalog — proves no hardcoded enum", () => {
    const genericTeams = [
      { id: "t-cc-1", name: "Call Center Shift A" },
      { id: "t-cc-2", name: "Call Center Shift B" },
    ];
    expect(resolveTeam("Shift A", genericTeams)).toEqual({ teamId: "t-cc-1", teamName: "Call Center Shift A" });
  });

  it("normalizeName is reused consistently for both rep-name and team-name matching", () => {
    expect(normalizeName(" חידושי  רכב ")).toBe(normalizeName("חידושי-רכב"));
  });
});
