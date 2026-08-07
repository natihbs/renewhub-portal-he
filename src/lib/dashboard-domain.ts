// Dashboard operational domain — pure, dependency-free, unit-tested.
//
// Everything the dashboard asserts about the state of the business lives here
// rather than inline in a component, for the same reason the score formula
// moved into feedback-domain.ts: a rule that exists in exactly one place can
// be tested, and cannot drift between the two screens that show it.
//
// The functions here replace four figures that were previously incapable of
// reporting a problem:
//   * data completeness, which was pinned at 100% by a predicate that could
//     never be false;
//   * "נציג ללא ביצוע" warnings, which could therefore never fire;
//   * the day-over-day achievement trend, which compared against a column
//     nothing had ever written;
//   * "האזנות להיום", which planned against a hardcoded 5.

import { paceStatus, type AchievementStatus } from "@/lib/performance-domain";

// ---------------------------------------------------------------------------
// Data completeness
// ---------------------------------------------------------------------------

/**
 * What we actually know about one representative's performance data.
 *
 * The previous implementation asked `r.currentResult > 0 || r.lastUpdatedAt`,
 * where lastUpdatedAt is representatives.updated_at — a NOT NULL DEFAULT now()
 * column that is always populated. The right-hand side was therefore always
 * true, the left-hand side was dead code, and completeness was a constant
 * 100%. Worse, updated_at moves when a name is corrected and does NOT move
 * when a renewals-only import lands, so it was uncorrelated with the thing it
 * claimed to measure in both directions.
 *
 * These four states are distinguishable from real evidence only:
 *   has_data    a dated kpi_values row with a value > 0, or a non-zero
 *               current_result recorded through the audited metrics path
 *   real_zero   a dated kpi_values row that genuinely says zero. This is the
 *               null-vs-0 distinction kpi-values.ts already models: a row
 *               exists and its value is 0, which is a fact, not an absence.
 *   no_data     no dated row and no non-zero result. We cannot prove anything
 *               was ever recorded for this person.
 *   stale       we have data, but the newest dated evidence is older than the
 *               staleness threshold.
 */
export type RepDataState = "has_data" | "real_zero" | "no_data" | "stale";

/** A representative has genuinely reportable performance data. */
export function isReportedState(state: RepDataState): boolean {
  return state === "has_data" || state === "real_zero" || state === "stale";
}

export type RepDataEvidence = {
  /** Newest kpi_values.metric_date for this rep in the measured period, or null. */
  latestMetricDate: string | null;
  /**
   * Whether any dated row in the period carried a non-null value. A row of
   * all-nulls is not evidence of a measurement.
   */
  hasDatedValue: boolean;
  /** Sum of the dated values in the period, when hasDatedValue. */
  datedTotal: number;
  /** representatives.current_result — the authoritative scalar for non-renewal profiles. */
  currentResult: number;
};

/** Days after which dated evidence stops counting as current. */
export const STALE_AFTER_DAYS = 3;

export function classifyRepData(evidence: RepDataEvidence, today: string, staleAfterDays = STALE_AFTER_DAYS): RepDataState {
  const { latestMetricDate, hasDatedValue, datedTotal, currentResult } = evidence;

  if (hasDatedValue && latestMetricDate) {
    if (daysBetweenIso(latestMetricDate, today) > staleAfterDays) return "stale";
    return datedTotal > 0 ? "has_data" : "real_zero";
  }

  // No dated evidence. A non-zero current_result is still real evidence —
  // it can only have been written through updateRepresentativeMetrics, which
  // is audited. A zero with no dated row proves nothing at all, and is
  // deliberately NOT called a "real zero": we cannot tell it apart from
  // "never imported", and telling the manager it is fine would be the exact
  // failure this replaces.
  if (currentResult > 0) return "has_data";
  return "no_data";
}

/** Whole days from an ISO date to another, never negative. */
export function daysBetweenIso(from: string, to: string): number {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 86400000));
}

export type CompletenessInput = {
  repId: string;
  repName: string;
  evidence: RepDataEvidence;
  /** Whether an official monthly target exists for this rep. */
  hasTarget: boolean;
};

export type CompletenessWarning = {
  repId: string;
  repName: string;
  kind: "no_data" | "stale" | "no_target";
};

export type CompletenessResult = {
  total: number;
  reported: number;
  missing: number;
  stale: number;
  realZero: number;
  /** Share of representatives with genuinely reportable data, 0-100. */
  completenessPct: number;
  warnings: CompletenessWarning[];
  byRepId: Map<string, RepDataState>;
};

