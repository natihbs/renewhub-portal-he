import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  EMPTY_COMPONENTS,
  componentsBalance,
  fromComponents,
  unavailable,
  freshnessBlock,
  sumComponents,
  aggregateCoverage,
  lineageMatchesCurrent,
  describeCoverage,
  type CoverageComponents,
  type CoverageResult,
  type CoverageScopeRef,
  type ScopeLineage,
} from "@/lib/coverage-domain";
import { classifyFreshness, type FreshnessInput } from "@/lib/ingestion-domain";

const SCOPE: CoverageScopeRef = { scopeId: "s1", scopeKey: "team:1", displayName: "צוות רכב" };
const FROM = "2026-08-01";
const TO = "2026-08-31";
const AT = "2026-08-09T08:00:00.000Z";

const comps = (over: Partial<CoverageComponents> = {}): CoverageComponents => ({
  ...EMPTY_COMPONENTS,
  eligibleCount: 100,
  engagedCount: 80,
  expiredUnworkedCount: 15,
  pendingCount: 5,
  eligibleValue: 100_000,
  engagedValue: 70_000,
  expiredUnworkedValue: 25_000,
  pendingValue: 5_000,
  ...over,
});

// ---------------------------------------------------------------------------
// engaged / eligible, by count and by value
// ---------------------------------------------------------------------------

describe("coverage by count and by value", () => {
  it("computes both ratios from the same components", () => {
    const r = fromComponents(SCOPE, FROM, TO, comps(), { computedAt: AT, source: "live" });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.countRatio).toBeCloseTo(0.8);
    expect(r.valueRatio).toBeCloseTo(0.7);
  });

  it("always carries the numerator and denominator alongside the ratio", () => {
    // The type makes this structural — countRatio is only reachable through
    // available: true, which carries the components. The assertion pins the
    // behaviour anyway, because the whole point is that a percentage can never
    // travel alone.
    const r = fromComponents(SCOPE, FROM, TO, comps(), { computedAt: AT, source: "live" });
    if (!r.available) throw new Error("expected available");
    expect(r.engagedCount).toBe(80);
    expect(r.eligibleCount).toBe(100);
    expect(r.engagedValue).toBe(70_000);
    expect(r.eligibleValue).toBe(100_000);
  });

  it("diverges between count and value when the book is skewed", () => {
    // The reason value-weighting exists: touching many cheap items and missing
    // a few expensive ones looks fine by count and is not fine.
    const skewed = comps({
      engagedCount: 95,
      expiredUnworkedCount: 5,
      pendingCount: 0,
      engagedValue: 40_000,
      expiredUnworkedValue: 60_000,
      pendingValue: 0,
    });
    const r = fromComponents(SCOPE, FROM, TO, skewed, { computedAt: AT, source: "live" });
    if (!r.available) throw new Error("expected available");
    expect(r.countRatio).toBeCloseTo(0.95);
    expect(r.valueRatio).toBeCloseTo(0.4);
    expect(r.unworkedValue).toBe(60_000);
  });

  it("reports a zero denominator as unavailable, never as 0%", () => {
    // "Nothing was due" and "nothing was worked" are opposite facts, and 0/0 is
    // not a performance figure.
    const r = fromComponents(SCOPE, FROM, TO, EMPTY_COMPONENTS, { computedAt: AT, source: "live" });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.reason).toBe("no_eligible_work");
  });

  it("reports a zero numerator as 0%, which IS a performance figure", () => {
    const none = comps({
      engagedCount: 0,
      expiredUnworkedCount: 100,
      pendingCount: 0,
      engagedValue: 0,
      expiredUnworkedValue: 100_000,
      pendingValue: 0,
    });
    const r = fromComponents(SCOPE, FROM, TO, none, { computedAt: AT, source: "live" });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.countRatio).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// the decomposition adds up
// ---------------------------------------------------------------------------

describe("component balance", () => {
  it("holds for a well-formed decomposition", () => {
    expect(componentsBalance(comps())).toBe(true);
    expect(componentsBalance(EMPTY_COMPONENTS)).toBe(true);
  });

  it("fails when the counts do not account for the eligible total", () => {
    expect(componentsBalance(comps({ pendingCount: 4 }))).toBe(false);
  });

  it("fails when the values do not account for the eligible total", () => {
    expect(componentsBalance(comps({ pendingValue: 4_000 }))).toBe(false);
  });

  it("tolerates rounding to the cent but not beyond", () => {
    expect(componentsBalance(comps({ pendingValue: 5_000.005 }))).toBe(true);
    expect(componentsBalance(comps({ pendingValue: 5_000.5 }))).toBe(false);
  });

  it("matches the CHECK constraints in the migration", () => {
    const sql = readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../supabase/migrations/20260810090000_v2_coverage_engine.sql",
      ),
      "utf8",
    );
    expect(sql).toContain(
      "CHECK (engaged_count + expired_unworked_count + pending_count = eligible_count)",
    );
    expect(sql).toContain(
      "abs((engaged_value + expired_unworked_value + pending_value) - eligible_value) < 0.01",
    );
    // And there is no stored ratio column for an aggregate to average.
    expect(sql).not.toMatch(/\bcoverage_pct\b|\bratio\s+numeric/);
  });
});

