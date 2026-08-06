import { describe, it, expect } from "vitest";
import {
  classifyRepData, computeCompleteness, daysBetweenIso, STALE_AFTER_DAYS,
  computeAchievementTrend, computeMonthlyAverage,
  computeListeningPlan,
  needsSupport, repsNeedingSupport, supportStatus,
  computeFreshness, viewState, canAssertAbsence,
  type RepDataEvidence, type CompletenessInput, type SupportInput, type AchievementSnapshot,
} from "@/lib/dashboard-domain";
import { CLOUD_TABLES, CLOUD_WRITE_PROTECTED_TABLES } from "@/lib/cloud.functions";

// Regression coverage for the Dashboard Operational Hardening sprint. Each
// block names the defect it keeps fixed.

const TODAY = "2026-08-07";

function evidence(over: Partial<RepDataEvidence> = {}): RepDataEvidence {
  return { latestMetricDate: null, hasDatedValue: false, datedTotal: 0, currentResult: 0, ...over };
}

// ---------------------------------------------------------------------------
// P0 — real data completeness
// ---------------------------------------------------------------------------

describe("data completeness is derived from real evidence", () => {
  it("a representative with no dated row and no result is missing data", () => {
    // THE BUG: the old predicate was `currentResult > 0 || lastUpdatedAt`,
    // where lastUpdatedAt is representatives.updated_at — NOT NULL DEFAULT
    // now(), hence always truthy. This case could never be reached.
    expect(classifyRepData(evidence(), TODAY)).toBe("no_data");
  });

  it("a dated row of zero is a REAL zero, not missing data", () => {
    expect(classifyRepData(
      evidence({ latestMetricDate: TODAY, hasDatedValue: true, datedTotal: 0 }),
      TODAY,
    )).toBe("real_zero");
  });

  it("a dated row with a value is reported data", () => {
    expect(classifyRepData(
      evidence({ latestMetricDate: TODAY, hasDatedValue: true, datedTotal: 12 }),
      TODAY,
    )).toBe("has_data");
  });

  it("a non-zero current_result counts even without a dated row", () => {
    // It can only have been written through the audited metrics path.
    expect(classifyRepData(evidence({ currentResult: 40 }), TODAY)).toBe("has_data");
  });

  it("a zero current_result with no dated row is NOT called a real zero", () => {
    // We cannot distinguish "genuinely zero" from "never imported" here, and
    // certifying it as fine is exactly the failure this replaces.
    expect(classifyRepData(evidence({ currentResult: 0 }), TODAY)).toBe("no_data");
  });

  it("dated evidence older than the threshold is stale", () => {
    expect(classifyRepData(
      evidence({ latestMetricDate: "2026-08-01", hasDatedValue: true, datedTotal: 5 }),
      TODAY,
    )).toBe("stale");
    // Exactly at the threshold is still current.
    const atEdge = new Date(Date.UTC(2026, 7, 7 - STALE_AFTER_DAYS)).toISOString().slice(0, 10);
    expect(classifyRepData(
      evidence({ latestMetricDate: atEdge, hasDatedValue: true, datedTotal: 5 }),
      TODAY,
    )).not.toBe("stale");
  });

  it("no representatives reports 0%, never a vacuous 100%", () => {
    // "No representatives" is not "all representatives are fine" — a manager
    // whose team failed to load must not be told their data is complete.
    const result = computeCompleteness([], TODAY);
    expect(result.total).toBe(0);
    expect(result.completenessPct).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it("a representative with no performance record REDUCES completeness", () => {
    const inputs: CompletenessInput[] = [
      { repId: "a", repName: "דנה", hasTarget: true, evidence: evidence({ currentResult: 50 }) },
      { repId: "b", repName: "יוסי", hasTarget: true, evidence: evidence() },
    ];
    const result = computeCompleteness(inputs, TODAY);
    expect(result.total).toBe(2);
    expect(result.reported).toBe(1);
    expect(result.missing).toBe(1);
    expect(result.completenessPct).toBe(50);
    // The old implementation returned 100% for this exact population.
    expect(result.completenessPct).not.toBe(100);
  });

  it("mixed population: warnings are real and per-representative", () => {
    const inputs: CompletenessInput[] = [
      { repId: "a", repName: "דנה", hasTarget: true, evidence: evidence({ latestMetricDate: TODAY, hasDatedValue: true, datedTotal: 9 }) },
      { repId: "b", repName: "יוסי", hasTarget: true, evidence: evidence() },
      { repId: "c", repName: "מיכל", hasTarget: false, evidence: evidence({ latestMetricDate: TODAY, hasDatedValue: true, datedTotal: 0 }) },
      { repId: "d", repName: "רון", hasTarget: true, evidence: evidence({ latestMetricDate: "2026-07-20", hasDatedValue: true, datedTotal: 3 }) },
    ];
    const result = computeCompleteness(inputs, TODAY);
    expect(result.total).toBe(4);
    expect(result.missing).toBe(1);
    expect(result.stale).toBe(1);
    expect(result.realZero).toBe(1);
    expect(result.reported).toBe(3);
    expect(result.completenessPct).toBe(75);

    expect(result.warnings.filter((w) => w.kind === "no_data").map((w) => w.repName)).toEqual(["יוסי"]);
    expect(result.warnings.filter((w) => w.kind === "stale").map((w) => w.repName)).toEqual(["רון"]);
    expect(result.warnings.filter((w) => w.kind === "no_target").map((w) => w.repName)).toEqual(["מיכל"]);
  });

  it("daysBetweenIso never returns a negative gap", () => {
    expect(daysBetweenIso("2026-08-01", "2026-08-07")).toBe(6);
    expect(daysBetweenIso("2026-09-01", "2026-08-07")).toBe(0);
    expect(daysBetweenIso("not-a-date", TODAY)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// P0 — real trend, never a fabricated zero baseline
// ---------------------------------------------------------------------------

describe("achievement trend uses real dated history", () => {
  const snaps = (rows: [string, number | null][]): AchievementSnapshot[] =>
    rows.map(([snapshotDate, achievementPct]) => ({ snapshotDate, achievementPct }));

  it("positive trend against yesterday's real snapshot", () => {
    const t = computeAchievementTrend(92, snaps([["2026-08-06", 85]]), TODAY);
    expect(t.available).toBe(true);
    expect(t.available && t.previousPct).toBe(85);
    expect(t.available && t.changePct).toBe(7);
  });

  it("negative trend is reported as negative, not as the whole achievement", () => {
    // THE BUG: change was `achievementPct - 0`, because
    // morning_settings.yesterday_achievement_pct had no writer anywhere. A
    // team sliding from 90 to 87 still showed "+87.0%" in green.
    const t = computeAchievementTrend(87, snaps([["2026-08-06", 90]]), TODAY);
    expect(t.available && t.changePct).toBe(-3);
    expect(t.available && t.changePct).not.toBe(87);
  });

  it("an unchanged figure is a zero change, distinct from no history", () => {
    const t = computeAchievementTrend(80, snaps([["2026-08-06", 80]]), TODAY);
    expect(t.available).toBe(true);
    expect(t.available && t.changePct).toBe(0);
  });

  it("no prior history is UNAVAILABLE, never a comparison against zero", () => {
    const t = computeAchievementTrend(87, [], TODAY);
    expect(t.available).toBe(false);
    expect(!t.available && t.reason).toBe("no_history");
  });

  it("today's own snapshot is not used as its own baseline", () => {
    // The dashboard writes today's snapshot on open; comparing against it
    // would always produce a change of exactly zero.
    const t = computeAchievementTrend(87, snaps([[TODAY, 87]]), TODAY);
    expect(t.available).toBe(false);
    expect(!t.available && t.reason).toBe("no_history");
  });

  it("no target means no percentage to compare at all", () => {
    const t = computeAchievementTrend(null, snaps([["2026-08-06", 85]]), TODAY);
    expect(t.available).toBe(false);
    expect(!t.available && t.reason).toBe("no_target");
  });

  it("partial history: the most recent prior day wins, gaps are skipped", () => {
    const t = computeAchievementTrend(90, snaps([["2026-08-01", 50], ["2026-08-05", 70], ["2026-08-03", null]]), TODAY);
    expect(t.available && t.previousDate).toBe("2026-08-05");
    expect(t.available && t.changePct).toBe(20);
  });

  it("monthly average is null with no data, never 0", () => {
    expect(computeMonthlyAverage([], TODAY)).toBeNull();
    // A 0 here would read as "the team averaged zero this month".
    expect(computeMonthlyAverage(snaps([["2026-07-30", 90]]), TODAY)).toBeNull();
    expect(computeMonthlyAverage(snaps([["2026-08-01", 80], ["2026-08-05", 90]]), TODAY)).toBe(85);
  });
});

// ---------------------------------------------------------------------------
// P0 — real listening plan
// ---------------------------------------------------------------------------

describe("listening plan comes from real schedules", () => {
  const sched = (id: string, date: string, status: "planned" | "completed" | "cancelled") =>
    ({ id, repId: "r1", date, status });

  it("counts today's real sessions, not a hardcoded 5", () => {
    const plan = computeListeningPlan(
      [sched("1", TODAY, "planned"), sched("2", TODAY, "completed"), sched("3", TODAY, "planned")],
      [],
      TODAY,
    );
    expect(plan.plannedToday).toBe(3);
    expect(plan.completedToday).toBe(1);
    expect(plan.remainingToday).toBe(2);
    // The old card reported 5 planned for every manager, every day.
    expect(plan.plannedToday).not.toBe(5);
  });

  it("zero scheduled is honestly zero, not 5", () => {
    const plan = computeListeningPlan([], [], TODAY);
    expect(plan.plannedToday).toBe(0);
    expect(plan.remainingToday).toBe(0);
  });

  it("cancelled sessions are excluded from the plan but counted separately", () => {
    const plan = computeListeningPlan(
      [sched("1", TODAY, "planned"), sched("2", TODAY, "cancelled")],
      [],
      TODAY,
    );
    expect(plan.plannedToday).toBe(1);
    expect(plan.cancelledToday).toBe(1);
  });

  it("past planned sessions are overdue; past completed and cancelled are not", () => {
    const plan = computeListeningPlan(
      [sched("1", "2026-08-05", "planned"), sched("2", "2026-08-04", "completed"), sched("3", "2026-08-03", "cancelled")],
      [],
      TODAY,
    );
    expect(plan.overdue).toBe(1);
  });

  it("ad-hoc evaluations are counted separately and may exceed the plan", () => {
    const plan = computeListeningPlan([], [TODAY, TODAY, "2026-08-01"], TODAY);
    expect(plan.evaluationsToday).toBe(2);
    expect(plan.plannedToday).toBe(0);
  });

  it("timestamped evaluation dates are matched on their date part", () => {
    const plan = computeListeningPlan([], [`${TODAY}T09:30:00.000Z`], TODAY);
    expect(plan.evaluationsToday).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// P2 — support thresholds, not rank
// ---------------------------------------------------------------------------

describe("needing support is measured against pace, not rank", () => {
  const base = { workdaysTotal: 20, workdaysPassed: 10 };

  it("a representative above target is never described as needing support", () => {
    // THE BUG: buildInsights labelled `withPct[withPct.length - 1]` — whoever
    // sorted last — as "דורש/ת ליווי", with no floor. On a team where
    // everyone beat target it named the person at 145%.
    const star: SupportInput = { repId: "a", repName: "דנה", achievementPct: 145, currentResult: 145, target: 100, ...base };
    expect(needsSupport(star)).toBe(false);
    expect(supportStatus(star)).toBe("above");
  });

  it("the LAST-ranked representative on a strong team is still not flagged", () => {
    const inputs: SupportInput[] = [
      { repId: "a", repName: "דנה", achievementPct: 150, currentResult: 150, target: 100, ...base },
      { repId: "b", repName: "יוסי", achievementPct: 145, currentResult: 145, target: 100, ...base },
    ];
    expect(repsNeedingSupport(inputs)).toEqual([]);
  });

  it("a genuinely behind representative IS flagged", () => {
    const behind: SupportInput = { repId: "c", repName: "רון", achievementPct: 20, currentResult: 20, target: 100, ...base };
    expect(needsSupport(behind)).toBe(true);
    expect(supportStatus(behind)).toBe("attention");
  });

  it("no target means no judgement — never flagged, never ranked", () => {
    const noTarget: SupportInput = { repId: "d", repName: "מיכל", achievementPct: null, currentResult: 30, target: null, ...base };
    expect(needsSupport(noTarget)).toBe(false);
    expect(supportStatus(noTarget)).toBe("no_target");
  });

  it("those flagged are ordered worst first", () => {
    const inputs: SupportInput[] = [
      { repId: "a", repName: "א", achievementPct: 30, currentResult: 30, target: 100, ...base },
      { repId: "b", repName: "ב", achievementPct: 10, currentResult: 10, target: 100, ...base },
      { repId: "c", repName: "ג", achievementPct: 120, currentResult: 120, target: 100, ...base },
    ];
    expect(repsNeedingSupport(inputs).map((r) => r.repName)).toEqual(["ב", "א"]);
  });
});

// ---------------------------------------------------------------------------
// P1 — freshness from the real source
// ---------------------------------------------------------------------------

describe("freshness separates the three facts it used to conflate", () => {
  it("reports source-data age, import time and refetch time independently", () => {
    const f = computeFreshness({
      sourceDataDate: "2026-08-06",
      lastImportAt: "2026-08-06T05:00:00.000Z",
      lastRefreshAt: "2026-08-07T08:00:00.000Z",
      today: TODAY,
    });
    expect(f.ageInDays).toBe(1);
    expect(f.state).toBe("current");
    expect(f.lastImportAt).toBe("2026-08-06T05:00:00.000Z");
    expect(f.lastRefreshAt).toBe("2026-08-07T08:00:00.000Z");
  });

  it("no dated measurement is 'unknown', not 'current'", () => {
    const f = computeFreshness({ sourceDataDate: null, lastImportAt: null, lastRefreshAt: null, today: TODAY });
    expect(f.state).toBe("unknown");
    expect(f.ageInDays).toBeNull();
  });

  it("ages through aging into stale", () => {
    expect(computeFreshness({ sourceDataDate: "2026-08-05", lastImportAt: null, lastRefreshAt: null, today: TODAY }).state).toBe("aging");
    expect(computeFreshness({ sourceDataDate: "2026-07-25", lastImportAt: null, lastRefreshAt: null, today: TODAY }).state).toBe("stale");
  });

  it("a recent refetch does not make old source data look fresh", () => {
    // The two were previously conflated into one "is the data fresh" claim.
    const f = computeFreshness({
      sourceDataDate: "2026-07-01",
      lastImportAt: "2026-07-01T00:00:00.000Z",
      lastRefreshAt: "2026-08-07T09:00:00.000Z",
      today: TODAY,
    });
    expect(f.state).toBe("stale");
  });
});

// ---------------------------------------------------------------------------
// P1 — loading / error / empty are distinct
// ---------------------------------------------------------------------------

describe("async view state", () => {
  it("distinguishes all four states", () => {
    expect(viewState({ isLoading: true, isError: false, isEmpty: true })).toBe("loading");
    expect(viewState({ isLoading: false, isError: true, isEmpty: true })).toBe("error");
    expect(viewState({ isLoading: false, isError: false, isEmpty: true })).toBe("empty");
    expect(viewState({ isLoading: false, isError: false, isEmpty: false })).toBe("ready");
  });

  it("loading takes precedence over error and emptiness", () => {
    expect(viewState({ isLoading: true, isError: true, isEmpty: false })).toBe("loading");
  });

  it("an absence may only be asserted once the query settled successfully", () => {
    // This is what gates "לא הוגדר יעד חודשי לצוות זה" and its CTA. The
    // dashboard used to render that claim, with a button to go and create a
    // target, for teams whose target had simply not arrived yet.
    expect(canAssertAbsence({ isLoading: true, isError: false })).toBe(false);
    expect(canAssertAbsence({ isLoading: false, isError: true })).toBe(false);
    expect(canAssertAbsence({ isLoading: false, isError: false })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Write boundary
// ---------------------------------------------------------------------------

describe("dashboard write boundary", () => {
  it("underwriting, checklist and snapshots must go through domain server functions", () => {
    for (const t of ["underwriting_issues", "morning_checklist", "team_achievement_snapshots"]) {
      expect(CLOUD_WRITE_PROTECTED_TABLES).toContain(t);
    }
  });

  it("activity_events is no longer reachable through the generic reader at all", () => {
    // It is retired: admin-only reads, no client writes, no app reader. The
    // dashboard feed comes from audit_log instead.
    expect(CLOUD_TABLES).not.toContain("activity_events");
  });

  it("every write-protected table is still readable", () => {
    for (const t of CLOUD_WRITE_PROTECTED_TABLES) {
      expect(CLOUD_TABLES).toContain(t);
    }
  });
});
