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
