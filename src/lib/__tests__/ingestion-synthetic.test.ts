import { describe, it, expect } from "vitest";
import {
  createRandom,
  generateOrg,
  generateWorkItems,
  generateUpdateBatch,
  injectCorruption,
  type SyntheticRow,
} from "@/lib/ingestion-synthetic";
import { validateRow, canonicalRowString } from "@/lib/ingestion-domain";

/**
 * The fixture has to be trustworthy before anything benchmarked against it
 * means anything. Two properties matter most: it is reproducible across runs,
 * and it is SHAPED like a real book rather than like uniform noise — a
 * generator that produced tidy data would make every later benchmark pass and
 * every later feature look correct on data it will never see.
 */

const ORG = generateOrg(12);
const OWNER_REFS = new Set(ORG.representatives.map((r) => r.externalRef));

describe("determinism", () => {
  it("produces an identical stream for the same seed", () => {
    const a = createRandom(42);
    const b = createRandom(42);
    const first = Array.from({ length: 20 }, () => a());
    const second = Array.from({ length: 20 }, () => b());
    expect(first).toEqual(second);
  });

  it("produces a different stream for a different seed", () => {
    const a = Array.from({ length: 20 }, createRandom(42));
    const b = Array.from({ length: 20 }, createRandom(43));
    expect(a).not.toEqual(b);
  });

  it("regenerates a byte-identical book from the same seed", () => {
    // Non-negotiable: a dataset that differs between PRs makes their benchmark
    // numbers incomparable, which defeats the purpose of having a fixture.
    const opts = { count: 500, org: ORG, anchorDate: "2026-08-09", seed: 1234 };
    expect(generateWorkItems(opts)).toEqual(generateWorkItems(opts));
  });

  it("builds the same org from the same seed", () => {
    expect(generateOrg(5, 99)).toEqual(generateOrg(5, 99));
  });
});

describe("org shape", () => {
  it("varies team size, so a capacity shortfall is demonstrable", () => {
    const sizes = new Map<string, number>();
    for (const r of ORG.representatives) sizes.set(r.teamKey, (sizes.get(r.teamKey) ?? 0) + 1);
    expect(new Set(sizes.values()).size).toBeGreaterThan(1);
    for (const size of sizes.values()) {
      expect(size).toBeGreaterThanOrEqual(6);
      expect(size).toBeLessThanOrEqual(14);
    }
  });

  it("mixes measurement modes across teams", () => {
    expect(new Set(ORG.teams.map((t) => t.kpiProfile)).size).toBe(2);
  });

  it("gives every representative a unique external ref", () => {
    expect(OWNER_REFS.size).toBe(ORG.representatives.length);
  });
});

describe("generated book", () => {
  const rows = generateWorkItems({ count: 5_000, org: ORG, anchorDate: "2026-08-09", seed: 7 });

  it("produces exactly the requested count with unique keys", () => {
    expect(rows).toHaveLength(5_000);
    expect(new Set(rows.map((r) => r.externalRef)).size).toBe(5_000);
  });

  it("produces only rows the pipeline accepts", () => {
    for (const r of rows) {
      expect(validateRow(r, OWNER_REFS.has(r.ownerExternalRef))).toEqual({ valid: true });
    }
  });

  it("opens the eligibility window before the due date, every time", () => {
    for (const r of rows) {
      expect(new Date(r.eligibleFromRaw).getTime()).toBeLessThan(new Date(r.dueAtRaw).getTime());
    }
  });

  it("clusters due dates into waves rather than spreading them evenly", () => {
    // Policies renew on their sale anniversary and selling is seasonal. A
    // uniform spread would make coverage-versus-capacity look comfortable on
    // every day of the year, which is the one thing it never is.
    const perWeek = new Map<number, number>();
    const anchor = new Date("2026-08-09T00:00:00.000Z").getTime();
    for (const r of rows) {
      const week = Math.floor((new Date(r.dueAtRaw).getTime() - anchor) / (7 * 86_400_000));
      perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
    }
    const counts = [...perWeek.values()];
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const peak = Math.max(...counts);
    expect(peak).toBeGreaterThan(mean * 2);
  });

  it("skews business value, so weighted and unweighted aggregates diverge", () => {
    const values = rows.map((r) => Number(r.businessValueRaw)).sort((a, b) => a - b);
    const median = values[Math.floor(values.length / 2)];
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    // A long tail pulls the mean above the median. Uniform values would make
    // these equal and hide the entire reason for value-weighting coverage.
    expect(mean).toBeGreaterThan(median * 1.2);
    expect(values[0]).toBeGreaterThanOrEqual(350);
  });

  it("distributes ownership unevenly, so per-owner figures are not identical", () => {
    const perOwner = new Map<string, number>();
    for (const r of rows)
      perOwner.set(r.ownerExternalRef, (perOwner.get(r.ownerExternalRef) ?? 0) + 1);
    const counts = [...perOwner.values()];
    expect(Math.max(...counts)).toBeGreaterThan(Math.min(...counts) * 1.5);
  });

  it("keeps two datasets apart when given different ref prefixes", () => {
    const other = generateWorkItems({
      count: 10,
      org: ORG,
      anchorDate: "2026-08-09",
      seed: 7,
      refPrefix: "ALT",
    });
    expect(other.every((r) => r.externalRef.startsWith("ALT-"))).toBe(true);
  });
});

