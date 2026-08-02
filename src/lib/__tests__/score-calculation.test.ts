import { describe, it, expect } from "vitest";
import { computeScore } from "@/lib/store";
import { CRITERIA } from "@/lib/feedback-domain";

// Regression coverage for the Feedback & Listening production-readiness audit:
// score must be (sum of applicable criteria) / (count of applicable criteria) * 100,
// Done=1/Partial=0.5/NotDone=0, N/A excluded entirely, no division by zero, and it
// must never silently drop a criterion that the feedback form actually collects.

function allDone(): Record<string, "done"> {
  return Object.fromEntries(CRITERIA.map((c) => [c.key, "done" as const]));
}

describe("computeScore", () => {
  it("scores 100 when every criterion is done", () => {
    expect(computeScore(allDone())).toBe(100);
  });

  it("weights done=1, partial=0.5, not_done=0", () => {
    const [k1, k2, k3] = CRITERIA.map((c) => c.key);
    const criteria = { [k1]: "done", [k2]: "partial", [k3]: "not_done" } as const;
    // (1 + 0.5 + 0) / 3 * 100 = 50
    expect(computeScore(criteria as never)).toBe(50);
  });

  it("excludes n/a criteria from both the numerator and the denominator", () => {
    const [k1, k2] = CRITERIA.map((c) => c.key);
    const withNA = { [k1]: "done", [k2]: "na" } as const; // (1)/(1) * 100 = 100, not 50
    expect(computeScore(withNA as never)).toBe(100);
  });

  it("never divides by zero — all n/a (or empty) yields 0, not NaN", () => {
    expect(computeScore({ a: "na", b: "na" } as never)).toBe(0);
    expect(computeScore({})).toBe(0);
  });

  it("includes every criterion the feedback form actually exposes (regression: 'knowledge' and 'impression' were silently excluded)", () => {
    const keys = CRITERIA.map((c) => c.key);
    expect(keys).toContain("knowledge");
    expect(keys).toContain("impression");

    const allDoneExceptKnowledge = { ...allDone(), knowledge: "not_done" } as Record<string, "done" | "not_done">;
    // If "knowledge" were excluded (the bug), this would still score 100.
    expect(computeScore(allDoneExceptKnowledge)).toBeLessThan(100);
  });

  it("every criterion has a real label — none fall back to a raw key", () => {
    for (const c of CRITERIA) {
      expect(c.label).toBeTruthy();
      expect(c.label).not.toBe(c.key);
    }
  });
});
