// Pulse v2 — work item and outcome invariants. Pure, dependency-free.
//
// Deliberately narrow. Coverage, ranking and capacity are later PRs; what
// lives here is only what the domain model itself asserts about a work item
// and its outcomes, so that later features build on one definition instead of
// each inventing their own.
//
// Two of these are load-bearing beyond their size:
//
//   isExpiredUnworked   the derived sixth outcome state. It is the only way
//                       silent loss becomes visible, and it must be computed
//                       from the absence of a record — never read from one.
//   effectiveOutcome    outcomes are append-only, so "what does this item say
//                       now" is a walk over a supersession chain, not a read
//                       of the newest row. Getting this wrong makes a
//                       corrected record and its correction both count.

import type { CanonicalOutcomeState, Outcome, WorkItem, WorkType } from "@/lib/domain-types";
import { CANONICAL_OUTCOME_STATES } from "@/lib/domain-types";

// ---------------------------------------------------------------------------
// Canonical states
// ---------------------------------------------------------------------------

export function isCanonicalOutcomeState(value: unknown): value is CanonicalOutcomeState {
  return (
    typeof value === "string" && (CANONICAL_OUTCOME_STATES as readonly string[]).includes(value)
  );
}

/** The two states that close a work item. The other three leave it open. */
export function isResolvingState(state: CanonicalOutcomeState): boolean {
  return state === "resolved_positive" || state === "resolved_negative";
}

/**
 * Whether an outcome counts toward the numerator of an outcome rate.
 * Separate from isResolvingState because the denominator question ("was this
 * item concluded at all") and the numerator question ("did it conclude well")
 * are different, and collapsing them is how a conversion figure quietly starts
 * measuring activity instead.
 */
export function isPositiveOutcome(state: CanonicalOutcomeState): boolean {
  return state === "resolved_positive";
}

// ---------------------------------------------------------------------------
// Supersession
// ---------------------------------------------------------------------------

/**
 * The outcome that currently stands for a work item, from its full
 * append-only history.
 *
 * A record that has been superseded is history, not a fact about the present.
 * Because corrections form a chain (A superseded by B superseded by C), the
 * answer is "the record nothing supersedes", not "the newest record" — those
 * differ whenever a correction is backdated, which is exactly when someone is
 * fixing a mistake and can least afford a second one.
 *
 * Returns null for an item with no outcomes at all: an absence, which is a
 * different thing from an outcome saying nothing happened.
 */
export function effectiveOutcome(outcomes: readonly Outcome[]): Outcome | null {
  if (outcomes.length === 0) return null;

  const superseded = new Set<string>();
  for (const o of outcomes) {
    if (o.supersedesId) superseded.add(o.supersedesId);
  }

  const live = outcomes.filter((o) => !superseded.has(o.id));
  if (live.length === 0) return null; // a cycle; the caller should treat it as unrecorded
  if (live.length === 1) return live[0];

  // More than one live record means several independent outcome events on one
  // item (a pending record, then a resolution). The latest event stands.
  return live.reduce((newest, o) => (o.occurredAt > newest.occurredAt ? o : newest));
}

/** Full correction history for one work item, oldest first. */
export function supersessionChain(outcomes: readonly Outcome[]): Outcome[] {
  return [...outcomes].sort((a, b) =>
    a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0,
  );
}

// ---------------------------------------------------------------------------
// The derived state
// ---------------------------------------------------------------------------

/**
 * An item whose window closed with nothing recorded against it.
 *
 * This is the whole point of holding an inventory. Work that was done badly
 * leaves a record and shows up in every report; work that was never done
 * leaves nothing at all, and is visible only as a subtraction nobody performs.
 * It is derived here and can never be written by a user (PRD FR-9) — a
 * disposition someone has to type is a disposition nobody types.
 *
 * Items with no due date belong to a work type with no decay and can never
 * expire. Voided items were withdrawn, not missed.
 */
export function isExpiredUnworked(
  item: Pick<WorkItem, "state" | "dueAt">,
  outcomes: readonly Outcome[],
  now: string,
): boolean {
  if (item.state !== "open") return false;
  if (item.dueAt === null) return false;
  if (item.dueAt >= now) return false;
  return effectiveOutcome(outcomes) === null;
}

/** Item states for reporting: the canonical five, plus the one nobody records. */
export type WorkItemDisposition =
  | CanonicalOutcomeState
  | "expired_unworked"
  | "unworked_open"
  | "voided";

export function classifyWorkItem(
  item: Pick<WorkItem, "state" | "dueAt">,
  outcomes: readonly Outcome[],
  now: string,
): WorkItemDisposition {
  if (item.state === "voided") return "voided";
  const outcome = effectiveOutcome(outcomes);
  if (outcome) return outcome.canonicalState;
  if (isExpiredUnworked(item, outcomes, now)) return "expired_unworked";
  return "unworked_open";
}

// ---------------------------------------------------------------------------
// Durability
// ---------------------------------------------------------------------------

/**
 * When a resolved outcome becomes due for its post-horizon check, or null if
 * the work type has no reversal path.
 *
 * Measuring only at the moment of resolution overstates performance wherever
 * an outcome can be undone — a broken payment plan, a repeat contact, a
 * cancelled sale, a re-opened claim. A horizon of 0 says that operation
 * genuinely has none; it never means the question was skipped.
 */
export function durabilityCheckDueAt(
  outcome: Pick<Outcome, "canonicalState" | "occurredAt">,
  workType: Pick<WorkType, "durabilityHorizonDays">,
): string | null {
  if (!isResolvingState(outcome.canonicalState)) return null;
  if (workType.durabilityHorizonDays <= 0) return null;
  const at = new Date(outcome.occurredAt);
  if (Number.isNaN(at.getTime())) return null;
  at.setUTCDate(at.getUTCDate() + workType.durabilityHorizonDays);
  return at.toISOString();
}

/**
 * Whether an outcome may still be reported as final, or is awaiting its
 * durability check. Anything in the second group belongs in the provisional
 * figure, not the honest one.
 */
export function isDurabilityPending(
  outcome: Pick<Outcome, "canonicalState" | "occurredAt">,
  workType: Pick<WorkType, "durabilityHorizonDays">,
  hasCheck: boolean,
  now: string,
): boolean {
  const dueAt = durabilityCheckDueAt(outcome, workType);
  if (dueAt === null) return false;
  if (hasCheck) return false;
  return now >= dueAt;
}