describe("update batches", () => {
  const day1 = generateWorkItems({ count: 2_000, org: ORG, anchorDate: "2026-08-09", seed: 11 });
  const day2 = generateUpdateBatch(day1, {
    churnRate: 0.05,
    dropRate: 0.02,
    addRate: 0.03,
    anchorDate: "2026-08-10",
    org: ORG,
    seed: 12,
  });

  it("reports counts a test can check the pipeline against independently", () => {
    expect(day2.rows).toHaveLength(day2.expected.carried + day2.expected.added);
    expect(day2.expected.carried + day2.expected.dropped).toBe(day1.length);
  });

  it("leaves the great majority of rows byte-identical — the realistic daily shape", () => {
    // The expensive path in a daily snapshot is comparing 100,000 rows to find
    // the 300 that moved. A fixture where everything changed would benchmark a
    // workload the pipeline never sees.
    const before = new Map(day1.map((r) => [r.externalRef, canonicalRowString(r)]));
    let identical = 0;
    for (const r of day2.rows) {
      if (before.get(r.externalRef) === canonicalRowString(r)) identical++;
    }
    expect(identical / day2.rows.length).toBeGreaterThan(0.9);
  });

  it("changes roughly the requested share, and changes it for real", () => {
    const before = new Map(day1.map((r) => [r.externalRef, canonicalRowString(r)]));
    let changed = 0;
    for (const r of day2.rows) {
      const prior = before.get(r.externalRef);
      if (prior !== undefined && prior !== canonicalRowString(r)) changed++;
    }
    expect(changed).toBe(day2.expected.changed);
    expect(changed / day1.length).toBeGreaterThan(0.03);
    expect(changed / day1.length).toBeLessThan(0.07);
  });

  it("never collides a new item's key with an existing one, however many days are chained", () => {
    const day3 = generateUpdateBatch(day2.rows, {
      churnRate: 0.05,
      dropRate: 0.02,
      addRate: 0.03,
      anchorDate: "2026-08-11",
      org: ORG,
      seed: 13,
    });
    expect(new Set(day3.rows.map((r) => r.externalRef)).size).toBe(day3.rows.length);
  });

  it("produces rows the pipeline still accepts", () => {
    for (const r of day2.rows) {
      expect(validateRow(r, OWNER_REFS.has(r.ownerExternalRef))).toEqual({ valid: true });
    }
  });

  it("drops nothing when dropRate is zero", () => {
    const noDrop = generateUpdateBatch(day1, {
      churnRate: 0,
      dropRate: 0,
      addRate: 0,
      anchorDate: "2026-08-10",
      org: ORG,
      seed: 14,
    });
    expect(noDrop.rows).toEqual(day1);
  });
});

describe("injected corruption", () => {
  const clean = generateWorkItems({ count: 200, org: ORG, anchorDate: "2026-08-09", seed: 21 });

  const resolves = (r: SyntheticRow) => OWNER_REFS.has(r.ownerExternalRef);

  it("produces exactly the defect asked for, so a test can assert the RIGHT rejection", () => {
    // A suite that only checks "the batch failed" passes just as happily when
    // the pipeline is broken in some entirely different way.
    const cases = [
      ["missing_external_ref", "missing_external_ref"],
      ["malformed_due_at", "malformed_due_at"],
      ["malformed_business_value", "malformed_business_value"],
      ["negative_business_value", "negative_business_value"],
      ["unknown_owner", "unknown_owner"],
      ["window_inverted", "window_inverted"],
    ] as const;

    for (const [kind, expectedCode] of cases) {
      const dirty = injectCorruption(clean, kind, 1, 3);
      const verdicts = dirty.map((r) => validateRow(r, resolves(r)));
      const bad = verdicts.filter((v) => !v.valid);
      expect(bad).toHaveLength(1);
      expect(bad[0]).toMatchObject({ errorCode: expectedCode });
    }
  });

  it("produces a duplicate key that row-level validation cannot see", () => {
    // Duplicate keys are a BATCH-level defect: every individual row is
    // perfectly well-formed, which is exactly why the pipeline needs a
    // whole-batch check and not just a row loop.
    const dirty = injectCorruption(clean, "duplicate_key", 1, 5);
    expect(dirty.every((r) => validateRow(r, resolves(r)).valid)).toBe(true);
    expect(new Set(dirty.map((r) => r.externalRef)).size).toBeLessThan(dirty.length);
  });

  it("does not mutate the input", () => {
    const snapshot = JSON.stringify(clean);
    injectCorruption(clean, "missing_external_ref", 5);
    expect(JSON.stringify(clean)).toBe(snapshot);
  });
});