/**
 * Real data completeness for a population of representatives.
 *
 * A representative with no performance record REDUCES completeness — which
 * was the whole point and was previously impossible. An empty population
 * reports 0 reps and 0%, not a vacuous 100%: "no representatives" is not the
 * same as "all representatives are fine", and a manager whose team failed to
 * load must not be told their data is complete.
 */
export function computeCompleteness(reps: CompletenessInput[], today: string, staleAfterDays = STALE_AFTER_DAYS): CompletenessResult {
  const byRepId = new Map<string, RepDataState>();
  const warnings: CompletenessWarning[] = [];
  let reported = 0;
  let missing = 0;
  let stale = 0;
  let realZero = 0;

  for (const r of reps) {
    const state = classifyRepData(r.evidence, today, staleAfterDays);
    byRepId.set(r.repId, state);
    if (state === "no_data") {
      missing += 1;
      warnings.push({ repId: r.repId, repName: r.repName, kind: "no_data" });
    } else {
      reported += 1;
      if (state === "stale") {
        stale += 1;
        warnings.push({ repId: r.repId, repName: r.repName, kind: "stale" });
      }
      if (state === "real_zero") realZero += 1;
    }
    if (!r.hasTarget) {
      warnings.push({ repId: r.repId, repName: r.repName, kind: "no_target" });
    }
  }

  return {
    total: reps.length,
    reported,
    missing,
    stale,
    realZero,
    completenessPct: reps.length === 0 ? 0 : (reported / reps.length) * 100,
    warnings,
    byRepId,
  };
}

// ---------------------------------------------------------------------------
// Achievement trend
// ---------------------------------------------------------------------------

export type AchievementSnapshot = { snapshotDate: string; achievementPct: number | null };

export type TrendUnavailableReason = "no_target" | "no_history";

export type AchievementTrend =
  | { available: true; previousPct: number; changePct: number; previousDate: string; monthlyAvgPct: number | null }
  | { available: false; reason: TrendUnavailableReason; monthlyAvgPct: number | null };

export const TREND_UNAVAILABLE_LABEL: Record<TrendUnavailableReason, string> = {
  no_target: "לא הוגדר יעד חודשי — אין אחוז עמידה להשוואה",
  no_history: "אין עדיין היסטוריה להשוואה — ההשוואה תופיע החל ממחר",
};

/**
 * Day-over-day change, computed from REAL dated snapshots.
 *
 * The previous version was `achievementPct - morning_settings.yesterday_achievement_pct`,
 * a column no code path ever wrote. It stayed 0 forever and the read had a
 * `?? 0`, so the badge always rendered "+<the entire achievement>", in green,
 * regardless of what the team had actually done. A team sliding from 90% to
 * 87% still showed "+87.0%".
 *
 * Here, absent history is absent: `available: false` with a reason, never a
 * zero standing in for a measurement that was never taken. The most recent
 * snapshot STRICTLY BEFORE today is the comparison point — comparing against
 * today's own snapshot (which the dashboard writes on open) would always
 * yield zero change.
 */
export function computeAchievementTrend(
  currentPct: number | null,
  snapshots: AchievementSnapshot[],
  today: string,
): AchievementTrend {
  const monthlyAvgPct = computeMonthlyAverage(snapshots, today);
  if (currentPct === null) return { available: false, reason: "no_target", monthlyAvgPct };

  const prior = snapshots
    .filter((s) => s.snapshotDate < today && s.achievementPct !== null)
    .sort((a, b) => (a.snapshotDate < b.snapshotDate ? 1 : -1))[0];

  if (!prior || prior.achievementPct === null) {
    return { available: false, reason: "no_history", monthlyAvgPct };
  }
  return {
    available: true,
    previousPct: prior.achievementPct,
    changePct: currentPct - prior.achievementPct,
    previousDate: prior.snapshotDate,
    monthlyAvgPct,
  };
}

/**
 * Mean achievement across the real snapshots recorded in the current calendar
 * month. Null when there are none — never 0, which would read as "the team
 * averaged zero" rather than "we have not measured".
 */
export function computeMonthlyAverage(snapshots: AchievementSnapshot[], today: string): number | null {
  const monthPrefix = today.slice(0, 7);
  const inMonth = snapshots.filter((s) => s.snapshotDate.slice(0, 7) === monthPrefix && s.achievementPct !== null);
  if (inMonth.length === 0) return null;
  return inMonth.reduce((sum, s) => sum + (s.achievementPct as number), 0) / inMonth.length;
}

