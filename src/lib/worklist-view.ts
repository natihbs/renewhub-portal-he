// Pulse v2 — operator surface presentation. Pure, dependency-free, tested.
//
// Everything the queue screen shows passes through here, for one reason: the
// internal domain vocabulary must never reach a representative's eyes. They
// work with customers and renewals, not with "work items", "outcomes",
// "coverage", "scopes" or "assignments" — those are how the system is built,
// not what the job is. A screen that leaks them tells the person using it that
// the software was written for somebody else.
//
// A test asserts that no visible string here contains one of those terms, so
// the rule is enforced rather than remembered.

import type { CanonicalOutcomeState } from "@/lib/domain-types";
import { formatILS, formatNum } from "@/lib/format";

/** The five dispositions, in the order the buttons appear. */
export type OutcomeChoice = {
  state: CanonicalOutcomeState;
  label: string;
  /** Whether choosing this closes the customer and moves the list on. */
  concludes: boolean;
  /** For the confirmation line after the tap. */
  confirmation: string;
};

export const OUTCOME_CHOICES: readonly OutcomeChoice[] = [
  {
    state: "resolved_positive",
    label: "טופל בהצלחה",
    concludes: true,
    confirmation: "נרשם: טופל בהצלחה",
  },
  { state: "resolved_negative", label: "לא נסגר", concludes: true, confirmation: "נרשם: לא נסגר" },
  {
    state: "pending_internal",
    label: "ממתין לגורם פנימי",
    concludes: false,
    confirmation: "נרשם: ממתין לגורם פנימי",
  },
  {
    state: "pending_external",
    label: "ממתין ללקוח",
    concludes: false,
    confirmation: "נרשם: ממתין ללקוח",
  },
  {
    state: "unreachable",
    label: "לא ניתן להשגה",
    concludes: false,
    confirmation: "נרשם: לא ניתן להשגה",
  },
];

/**
 * Context lines for the panel above the buttons.
 *
 * Only fields the API actually returns. Nothing is invented, and a field that
 * is absent produces no line at all rather than a placeholder — a dash where a
 * customer name should be reads as a system fault, and after the third one
 * nobody trusts the panel.
 */
export type ItemContext = {
  subjectLabel: string | null;
  subjectRef: string | null;
  dueAt: string | null;
  businessValue: number;
  touchCount: number;
};

export type ContextLine = { label: string; value: string };

export const NO_CONTEXT_MESSAGE = "אין מידע נוסף להצגה";

export function contextLines(item: ItemContext): ContextLine[] {
  const lines: ContextLine[] = [];

  if (item.subjectLabel?.trim()) lines.push({ label: "לקוח", value: item.subjectLabel.trim() });
  if (item.subjectRef?.trim()) lines.push({ label: "מספר לקוח", value: item.subjectRef.trim() });
  if (item.dueAt) {
    lines.push({
      label: "תאריך חידוש",
      value: new Intl.DateTimeFormat("he-IL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(new Date(item.dueAt)),
    });
  }
  if (item.businessValue > 0)
    lines.push({ label: "פרמיה שנתית", value: formatILS(item.businessValue) });
  if (item.touchCount > 0) {
    lines.push({
      label: "פניות קודמות",
      value: item.touchCount === 1 ? "פנייה אחת" : `${formatNum(item.touchCount)} פניות`,
    });
  }

  return lines;
}

/** How many customers are left, phrased as a sentence rather than a bare number. */
export function remainingSentence(remaining: number): string {
  if (remaining <= 0) return "אין לקוחות ממתינים";
  if (remaining === 1) return "נותר לקוח אחד";
  return `נותרו ${formatNum(remaining)} לקוחות`;
}

// ---------------------------------------------------------------------------
// Scoreboard
// ---------------------------------------------------------------------------

/**
 * Counts and money only. No percentage, no rank, no trend, no comparison to
 * anybody else.
 *
 * A ratio would have to be shown with its components to be honest, and at this
 * size that is four numbers where the operator needs two. Rank and trend were
 * left out on purpose: neither changes what to do next, which is the only
 * question this screen exists to answer.
 */
export type ScoreboardInput =
  | {
      available: true;
      engagedCount: number;
      eligibleCount: number;
      expiredUnworkedCount: number;
      pendingCount: number;
      expiredUnworkedValue: number;
      pendingValue: number;
    }
  | { available: false; detail: string };

export type ScoreboardStat = { label: string; value: string; tone: "neutral" | "attention" };

export function scoreboardStats(input: ScoreboardInput): ScoreboardStat[] {
  if (!input.available) return [];
  return [
    { label: "טופלו החודש", value: formatNum(input.engagedCount), tone: "neutral" },
    { label: "ממתינים לטיפול", value: formatNum(input.pendingCount), tone: "neutral" },
    {
      label: "חלף מועד החידוש",
      value: formatNum(input.expiredUnworkedCount),
      tone: input.expiredUnworkedCount > 0 ? "attention" : "neutral",
    },
    {
      label: "פרמיה שלא טופלה",
      value: formatILS(input.expiredUnworkedValue),
      tone: input.expiredUnworkedValue > 0 ? "attention" : "neutral",
    },
  ];
}

/**
 * The one sentence worth reading on the scoreboard: what is still reachable,
 * and what has already slipped.
 *
 * Says nothing when there is nothing to say. A summary line that always
 * produces text ends up producing filler, and filler is what people learn to
 * skip.
 */
export function scoreboardSummary(input: ScoreboardInput): string | null {
  if (!input.available) return null;
  if (input.pendingCount === 0 && input.expiredUnworkedCount === 0) {
    return "כל הלקוחות שמועד החידוש שלהם חלף החודש טופלו.";
  }
  if (input.expiredUnworkedCount === 0) {
    return `${formatNum(input.pendingCount)} לקוחות עדיין בתוך התקופה שבה אפשר לחדש.`;
  }
  return (
    `אצל ${formatNum(input.expiredUnworkedCount)} לקוחות חלף מועד החידוש בלי פנייה — ` +
    `${formatILS(input.expiredUnworkedValue)} בפרמיה שנתית.`
  );
}

// ---------------------------------------------------------------------------
// Error text
// ---------------------------------------------------------------------------

/**
 * A failed write says what happened and what to do, in Hebrew, and never
 * reads as success.
 *
 * The server messages are already Hebrew and specific — they name the
 * conflicting record or the missing permission — so they are passed through
 * rather than replaced with something vaguer. Only an unrecognizable failure
 * gets a generic line.
 */
export function outcomeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const trimmed = raw.trim();
  if (!trimmed) return "רישום התוצאה נכשל. הלקוח נשאר ברשימה — אפשר לנסות שוב.";
  // A message with no Hebrew in it is a stack trace or a framework error,
  // not something to put in front of a representative mid-call.
  if (!/[\u0590-\u05FF]/.test(trimmed)) {
    return "רישום התוצאה נכשל. הלקוח נשאר ברשימה — אפשר לנסות שוב.";
  }
  return `${trimmed} הלקוח נשאר ברשימה.`;
}

/**
 * Terms that must never appear in operator-visible text. Asserted by test
 * against every string this module can produce.
 */
export const FORBIDDEN_UI_TERMS: readonly string[] = [
  "workitem",
  "work item",
  "outcome",
  "coverage",
  "assignment",
  "scope",
  "ingestion",
  "batch",
  "metric_fact",
  "expired_unworked",
  "canonical",
  "representative_id",
];

export function containsForbiddenTerm(text: string): string | null {
  const lower = text.toLowerCase();
  return FORBIDDEN_UI_TERMS.find((term) => lower.includes(term)) ?? null;
}
