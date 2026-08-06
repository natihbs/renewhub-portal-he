// Pulse v2 — assignment validation. Pure, dependency-free, unit-tested.
//
// The same four rules the database enforces in
// 20260808092000_v2_assignment_validation.sql, stated here so a caller can
// check them before a round trip and so they can be tested exhaustively
// without a database. The database remains authoritative: this module exists
// to give a fast, exact answer and a good message, not to replace the
// constraint. Where the two could ever disagree the database wins, and a test
// pins the shared cases.
//
//   1. VALIDITY PERIOD     valid_to, when present, is on or after valid_from.
//   2. ACCOUNTABLE OVERLAP at most one accountable assignment covers a
//                          representative on any given day.
//   3. ACCOUNTABILITY GAP  no representative is left with nobody answering.
//   4. DELEGATION LIMITS   a delegation exceeds its grantor in neither
//                          capability, nor scope, nor time.
//
// Dates are ISO calendar days (YYYY-MM-DD) and compared as strings, which is
// correct and total for that format and avoids pulling a date library into a
// module that every other module will import. Both endpoints are INCLUSIVE:
// an assignment with validTo = today is still in force today, which is how a
// cover arrangement handed back at end of shift behaves.

import { capabilitiesExceeding } from "@/lib/capability-domain";
import type { AssignmentPeriod } from "@/lib/domain-types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE.test(value);
}

// ---------------------------------------------------------------------------
// Rule 1 — validity period
// ---------------------------------------------------------------------------

export type PeriodProblem =
  | "missing_from"
  | "malformed_from"
  | "malformed_to"
  | "ends_before_start";

/** Null when the period is valid. Never throws — callers decide how to report. */
export function checkPeriod(period: AssignmentPeriod): PeriodProblem | null {
  if (period.validFrom === null || period.validFrom === undefined || period.validFrom === "")
    return "missing_from";
  if (!isIsoDate(period.validFrom)) return "malformed_from";
  if (period.validTo !== null && period.validTo !== undefined) {
    if (!isIsoDate(period.validTo)) return "malformed_to";
    if (period.validTo < period.validFrom) return "ends_before_start";
  }
  return null;
}

export function isValidPeriod(period: AssignmentPeriod): boolean {
  return checkPeriod(period) === null;
}

/**
 * Inclusive on both ends; a null validTo is an open upper bound. Two periods
 * that merely touch (one ends the day the other begins) DO overlap, because
 * both are in force on that shared day and two people would be accountable
 * for the same person on it.
 */
export function periodsOverlap(a: AssignmentPeriod, b: AssignmentPeriod): boolean {
  const aEndsFirst = a.validTo !== null && a.validTo < b.validFrom;
  const bEndsFirst = b.validTo !== null && b.validTo < a.validFrom;
  return !aEndsFirst && !bEndsFirst;
}

