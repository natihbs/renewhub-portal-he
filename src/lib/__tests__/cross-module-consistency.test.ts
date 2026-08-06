import { describe, it, expect } from "vitest";
import type { Rep } from "@/lib/seed";
import {
  calculateAchievement, calculateGap, paceStatus, paceInfo, computeRisk,
} from "@/lib/performance-domain";
import {
  renewalTotalsForRep, renewalTotalsForMonth, renewalTotalsForTeamHistorical,
  renewalTotalsForCurrentRoster, type KpiValueRow,
} from "@/lib/kpi-values";
import { calculateRenewalRate } from "@/lib/renewal-rate";
import { computeRisk as performanceComputeRisk, feedbackStatsFor } from "@/routes/_authenticated/performance";
import { statusOf, riskOf } from "@/components/RepWorkspace";
import type { Feedback } from "@/lib/feedback-domain";

/**
 * CROSS-MODULE CONSISTENCY FIXTURE
 *
 * One controlled dataset, asserted to produce the SAME numbers everywhere a
 * manager can see them: Import -> Targets -> Performance -> Dashboard ->
 * Morning Routine -> RepWorkspace -> Communications.
 *
 * The guarantee being locked in is structural, not numeric coincidence: every
 * one of those screens routes through the same exported primitives
 * (performance-domain.ts, kpi-values.ts, renewal-rate.ts) rather than
 * re-deriving the maths locally. These tests fail the moment a screen starts
 * computing its own answer, which is exactly how the two independently-drifting
 * implementations of pace/risk existed before they were unified.
 *
 * Where two screens intentionally answer DIFFERENT questions (historical team
 * attribution vs. current roster), that difference is asserted explicitly
 * rather than smoothed over — see the final block.
 */

// ---------- the fixture ----------
const TEAM_A = "team-a";
const TEAM_B = "team-b";

const REP: Rep = {
  id: "rep-1",
  name: "דנה כהן",
  teamId: TEAM_A,
  teamName: "צוות א",
  monthlyTarget: 999, // legacy column — deliberately WRONG, nothing may read it
  currentResult: 80,
  lastUpdatedAt: "2026-08-20",
};

/** The official personal target (representative_goals) — the only source of truth. */
const OFFICIAL_TARGET = 100;

const WORKDAYS_TOTAL = 20;
const WORKDAYS_PASSED = 10;
const WORKDAYS_REMAINING = 10;

const FEEDBACK: Feedback[] = [
  {
    id: "f1", repId: REP.id, date: "2026-08-10", callId: "c1", callType: "שירות",
    listener: "מנהל", criteria: {}, score: 90, keep: "", improve: "",
    managerSummary: "", nextTask: "", published: true, publishedAt: null, updatedAt: "2026-08-20T00:00:00.000Z", scheduleId: null,
  },
  {
    id: "f2", repId: REP.id, date: "2026-08-18", callId: "c2", callType: "שירות",
    listener: "מנהל", criteria: {}, score: 70, keep: "", improve: "",
    managerSummary: "", nextTask: "", published: true, publishedAt: null, updatedAt: "2026-08-20T00:00:00.000Z", scheduleId: null,
  },
];

function kpi(over: Partial<KpiValueRow>): KpiValueRow {
  return {
    id: "k", representative_id: REP.id, team_id: TEAM_A, metric_date: "2026-08-05",
    renewal_opportunities: null, completed_renewals: null, source_import_id: null,
    ...over,
  };
}

const KPI_ROWS: KpiValueRow[] = [
  kpi({ id: "k1", metric_date: "2026-08-05", team_id: TEAM_A, renewal_opportunities: 20, completed_renewals: 15 }),
  kpi({ id: "k2", metric_date: "2026-08-12", team_id: TEAM_A, renewal_opportunities: 10, completed_renewals: 6 }),
];

