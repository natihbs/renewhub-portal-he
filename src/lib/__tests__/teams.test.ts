import { describe, it, expect } from "vitest";
import { teamSummary, teamsFromReps } from "@/lib/store";
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

describe("teamsFromReps / teamSummary — no hardcoded car/home", () => {
  it("groups an arbitrary number of teams, not just two", () => {
    const reps: Rep[] = [
      rep({ id: "r1", teamId: "t-alpha", teamName: "Alpha Squad", monthlyTarget: 100, currentResult: 50 }),
      rep({ id: "r2", teamId: "t-beta", teamName: "Beta Squad", monthlyTarget: 100, currentResult: 100 }),
      rep({ id: "r3", teamId: "t-gamma", teamName: "Gamma Squad", monthlyTarget: 100, currentResult: 25 }),
      rep({ id: "r4", teamId: "t-alpha", teamName: "Alpha Squad", monthlyTarget: 100, currentResult: 90 }),
    ];

    const groups = teamsFromReps(reps);
    expect(groups.map((g) => g.teamId).sort()).toEqual(["t-alpha", "t-beta", "t-gamma"]);

    const alpha = teamSummary(reps, "t-alpha");
    expect(alpha).toEqual({ target: 200, result: 140, pct: 70, count: 2 });

    const beta = teamSummary(reps, "t-beta");
    expect(beta.pct).toBe(100);
  });

  it("never special-cases 'car' or 'home' — a team named exactly that is treated like any other id", () => {
    const reps: Rep[] = [
      rep({ id: "r1", teamId: "car", teamName: "Car (renamed as a generic id)", monthlyTarget: 50, currentResult: 25 }),
      rep({ id: "r2", teamId: "retention-eu", teamName: "EU Retention", monthlyTarget: 80, currentResult: 80 }),
    ];
    const groups = teamsFromReps(reps).map((g) => g.teamId).sort();
    expect(groups).toEqual(["car", "retention-eu"]);
    expect(teamSummary(reps, "retention-eu").pct).toBe(100);
  });

  it("excludes unassigned (teamId: null) reps from the team groups", () => {
    const reps: Rep[] = [
      rep({ id: "r1", teamId: null, teamName: "ללא צוות" }),
      rep({ id: "r2", teamId: "t-x", teamName: "Team X" }),
    ];
    expect(teamsFromReps(reps)).toEqual([{ teamId: "t-x", teamName: "Team X" }]);
  });

  it("teamSummary(reps, null) aggregates unassigned reps without crashing", () => {
    const reps: Rep[] = [
      rep({ id: "r1", teamId: null, teamName: "ללא צוות", monthlyTarget: 10, currentResult: 5 }),
      rep({ id: "r2", teamId: "t-x", teamName: "Team X", monthlyTarget: 10, currentResult: 10 }),
    ];
    expect(teamSummary(reps, null)).toEqual({ target: 10, result: 5, pct: 50, count: 1 });
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