// ---------------------------------------------------------------------------
// freshness gate
// ---------------------------------------------------------------------------

const freshness = (over: Partial<FreshnessInput> = {}) =>
  classifyFreshness({
    sourceKey: "renewals-core",
    sourceName: "ספר חידושים",
    lastPublishedAt: "2026-08-09T04:00:00.000Z",
    lastBatchId: "b1",
    lastRowCount: 100_000,
    ageSeconds: 3600,
    lastAttemptAt: "2026-08-09T04:00:00.000Z",
    lastAttemptStatus: "published",
    consecutiveFailures: 0,
    warningHours: 26,
    criticalHours: 50,
    openItemCount: 98_000,
    ...over,
  });

describe("missing or stale inventory returns unavailable, not zero", () => {
  it("passes a fresh source", () => {
    expect(freshnessBlock(freshness())).toBeNull();
  });

  it("still passes a source inside the warning band", () => {
    // Warning means "say when", not "refuse to answer". Blocking here would
    // make the product useless every Monday morning after a quiet weekend.
    expect(freshnessBlock(freshness({ ageSeconds: 30 * 3600 }))).toBeNull();
  });

  it("blocks a critically stale source", () => {
    expect(freshnessBlock(freshness({ ageSeconds: 60 * 3600 }))).toBe("stale_inventory");
  });

  it("blocks a source that has never published", () => {
    expect(freshnessBlock(freshness({ lastPublishedAt: null, ageSeconds: null }))).toBe(
      "no_inventory",
    );
  });

  it("blocks when there is no source at all", () => {
    expect(freshnessBlock(null)).toBe("no_inventory");
  });

  it("produces a specific Hebrew reason rather than 'no data'", () => {
    const r = unavailable(SCOPE, FROM, TO, "stale_inventory");
    if (r.available) throw new Error("expected unavailable");
    expect(r.detail).toContain("אינו עדכני");
    expect(r.detail).toContain("לא כאפס");
  });
});

// ---------------------------------------------------------------------------
// aggregation
// ---------------------------------------------------------------------------