// ---------------------------------------------------------------------------
// Listening plan
// ---------------------------------------------------------------------------

export type ScheduleLike = { id: string; repId: string; date: string; status: "planned" | "completed" | "cancelled" };

export type ListeningPlan = {
  /** Sessions actually on the calendar for today, excluding cancelled ones. */
  plannedToday: number;
  /** Today's sessions already marked completed. */
  completedToday: number;
  /** Today's planned sessions still outstanding. */
  remainingToday: number;
  /** Planned sessions whose date has already passed and were never completed or cancelled. */
  overdue: number;
  /** Evaluations actually recorded today, which may exceed the plan (ad-hoc listening). */
  evaluationsToday: number;
  cancelledToday: number;
};

/**
 * The real listening plan, from listening_schedules.
 *
 * This replaces `const planned = 5` — a literal that ignored the schedule
 * table entirely, so the badge read "X/5" for every manager, every team, every
 * day, whether they had twelve sessions booked or none.
 *
 * Scope is the caller's: pass only the schedules and evaluations for the
 * representatives in the current workspace, so the counts describe the same
 * population as every other figure on the card.
 */
export function computeListeningPlan(
  schedules: ScheduleLike[],
  evaluationDates: string[],
  today: string,
): ListeningPlan {
  const todays = schedules.filter((s) => s.date === today);
  const plannedToday = todays.filter((s) => s.status !== "cancelled").length;
  const completedToday = todays.filter((s) => s.status === "completed").length;
  const cancelledToday = todays.filter((s) => s.status === "cancelled").length;
  const overdue = schedules.filter((s) => s.status === "planned" && s.date < today).length;
  return {
    plannedToday,
    completedToday,
    remainingToday: Math.max(0, plannedToday - completedToday),
    overdue,
    evaluationsToday: evaluationDates.filter((d) => d.slice(0, 10) === today).length,
    cancelledToday,
  };
}

// ---------------------------------------------------------------------------
// Support / focus thresholds
// ---------------------------------------------------------------------------

export type SupportInput = {
  repId: string;
  repName: string;
  /** Achievement %, or null when the rep has no official target. */
  achievementPct: number | null;
  currentResult: number;
  target: number | null;
  workdaysTotal: number;
  workdaysPassed: number;
};

/**
 * Whether a representative genuinely needs support — measured against pace,
 * not against their rank.
 *
 * The previous rule was "whoever sorts last": `buildInsights` labelled the
 * bottom-ranked representative "דורש/ת ליווי" with no floor at all, so on a
 * team where everyone beat target it named someone at 145% as needing help.
 * The morning WhatsApp generator did the same thing with `slice(-2)` and
 * broadcast those two names to the entire team.
 *
 * A representative at or above pace is never described as needing support,
 * regardless of where they rank. Someone has to be last on every list; that
 * is not a finding.
 */
export function needsSupport(input: SupportInput): boolean {
  if (input.achievementPct === null || input.target === null) return false;
  return paceStatus(input.currentResult, input.target, input.workdaysTotal, input.workdaysPassed) === "attention";
}

export function supportStatus(input: SupportInput): AchievementStatus | "no_target" {
  if (input.achievementPct === null || input.target === null) return "no_target";
  return paceStatus(input.currentResult, input.target, input.workdaysTotal, input.workdaysPassed);
}

