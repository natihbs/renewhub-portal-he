import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateTeamGoalReaders, invalidateRepresentativeGoalReaders } from "@/routes/_authenticated/targets";

// Regression coverage for: "an official monthly team target of 1500 was
// saved, but the target is not reflected consistently in the team/dashboard
// experience." Root cause: the Targets page's save mutations (team goal, rep
// goals, copy-from-previous-month) only invalidated their own
// ["targets","workspace",teamId,month] query. Every OTHER consumer —
// index.tsx (Dashboard), MorningRoutine.tsx, and performance.tsx — reads via
// useTeamGoal/useRepresentativeGoals (goals-hooks.ts), which go through
// useCloudCollection keyed ["cloud","team_goals",opts] / ["cloud",
// "representative_goals",opts] (cloud-hooks.ts) — a completely disjoint cache
// namespace the Targets page's save mutations never touched. The Targets page
// itself always looked correct (its own query refetched); everything else
// kept showing the pre-save value.
//
// invalidateQueries matches by key PREFIX by default, so invalidating
// ["cloud","team_goals"] must cover every differently-parameterized cached
// variant (different team_id/month/enabled `opts`) a real consumer creates —
// asserted below by seeding several such variants, not just one.

describe("invalidateTeamGoalReaders / invalidateRepresentativeGoalReaders — Dashboard/MorningRoutine/Performance cannot see a stale target after a save", () => {
  it("invalidates every cached team_goals variant regardless of its eq/in/enabled options", async () => {
    const qc = new QueryClient();
    const variants = [
      ["cloud", "team_goals", { eq: { team_id: "vehicle-renewals", goal_month: "2026-08-01" }, enabled: true }],
      ["cloud", "team_goals", { in: { team_id: ["vehicle-renewals", "other-team"] }, eq: { goal_month: "2026-08-01" }, enabled: true }],
    ];
    for (const key of variants) qc.setQueryData(key, [{ target_value: 1400 }]); // pre-save value

    await invalidateTeamGoalReaders(qc);

    for (const key of variants) {
      expect(qc.getQueryState(key)?.isInvalidated, `expected ${JSON.stringify(key)} to be invalidated`).toBe(true);
    }
  });

  it("invalidates every cached representative_goals variant regardless of its eq/in/enabled options", async () => {
    const qc = new QueryClient();
    const variants = [
      ["cloud", "representative_goals", { eq: { representative_id: "rep-1", goal_month: "2026-08-01" }, enabled: true }],
      ["cloud", "representative_goals", { in: { representative_id: ["rep-1", "rep-2"] }, eq: { goal_month: "2026-08-01" }, enabled: true }],
    ];
    for (const key of variants) qc.setQueryData(key, [{ target_value: 500 }]);

    await invalidateRepresentativeGoalReaders(qc);

    for (const key of variants) {
      expect(qc.getQueryState(key)?.isInvalidated, `expected ${JSON.stringify(key)} to be invalidated`).toBe(true);
    }
  });

  it("saving a team target does not touch representative_goals caches, and vice versa (no over-broad invalidation)", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["cloud", "representative_goals", { eq: { representative_id: "rep-1" } }], [{ target_value: 500 }]);

    await invalidateTeamGoalReaders(qc);

    expect(qc.getQueryState(["cloud", "representative_goals", { eq: { representative_id: "rep-1" } }])?.isInvalidated).toBeFalsy();
  });

  it("does not invalidate the legacy representatives.monthly_target read path (a different, unrelated cache)", async () => {
    // Guards against a future "fix" that widens invalidation into the legacy
    // per-representative cloud collection instead of the official goals
    // tables — that would mask this exact bug behind an unrelated refetch.
    const qc = new QueryClient();
    qc.setQueryData(["cloud", "representatives", {}], [{ monthly_target: 999 }]);

    await Promise.all([invalidateTeamGoalReaders(qc), invalidateRepresentativeGoalReaders(qc)]);

    expect(qc.getQueryState(["cloud", "representatives", {}])?.isInvalidated).toBeFalsy();
  });
});
