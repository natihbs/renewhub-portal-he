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
  success: "text-success-foreground",
  warning: "text-warning-foreground",
  danger: "text-primary",
};

export const ACHIEVEMENT_BADGE_CLASS: Record<Tone, string> = {
  success: "bg-[color:var(--success)]/12 text-success-foreground border border-[color:var(--success)]/25",
  warning: "bg-[color:var(--warning)]/15 text-warning-foreground border border-[color:var(--warning)]/30",
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

/**
 * Whether the measured period still has working days left to act in.
 * "no_time_remaining" is a genuinely different operational situation from
 * "behind pace": there is no daily rate that can close the gap, so the UI must
 * stop offering one.
 */
export type PacePeriodState = "active" | "no_time_remaining";

export type PaceInfo = {
  expected: number;
  forecast: number;
  /**
   * Units per remaining working day needed to still hit target, or null when
   * the period has no working days left — never a number computed against a
   * synthetic minimum of one day. Callers must render null as an honest
   * end-of-period message, not as "0/day".
   */
  perDay: number | null;
  paceDelta: number;
  remaining: number;
  periodState: PacePeriodState;
};

/** Honest label for a period that has no working days left to act in. */
export const NO_TIME_REMAINING_LABEL = "לא נותרו ימי עבודה בתקופה זו";

/**
 * Pace math shared by Performance and RepWorkspace (previously two separate,
 * near-identical inline implementations): expected progress so far, projected
 * end-of-month forecast, and the daily pace needed to still hit target.
 *
 * §P3 correction: perDay used to be computed as
 *     Math.ceil((target - actual) / Math.max(1, workdaysRemaining))
 * so on the last working day of the month — when workdaysRemaining is already
 * 0 — it divided by a synthetic 1 and confidently displayed something like
 * "142/יום כדי לעמוד ביעד" on a day when that is arithmetically impossible.
 * The floor is gone: with no working days left, perDay is null and
 * periodState is "no_time_remaining", and the UI says so instead of inventing
 * an actionable rate.
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
  const periodState: PacePeriodState = workdaysRemaining > 0 ? "active" : "no_time_remaining";
  const perDay = periodState === "active"
    ? Math.max(0, Math.ceil((target - actual) / workdaysRemaining))
    : null;
  const paceDelta = actual - expected;
  return { expected, forecast, perDay, paceDelta, remaining: workdaysRemaining, periodState };
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

export const KPI_PROFILE_LABEL: Record<KpiProfile, string> = {
  generic_sales: "מכירות כלליות",
  renewals: "חידושים",
};

export const KPI_PROFILE_BADGE_CLASS: Record<KpiProfile, string> = {
  generic_sales: "bg-accent text-foreground",
  renewals: "bg-primary/10 text-primary",
};

// ------------------------------------------------- cross-profile aggregation

/**
 * Which KPI profiles a visible population actually spans, renewals first.
 *
 * A renewals target is an assigned monthly book (מיועדות חודשיות) and its
 * result is closed renewals; a generic target is a sales figure. Summing the
 * two produces a number in no unit, and averaging their percentages averages
 * אחוז חידוש with אחוז עמידה. Any screen that would render ONE combined total
 * or ONE combined percentage over a population has to ask this first — and,
 * when `mixed` is true, state the split instead of inventing the total.
 *
 * A single-profile population is unaffected: `mixed` is false and the
 * combined figure stays exactly as truthful as it always was.
 */
export type KpiProfileMix = { profiles: KpiProfile[]; mixed: boolean };

export function kpiProfileMix(profiles: (KpiProfile | null | undefined)[]): KpiProfileMix {
  const order: KpiProfile[] = ["renewals", "generic_sales"];
  const present = order.filter((p) => profiles.some((x) => x === p));
  return { profiles: present, mixed: present.length > 1 };
}

/**
 * What a combined aggregate says when the population spans more than one KPI
 * profile — the honest statement that replaces the fabricated total.
 */
export const MIXED_PROFILE_AGGREGATE_LABEL = "לא זמין";
export const MIXED_PROFILE_AGGREGATE_NOTICE =
  "פרופילים מעורבים — חידושים ומכירות נמדדים ביחידות שונות ואינם מסוכמים לנתון אחד. הפירוט לפי צוות בטבלה שלמטה.";

// ---------------------------------------------------------------------------
// Manual performance entry — "עדכון ביצועים ידני"
//
// The manager fallback for when imported (Qlik) data is stale, delayed or
// wrong. This is a performance NUMBER correction only: it never touches
// targets (those live on /targets), and it is not call capture, customer
// handling or a work queue of any kind.
// ---------------------------------------------------------------------------

/** Why the manager is overriding the imported figure. Audited verbatim. */
export const MANUAL_UPDATE_REASONS: { value: string; label: string }[] = [
  { value: "import_stale", label: "ייבוא / Qlik לא התעדכן" },
  { value: "data_correction", label: "תיקון נתון שגוי" },
  { value: "temporary_control", label: "עדכון זמני לבקרה" },
  { value: "other", label: "אחר" },
];

export const MANUAL_UPDATE_SUCCESS_MESSAGE = "הביצוע עודכן ידנית";

/** Shown near the performance table so the fallback is discoverable exactly when it is needed. */
export const STALE_DATA_HINT =
  "הנתונים מבוססים על הייבוא האחרון. אם הנתונים לא התעדכנו, ניתן להשתמש בעדכון ביצועים ידני.";