describe("aggregation recomputes from components", () => {
  const small = fromComponents(
    { scopeId: "a", scopeKey: null, displayName: "צוות קטן" },
    FROM,
    TO,
    {
      ...EMPTY_COMPONENTS,
      eligibleCount: 8,
      engagedCount: 8,
      eligibleValue: 8_000,
      engagedValue: 8_000,
    },
    { computedAt: AT, source: "fact" },
  );
  const large = fromComponents(
    { scopeId: "b", scopeKey: null, displayName: "צוות גדול" },
    FROM,
    TO,
    {
      ...EMPTY_COMPONENTS,
      eligibleCount: 400,
      engagedCount: 160,
      expiredUnworkedCount: 240,
      eligibleValue: 400_000,
      engagedValue: 160_000,
      expiredUnworkedValue: 240_000,
    },
    { computedAt: AT, source: "fact" },
  );

  it("sums numerators and denominators, then recomputes — it does NOT average ratios", () => {
    // 100% and 40% average to 70%. The truth is 41%. This is the single most
    // common way a roll-up starts lying, and it is why no ratio is stored
    // anywhere in this engine.
    const { result } = aggregateCoverage([small, large], SCOPE, FROM, TO, AT);
    if (!result.available) throw new Error("expected available");
    expect(result.eligibleCount).toBe(408);
    expect(result.engagedCount).toBe(168);
    expect(result.countRatio).toBeCloseTo(168 / 408);

    if (!small.available || !large.available) throw new Error("fixture");
    const naiveMean = (small.countRatio + large.countRatio) / 2;
    expect(naiveMean).toBeCloseTo(0.7);
    expect(result.countRatio).toBeLessThan(0.42);
  });

  it("keeps the aggregate balanced", () => {
    const { result } = aggregateCoverage([small, large], SCOPE, FROM, TO, AT);
    if (!result.available) throw new Error("expected available");
    expect(componentsBalance(result)).toBe(true);
  });

  it("EXCLUDES unavailable parts rather than treating them as zero", () => {
    // Folding "we do not know" into a total as though it were "nothing was
    // due" understates the denominator and inflates the ratio — the flattering
    // direction, which is the one to guard.
    const dead = unavailable(
      { scopeId: "c", scopeKey: null, displayName: "צוות ללא מלאי" },
      FROM,
      TO,
      "stale_inventory",
    );
    const { result, contributed, skipped } = aggregateCoverage(
      [small, large, dead],
      SCOPE,
      FROM,
      TO,
      AT,
    );
    if (!result.available) throw new Error("expected available");
    expect(contributed).toBe(2);
    expect(result.eligibleCount).toBe(408);
    expect(skipped).toEqual([{ reason: "stale_inventory", count: 1 }]);
  });

  it("reports the most serious reason when nothing is available", () => {
    const stale = unavailable(SCOPE, FROM, TO, "stale_inventory");
    const empty = unavailable(SCOPE, FROM, TO, "no_eligible_work");
    const missing = unavailable(SCOPE, FROM, TO, "no_inventory");

    const a = aggregateCoverage([empty, stale], SCOPE, FROM, TO, AT).result;
    expect(a.available).toBe(false);
    if (!a.available) expect(a.reason).toBe("stale_inventory");

    const b = aggregateCoverage([empty, stale, missing], SCOPE, FROM, TO, AT).result;
    if (!b.available) expect(b.reason).toBe("no_inventory");
  });

  it("returns unavailable for an empty input rather than 0/0", () => {
    const { result, contributed } = aggregateCoverage([], SCOPE, FROM, TO, AT);
    expect(result.available).toBe(false);
    expect(contributed).toBe(0);
  });

  it("sums components associatively — grouping cannot change the total", () => {
    const parts = [
      comps({
        eligibleCount: 3,
        engagedCount: 1,
        expiredUnworkedCount: 1,
        pendingCount: 1,
        eligibleValue: 30,
        engagedValue: 10,
        expiredUnworkedValue: 10,
        pendingValue: 10,
      }),
      comps(),
      EMPTY_COMPONENTS,
    ];
    const all = sumComponents(parts);
    const split = sumComponents([sumComponents([parts[0]]), sumComponents([parts[1], parts[2]])]);
    expect(all).toEqual(split);
  });
});

// ---------------------------------------------------------------------------
// pinned lineage
// ---------------------------------------------------------------------------

describe("pinned scope lineage", () => {
  const pinned: ScopeLineage = {
    scopeId: "s1",
    scopeKey: "team:1",
    scopeKind: "team",
    displayName: "צוות רכב",
    representativeIds: ["rep-1", "rep-2", "rep-3"],
    teamIds: ["team-1"],
    resolvedCount: 3,
    pinnedAt: AT,
  };

  it("matches when the roster is unchanged, regardless of order", () => {
    expect(lineageMatchesCurrent(pinned, ["rep-3", "rep-1", "rep-2"])).toBe(true);
  });

  it("does not match after someone moves teams", () => {
    // The point of pinning: this returns false, and the FACT still holds the
    // old membership, so last month's coverage does not change because the org
    // chart did.
    expect(lineageMatchesCurrent(pinned, ["rep-1", "rep-2", "rep-9"])).toBe(false);
  });

  it("does not match after the scope grows or shrinks", () => {
    expect(lineageMatchesCurrent(pinned, ["rep-1", "rep-2"])).toBe(false);
    expect(lineageMatchesCurrent(pinned, ["rep-1", "rep-2", "rep-3", "rep-4"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// presentation
// ---------------------------------------------------------------------------

describe("describeCoverage", () => {
  it("never states a percentage without its components", () => {
    const r = fromComponents(SCOPE, FROM, TO, comps(), { computedAt: AT, source: "live" });
    const text = describeCoverage(r);
    expect(text).toContain("80 מתוך 100");
    expect(text).toContain("80.0%");
    expect(text).toContain("לא טופלו 15");
  });

  it("states the reason when unavailable, and no number at all", () => {
    const text = describeCoverage(unavailable(SCOPE, FROM, TO, "no_inventory"));
    expect(text).toContain("לא נקלט מלאי");
    expect(text).not.toMatch(/\d+%/);
  });
});

// ---------------------------------------------------------------------------
// the union prevents a bare ratio at the type level
// ---------------------------------------------------------------------------

describe("result shape", () => {
  it("carries no ratio on the unavailable branch", () => {
    const r: CoverageResult = unavailable(SCOPE, FROM, TO, "no_inventory");
    expect("countRatio" in r).toBe(false);
    expect("eligibleCount" in r).toBe(false);
  });
});
