import { describe, it, expect } from "vitest";
import { riskOf, statusOf } from "@/components/RepWorkspace";
import type { Rep } from "@/lib/seed";

// Regression coverage: RepWorkspace's risk/status indicators used to be seeded from
// hash(rep.id), so two reps with identical real performance/feedback data could get
// different risk levels purely because of their id string. They must now be a pure
// function of real inputs only.

function mkRep(overrides: Partial<Rep>): Rep {
  return { id: "r1", name: "נציג", teamId: "t1", teamName: "צוות", monthlyTarget: 100, currentResult: 100, ...overrides };
}

describe("riskOf — derived only from real data, not the rep's id", () => {
  it("is deterministic across different ids given identical real inputs", () => {
    const a = riskOf(mkRep({ id: "aaaaaaaa" }), 100, 90, 2);
    const b = riskOf(mkRep({ id: "zzzzzzzz" }), 100, 90, 2);
    expect(a).toEqual(b);
  });

  it("flags low pace as a real reason, not a random one", () => {
    const rep = mkRep({ currentResult: 50 });
    const { level, reasons } = riskOf(rep, 100, 90, 1);
    expect(level).not.toBe("low");
    expect(reasons.some((r) => r.includes("80%"))).toBe(true);
  });

  it("flags a low average feedback score as a real reason", () => {
    const rep = mkRep({ currentResult: 100 });
    const { reasons } = riskOf(rep, 100, 40, 1);
    expect(reasons.some((r) => r.includes("ציון איכות"))).toBe(true);
  });

  it("flags missing feedback (null average) as a real reason instead of staying silent", () => {
    const rep = mkRep({ currentResult: 100 });
    const { reasons } = riskOf(rep, 100, null, null);
    expect(reasons.some((r) => r.includes("אין עדיין משוב"))).toBe(true);
  });

  it("a rep fully on pace with recent, high-quality feedback is low risk", () => {
    const rep = mkRep({ currentResult: 100 });
    const { level } = riskOf(rep, 100, 95, 1);
    expect(level).toBe("low");
  });

  it("a rep with no official target isn't penalized by the missing pct — only real feedback signals count", () => {
    const rep = mkRep({ currentResult: 0 });
    const { level, reasons } = riskOf(rep, null, 95, 1);
    expect(level).toBe("low");
    expect(reasons.some((r) => r.includes("80%") || r.includes("מתחת לצפוי"))).toBe(false);
  });
});

describe("statusOf — based on real target/result pace only", () => {
  it("a rep at or above target is 'above', regardless of where in the month it is", () => {
    // pct >= 100 short-circuits before any date-dependent pacing math.
    expect(statusOf(mkRep({ currentResult: 150 }), 100)).toBe("above");
  });

  it("a rep with no official target for the month is 'no_target', never a fabricated status", () => {
    expect(statusOf(mkRep({ currentResult: 150 }), null)).toBe("no_target");
  });
});
