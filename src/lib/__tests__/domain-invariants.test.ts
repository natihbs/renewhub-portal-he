import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CANONICAL_OUTCOME_STATES,
  WORK_ARRIVALS,
  WORK_SELECTIONS,
  WORK_DECAYS,
  OUTCOME_SHAPES,
  VALUE_MODELS,
  SYNCHRONIES,
  DISCRETION_LEVELS,
  WORK_ITEM_STATES,
  SCOPE_KINDS,
  ASSIGNMENT_CADENCES,
  COMMITMENT_SUBJECT_KINDS,
  COMMITMENT_RESOLUTIONS,
  CAPABILITY_FAMILIES,
  DERIVED_EXPIRED_UNWORKED,
  type Outcome,
} from "@/lib/domain-types";
import { CAPABILITY_KEYS } from "@/lib/capability-domain";
import {
  effectiveOutcome,
  supersessionChain,
  isExpiredUnworked,
  classifyWorkItem,
  isCanonicalOutcomeState,
  isResolvingState,
  isPositiveOutcome,
  durabilityCheckDueAt,
  isDurabilityPending,
} from "@/lib/work-domain";

const MIGRATIONS = path.resolve(import.meta.dirname, "../../../supabase/migrations");
const FOUNDATION_SQL = readFileSync(
  path.join(MIGRATIONS, "20260808090000_v2_domain_foundation.sql"),
  "utf8",
);