/** Whether an assignment is in force on a given day, ignoring revocation. */
export function periodCoversDate(period: AssignmentPeriod, onDate: string): boolean {
  if (onDate < period.validFrom) return false;
  if (period.validTo !== null && onDate > period.validTo) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Rules 2 and 3 — the accountable partition
// ---------------------------------------------------------------------------

/**
 * An assignment reduced to what the partition rules need: who holds it, when
 * it runs, and which representatives its scope resolves to.
 *
 * Resolution happens elsewhere — in SQL, by
 * private.scope_representative_ids — because it depends on live team
 * membership. What arrives here is already a set, which is what makes these
 * rules testable at all.
 */
export type AccountableAssignmentView = {
  assignmentId: string;
  personId: string;
  period: AssignmentPeriod;
  representativeIds: readonly string[];
  revoked?: boolean;
};

export type AccountableConflict = {
  representativeId: string;
  conflictingAssignmentId: string;
  conflictingPersonId: string;
};

/**
 * Every representative the candidate would cover who is already covered by a
 * different accountable assignment over an overlapping period.
 *
 * Returns the conflicts rather than a boolean so the caller can name them.
 * "Dana is already covered, by Yossi's assignment" is actionable; "constraint
 * violated" is not, and an administrator who cannot see what they collided
 * with will simply try again with a different date.
 */
export function findAccountableConflicts(
  candidate: {
    assignmentId?: string;
    period: AssignmentPeriod;
    representativeIds: readonly string[];
  },
  existing: readonly AccountableAssignmentView[],
): AccountableConflict[] {
  const conflicts: AccountableConflict[] = [];
  const seen = new Set<string>();

  for (const other of existing) {
    if (other.revoked) continue;
    if (candidate.assignmentId !== undefined && other.assignmentId === candidate.assignmentId)
      continue;
    if (!periodsOverlap(candidate.period, other.period)) continue;

    const otherReps = new Set(other.representativeIds);
    for (const repId of candidate.representativeIds) {
      if (!otherReps.has(repId)) continue;
      const dedupeKey = `${repId}:${other.assignmentId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      conflicts.push({
        representativeId: repId,
        conflictingAssignmentId: other.assignmentId,
        conflictingPersonId: other.personId,
      });
    }
  }
  return conflicts;
}

export function hasAccountableConflict(
  candidate: {
    assignmentId?: string;
    period: AssignmentPeriod;
    representativeIds: readonly string[];
  },
  existing: readonly AccountableAssignmentView[],
): boolean {
  return findAccountableConflicts(candidate, existing).length > 0;
}

/**
 * Representatives with nobody accountable for them on a given day.
 *
 * Reporting only. A representative created this morning has no accountable
 * assignment and that is a fact awaiting an administrator, not an error — the
 * product's job is to make the state visible, not to make it unrepresentable.
 * The one place a gap IS rejected is when an operation creates it; see
 * gapsIfEnded below.
 */
export function findAccountabilityGaps(
  representativeIds: readonly string[],
  assignments: readonly AccountableAssignmentView[],
  onDate: string,
): string[] {
  const covered = new Set<string>();
  for (const a of assignments) {
    if (a.revoked) continue;
    if (!periodCoversDate(a.period, onDate)) continue;
    for (const repId of a.representativeIds) covered.add(repId);
  }
  return representativeIds.filter((id) => !covered.has(id));
}

/**
 * Representatives who would be left uncovered if `assignmentId` stopped
 * applying from `effectiveFrom`.
 *
 * This is the one gap check that rejects rather than reports. A representative
 * who never had an accountable manager is a queue item; a representative who
 * had one until someone ended it is a broken roll-up, and the difference is
 * worth a hard stop.
 */
export function gapsIfEnded(
  assignmentId: string,
  assignments: readonly AccountableAssignmentView[],
  effectiveFrom: string,
): string[] {
  const ending = assignments.find((a) => a.assignmentId === assignmentId);
  if (!ending) return [];

  const remaining = assignments.filter((a) => a.assignmentId !== assignmentId);
  return findAccountabilityGaps(ending.representativeIds, remaining, effectiveFrom);
}

// ---------------------------------------------------------------------------
// Rule 4 — delegation limits
// ---------------------------------------------------------------------------

export type DelegationViolationCode =
  | "grantor_revoked"
  | "starts_before_grantor"
  | "outlives_grantor"
  | "scope_exceeds_grantor"
  | "capability_exceeds_grantor"
  | "accountable_from_non_accountable";

export type DelegationViolation = {
  code: DelegationViolationCode;
  /** The specific representative id or capability key that broke the rule, when there is one. */
  detail?: string;
};

export type DelegationParent = {
  assignmentId: string;
  period: AssignmentPeriod;
  representativeIds: readonly string[];
  capabilities: readonly string[];
  accountable: boolean;
  revoked?: boolean;
};

export type DelegationChild = {
  period: AssignmentPeriod;
  representativeIds: readonly string[];
  capabilities: readonly string[];
  accountable: boolean;
};

/**
 * Every way this delegation exceeds its grantor. Empty means it is within
 * bounds.
 *
 * All four dimensions are checked, and returning all violations rather than
 * the first one means an administrator fixes the delegation once instead of
 * discovering the next problem on each retry.
 */
export function validateDelegation(
  parent: DelegationParent,
  child: DelegationChild,
): DelegationViolation[] {
  const violations: DelegationViolation[] = [];

  if (parent.revoked) violations.push({ code: "grantor_revoked" });

  if (child.period.validFrom < parent.period.validFrom) {
    violations.push({ code: "starts_before_grantor" });
  }
  if (
    parent.period.validTo !== null &&
    (child.period.validTo === null || child.period.validTo > parent.period.validTo)
  ) {
    violations.push({ code: "outlives_grantor" });
  }

  const held = new Set(parent.representativeIds);
  for (const repId of child.representativeIds) {
    if (!held.has(repId)) {
      violations.push({ code: "scope_exceeds_grantor", detail: repId });
      break;
    }
  }

  const excess = capabilitiesExceeding(parent.capabilities, child.capabilities);
  if (excess.length > 0) {
    violations.push({ code: "capability_exceeds_grantor", detail: excess[0] });
  }

  if (child.accountable && !parent.accountable) {
    violations.push({ code: "accountable_from_non_accountable" });
  }

  return violations;
}

export function isDelegationWithinBounds(
  parent: DelegationParent,
  child: DelegationChild,
): boolean {
  return validateDelegation(parent, child).length === 0;
}

// ---------------------------------------------------------------------------
// Explainability
// ---------------------------------------------------------------------------

/**
 * The sentence behind "why can I see this?".
 *
 * Required on every row that an assignment put on a screen. An overlapping-set
 * permission model that cannot explain itself is an oracle, and operators
 * quite correctly work around oracles — which restores the cherry-picking the
 * whole design exists to prevent.
 */
export function describeAssignmentReason(assignment: {
  label: string | null;
  scopeDisplayName: string;
  accountable: boolean;
  validFrom: string;
  validTo: string | null;
}): string {
  const role =
    assignment.label?.trim() || (assignment.accountable ? "אחריות ניהולית" : "הרשאה תפעולית");
  const period = assignment.validTo
    ? `${assignment.validFrom} עד ${assignment.validTo}`
    : `מ־${assignment.validFrom}`;
  return `${role} על ${assignment.scopeDisplayName} (${period})`;
}
