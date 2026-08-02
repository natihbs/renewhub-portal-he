// Canonical target-achievement domain: single source of truth for what "achievement"
// means (actual / target) and how it is displayed. Previously this ratio was
// recomputed independently in ~9 places (store.tsx, performance.tsx, RepWorkspace.tsx,
// MorningRoutine.tsx, communications.tsx, dashboard index.tsx) and, in several of them,
// mislabeled as "renewal percentage" (אחוז חידוש) even though nothing about the
// calculation is renewal-specific — it is plain target achievement for whatever a
// team's monthly_target/current_result represent. A real, separately-defined renewal
// rate (completed renewals / renewal opportunities) lives in ./renewal-rate.ts.

export type Tone = "success" | "warning" | "danger";

/** actual / target as a percentage. A zero or missing target is always 0, never a divide-by-zero. */
export function calculateAchievement(actual: number, target: number): number {
  return target > 0 ? (actual / target) * 100 : 0;
}

/** actual - target. Positive = above target, negative = short of target. */
export function calculateGap(actual: number, target: number): number {
  return actual - target;
}

export type AchievementStatus = "above" | "onpace" | "attention";

/** Canonical Hebrew terminology for the flat (non-pace-adjusted) achievement status. */
export const ACHIEVEMENT_STATUS_LABEL: Record<AchievementStatus, string> = {
  above: "מעל היעד",
  onpace: "בקצב הנדרש",
  attention: "דורש שיפור",
};

export const ACHIEVEMENT_STATUS_TONE: Record<AchievementStatus, Tone> = {
  above: "success",
  onpace: "warning",
  attention: "danger",
};

export const ACHIEVEMENT_TEXT_CLASS: Record<Tone, string> = {
  success: "text-[color:var(--success)]",
  warning: "text-[color:oklch(0.45_0.14_75)]",
  danger: "text-primary",
};

export const ACHIEVEMENT_BADGE_CLASS: Record<Tone, string> = {
  success: "bg-[color:var(--success)]/12 text-[color:var(--success)] border border-[color:var(--success)]/25",
  warning: "bg-[color:var(--warning)]/15 text-[color:oklch(0.45_0.14_75)] border border-[color:var(--warning)]/30",
  danger: "bg-primary/10 text-primary border border-primary/25",
};

/** Flat threshold: >=100% above, >=80% onpace, else attention. Safe on a zero/missing target (pct is 0 -> attention). */
export function achievementStatus(pct: number): AchievementStatus {
  if (pct >= 100) return "above";
  if (pct >= 80) return "onpace";
  return "attention";
}

/**
 * Pace-aware status label set, used where the UI compares a rep against the
 * expected pace so far this month rather than only the end-of-month flat percentage.
 */
export const PACE_STATUS_LABEL: Record<AchievementStatus, string> = {
  above: "מעל היעד",
  onpace: "בקצב",
  attention: "דורש טיפול",
};

/**
 * Pace-aware status: above target, on the expected pace for how far the month has
 * progressed (within 5% either side), or behind. This was duplicated verbatim as
 * `statusOf` in both performance.tsx and RepWorkspace.tsx — unified here.
 */
export function paceStatus(actual: number, target: number, workdaysTotal: number, workdaysPassed: number): AchievementStatus {
  const passed = Math.max(1, workdaysPassed);
  const expected = workdaysTotal > 0 ? (target / workdaysTotal) * passed : 0;
  const paceDelta = actual - expected;
  const pct = calculateAchievement(actual, target);
  if (pct >= 100 || paceDelta >= target * 0.05) return "above";
  if (paceDelta >= -target * 0.05) return "onpace";
  return "attention";
}

export type PaceInfo = {
  expected: number;
  forecast: number;
  perDay: number;
  paceDelta: number;
  remaining: number;
};

/**
 * Pace math shared by Performance and RepWorkspace (previously two separate,
 * near-identical inline implementations): expected progress so far, projected
 * end-of-month forecast, and the daily pace needed to still hit target.
 */
export function paceInfo(
  target: number,
  actual: number,
  workdaysTotal: number,
  workdaysPassed: number,
  workdaysRemaining: number,
): PaceInfo {
  const passed = Math.max(1, workdaysPassed);
  const expected = workdaysTotal > 0 ? (target / workdaysTotal) * passed : 0;
  const forecast = Math.round((actual / passed) * workdaysTotal);
  const perDay = Math.max(0, Math.ceil((target - actual) / Math.max(1, workdaysRemaining)));
  const paceDelta = actual - expected;
  return { expected, forecast, perDay, paceDelta, remaining: workdaysRemaining };
}

export type RiskLevel = "low" | "medium" | "high";

/**
 * Coaching-priority risk level, derived only from real target/result pace and real
 * feedback records — never from anything id-based or fabricated. Was duplicated
 * (with a slightly different reason wording) as `computeRisk` in performance.tsx and
 * `riskOf` in RepWorkspace.tsx.
 */
export function computeRisk(
  pct: number,
  avgScore: number | null,
  daysSinceLastFeedback: number | null,
): { level: RiskLevel; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  if (pct < 80) {
    score += 2;
    reasons.push("ביצוע מתחת ל-80% מהיעד");
  } else if (pct < 95) {
    score += 1;
    reasons.push("ביצוע מתחת לצפוי");
  }
  if (avgScore !== null && avgScore < 60) {
    score += 2;
    reasons.push("ציון איכות ממוצע נמוך בהאזנות");
  }
  if (daysSinceLastFeedback === null) {
    score += 1;
    reasons.push("אין עדיין משוב מתועד");
  } else if (daysSinceLastFeedback > 30) {
    score += 1;
    reasons.push("אין משוב עדכני (מעל 30 יום)");
  }
  const level: RiskLevel = score >= 4 ? "high" : score >= 2 ? "medium" : "low";
  return { level, reasons };
}

// ---------- KPI profile foundation ----------
// A minimal, explicit, additive per-team switch (teams.kpi_profile) so the app can
// know whether a team's activity supports a *real* renewal rate (see ./renewal-rate.ts)
// without ever inferring it from a team's name/id. Every existing team defaults to
// "generic_sales" (plain target achievement only) unless a deliberate migration
// decision marks it "renewals". See supabase/migrations for the schema change.

export type KpiProfile = "generic_sales" | "renewals";
export const DEFAULT_KPI_PROFILE: KpiProfile = "generic_sales";