/** Values from a `CHECK (<column> IN ('a', 'b'))` clause in the migration. */
function checkValues(sql: string, column: string): string[] {
  const match = new RegExp(`CHECK \\(${column} IN \\(([^)]*)\\)\\)`).exec(sql);
  if (!match) throw new Error(`no CHECK ... IN constraint found for column "${column}"`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// The unions must not drift from the constraints
// ---------------------------------------------------------------------------
//
// TypeScript cannot read a Postgres CHECK constraint, so domain-types.ts
// restates every closed set by hand. That duplication is only safe if
// something notices when the two diverge — otherwise a value added in SQL and
// not in TS compiles fine and fails at the database, which is the same class
// of defect as a column nothing writes.

describe("domain unions match the database constraints", () => {
  const cases: [string, readonly string[]][] = [
    ["arrival", WORK_ARRIVALS],
    ["selection", WORK_SELECTIONS],
    ["decay", WORK_DECAYS],
    ["outcome_shape", OUTCOME_SHAPES],
    ["value_model", VALUE_MODELS],
    ["synchrony", SYNCHRONIES],
    ["discretion", DISCRETION_LEVELS],
    ["state", WORK_ITEM_STATES],
    ["kind", SCOPE_KINDS],
    ["cadence", ASSIGNMENT_CADENCES],
    ["subject_kind", COMMITMENT_SUBJECT_KINDS],
    ["resolution", COMMITMENT_RESOLUTIONS],
    ["family", CAPABILITY_FAMILIES],
  ];

  for (const [column, union] of cases) {
    it(`${column} — TypeScript union equals the SQL CHECK`, () => {
      expect([...union].sort()).toEqual(checkValues(FOUNDATION_SQL, column).sort());
    });
  }

  it("canonical_state — TypeScript union equals the SQL CHECK", () => {
    // Written across several lines in the migration, so matched separately.
    const match = /canonical_state IN \(([\s\S]*?)\)/.exec(FOUNDATION_SQL);
    expect(match).not.toBeNull();
    const sqlValues = [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...CANONICAL_OUTCOME_STATES].sort()).toEqual(sqlValues.sort());
  });

  it("never lets the derived expired state become a recordable outcome", () => {
    // The single most important invariant in the outcome model: silent loss is
    // silent because nobody types it in. If it were a disposition, it would be
    // recorded by nobody and the metric would report zero forever.
    expect(CANONICAL_OUTCOME_STATES).not.toContain(DERIVED_EXPIRED_UNWORKED as string);

    // Asserted against the CHECK clause specifically, not the whole file — the
    // migration discusses the derived state at length in its comments, and
    // that prose is the documentation of this very rule.
    const constraint = /canonical_state IN \(([\s\S]*?)\)/.exec(FOUNDATION_SQL)![1];
    expect(constraint).not.toContain("expired_unworked");
  });

  it("capability catalog matches the SQL seed exactly", () => {
    const seedBlock = FOUNDATION_SQL.split("INSERT INTO public.capabilities")[1] ?? "";
    const seeded = [...seedBlock.matchAll(/^\s*\('([a-z_.]+)',/gm)].map((m) => m[1]);
    expect(seeded.length).toBeGreaterThan(0);
    expect([...CAPABILITY_KEYS].sort()).toEqual(seeded.sort());
  });
});

// ---------------------------------------------------------------------------
// Outcome supersession
// ---------------------------------------------------------------------------

const outcome = (over: Partial<Outcome> & Pick<Outcome, "id">): Outcome => ({
  workItemId: "w1",
  actorId: null,
  actorRepresentativeId: null,
  canonicalState: "resolved_positive",
  reasonCode: null,
  valueRealized: null,
  occurredAt: "2026-08-01T09:00:00.000Z",
  supersedesId: null,
  correctionReason: null,
  ...over,
});

describe("effective outcome", () => {
  it("returns null for an item with no outcomes — an absence, not a state", () => {
    expect(effectiveOutcome([])).toBeNull();
  });

  it("returns the only record when there is one", () => {
    expect(effectiveOutcome([outcome({ id: "o1" })])?.id).toBe("o1");
  });

  it("returns the correction, not the record it corrected", () => {
    const original = outcome({ id: "o1", canonicalState: "resolved_positive" });
    const correction = outcome({
      id: "o2",
      canonicalState: "resolved_negative",
      supersedesId: "o1",
      correctionReason: "נרשם בטעות",
      occurredAt: "2026-08-02T09:00:00.000Z",
    });
    const effective = effectiveOutcome([original, correction]);
    expect(effective?.id).toBe("o2");
    expect(effective?.canonicalState).toBe("resolved_negative");
  });

  it("follows a chain of corrections to its end", () => {
    const chain = [
      outcome({ id: "o1", occurredAt: "2026-08-01T09:00:00.000Z" }),
      outcome({
        id: "o2",
        supersedesId: "o1",
        correctionReason: "x",
        occurredAt: "2026-08-02T09:00:00.000Z",
      }),
      outcome({
        id: "o3",
        supersedesId: "o2",
        correctionReason: "y",
        occurredAt: "2026-08-03T09:00:00.000Z",
      }),
    ];
    expect(effectiveOutcome(chain)?.id).toBe("o3");
  });

  it("follows the chain even when the correction is BACKDATED before the record it fixes", () => {
    // "Newest row" and "the record nothing supersedes" differ exactly here —
    // when someone is fixing a mistake and can least afford a second one.
    const original = outcome({ id: "o1", occurredAt: "2026-08-05T09:00:00.000Z" });
    const backdated = outcome({
      id: "o2",
      supersedesId: "o1",
      correctionReason: "תוקן למועד האמיתי",
      canonicalState: "unreachable",
      occurredAt: "2026-08-01T09:00:00.000Z",
    });
    expect(effectiveOutcome([original, backdated])?.id).toBe("o2");
  });

  it("takes the latest event when several independent records stand", () => {
    const pending = outcome({
      id: "o1",
      canonicalState: "pending_external",
      occurredAt: "2026-08-01T09:00:00.000Z",
    });
    const resolved = outcome({
      id: "o2",
      canonicalState: "resolved_positive",
      occurredAt: "2026-08-04T09:00:00.000Z",
    });
    expect(effectiveOutcome([pending, resolved])?.id).toBe("o2");
  });

  it("treats a supersession cycle as unrecorded rather than picking arbitrarily", () => {
    const a = outcome({ id: "o1", supersedesId: "o2", correctionReason: "x" });
    const b = outcome({ id: "o2", supersedesId: "o1", correctionReason: "y" });
    expect(effectiveOutcome([a, b])).toBeNull();
  });

  it("orders the full history oldest first without mutating the input", () => {
    const input = [
      outcome({ id: "o2", occurredAt: "2026-08-02T09:00:00.000Z" }),
      outcome({ id: "o1", occurredAt: "2026-08-01T09:00:00.000Z" }),
    ];
    expect(supersessionChain(input).map((o) => o.id)).toEqual(["o1", "o2"]);
    expect(input.map((o) => o.id)).toEqual(["o2", "o1"]);
  });
});

// ---------------------------------------------------------------------------
// Canonical state predicates
// ---------------------------------------------------------------------------

describe("canonical states", () => {
  it("recognizes only the canonical five", () => {
    expect(isCanonicalOutcomeState("resolved_positive")).toBe(true);
    expect(isCanonicalOutcomeState("expired_unworked")).toBe(false);
    expect(isCanonicalOutcomeState("renewed")).toBe(false);
    expect(isCanonicalOutcomeState(null)).toBe(false);
  });

  it("separates 'concluded' from 'concluded well'", () => {
    // The denominator question and the numerator question are different;
    // collapsing them is how a conversion figure starts measuring activity.
    expect(isResolvingState("resolved_positive")).toBe(true);
    expect(isResolvingState("resolved_negative")).toBe(true);
    expect(isResolvingState("pending_external")).toBe(false);
    expect(isResolvingState("unreachable")).toBe(false);

    expect(isPositiveOutcome("resolved_positive")).toBe(true);
    expect(isPositiveOutcome("resolved_negative")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The derived state
// ---------------------------------------------------------------------------

describe("expired unworked", () => {
  const NOW = "2026-08-10T08:00:00.000Z";

  it("fires for an open item past its due date with no outcome", () => {
    const item = { state: "open" as const, dueAt: "2026-08-09T23:59:59.000Z" };
    expect(isExpiredUnworked(item, [], NOW)).toBe(true);
  });

  it("does not fire before the due date", () => {
    const item = { state: "open" as const, dueAt: "2026-08-20T00:00:00.000Z" };
    expect(isExpiredUnworked(item, [], NOW)).toBe(false);
  });

  it("does not fire once anything has been recorded, even a pending record", () => {
    const item = { state: "open" as const, dueAt: "2026-08-09T00:00:00.000Z" };
    expect(
      isExpiredUnworked(item, [outcome({ id: "o1", canonicalState: "pending_external" })], NOW),
    ).toBe(false);
  });

  it("fires when the only record was superseded into nothing", () => {
    // A correction chain that resolves to no live record leaves the item
    // genuinely unrecorded again.
    const item = { state: "open" as const, dueAt: "2026-08-09T00:00:00.000Z" };
    const cyclical = [
      outcome({ id: "o1", supersedesId: "o2", correctionReason: "x" }),
      outcome({ id: "o2", supersedesId: "o1", correctionReason: "y" }),
    ];
    expect(isExpiredUnworked(item, cyclical, NOW)).toBe(true);
  });

  it("never fires for an item with no due date — that work type has no decay", () => {
    expect(isExpiredUnworked({ state: "open", dueAt: null }, [], NOW)).toBe(false);
  });

  it("never fires for a voided item — withdrawn is not missed", () => {
    expect(isExpiredUnworked({ state: "voided", dueAt: "2026-01-01T00:00:00.000Z" }, [], NOW)).toBe(
      false,
    );
  });

  it("never fires for a resolved item", () => {
    expect(
      isExpiredUnworked({ state: "resolved", dueAt: "2026-01-01T00:00:00.000Z" }, [], NOW),
    ).toBe(false);
  });
});

describe("work item classification", () => {
  const NOW = "2026-08-10T08:00:00.000Z";

  it("reports the effective outcome when there is one", () => {
    const item = { state: "open" as const, dueAt: "2026-08-01T00:00:00.000Z" };
    expect(
      classifyWorkItem(item, [outcome({ id: "o1", canonicalState: "unreachable" })], NOW),
    ).toBe("unreachable");
  });

  it("distinguishes an expired item from one still inside its window", () => {
    expect(classifyWorkItem({ state: "open", dueAt: "2026-08-01T00:00:00.000Z" }, [], NOW)).toBe(
      "expired_unworked",
    );
    expect(classifyWorkItem({ state: "open", dueAt: "2026-08-20T00:00:00.000Z" }, [], NOW)).toBe(
      "unworked_open",
    );
  });

  it("reports a voided item as voided regardless of its dates", () => {
    expect(classifyWorkItem({ state: "voided", dueAt: "2026-01-01T00:00:00.000Z" }, [], NOW)).toBe(
      "voided",
    );
  });
});

// ---------------------------------------------------------------------------
// Durability
// ---------------------------------------------------------------------------

describe("durability horizon", () => {
  const renewals = { durabilityHorizonDays: 30 };
  const noReversal = { durabilityHorizonDays: 0 };

  it("schedules a check the configured number of days after resolution", () => {
    const due = durabilityCheckDueAt(
      { canonicalState: "resolved_positive", occurredAt: "2026-08-01T09:00:00.000Z" },
      renewals,
    );
    expect(due).toBe("2026-08-31T09:00:00.000Z");
  });

  it("schedules a check for a negative resolution too — a reversal can go either way", () => {
    expect(
      durabilityCheckDueAt(
        { canonicalState: "resolved_negative", occurredAt: "2026-08-01T09:00:00.000Z" },
        renewals,
      ),
    ).not.toBeNull();
  });

  it("schedules nothing for a pending outcome", () => {
    expect(
      durabilityCheckDueAt(
        { canonicalState: "pending_external", occurredAt: "2026-08-01T09:00:00.000Z" },
        renewals,
      ),
    ).toBeNull();
  });

  it("schedules nothing when the work type genuinely has no reversal path", () => {
    expect(
      durabilityCheckDueAt(
        { canonicalState: "resolved_positive", occurredAt: "2026-08-01T09:00:00.000Z" },
        noReversal,
      ),
    ).toBeNull();
  });

  it("returns null rather than a bogus date for an unparseable timestamp", () => {
    expect(
      durabilityCheckDueAt(
        { canonicalState: "resolved_positive", occurredAt: "not a date" },
        renewals,
      ),
    ).toBeNull();
  });

  it("crosses a month boundary correctly", () => {
    expect(
      durabilityCheckDueAt(
        { canonicalState: "resolved_positive", occurredAt: "2026-12-20T00:00:00.000Z" },
        renewals,
      ),
    ).toBe("2027-01-19T00:00:00.000Z");
  });

  it("marks an outcome as pending its check once the horizon has passed and nothing was recorded", () => {
    const o = {
      canonicalState: "resolved_positive" as const,
      occurredAt: "2026-08-01T09:00:00.000Z",
    };
    expect(isDurabilityPending(o, renewals, false, "2026-09-05T00:00:00.000Z")).toBe(true);
    expect(isDurabilityPending(o, renewals, false, "2026-08-15T00:00:00.000Z")).toBe(false);
    expect(isDurabilityPending(o, renewals, true, "2026-09-05T00:00:00.000Z")).toBe(false);
    expect(isDurabilityPending(o, noReversal, false, "2026-09-05T00:00:00.000Z")).toBe(false);
  });
});
