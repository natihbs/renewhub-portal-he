import { describe, it, expect } from "vitest";
import { scoreTone, SCORE_TEXT_CLASS, SCORE_BADGE_CLASS } from "@/lib/feedback-domain";

// Regression coverage: score -> color/tone used to be three separate inline ternaries
// (feedback.tsx's RecentSessions and HistoryTable, RepWorkspace's listening history
// table), one of which used different thresholds (85/70) and a different middle color
// than the other two (80/60) — the same score could read as a different tone depending
// on which screen showed it. Now a single source of truth.

describe("scoreTone", () => {
  it("is success at and above 80", () => {
    expect(scoreTone(80)).toBe("success");
    expect(scoreTone(100)).toBe("success");
  });

  it("is warning from 60 up to (not including) 80", () => {
    expect(scoreTone(60)).toBe("warning");
    expect(scoreTone(79)).toBe("warning");
  });

  it("is danger below 60", () => {
    expect(scoreTone(59)).toBe("danger");
    expect(scoreTone(0)).toBe("danger");
  });

  it("every tone has a text class and a badge class defined", () => {
    for (const tone of ["success", "warning", "danger"] as const) {
      expect(SCORE_TEXT_CLASS[tone]).toBeTruthy();
      expect(SCORE_BADGE_CLASS[tone]).toBeTruthy();
    }
  });
});
