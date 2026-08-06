// Pulse v2 — coverage. Pure, dependency-free, unit-tested.
//
// Coverage is engaged / eligible, and it is the metric that makes silent loss
// visible: work done badly leaves a record and shows up everywhere, work never
// done leaves nothing at all and is visible only as a subtraction nobody
// performs.
//
// TWO RULES ARE ENCODED IN THE TYPES RATHER THAN IN CONVENTION:
//
//   1. A RATIO IS NEVER AVAILABLE WITHOUT ITS COMPONENTS. `CoverageResult` is
//      a discriminated union — you cannot read `countRatio` without having
//      gone through `available: true`, which carries the numerator and
//      denominator with it. This is not fussiness: "87%" next to "0% yesterday"
//      coexisted on one card in v1 for months because a percentage had been
//      separated from the numbers behind it.
//
//   2. MISSING INVENTORY IS UNAVAILABLE, NOT ZERO. A source that has not
//      loaded produces `available: false` with a reason, never 0%. Zero
//      coverage and unknown coverage call for opposite responses, and a
//      product that renders them identically has told the manager the calmest
//      possible lie on the worst possible morning.
//
// AGGREGATION SUMS COMPONENTS AND RECOMPUTES. Percentages never aggregate.
// Two teams at 90% and 50% are not 70% unless their books are the same size,
// and they never are.

import { canAssertCurrent, type FreshnessReport } from "@/lib/ingestion-domain";

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/**
 * The four disjoint states an eligible work item is in, by count and by value.
 *
 *   engaged          touched at or before its deadline
 *   expiredUnworked  deadline passed with nothing recorded — the silent loss
 *   pending          still inside its window, not yet touched
 *
 * engaged + expiredUnworked + pending = eligible, always. That invariant is
 * asserted rather than assumed, because a decomposition that does not add up
 * is worse than no decomposition: it invites people to trust one term.
 */
export type CoverageComponents = {
  eligibleCount: number;
  engagedCount: number;
  expiredUnworkedCount: number;
  pendingCount: number;
  eligibleValue: number;
  engagedValue: number;
  expiredUnworkedValue: number;
  pendingValue: number;
};

export const EMPTY_COMPONENTS: CoverageComponents = {
  eligibleCount: 0,
  engagedCount: 0,
  expiredUnworkedCount: 0,
  pendingCount: 0,
  eligibleValue: 0,
  engagedValue: 0,
  expiredUnworkedValue: 0,
  pendingValue: 0,
};

