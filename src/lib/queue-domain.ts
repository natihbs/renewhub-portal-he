// Pulse v2 — MVP operator queue. Pure, dependency-free, unit-tested.
//
// Three ordering terms and no model behind them. This is deliberately NOT the
// ranking engine: a weighted score with tunable coefficients is a later PR, and
// shipping one now would mean shipping something nobody can explain on the day
// an operator asks why a particular customer came up.
//
//   1. earliest due date       urgency, and the only term that reflects loss
//   2. highest business value  what is at stake among equally urgent items
//   3. fewest prior touches    so one difficult item cannot absorb a morning
//                              while untouched work expires beside it
//
// Then item id, so the order is TOTAL. Without a final tiebreak two items
// identical on all three terms can swap between calls, and an operator who
// reloads and sees a different "next" stops trusting the queue — after which
// they cherry-pick, which is the behaviour the queue exists to prevent.

import type { CanonicalOutcomeState } from "@/lib/domain-types";

export type QueueItem = {
  workItemId: string;
  externalRef: string;
  subjectRef: string | null;
  subjectLabel: string | null;
  /** ISO timestamp, or null when the work type has no decay. */
  dueAt: string | null;
  eligibleFrom: string | null;
  businessValue: number;
  touchCount: number;
  hoursToDue: number | null;
  overdue: boolean;
  position: number;
};

/**
 * The comparator, stated once so the SQL ORDER BY and any client-side
 * re-sorting cannot disagree. A test pins it against the migration text.
 *
 * Null due dates sort LAST: an item with no deadline cannot expire, so it can
 * never be the most urgent thing on the list.
 */
export function compareQueueItems(a: QueueItem, b: QueueItem): number {
  if (a.dueAt !== b.dueAt) {
    if (a.dueAt === null) return 1;
    if (b.dueAt === null) return -1;
    return a.dueAt < b.dueAt ? -1 : 1;
  }
  if (a.businessValue !== b.businessValue) return b.businessValue - a.businessValue;
  if (a.touchCount !== b.touchCount) return a.touchCount - b.touchCount;
  return a.workItemId < b.workItemId ? -1 : a.workItemId > b.workItemId ? 1 : 0;
}

export function orderQueue(items: readonly QueueItem[]): QueueItem[] {
  return [...items].sort(compareQueueItems);
}

/**
 * Why this item is next, in Hebrew, built from the terms that actually decided
 * its position.
 *
 * Required on every row. A queue that says only "next: customer 4812" is an
 * oracle; one that says "expires in 6 hours, ₪4,200, not yet contacted" is a
 * reason someone can act on and, when it is wrong, argue with.
 */
export function describeQueueReason(item: QueueItem): string {
  const parts: string[] = [];

  if (item.dueAt === null) {
    parts.push("ללא מועד יעד");
  } else if (item.overdue) {
    const hours = Math.abs(item.hoursToDue ?? 0);
    parts.push(
      hours < 48
        ? `עבר את מועד היעד לפני ${Math.round(hours)} שעות`
        : `באיחור ${Math.round(hours / 24)} ימים`,
    );
  } else {
    const hours = item.hoursToDue ?? 0;
    parts.push(
      hours < 48 ? `נותרו ${Math.round(hours)} שעות` : `נותרו ${Math.round(hours / 24)} ימים`,
    );
  }

  parts.push(`${Math.round(item.businessValue).toLocaleString("he-IL")} ₪`);

  parts.push(
    item.touchCount === 0
      ? "טרם נוצר קשר"
      : item.touchCount === 1
        ? "ניסיון אחד קודם"
        : `${item.touchCount} ניסיונות קודמים`,
  );

  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/**
 * The five states an operator may record. `expired_unworked` is absent and
 * always will be — it is derived from the ABSENCE of a record before the
 * deadline, and offering it as a choice would mean asking people to declare
 * their own silent loss, which nobody does.
 */
export const RECORDABLE_OUTCOME_STATES: readonly CanonicalOutcomeState[] = [
  "resolved_positive",
  "resolved_negative",
  "pending_internal",
  "pending_external",
  "unreachable",
];

export function isRecordableOutcomeState(value: unknown): value is CanonicalOutcomeState {
  return (
    typeof value === "string" && (RECORDABLE_OUTCOME_STATES as readonly string[]).includes(value)
  );
}

/** The two states that conclude a work item and close it. */
export function isResolvingOutcomeState(state: CanonicalOutcomeState): boolean {
  return state === "resolved_positive" || state === "resolved_negative";
}

export const OUTCOME_STATE_LABELS: Record<CanonicalOutcomeState, string> = {
  resolved_positive: "חודש",
  resolved_negative: "לא חודש",
  pending_internal: "ממתין לגורם פנימי",
  pending_external: "ממתין ללקוח",
  unreachable: "לא נוצר קשר",
};
