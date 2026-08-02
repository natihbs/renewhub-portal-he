import { describe, it, expect } from "vitest";
import {
  calculateAchievement, calculateGap, achievementStatus, paceStatus, paceInfo, computeRisk,
  ACHIEVEMENT_STATUS_LABEL, ACHIEVEMENT_STATUS_TONE, PACE_STATUS_LABEL,
} from "@/lib/performance-domain";

// Regression coverage: achievement (actual/target) used to be recomputed inline in
// ~9 places (store.tsx, performance.tsx, RepWorkspace.tsx, MorningRoutine.tsx,
// communications.tsx, dashboard index.tsx) and, in several of them, mislabeled as a
// "renewal percentage" even though the calculation has nothing to do with renewals.
// This is now the single source of truth for that math and its thresholds.

describe("calculateAchievement", () => {
  it("is actual / target as a percentage", () => {
    expect(calculateAchievement(80, 100)).toBe(80);
    expect(calculateAchievement(150, 100)).toBe(150);
  });

  it("is safe (0, not NaN/Infinity) on a zero or missing target", () => {
    expect(calculateAchievement(50, 0)).toBe(0);
    expect(calculateAchievement(0, 0)).toBe(0);
  });
});

describe("calculateGap", () => {
  it("is actual - target, positive when above target", () => {
    expect(calculateGap(120, 100)).toBe(20);
    expect(calculateGap(80, 100)).toBe(-20);
  });
});

describe("achievementStatus — flat threshold, canonical Hebrew terminology", () => {
  it("is 'above' at or above 100%", () => {
    expect(achievementStatus(100)).toBe("above");
    expect(achievementStatus(140)).toBe("above");
  });

  it("is 'onpace' from 80% up to (not including) 100%", () => {
    expect(achievementStatus(80)).toBe("onpace");
    expect(achievementStatus(99)).toBe("onpace");
  });

  it("is 'attention' below 80%, including the zero-target case", () => {
    expect(achievementStatus(79)).toBe("attention");
    expect(achievementStatus(0)).toBe("attention");
  });

  it("never labels achievement as a renewal percentage", () => {
    for (const label of Object.values(ACHIEVEMENT_STATUS_LABEL)) {
      expect(label).not.toContain("חידוש");
    }
    for (const label of Object.values(PACE_STATUS_LABEL)) {
      expect(label).not.toContain("חידוש");
    }
  });

  it("every status has a tone", () => {
    expect(ACHIEVEMENT_STATUS_TONE.above).toBe("success");
    expect(ACHIEVEMENT_STATUS_TONE.onpace).toBe("warning");
    expect(ACHIEVEMENT_STATUS_TONE.attention).toBe("danger");
  });
});

describe("paceStatus — pace-adjusted, used by Performance and RepWorkspace", () => {
  it("is 'above' once actual already meets target, regardless of date", () => {
    expect(paceStatus(150, 100, 20, 1)).toBe("above");
  });

  it("is deterministic and matches a hand-computed expectation", () => {
    // 20 workdays total, 10 passed -> expected = 50. actual 55 is within +5% of target (105) -> above.
    expect(paceStatus(55, 100, 20, 10)).toBe("above");
    // actual 40 is more than -5% below expected (50) -> attention.
    expect(paceStatus(40, 100, 20, 10)).toBe("attention");
    // actual 48 is within the +-5 band around expected 50 -> onpace.
    expect(paceStatus(48, 100, 20, 10)).toBe("onpace");
  });

  it("is safe on a zero target", () => {
    expect(paceStatus(0, 0, 20, 10)).toBe("above");
  });
});

describe("paceInfo", () => {
  it("computes expected/forecast/perDay/paceDelta from real inputs only", () => {
    const info = paceInfo(100, 50, 20, 10, 10);
    expect(info.expected).toBe(50);
    expect(info.forecast).toBe(100);
    expect(info.perDay).toBe(5);
    expect(info.paceDelta).toBe(0);
  });

  it("is safe on a zero target/workdays", () => {
    const info = paceInfo(0, 0, 0, 0, 0);
    expect(info.expected).toBe(0);
    expect(Number.isFinite(info.forecast)).toBe(true);
  });
});

describe("computeRisk — shared by performance.tsx and RepWorkspace.tsx", () => {
  it("is deterministic given identical real inputs", () => {
    expect(computeRisk(90, 90, 2)).toEqual(computeRisk(90, 90, 2));
  });

  it("a rep on pace with recent, high-quality feedback is low risk", () => {
    expect(computeRisk(100, 95, 1).level).toBe("low");
  });

  it("flags a low average feedback score as a real reason", () => {
    const { reasons } = computeRisk(100, 40, 1);
    expect(reasons.some((r) => r.includes("ציון איכות"))).toBe(true);
  });

  it("flags no feedback at all as a real reason instead of staying silent", () => {
    const { reasons } = computeRisk(100, null, null);
    expect(reasons.some((r) => r.includes("אין עדיין משוב"))).toBe(true);
  });
});
