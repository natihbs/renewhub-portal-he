// Feedback/listening domain: real application configuration, not demo data.
// Kept separate from seed.ts (which holds demo-mode fixtures) so this never
// gets mistaken for — or drifts alongside — throwaway sample data.

export type CriterionValue = "done" | "partial" | "not_done" | "na";

// Must stay a superset of every criteriaKeys entry in feedback.tsx's SECTIONS —
// a key present in the form but missing here is silently excluded from the
// score (it's captured in the criteria jsonb but never counted).
export const CRITERIA: { key: string; label: string }[] = [
  { key: "opening", label: "פתיחת שיחה ברורה ומקצועית" },
  { key: "needs", label: "אימות צורכי הלקוח" },
  { key: "benefits", label: "הצגת יתרונות המוצר" },
  { key: "value", label: "יצירת ערך" },
  { key: "objections", label: "טיפול בהתנגדויות" },
  { key: "upsell", label: "הצעת שדרוג" },
  { key: "summary", label: "סיכום השיחה" },
  { key: "regulation", label: "עמידה ברגולציה" },
  { key: "service", label: "שירותיות" },
  { key: "closing", label: "הנעה לסגירה" },
  { key: "knowledge", label: "ידע מקצועי" },
  { key: "impression", label: "התרשמות מנהל" },
];

export type Feedback = {
  id: string;
  repId: string;
  date: string;
  callId: string;
  callType: string;
  listener: string;
  criteria: Record<string, CriterionValue>;
  score: number;
  keep: string;
  improve: string;
  managerSummary: string;
  nextTask: string;
  published: boolean;
  scheduleId: string | null;
  /**
   * Optimistic-concurrency token. Sent back with an edit so the server can
   * reject a write built from a stale read (the cloud collection has a 15s
   * staleTime, which is exactly long enough for two team leads to clobber
   * each other). Empty string in Demo Mode, where there is no shared record.
   */
  updatedAt: string;
  /** When the rep could first see this. null while it is a draft. */
  publishedAt: string | null;
};

// Single source of truth for score -> tone. Previously duplicated as inline ternaries
// in three places (feedback.tsx's RecentSessions and HistoryTable, and RepWorkspace's
// listening history table) — one of which used different thresholds (85/70) and a
// different middle color than the other two (80/60), so the same score could read as
// a different tone depending on which screen you were looking at it from.
export type ScoreTone = "success" | "warning" | "danger";

export function scoreTone(score: number): ScoreTone {
  if (score >= 80) return "success";
  if (score >= 60) return "warning";
  return "danger";
}

/** Plain text-color utility class per tone. */
export const SCORE_TEXT_CLASS: Record<ScoreTone, string> = {
  success: "text-success-foreground",
  warning: "text-warning-foreground",
  danger: "text-primary",
};

/** Background+text badge-style utility classes per tone. */
export const SCORE_BADGE_CLASS: Record<ScoreTone, string> = {
  success: "bg-[color:var(--success)]/15 text-success-foreground",
  warning: "bg-[color:var(--warning)]/15 text-warning-foreground",
  danger: "bg-primary/15 text-primary",
};

/**
 * Canonical quality-score formula: the mean of the scored criteria, where
 * done = 1, partial = 0.5, not_done = 0, and "na" is excluded entirely.
 *
 * §P1 hardening: this moved here from store.tsx so the SERVER can use it too.
 * The score used to be computed only in the browser and forwarded verbatim by
 * the generic cloud writer, which meant the authoritative quality figure for a
 * representative — the number driving the heat map, the coaching queue, and
 * Performance's risk model — was whatever the client asserted, and could
 * disagree with the criteria stored alongside it. createFeedback/updateFeedback
 * now recompute it from the submitted criteria and ignore any score the client
 * sends. Keeping ONE implementation is the point: a second copy in SQL or in a
 * server file would be a business rule that could drift.
 *
 * Only keys present in CRITERIA are counted — a key captured in the criteria
 * jsonb but absent from CRITERIA is deliberately not scored.
 */
export function computeFeedbackScore(criteria: Record<string, CriterionValue>): number {
  const values = CRITERIA.map((c) => criteria[c.key]).filter(Boolean);
  const relevant = values.filter((v) => v !== "na");
  if (relevant.length === 0) return 0;
  const sum = relevant.reduce((acc, v) => acc + (v === "done" ? 1 : v === "partial" ? 0.5 : 0), 0);
  return Math.round((sum / relevant.length) * 100);
}

/** Today as YYYY-MM-DD, for the "no future evaluations" rule. */
export function todayIsoDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * An evaluation records a call that already happened, so a future date is
 * always wrong. It also silently corrupted the coaching queue: daysSince()
 * went negative, which LOWERED that representative's priority — the opposite
 * of correct. Pure and exported so the rule is unit-tested and identical on
 * both sides; the server is the enforcement point, the client only for UX.
 */
export function isFutureFeedbackDate(date: string, now = new Date()): boolean {
  return !!date && date > todayIsoDate(now);
}

/**
 * Whole days between an ISO date and now, never negative.
 *
 * The clamp matters: feedback rows created before the future-date rule existed
 * can still carry a future date, and a negative "days since last listening"
 * flowed straight into the coaching queue's priority score — making the
 * representative look MORE recently heard than someone heard today.
 */
export function daysSinceIsoDate(date: string, now = new Date()): number {
  const t = new Date(date).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / 86400000));
}

/** "Never listened to" contributes exactly this much, and nothing else. */
export const QUEUE_NO_HISTORY_PRIORITY = 40;

export type QueuePriorityInput = {
  /** Days since the last evaluation, or null when there has never been one. */
  daysSinceLast: number | null;
  /** Mean quality score, or null when there is nothing to average. */
  avgScore: number | null;
  /** Target achievement percentage, or null when no personal target is set. */
  achievementPct: number | null;
};

/**
 * Coaching-queue urgency.
 *
 * §P2 fix — the previous version double-counted a representative who had never
 * been listened to. It substituted a synthetic `days = 30` for "no history",
 * added `Math.min(days, 30)` = 30 for it, and then added another 25 for
 * `if (!last)`. That single fact was worth 55 of a ~75-point scale, which
 * pushed every never-heard representative above genuinely at-risk ones with
 * real, poor scores. "Never heard" is now exactly one contribution.
 *
 * Pure and exported so the ranking rule is unit-tested rather than asserted by
 * reading a table.
 */
export function computeQueuePriority({ daysSinceLast, avgScore, achievementPct }: QueuePriorityInput): number {
  let priority = 0;
  if (daysSinceLast === null) {
    priority += QUEUE_NO_HISTORY_PRIORITY;
  } else {
    priority += Math.min(Math.max(daysSinceLast, 0), 30);
    // Quality only counts when there IS quality data. Previously written as
    // `if (avg && avg < 60)`, which silently treated a genuine average of 0 —
    // the worst possible score — as "no data" and skipped the penalty.
    if (avgScore !== null) {
      if (avgScore < 60) priority += 30;
      else if (avgScore < 75) priority += 15;
    }
  }
  if (achievementPct !== null && achievementPct < 80) priority += 20;
  return priority;
}

export type QueuePriorityLevel = "high" | "medium" | "low";

export function queuePriorityLevel(priority: number): QueuePriorityLevel {
  if (priority >= 45) return "high";
  if (priority >= 25) return "medium";
  return "low";
}