/** Whether the three states account for exactly the eligible total, on both measures. */
export function componentsBalance(c: CoverageComponents): boolean {
  const countOk = c.engagedCount + c.expiredUnworkedCount + c.pendingCount === c.eligibleCount;
  const valueSum = c.engagedValue + c.expiredUnworkedValue + c.pendingValue;
  // Money is numeric(14,2) in the database and floating point here; compare to
  // the cent rather than to the bit.
  const valueOk = Math.abs(valueSum - c.eligibleValue) < 0.01;
  return countOk && valueOk;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type CoverageUnavailableReason =
  | "no_inventory"
  | "stale_inventory"
  | "no_eligible_work"
  | "out_of_scope";

export type CoverageScopeRef = {
  scopeId: string | null;
  scopeKey: string | null;
  displayName: string;
};

export type CoverageResult =
  | ({
      available: true;
      scope: CoverageScopeRef;
      periodStart: string;
      periodEnd: string;
      /** engaged / eligible, by count. Only reachable alongside its components. */
      countRatio: number;
      /** engaged / eligible, weighted by business value. */
      valueRatio: number;
      /** The value that will be lost if nothing changes — the number that moves people. */
      unworkedValue: number;
      computedAt: string;
      /** Named so a caller can say where the figure came from. */
      source: "live" | "fact";
    } & CoverageComponents)
  | {
      available: false;
      scope: CoverageScopeRef;
      periodStart: string;
      periodEnd: string;
      reason: CoverageUnavailableReason;
      /** Hebrew, and specific about WHY rather than "no data". */
      detail: string;
    };

const UNAVAILABLE_DETAIL: Record<CoverageUnavailableReason, string> = {
  no_inventory: "לא נקלט מלאי עבודה עבור סוג עבודה זה — לא ניתן לחשב כיסוי",
  stale_inventory: "המלאי אינו עדכני — הנתונים מוצגים כלא זמינים ולא כאפס",
  no_eligible_work: "אין פריטים בתחום ובתקופה שנבחרו",
  out_of_scope: "אין לך הרשאה לצפות בכיסוי עבור תחום זה",
};

export function unavailable(
  scope: CoverageScopeRef,
  periodStart: string,
  periodEnd: string,
  reason: CoverageUnavailableReason,
): CoverageResult {
  return {
    available: false,
    scope,
    periodStart,
    periodEnd,
    reason,
    detail: UNAVAILABLE_DETAIL[reason],
  };
}

/**
 * Builds an available result from components.
 *
 * A zero denominator yields `no_eligible_work`, not 0%. "Nothing was due" and
 * "nothing was worked" are opposite facts and 0/0 is not a performance figure.
 */
export function fromComponents(
  scope: CoverageScopeRef,
  periodStart: string,
  periodEnd: string,
  components: CoverageComponents,
  options: { computedAt: string; source: "live" | "fact" },
): CoverageResult {
  if (components.eligibleCount === 0) {
    return unavailable(scope, periodStart, periodEnd, "no_eligible_work");
  }
  return {
    available: true,
    scope,
    periodStart,
    periodEnd,
    ...components,
    countRatio: components.engagedCount / components.eligibleCount,
    valueRatio:
      components.eligibleValue === 0 ? 0 : components.engagedValue / components.eligibleValue,
    unworkedValue: components.expiredUnworkedValue,
    computedAt: options.computedAt,
    source: options.source,
  };
}

// ---------------------------------------------------------------------------
// Freshness gate
// ---------------------------------------------------------------------------

/**
 * The one check every coverage read must pass before it reports a number.
 *
 * Returns the reason to report as unavailable, or null to proceed. Beyond the
 * critical threshold the figures may still be computable — the rows are all
 * still there — and reporting them anyway is exactly the failure mode: a
 * confident number derived from a book that stopped arriving on Tuesday.
 */
export function freshnessBlock(report: FreshnessReport | null): CoverageUnavailableReason | null {
  if (report === null) return "no_inventory";
  if (report.state === "never") return "no_inventory";
  if (!canAssertCurrent(report)) return "stale_inventory";
  return null;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Sum the components, then recompute the ratio. Never average ratios.
 *
 * Simpson's paradox is not a curiosity here, it is the daily case: a team of 8
 * at 95% and a team of 400 at 40% average to 67.5% and roll up to 41%. The
 * first number is comforting and wrong, and it is the one every dashboard that
 * averages percentages reports.
 */
export function sumComponents(parts: readonly CoverageComponents[]): CoverageComponents {
  return parts.reduce<CoverageComponents>(
    (acc, p) => ({
      eligibleCount: acc.eligibleCount + p.eligibleCount,
      engagedCount: acc.engagedCount + p.engagedCount,
      expiredUnworkedCount: acc.expiredUnworkedCount + p.expiredUnworkedCount,
      pendingCount: acc.pendingCount + p.pendingCount,
      eligibleValue: acc.eligibleValue + p.eligibleValue,
      engagedValue: acc.engagedValue + p.engagedValue,
      expiredUnworkedValue: acc.expiredUnworkedValue + p.expiredUnworkedValue,
      pendingValue: acc.pendingValue + p.pendingValue,
    }),
    { ...EMPTY_COMPONENTS },
  );
}

/**
 * Roll several scopes or several days into one result.
 *
 * Only `available` parts contribute. An unavailable part is NOT treated as
 * zero — it is excluded and reported, because folding "we do not know" into a
 * total as though it were "nothing was due" understates the denominator and
 * inflates the ratio, which is the flattering direction.
 */
export type AggregateResult = {
  result: CoverageResult;
  /** How many parts contributed, and how many were skipped and why. */
  contributed: number;
  skipped: { reason: CoverageUnavailableReason; count: number }[];
};

export function aggregateCoverage(
  parts: readonly CoverageResult[],
  scope: CoverageScopeRef,
  periodStart: string,
  periodEnd: string,
  computedAt: string,
): AggregateResult {
  const available = parts.filter(
    (p): p is Extract<CoverageResult, { available: true }> => p.available,
  );
  const skippedBy = new Map<CoverageUnavailableReason, number>();
  for (const p of parts) {
    if (!p.available) skippedBy.set(p.reason, (skippedBy.get(p.reason) ?? 0) + 1);
  }
  const skipped = [...skippedBy.entries()].map(([reason, count]) => ({ reason, count }));

  if (available.length === 0) {
    // Prefer the most serious reason present, so an aggregate that is empty
    // because a feed died does not report itself as "nothing was due".
    const reason: CoverageUnavailableReason =
      skippedBy.get("no_inventory") !== undefined
        ? "no_inventory"
        : skippedBy.get("stale_inventory") !== undefined
          ? "stale_inventory"
          : "no_eligible_work";
    return { result: unavailable(scope, periodStart, periodEnd, reason), contributed: 0, skipped };
  }

  const summed = sumComponents(available);
  return {
    result: fromComponents(scope, periodStart, periodEnd, summed, { computedAt, source: "fact" }),
    contributed: available.length,
    skipped,
  };
}

// ---------------------------------------------------------------------------
// Pinned lineage
// ---------------------------------------------------------------------------

/**
 * What a scope resolved to at the moment a fact was computed.
 *
 * Stored on every fact because a scope is a live query — move a
 * representative between teams and yesterday's team scope resolves to a
 * different set of people today. Without the pin, last month's coverage
 * silently changes whenever the org chart does, and a figure that moves after
 * the fact cannot be reconciled against anything.
 */
export type ScopeLineage = {
  scopeId: string;
  scopeKey: string | null;
  scopeKind: string;
  displayName: string;
  representativeIds: string[];
  teamIds: string[];
  resolvedCount: number;
  pinnedAt: string;
};

/** Whether a stored lineage still matches what the scope resolves to now. */
export function lineageMatchesCurrent(
  pinned: ScopeLineage,
  currentRepresentativeIds: readonly string[],
): boolean {
  if (pinned.representativeIds.length !== currentRepresentativeIds.length) return false;
  const now = new Set(currentRepresentativeIds);
  return pinned.representativeIds.every((id) => now.has(id));
}

/**
 * A short Hebrew sentence naming the figure, its components and its source.
 * The product must never show the ratio alone, so the sentence never does.
 */
export function describeCoverage(result: CoverageResult): string {
  if (!result.available) return `${result.scope.displayName}: ${result.detail}`;
  const pct = (result.countRatio * 100).toFixed(1);
  return (
    `${result.scope.displayName}: ${result.engagedCount} מתוך ${result.eligibleCount} (${pct}%) · ` +
    `לא טופלו ${result.expiredUnworkedCount} בשווי ${Math.round(result.unworkedValue).toLocaleString("he-IL")} ₪`
  );
}
