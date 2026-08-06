import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parseTimestamp,
  parseAmount,
  validateRow,
  canonicalRowString,
  trailingMedian,
  decideVolume,
  classifyFreshness,
  canAssertCurrent,
  describeFreshness,
  failedChecks,
  changeRate,
  isBatchTerminal,
  type FreshnessInput,
  type RawWorkItemRow,
  type ValidationResult,
} from "@/lib/ingestion-domain";

const MIGRATIONS = path.resolve(import.meta.dirname, "../../../supabase/migrations");

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe("parsing untrusted values", () => {
  it("parses an ISO timestamp", () => {
    expect(parseTimestamp("2026-09-01T00:00:00.000Z")?.toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(parseTimestamp("2026-09-01")?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("returns null for absent and for malformed alike — the caller distinguishes them", () => {
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp("   ")).toBeNull();
    expect(parseTimestamp("31/09/2026")).toBeNull();
    expect(parseTimestamp("not a date")).toBeNull();
  });

  it("rejects a value that Number() would silently coerce", () => {
    // Number("") is 0 and Number(" 12 ") is 12. Either would let a malformed
    // feed through as a plausible figure, which is the exact defect shape this
    // program keeps removing.
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("₪4,200")).toBeNull();
    expect(parseAmount("4 200")).toBeNull();
    expect(parseAmount("1e5")).toBeNull();
    expect(parseAmount("12abc")).toBeNull();
  });

  it("parses a plain decimal, including zero", () => {
    expect(parseAmount("4200")).toBe(4200);
    expect(parseAmount("4200.50")).toBe(4200.5);
    expect(parseAmount(" 4200.50 ")).toBe(4200.5);
    expect(parseAmount("0")).toBe(0);
    expect(parseAmount("-1200")).toBe(-1200);
  });
});

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------

const row = (over: Partial<RawWorkItemRow> = {}): RawWorkItemRow => ({
  externalRef: "POL-0000001",
  subjectRef: "CUST-1",
  subjectLabel: "לקוח",
  ownerExternalRef: "rep-1",
  dueAtRaw: "2026-09-01T00:00:00.000Z",
  eligibleFromRaw: "2026-08-01T00:00:00.000Z",
  businessValueRaw: "4200.00",
  ...over,
});

describe("row validation", () => {
  it("accepts a well-formed row", () => {
    expect(validateRow(row(), true)).toEqual({ valid: true });
  });

  it("accepts a row with no owner — an unallocated item is a legitimate state", () => {
    expect(validateRow(row({ ownerExternalRef: null }), false)).toEqual({ valid: true });
    expect(validateRow(row({ ownerExternalRef: "" }), false)).toEqual({ valid: true });
  });

  it("rejects a supplied owner that does not resolve", () => {
    const verdict = validateRow(row({ ownerExternalRef: "ghost" }), false);
    expect(verdict).toEqual({ valid: false, errorCode: "unknown_owner", detail: "ghost" });
  });

  it("accepts a row with no dates at all — that work type may have no decay", () => {
    expect(validateRow(row({ dueAtRaw: null, eligibleFromRaw: null }), true)).toEqual({
      valid: true,
    });
  });

  it("rejects a missing key", () => {
    expect(validateRow(row({ externalRef: null }), true)).toMatchObject({
      errorCode: "missing_external_ref",
    });
    expect(validateRow(row({ externalRef: "  " }), true)).toMatchObject({
      errorCode: "missing_external_ref",
    });
  });

  it("rejects malformed dates and values, echoing what it actually received", () => {
    expect(validateRow(row({ dueAtRaw: "31/09/2026" }), true)).toEqual({
      valid: false,
      errorCode: "malformed_due_at",
      detail: "31/09/2026",
    });
    expect(validateRow(row({ businessValueRaw: "₪4,200" }), true)).toMatchObject({
      errorCode: "malformed_business_value",
      detail: "₪4,200",
    });
    expect(validateRow(row({ eligibleFromRaw: "yesterday" }), true)).toMatchObject({
      errorCode: "malformed_eligible_from",
    });
  });

  it("rejects a negative value", () => {
    expect(validateRow(row({ businessValueRaw: "-1200" }), true)).toMatchObject({
      errorCode: "negative_business_value",
    });
  });

  it("rejects an inverted window", () => {
    expect(
      validateRow(
        row({ dueAtRaw: "2026-08-01T00:00:00.000Z", eligibleFromRaw: "2026-09-01T00:00:00.000Z" }),
        true,
      ),
    ).toMatchObject({ errorCode: "window_inverted" });
  });

  it("accepts a window whose endpoints coincide", () => {
    const same = "2026-09-01T00:00:00.000Z";
    expect(validateRow(row({ dueAtRaw: same, eligibleFromRaw: same }), true)).toEqual({
      valid: true,
    });
  });

  it("reports the missing key first when a row is broken several ways", () => {
    // Precedence, not arbitrary order: the missing key is what an operator
    // fixes first, and one error per row keeps the report readable.
    const verdict = validateRow(
      row({ externalRef: "", dueAtRaw: "garbage", businessValueRaw: "-5" }),
      false,
    );
    expect(verdict).toMatchObject({ errorCode: "missing_external_ref" });
  });
});

// ---------------------------------------------------------------------------
// Canonical form
// ---------------------------------------------------------------------------

describe("canonical row form", () => {
  it("matches the generated column in the migration, field for field", () => {
    // The checksum is md5 in Postgres and is deliberately NOT reimplemented in
    // TypeScript — two implementations would drift. What CAN drift silently is
    // the field list, so it is pinned here against the migration text.
    const sql = readFileSync(
      path.join(MIGRATIONS, "20260809090000_v2_ingestion_pipeline.sql"),
      "utf8",
    );
    const generated = /row_checksum text GENERATED ALWAYS AS \(([\s\S]*?)\) STORED/.exec(sql);
    expect(generated).not.toBeNull();

    const sqlFields = [...generated![1].matchAll(/coalesce\((\w+),\s*''\)/g)].map((m) => m[1]);
    expect(sqlFields).toEqual([
      "external_ref",
      "subject_ref",
      "owner_external_ref",
      "due_at_raw",
      "eligible_from_raw",
      "business_value_raw",
    ]);
    expect(canonicalRowString(row()).split("|")).toHaveLength(sqlFields.length);
  });

  it("excludes subject_label so a cosmetic rename is not new content", () => {
    const a = canonicalRowString(row({ subjectLabel: "לקוח" }));
    const b = canonicalRowString(row({ subjectLabel: "לקוח (עודכן)" }));
    expect(a).toBe(b);
  });

  it("changes when any checksummed field changes", () => {
    const base = canonicalRowString(row());
    expect(canonicalRowString(row({ businessValueRaw: "4201.00" }))).not.toBe(base);
    expect(canonicalRowString(row({ ownerExternalRef: "rep-2" }))).not.toBe(base);
    expect(canonicalRowString(row({ dueAtRaw: "2026-09-02T00:00:00.000Z" }))).not.toBe(base);
  });

  it("treats null and empty string identically, as the SQL coalesce does", () => {
    expect(canonicalRowString(row({ subjectRef: null }))).toBe(
      canonicalRowString(row({ subjectRef: "" })),
    );
  });
});

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

describe("trailing baseline", () => {
  it("returns null with no history", () => {
    expect(trailingMedian([])).toBeNull();
  });

  it("takes the middle value for an odd count", () => {
    expect(trailingMedian([100, 300, 200])).toBe(200);
  });

  it("averages the middle pair for an even count", () => {
    expect(trailingMedian([100, 200, 300, 400])).toBe(250);
  });

  it("barely moves for a single outlier, where a mean collapses", () => {
    // This is the whole reason for a median. With a mean, one 5% delivery that
    // got published lowers the bar for its successor — which is exactly how a
    // feed degrades silently over a week instead of failing on day one.
    //
    // The median is not perfectly unmoved: appending a sixth value flips the
    // count to even, so it becomes the midpoint of the middle pair. What
    // matters is the magnitude — a fraction of a percent against fifteen.
    const healthy = [100_000, 99_000, 101_000, 100_500, 99_500];
    const withOutlier = [...healthy, 5_000];
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

    const medianShift = 1 - trailingMedian(withOutlier)! / trailingMedian(healthy)!;
    const meanShift = 1 - mean(withOutlier) / mean(healthy);

    expect(medianShift).toBeLessThan(0.005);
    expect(meanShift).toBeGreaterThan(0.15);
  });
});

describe("volume decision", () => {
  const trailing = [100_000, 99_000, 101_000];

  it("passes a normal batch", () => {
    expect(decideVolume(99_500, trailing, 80).passed).toBe(true);
  });

  it("passes a batch exactly at the floor", () => {
    const d = decideVolume(80_000, trailing, 80);
    expect(d.floor).toBe(80_000);
    expect(d.passed).toBe(true);
  });

  it("rejects a batch one row below the floor", () => {
    expect(decideVolume(79_999, trailing, 80).passed).toBe(false);
  });

  it("rejects an abnormal drop and reports the numbers it judged on", () => {
    const d = decideVolume(12_000, trailing, 80);
    expect(d).toMatchObject({
      passed: false,
      rowCount: 12_000,
      baseline: 100_000,
      floor: 80_000,
      thresholdPct: 80,
    });
  });

  it("passes a larger-than-usual batch — only drops are suspicious", () => {
    expect(decideVolume(400_000, trailing, 80).passed).toBe(true);
  });

  it("passes the FIRST batch for a source, and says why", () => {
    // Nothing to compare against. Refusing to start is not safer than
    // starting — it is a pipeline that can never be bootstrapped.
    const d = decideVolume(50_000, [], 80);
    expect(d).toMatchObject({ passed: true, noBaseline: true, baseline: null, floor: null });
  });

  it("still rejects an empty batch that follows history", () => {
    expect(decideVolume(0, trailing, 80).passed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

const fresh = (over: Partial<FreshnessInput> = {}): FreshnessInput => ({
  sourceKey: "renewals-core",
  sourceName: "ספר חידושים",
  lastPublishedAt: "2026-08-09T04:00:00.000Z",
  lastBatchId: "batch-1",
  lastRowCount: 100_000,
  ageSeconds: 3600,
  lastAttemptAt: "2026-08-09T04:00:00.000Z",
  lastAttemptStatus: "published",
  consecutiveFailures: 0,
  warningHours: 26,
  criticalHours: 50,
  openItemCount: 98_500,
  ...over,
});

describe("freshness", () => {
  it("classifies a recent import as fresh", () => {
    expect(classifyFreshness(fresh()).state).toBe("fresh");
  });

  it("classifies at the thresholds inclusively", () => {
    expect(classifyFreshness(fresh({ ageSeconds: 26 * 3600 })).state).toBe("warning");
    expect(classifyFreshness(fresh({ ageSeconds: 26 * 3600 - 1 })).state).toBe("fresh");
    expect(classifyFreshness(fresh({ ageSeconds: 50 * 3600 })).state).toBe("critical");
    expect(classifyFreshness(fresh({ ageSeconds: 50 * 3600 - 1 })).state).toBe("warning");
  });

  it("treats 'never imported' as its own state, not as very stale", () => {
    // "We have never received anything from this feed" is a configuration
    // problem; "the last delivery was three days ago" is an operational one.
    // Collapsing them into one red badge loses the only thing that tells them
    // apart.
    const never = classifyFreshness(
      fresh({ lastPublishedAt: null, ageSeconds: null, lastRowCount: null }),
    );
    expect(never.state).toBe("never");
    expect(never.ageHours).toBeNull();
  });

  it("reports a source that is FRESH and FAILING at the same time", () => {
    // Yesterday's data is still good and this morning's run was rejected. A
    // consumer reading only `state` would report all is well on the morning it
    // stopped being well.
    const report = classifyFreshness(
      fresh({ ageSeconds: 3600, lastAttemptStatus: "rejected", consecutiveFailures: 1 }),
    );
    expect(report.state).toBe("fresh");
    expect(report.lastAttemptFailed).toBe(true);
  });

  it("permits asserting current figures only while fresh or warning", () => {
    expect(canAssertCurrent(classifyFreshness(fresh()))).toBe(true);
    expect(canAssertCurrent(classifyFreshness(fresh({ ageSeconds: 30 * 3600 })))).toBe(true);
    expect(canAssertCurrent(classifyFreshness(fresh({ ageSeconds: 60 * 3600 })))).toBe(false);
    expect(
      canAssertCurrent(classifyFreshness(fresh({ lastPublishedAt: null, ageSeconds: null }))),
    ).toBe(false);
  });

  it("describes what, when and from where in one sentence", () => {
    expect(describeFreshness(classifyFreshness(fresh({ ageSeconds: 7200 })))).toBe(
      "ספר חידושים: 100000 פריטים, עודכן לפני 2 שעות",
    );
    expect(
      describeFreshness(classifyFreshness(fresh({ lastPublishedAt: null, ageSeconds: null }))),
    ).toBe("ספר חידושים: לא התקבלה קליטה מוצלחת מעולם");
    expect(
      describeFreshness(
        classifyFreshness(fresh({ lastAttemptStatus: "rejected", consecutiveFailures: 3 })),
      ),
    ).toContain("הריצה האחרונה נכשלה (3 ברצף)");
  });
});

// ---------------------------------------------------------------------------
// Batch summary
// ---------------------------------------------------------------------------

describe("batch summary helpers", () => {
  const result: ValidationResult = {
    passed: false,
    checks: [
      { check: "non_empty", passed: true, detail: { row_count: 40 } },
      { check: "volume", passed: false, detail: { row_count: 40, floor: 80_000 } },
      { check: "duplicate_batch", passed: true, detail: {} },
    ],
  };

  it("extracts only the failing checks", () => {
    expect(failedChecks(result).map((c) => c.check)).toEqual(["volume"]);
    expect(failedChecks(null)).toEqual([]);
  });

  it("recognizes terminal statuses", () => {
    expect(isBatchTerminal("published")).toBe(true);
    expect(isBatchTerminal("rejected")).toBe(true);
    expect(isBatchTerminal("validated")).toBe(false);
    expect(isBatchTerminal("open")).toBe(false);
  });

  it("computes how much of the inventory a batch actually moved", () => {
    // The interesting number is almost never the row count: two 100,000-row
    // snapshots are the same size and mean completely different things.
    expect(changeRate({ rowCount: 100_000, rowsInserted: 12, rowsUpdated: 288 })).toBeCloseTo(
      0.003,
    );
    expect(
      changeRate({ rowCount: 100_000, rowsInserted: 20_000, rowsUpdated: 20_000 }),
    ).toBeCloseTo(0.4);
    expect(changeRate({ rowCount: 0, rowsInserted: 0, rowsUpdated: 0 })).toBe(0);
  });
});
