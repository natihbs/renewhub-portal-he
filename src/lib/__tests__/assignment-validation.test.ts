import { describe, it, expect } from "vitest";
import {
  checkPeriod,
  isValidPeriod,
  periodsOverlap,
  periodCoversDate,
  findAccountableConflicts,
  hasAccountableConflict,
  findAccountabilityGaps,
  gapsIfEnded,
  validateDelegation,
  isDelegationWithinBounds,
  describeAssignmentReason,
  isIsoDate,
  type AccountableAssignmentView,
  type DelegationParent,
  type DelegationChild,
} from "@/lib/assignment-domain";

/**
 * The four assignment rules, exhaustively.
 *
 * These mirror the checks in 20260808092000_v2_assignment_validation.sql. The
 * database is authoritative; this suite is what makes the rules cheap to
 * reason about and catches a regression in the TS half before it reaches a
 * round trip. Cases that exist in both places are marked so a future change to
 * one is a prompt to check the other.
 */

const view = (
  assignmentId: string,
  personId: string,
  validFrom: string,
  validTo: string | null,
  representativeIds: string[],
  revoked = false,
): AccountableAssignmentView => ({
  assignmentId,
  personId,
  period: { validFrom, validTo },
  representativeIds,
  revoked,
});

// ---------------------------------------------------------------------------
// Rule 1 — validity period
// ---------------------------------------------------------------------------