/** Representatives who actually need support, worst pace first. Empty is a valid, common answer. */
export function repsNeedingSupport(inputs: SupportInput[]): SupportInput[] {
  return inputs
    .filter(needsSupport)
    .sort((a, b) => (a.achievementPct ?? 0) - (b.achievementPct ?? 0));
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

/**
 * Three genuinely different facts that were previously conflated into one
 * "is the data fresh" claim, now reported separately because a manager acts
 * differently on each:
 *   sourceDataDate   when the newest performance measurement is dated. This
 *                    is what the numbers on screen describe.
 *   lastImportAt     when source data last actually arrived in Pulse.
 *   lastRefreshAt    when this user last re-read the database. Says nothing
 *                    about whether the data itself is current.
 */
export type FreshnessModel = {
  sourceDataDate: string | null;
  lastImportAt: string | null;
  lastRefreshAt: string | null;
  ageInDays: number | null;
  state: "current" | "aging" | "stale" | "unknown";
};

export function computeFreshness(input: {
  sourceDataDate: string | null;
  lastImportAt: string | null;
  lastRefreshAt: string | null;
  today: string;
  staleAfterDays?: number;
}): FreshnessModel {
  const staleAfterDays = input.staleAfterDays ?? STALE_AFTER_DAYS;
  const { sourceDataDate, lastImportAt, lastRefreshAt, today } = input;
  if (!sourceDataDate) {
    return { sourceDataDate, lastImportAt, lastRefreshAt, ageInDays: null, state: "unknown" };
  }
  const ageInDays = daysBetweenIso(sourceDataDate, today);
  const state = ageInDays <= 1 ? "current" : ageInDays <= staleAfterDays ? "aging" : "stale";
  return { sourceDataDate, lastImportAt, lastRefreshAt, ageInDays, state };
}

export const FRESHNESS_STATE_LABEL: Record<FreshnessModel["state"], string> = {
  current: "עדכני",
  aging: "מתיישן",
  stale: "לא עדכני",
  unknown: "אין נתונים",
};

// ---------------------------------------------------------------------------
// Async view state
// ---------------------------------------------------------------------------

/**
 * One vocabulary for "what is this card actually showing", so loading,
 * failure and genuine emptiness stop being rendered identically.
 *
 * The dashboard previously had no loading or error handling at all: every
 * hook exposed isLoading/isError and none was read, and useCloudCollection
 * returns `rows: data ?? []`. A pending or failed targets query therefore
 * reached the same branch as "no target set" and rendered the confident claim
 * "לא הוגדר יעד חודשי לצוות זה" plus a button to go and set one — for a team
 * whose target existed and had simply not arrived yet.
 */
export type ViewState = "loading" | "error" | "empty" | "ready";

export function viewState(input: { isLoading: boolean; isError: boolean; isEmpty: boolean }): ViewState {
  if (input.isLoading) return "loading";
  if (input.isError) return "error";
  if (input.isEmpty) return "empty";
  return "ready";
}

/**
 * Whether a card may state that something is absent.
 *
 * "No target has been set" is a claim about the world; it is only sayable
 * once the query that would have proved otherwise has actually succeeded.
 * Any CTA built on an absence must be gated on this.
 */
export function canAssertAbsence(input: { isLoading: boolean; isError: boolean }): boolean {
  return !input.isLoading && !input.isError;
}

// ---------------------------------------------------------------------------
// Admin system console — structural gaps
// ---------------------------------------------------------------------------

export type StructuralGapTeam = {
  id: string;
  name: string;
  active: boolean;
  managerId: string | null;
};
export type StructuralGapRep = { teamId: string | null };

export type StructuralGap = {
  label: string;
  count: number;
  href: "/teams" | "/representatives";
};

/**
 * The wiring gaps an administrator is responsible for closing, in the order
 * they should be closed. Pure so the admin home and its tests share one rule.
 *
 * "Team with representatives but no manager" is listed FIRST because it is the
 * most consequential: every manager scope in the app (workspace options, RLS
 * helpers, target/feedback authorization) keys on teams.manager_id — a staffed
 * team with none has people producing numbers that no manager can manage.
 * Assigning the manager is an explicit admin action on the Teams page
 * (updateTeam, audited as team.manager_assigned) — never something the system
 * does silently.
 */
export function computeStructuralGaps(
  teams: StructuralGapTeam[],
  reps: StructuralGapRep[],
): StructuralGap[] {
  const activeTeams = teams.filter((t) => t.active);
  const staffedTeamIds = new Set(reps.map((r) => r.teamId).filter((id): id is string => !!id));
  const staffedWithoutManager = activeTeams.filter((t) => staffedTeamIds.has(t.id) && !t.managerId);
  const teamsWithoutReps = activeTeams.filter((t) => !staffedTeamIds.has(t.id));
  const repsWithoutTeam = reps.filter((r) => !r.teamId);
  return [
    {
      label: "צוותים מאוישים ללא מנהל צוות",
      count: staffedWithoutManager.length,
      href: "/teams" as const,
    },
    { label: "צוותים פעילים ללא נציגים", count: teamsWithoutReps.length, href: "/teams" as const },
    {
      label: "נציגים ללא צוות משויך",
      count: repsWithoutTeam.length,
      href: "/representatives" as const,
    },
  ].filter((g) => g.count > 0);
}
