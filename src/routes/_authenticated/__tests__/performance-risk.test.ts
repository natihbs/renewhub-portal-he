import { describe, it, expect } from "vitest";
import { computeRisk, feedbackStatsFor } from "@/routes/_authenticated/performance";
import type { Rep } from "@/lib/seed";
import type { Feedback } from "@/lib/feedback-domain";

// Regression coverage: Performance's risk indicator used to fabricate its monthly
// trend (repTrendPct, seeded from hash(rep.id)) and its "missing feedback"/"missing
// listening" reasons the same way (hash(rep.id) % 5). Both are now derived only from
// real target/result pace and the rep's real feedback records.

function mkRep(overrides: Partial<Rep>): Rep {
  return { id: "r1", name: "נציג", teamId: "t1", teamName: "צוות", monthlyTarget: 100, currentResult: 100, ...overrides };
}

function mkFeedback(overrides: Partial<Feedback>): Feedback {
  return {
    id: "f1", repId: "r1", date: "2026-01-01", callId: "C-1", callType: "חידוש",
    listener: "מנהל", criteria: {}, score: 80, keep: "", improve: "",
    managerSummary: "", nextTask: "", published: true, scheduleId: null,
    ...overrides,
  };
}

describe("feedbackStatsFor", () => {
  it("returns nulls when the rep has no feedback at all", () => {
    expect(feedbackStatsFor("r1", [])).toEqual({ avgScore: null, daysSinceLast: null });
  });

  it("averages only the given rep's feedback and finds the most recent date", () => {
    const feedback = [
      mkFeedback({ id: "f1", repId: "r1", date: "2026-01-01", score: 60 }),
      mkFeedback({ id: "f2", repId: "r1", date: "2026-01-10", score: 100 }),
      mkFeedback({ id: "f3", repId: "r2", date: "2026-01-15", score: 0 }), // other rep — excluded
    ];
    const { avgScore } = feedbackStatsFor("r1", feedback);
    expect(avgScore).toBe(80);
  });
});

describe("computeRisk — derived only from real data, not the rep's id", () => {
  it("is deterministic across different ids given identical real inputs", () => {
    const a = computeRisk(mkRep({ id: "aaaaaaaa" }), 90, 90, 2);
    const b = computeRisk(mkRep({ id: "zzzzzzzz" }), 90, 90, 2);
    expect(a).toEqual(b);
  });

  it("a rep on pace with recent, high-quality feedback is low risk", () => {
    expect(computeRisk(mkRep({}), 100, 95, 1).level).toBe("low");
  });

  it("flags a low average feedback score as a real reason", () => {
    const { reasons } = computeRisk(mkRep({}), 100, 40, 1);
    expect(reasons.some((r) => r.includes("ציון איכות"))).toBe(true);
  });

  it("flags no feedback at all as a real reason instead of staying silent", () => {
    const { reasons } = computeRisk(mkRep({}), 100, null, null);
    expect(reasons.some((r) => r.includes("אין עדיין משוב"))).toBe(true);
  });
});