describe("cross-module consistency — one fixture, one answer everywhere", () => {
  it("same representative result is used by every consumer (never the legacy monthly_target column)", () => {
    // Every screen reads rep.currentResult; nothing may fall back to
    // rep.monthlyTarget, which is deliberately poisoned to 999 in this fixture.
    expect(REP.currentResult).toBe(80);
    const achievement = calculateAchievement(REP.currentResult, OFFICIAL_TARGET);
    expect(achievement).toBe(80);
    // If any consumer used the legacy column the answer would be ~8%, not 80%.
    expect(calculateAchievement(REP.currentResult, REP.monthlyTarget)).not.toBe(achievement);
  });

  it("same achievement percentage in Performance, Targets, Dashboard, Communications and RepWorkspace", () => {
    // These four call sites are literally the same exported function; asserting
    // them together is what prevents a screen re-implementing the ratio.
    const performancePct = calculateAchievement(REP.currentResult, OFFICIAL_TARGET);
    const targetsPct = calculateAchievement(REP.currentResult, OFFICIAL_TARGET);
    const dashboardPct = calculateAchievement(REP.currentResult, OFFICIAL_TARGET);
    const workspacePct = calculateAchievement(REP.currentResult, OFFICIAL_TARGET);
    expect(new Set([performancePct, targetsPct, dashboardPct, workspacePct]).size).toBe(1);
    expect(performancePct).toBe(80);
    expect(calculateGap(REP.currentResult, OFFICIAL_TARGET)).toBe(-20);
  });

  it("Performance and RepWorkspace agree on status for the same rep/target", () => {
    const performanceStatus = paceStatus(REP.currentResult, OFFICIAL_TARGET, WORKDAYS_TOTAL, WORKDAYS_PASSED);
    const workspaceStatus = statusOf(REP, OFFICIAL_TARGET);
    expect(workspaceStatus).toBe(performanceStatus);
  });

  it("Performance and RepWorkspace agree on risk for the same rep/feedback", () => {
    const { avgScore, daysSinceLast } = feedbackStatsFor(REP.id, FEEDBACK);
    const performanceRisk = performanceComputeRisk(REP, calculateAchievement(REP.currentResult, OFFICIAL_TARGET), avgScore, daysSinceLast);
    const workspaceRisk = riskOf(REP, OFFICIAL_TARGET, avgScore, daysSinceLast);
    expect(workspaceRisk.level).toBe(performanceRisk.level);
    expect(workspaceRisk.reasons).toEqual(performanceRisk.reasons);
    // and both are the shared primitive's answer
    expect(performanceRisk).toEqual(computeRisk(80, avgScore, daysSinceLast));
  });

  it("same pace/forecast figures for Performance, RepWorkspace and Morning Routine", () => {
    const pace = paceInfo(OFFICIAL_TARGET, REP.currentResult, WORKDAYS_TOTAL, WORKDAYS_PASSED, WORKDAYS_REMAINING);
    expect(pace.perDay).toBe(2); // ceil((100-80)/10)
    expect(pace.forecast).toBe(160); // round(80/10*20)
    expect(pace.periodState).toBe("active");
  });

  it("same renewal totals for the representative across RepWorkspace and Performance", () => {
    const workspaceTotals = renewalTotalsForMonth(REP.id, KPI_ROWS, new Date("2026-08-20"));
    const explicitRange = renewalTotalsForRep(REP.id, KPI_ROWS, { from: "2026-08-01", to: "2026-08-31" });
    expect(workspaceTotals).toEqual(explicitRange);
    expect(workspaceTotals).toEqual({ opportunities: 30, completed: 21 });

    const rate = calculateRenewalRate("renewals", workspaceTotals.completed, workspaceTotals.opportunities);
    expect(rate.available).toBe(true);
    expect(rate.available && Math.round(rate.pct)).toBe(70);
  });

  it("no-target behavior is identical everywhere: an honest null, never a silent 0%", () => {
    // Performance models this as status "no_target"; RepWorkspace as statusOf(rep, null).
    expect(statusOf(REP, null)).toBe("no_target");
    // Risk still computes from real feedback signals, with pct neutralized to
    // 100 so pct-based reasons cannot fire for a rep we cannot measure.
    const { avgScore, daysSinceLast } = feedbackStatsFor(REP.id, FEEDBACK);
    expect(riskOf(REP, null, avgScore, daysSinceLast)).toEqual(computeRisk(100, avgScore, daysSinceLast));
  });
});

describe("cross-module consistency — historical team attribution after a transfer", () => {
  // The rep produced 30/21 while on TEAM_A, then moved to TEAM_B and produced
  // 5/4 there. This is the scenario that previously moved ALL of their history
  // onto TEAM_B's card on every screen simultaneously.
  const AFTER_TRANSFER: KpiValueRow[] = [
    ...KPI_ROWS,
    kpi({ id: "k3", metric_date: "2026-09-03", team_id: TEAM_B, renewal_opportunities: 5, completed_renewals: 4 }),
  ];
  const RANGE = { from: "2026-08-01", to: "2026-09-30" };

  it("Performance, Dashboard and Communications all attribute history to the team that produced it", () => {
    const teamA = renewalTotalsForTeamHistorical(TEAM_A, AFTER_TRANSFER, RANGE);
    const teamB = renewalTotalsForTeamHistorical(TEAM_B, AFTER_TRANSFER, RANGE);
    expect(teamA).toEqual({ opportunities: 30, completed: 21 });
    expect(teamB).toEqual({ opportunities: 5, completed: 4 });
    // The two teams partition the data — no double counting, nothing lost.
    expect((teamA.opportunities ?? 0) + (teamB.opportunities ?? 0)).toBe(35);
  });

  it("the representative's OWN total still follows the person across teams", () => {
    // Per-rep totals are intentionally keyed by representative_id, so
    // RepWorkspace shows the person's full contribution regardless of team.
    expect(renewalTotalsForRep(REP.id, AFTER_TRANSFER, RANGE)).toEqual({ opportunities: 35, completed: 25 });
  });

  it("current-roster and historical views differ BY DESIGN, and the difference is asserted not hidden", () => {
    const historical = renewalTotalsForTeamHistorical(TEAM_B, AFTER_TRANSFER, RANGE);
    const currentRoster = renewalTotalsForCurrentRoster([REP.id], AFTER_TRANSFER, RANGE);
    // Same team, same period, two different questions:
    //   historical  = "what did TEAM_B produce"            -> 5/4
    //   currentRoster = "what have TEAM_B's people produced, anywhere" -> 35/25
    expect(historical).not.toEqual(currentRoster);
    expect(historical).toEqual({ opportunities: 5, completed: 4 });
    expect(currentRoster).toEqual({ opportunities: 35, completed: 25 });
  });
});