describe("rule 1 — validity period", () => {
  it("accepts an open-ended period", () => {
    expect(checkPeriod({ validFrom: "2026-08-01", validTo: null })).toBeNull();
    expect(isValidPeriod({ validFrom: "2026-08-01", validTo: null })).toBe(true);
  });

  it("accepts a single-day period", () => {
    expect(checkPeriod({ validFrom: "2026-08-01", validTo: "2026-08-01" })).toBeNull();
  });

  it("rejects an end date before the start", () => {
    expect(checkPeriod({ validFrom: "2026-08-10", validTo: "2026-08-09" })).toBe(
      "ends_before_start",
    );
  });

  it("rejects a missing start", () => {
    expect(checkPeriod({ validFrom: "", validTo: null })).toBe("missing_from");
    expect(checkPeriod({ validFrom: null as unknown as string, validTo: null })).toBe(
      "missing_from",
    );
  });

  it("rejects malformed dates rather than coercing them", () => {
    expect(checkPeriod({ validFrom: "01/08/2026", validTo: null })).toBe("malformed_from");
    expect(checkPeriod({ validFrom: "2026-08-01", validTo: "next friday" })).toBe("malformed_to");
  });

  it("recognizes ISO dates only", () => {
    expect(isIsoDate("2026-08-01")).toBe(true);
    expect(isIsoDate("2026-8-1")).toBe(false);
    expect(isIsoDate(20260801)).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
});

describe("period arithmetic", () => {
  it("treats both endpoints as inclusive — touching periods DO overlap", () => {
    // The day one ends is the day the other begins: on that day two people
    // would both be accountable, which is the thing the rule exists to stop.
    const a = { validFrom: "2026-08-01", validTo: "2026-08-10" };
    const b = { validFrom: "2026-08-10", validTo: "2026-08-20" };
    expect(periodsOverlap(a, b)).toBe(true);
  });

  it("treats consecutive, non-touching periods as disjoint", () => {
    const a = { validFrom: "2026-08-01", validTo: "2026-08-09" };
    const b = { validFrom: "2026-08-10", validTo: "2026-08-20" };
    expect(periodsOverlap(a, b)).toBe(false);
  });

  it("treats an open-ended period as overlapping everything after its start", () => {
    const open = { validFrom: "2026-08-01", validTo: null };
    expect(periodsOverlap(open, { validFrom: "2030-01-01", validTo: null })).toBe(true);
    expect(periodsOverlap(open, { validFrom: "2026-01-01", validTo: "2026-07-31" })).toBe(false);
  });

  it("is symmetric", () => {
    const a = { validFrom: "2026-08-01", validTo: "2026-08-15" };
    const b = { validFrom: "2026-08-10", validTo: null };
    expect(periodsOverlap(a, b)).toBe(periodsOverlap(b, a));
  });

  it("covers the last day of a closed period", () => {
    const p = { validFrom: "2026-08-01", validTo: "2026-08-10" };
    expect(periodCoversDate(p, "2026-08-10")).toBe(true);
    expect(periodCoversDate(p, "2026-08-11")).toBe(false);
    expect(periodCoversDate(p, "2026-07-31")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — the accountable partition
// ---------------------------------------------------------------------------

describe("rule 2 — accountable overlap", () => {
  const existing = [view("a1", "manager-1", "2026-01-01", null, ["rep-1", "rep-2", "rep-3"])];

  it("allows a non-overlapping population", () => {
    const conflicts = findAccountableConflicts(
      { period: { validFrom: "2026-08-01", validTo: null }, representativeIds: ["rep-9"] },
      existing,
    );
    expect(conflicts).toEqual([]);
  });

  it("allows the same population in a period that does not overlap", () => {
    const past = [view("a1", "manager-1", "2026-01-01", "2026-06-30", ["rep-1"])];
    expect(
      hasAccountableConflict(
        { period: { validFrom: "2026-07-01", validTo: null }, representativeIds: ["rep-1"] },
        past,
      ),
    ).toBe(false);
  });

  it("rejects a second accountable assignment over the same representative", () => {
    const conflicts = findAccountableConflicts(
      { period: { validFrom: "2026-08-01", validTo: null }, representativeIds: ["rep-2"] },
      existing,
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      representativeId: "rep-2",
      conflictingAssignmentId: "a1",
      conflictingPersonId: "manager-1",
    });
  });

  it("detects the CROSS-SCOPE case a database exclusion constraint cannot", () => {
    // Two different scopes — a team scope and a hand-picked cover scope — that
    // happen to resolve to an overlapping set of people. This is the whole
    // reason validation cannot be left to the constraint.
    const teamScope = [view("a-team", "manager-1", "2026-01-01", null, ["rep-1", "rep-2"])];
    const coverCandidate = {
      period: { validFrom: "2026-08-01", validTo: "2026-08-14" },
      representativeIds: ["rep-2", "rep-77"],
    };
    const conflicts = findAccountableConflicts(coverCandidate, teamScope);
    expect(conflicts.map((c) => c.representativeId)).toEqual(["rep-2"]);
  });

  it("names every conflicting representative, not just the first", () => {
    const conflicts = findAccountableConflicts(
      {
        period: { validFrom: "2026-08-01", validTo: null },
        representativeIds: ["rep-1", "rep-3", "rep-9"],
      },
      existing,
    );
    expect(conflicts.map((c) => c.representativeId).sort()).toEqual(["rep-1", "rep-3"]);
  });

  it("ignores a revoked assignment", () => {
    const revoked = [view("a1", "manager-1", "2026-01-01", null, ["rep-1"], true)];
    expect(
      hasAccountableConflict(
        { period: { validFrom: "2026-08-01", validTo: null }, representativeIds: ["rep-1"] },
        revoked,
      ),
    ).toBe(false);
  });

  it("does not conflict with itself when re-validating an existing assignment", () => {
    expect(
      hasAccountableConflict(
        {
          assignmentId: "a1",
          period: { validFrom: "2026-01-01", validTo: null },
          representativeIds: ["rep-1"],
        },
        existing,
      ),
    ).toBe(false);
  });

  it("reports one conflict per (representative, assignment) pair rather than duplicating", () => {
    const twoHolders = [
      view("a1", "manager-1", "2026-01-01", null, ["rep-1"]),
      view("a2", "manager-2", "2026-01-01", null, ["rep-1"]),
    ];
    const conflicts = findAccountableConflicts(
      { period: { validFrom: "2026-08-01", validTo: null }, representativeIds: ["rep-1", "rep-1"] },
      twoHolders,
    );
    expect(conflicts).toHaveLength(2);
    expect(conflicts.map((c) => c.conflictingAssignmentId).sort()).toEqual(["a1", "a2"]);
  });

  it("permits a manager to hold two teams — that is two scopes, not a conflict", () => {
    const teamA = [view("a1", "manager-1", "2026-01-01", null, ["rep-1", "rep-2"])];
    expect(
      hasAccountableConflict(
        {
          period: { validFrom: "2026-01-01", validTo: null },
          representativeIds: ["rep-8", "rep-9"],
        },
        teamA,
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — accountability gaps
// ---------------------------------------------------------------------------

describe("rule 3 — accountability gaps", () => {
  it("finds representatives nobody is accountable for", () => {
    const assignments = [view("a1", "manager-1", "2026-01-01", null, ["rep-1"])];
    expect(findAccountabilityGaps(["rep-1", "rep-2"], assignments, "2026-08-01")).toEqual([
      "rep-2",
    ]);
  });

  it("counts an assignment that has not started yet as not covering", () => {
    const future = [view("a1", "manager-1", "2026-09-01", null, ["rep-1"])];
    expect(findAccountabilityGaps(["rep-1"], future, "2026-08-01")).toEqual(["rep-1"]);
  });

  it("counts an assignment that has already ended as not covering", () => {
    const past = [view("a1", "manager-1", "2026-01-01", "2026-07-31", ["rep-1"])];
    expect(findAccountabilityGaps(["rep-1"], past, "2026-08-01")).toEqual(["rep-1"]);
  });

  it("counts an assignment ending today as still covering today", () => {
    const ending = [view("a1", "manager-1", "2026-01-01", "2026-08-01", ["rep-1"])];
    expect(findAccountabilityGaps(["rep-1"], ending, "2026-08-01")).toEqual([]);
  });

  it("ignores revoked assignments when computing coverage", () => {
    const revoked = [view("a1", "manager-1", "2026-01-01", null, ["rep-1"], true)];
    expect(findAccountabilityGaps(["rep-1"], revoked, "2026-08-01")).toEqual(["rep-1"]);
  });

  it("reports who would be orphaned by ending an assignment", () => {
    const assignments = [view("a1", "manager-1", "2026-01-01", null, ["rep-1", "rep-2"])];
    expect(gapsIfEnded("a1", assignments, "2026-08-02").sort()).toEqual(["rep-1", "rep-2"]);
  });

  it("reports nobody orphaned when a successor already covers them", () => {
    const assignments = [
      view("a1", "manager-1", "2026-01-01", "2026-08-01", ["rep-1"]),
      view("a2", "manager-2", "2026-08-02", null, ["rep-1"]),
    ];
    expect(gapsIfEnded("a1", assignments, "2026-08-02")).toEqual([]);
  });

  it("still reports a gap when the successor starts later than the handover", () => {
    // The two-week hole between a manager leaving and their replacement
    // starting is exactly the state that silently breaks a roll-up.
    const assignments = [
      view("a1", "manager-1", "2026-01-01", "2026-08-01", ["rep-1"]),
      view("a2", "manager-2", "2026-09-01", null, ["rep-1"]),
    ];
    expect(gapsIfEnded("a1", assignments, "2026-08-02")).toEqual(["rep-1"]);
  });

  it("returns nothing for an assignment that does not exist", () => {
    expect(gapsIfEnded("missing", [], "2026-08-02")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule 4 — delegation limits
// ---------------------------------------------------------------------------

describe("rule 4 — delegation limits", () => {
  const parent: DelegationParent = {
    assignmentId: "parent-1",
    period: { validFrom: "2026-01-01", validTo: "2026-12-31" },
    representativeIds: ["rep-1", "rep-2", "rep-3"],
    capabilities: ["observe.performance", "intervene.coach", "answer.results"],
    accountable: true,
  };

  const child = (over: Partial<DelegationChild> = {}): DelegationChild => ({
    period: { validFrom: "2026-08-01", validTo: "2026-08-14" },
    representativeIds: ["rep-1"],
    capabilities: ["observe.performance"],
    accountable: false,
    ...over,
  });

  it("accepts a delegation strictly inside its grantor", () => {
    expect(validateDelegation(parent, child())).toEqual([]);
    expect(isDelegationWithinBounds(parent, child())).toBe(true);
  });

  it("accepts a delegation identical to its grantor", () => {
    expect(
      validateDelegation(
        parent,
        child({
          period: parent.period,
          representativeIds: [...parent.representativeIds],
          capabilities: [...parent.capabilities],
          accountable: true,
        }),
      ),
    ).toEqual([]);
  });

  it("rejects a delegation starting before its grantor", () => {
    const violations = validateDelegation(
      parent,
      child({ period: { validFrom: "2025-12-01", validTo: "2026-06-01" } }),
    );
    expect(violations.map((v) => v.code)).toContain("starts_before_grantor");
  });

  it("rejects a delegation outliving its grantor", () => {
    const violations = validateDelegation(
      parent,
      child({ period: { validFrom: "2026-08-01", validTo: "2027-01-01" } }),
    );
    expect(violations.map((v) => v.code)).toContain("outlives_grantor");
  });

  it("rejects an open-ended delegation from a grantor that ends", () => {
    const violations = validateDelegation(
      parent,
      child({ period: { validFrom: "2026-08-01", validTo: null } }),
    );
    expect(violations.map((v) => v.code)).toContain("outlives_grantor");
  });

  it("allows an open-ended delegation from an open-ended grantor", () => {
    const openParent: DelegationParent = {
      ...parent,
      period: { validFrom: "2026-01-01", validTo: null },
    };
    expect(
      validateDelegation(openParent, child({ period: { validFrom: "2026-08-01", validTo: null } })),
    ).toEqual([]);
  });

  it("rejects a delegation covering someone the grantor does not hold", () => {
    const violations = validateDelegation(
      parent,
      child({ representativeIds: ["rep-1", "rep-99"] }),
    );
    const scope = violations.find((v) => v.code === "scope_exceeds_grantor");
    expect(scope?.detail).toBe("rep-99");
  });

  it("rejects a delegation granting a capability the grantor lacks", () => {
    const violations = validateDelegation(
      parent,
      child({ capabilities: ["observe.performance", "define.roster"] }),
    );
    const cap = violations.find((v) => v.code === "capability_exceeds_grantor");
    expect(cap?.detail).toBe("define.roster");
  });

  it("rejects delegating accountability from a non-accountable grantor", () => {
    const functional: DelegationParent = { ...parent, accountable: false };
    const violations = validateDelegation(functional, child({ accountable: true }));
    expect(violations.map((v) => v.code)).toContain("accountable_from_non_accountable");
  });

  it("rejects delegating from a revoked grantor", () => {
    const violations = validateDelegation({ ...parent, revoked: true }, child());
    expect(violations.map((v) => v.code)).toContain("grantor_revoked");
  });

  it("returns every violation at once so one fix resolves them all", () => {
    const violations = validateDelegation(
      parent,
      child({
        period: { validFrom: "2025-01-01", validTo: "2028-01-01" },
        representativeIds: ["rep-99"],
        capabilities: ["define.work_type"],
        accountable: true,
      }),
    );
    expect(violations.map((v) => v.code).sort()).toEqual([
      "capability_exceeds_grantor",
      "outlives_grantor",
      "scope_exceeds_grantor",
      "starts_before_grantor",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Explainability
// ---------------------------------------------------------------------------

describe("assignment reason strings", () => {
  it("uses the label when there is one", () => {
    expect(
      describeAssignmentReason({
        label: "ראש צוות",
        scopeDisplayName: "צוות רכב",
        accountable: true,
        validFrom: "2026-01-01",
        validTo: null,
      }),
    ).toBe("ראש צוות על צוות רכב (מ־2026-01-01)");
  });

  it("falls back to the accountability of the assignment when unlabelled", () => {
    expect(
      describeAssignmentReason({
        label: null,
        scopeDisplayName: "צוות דירה",
        accountable: true,
        validFrom: "2026-01-01",
        validTo: "2026-08-14",
      }),
    ).toBe("אחריות ניהולית על צוות דירה (2026-01-01 עד 2026-08-14)");
  });

  it("distinguishes a functional assignment from an accountable one", () => {
    expect(
      describeAssignmentReason({
        label: "  ",
        scopeDisplayName: "איכות",
        accountable: false,
        validFrom: "2026-01-01",
        validTo: null,
      }),
    ).toBe("הרשאה תפעולית על איכות (מ־2026-01-01)");
  });
});
