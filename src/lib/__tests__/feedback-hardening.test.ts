import { describe, it, expect } from "vitest";
import {
  computeFeedbackScore,
  isFutureFeedbackDate,
  todayIsoDate,
  daysSinceIsoDate,
  computeQueuePriority,
  queuePriorityLevel,
  QUEUE_NO_HISTORY_PRIORITY,
} from "@/lib/feedback-domain";
import {
  normalizeFeedbackDate,
  normalizeCriteria,
  normalizeScheduleTime,
  assertFeedbackDateNotFuture,
  assertCorrectionReason,
  FUTURE_FEEDBACK_DATE_MESSAGE,
  PUBLISHED_CORRECTION_REASON_REQUIRED,
} from "@/lib/feedback.functions";
import { CLOUD_TABLES, CLOUD_WRITE_PROTECTED_TABLES } from "@/lib/cloud.functions";

// Regression coverage for the Feedback & Listening Operational Hardening
// sprint. Each block names the defect it exists to keep fixed.

describe("score derivation is one shared implementation", () => {
  it("averages the scored criteria, excluding 'na' entirely", () => {
    expect(computeFeedbackScore({ opening: "done", needs: "done" })).toBe(100);
    expect(computeFeedbackScore({ opening: "done", needs: "not_done" })).toBe(50);
    expect(computeFeedbackScore({ opening: "done", needs: "partial" })).toBe(75);
    // "na" is excluded, not counted as zero — a criterion that did not apply
    // must not drag the representative's score down.
    expect(computeFeedbackScore({ opening: "done", needs: "na" })).toBe(100);
  });

  it("returns 0 rather than NaN when nothing is scorable", () => {
    expect(computeFeedbackScore({})).toBe(0);
    expect(computeFeedbackScore({ opening: "na" })).toBe(0);
  });

  it("ignores keys that are not part of CRITERIA", () => {
    // Stored in the criteria jsonb, deliberately not scored.
    expect(computeFeedbackScore({ opening: "done", not_a_criterion: "not_done" } as never)).toBe(100);
  });
});

describe("future feedback dates", () => {
  const now = new Date("2026-08-05T12:00:00.000Z");

  it("todayIsoDate is the plain YYYY-MM-DD of now", () => {
    expect(todayIsoDate(now)).toBe("2026-08-05");
  });

  it("today and the past are accepted; tomorrow is not", () => {
    expect(isFutureFeedbackDate("2026-08-05", now)).toBe(false);
    expect(isFutureFeedbackDate("2026-08-04", now)).toBe(false);
    expect(isFutureFeedbackDate("2026-08-06", now)).toBe(true);
  });

  it("an empty date is not treated as a future date", () => {
    expect(isFutureFeedbackDate("", now)).toBe(false);
  });

  it("the server-side guard throws with the product message", () => {
    expect(() => assertFeedbackDateNotFuture("2026-08-06", now)).toThrowError(FUTURE_FEEDBACK_DATE_MESSAGE);
    expect(() => assertFeedbackDateNotFuture("2026-08-05", now)).not.toThrow();
  });
});

describe("daysSinceIsoDate never goes negative", () => {
  const now = new Date("2026-08-05T12:00:00.000Z");

  it("counts whole days back", () => {
    expect(daysSinceIsoDate("2026-08-01", now)).toBe(4);
  });

  it("clamps a future date to 0 instead of reporting a negative gap", () => {
    // The bug: a negative gap made a representative look MORE recently heard
    // than someone listened to today, LOWERING their coaching priority.
    expect(daysSinceIsoDate("2026-09-01", now)).toBe(0);
  });

  it("returns 0 for an unparseable date rather than NaN", () => {
    expect(daysSinceIsoDate("not-a-date", now)).toBe(0);
  });
});

describe("coaching queue priority", () => {
  it("counts 'never listened to' exactly once", () => {
    // Before the fix this was 30 (a synthetic days=30 gap) + 25 (a separate
    // no-history bonus) = 55, which outranked a representative with a real,
    // genuinely poor record.
    const neverHeard = computeQueuePriority({ daysSinceLast: null, avgScore: null, achievementPct: null });
    expect(neverHeard).toBe(QUEUE_NO_HISTORY_PRIORITY);
    expect(neverHeard).toBeLessThan(55);
  });

  it("ranks a genuinely failing representative above one never listened to", () => {
    const failing = computeQueuePriority({ daysSinceLast: 20, avgScore: 45, achievementPct: 60 });
    const neverHeard = computeQueuePriority({ daysSinceLast: null, avgScore: null, achievementPct: null });
    expect(failing).toBeGreaterThan(neverHeard);
  });

  it("treats an average of 0 as a real score, not as missing data", () => {
    // The old `if (avg && avg < 60)` skipped the low-quality penalty for an
    // average of exactly 0 — the worst possible score.
    const zero = computeQueuePriority({ daysSinceLast: 5, avgScore: 0, achievementPct: null });
    const good = computeQueuePriority({ daysSinceLast: 5, avgScore: 90, achievementPct: null });
    expect(zero).toBe(5 + 30);
    expect(good).toBe(5);
  });

  it("caps the time contribution at 30 days", () => {
    expect(computeQueuePriority({ daysSinceLast: 400, avgScore: null, achievementPct: null })).toBe(30);
  });

  it("adds the target-shortfall contribution only when a target exists", () => {
    expect(computeQueuePriority({ daysSinceLast: 0, avgScore: null, achievementPct: null })).toBe(0);
    expect(computeQueuePriority({ daysSinceLast: 0, avgScore: null, achievementPct: 100 })).toBe(0);
    expect(computeQueuePriority({ daysSinceLast: 0, avgScore: null, achievementPct: 50 })).toBe(20);
  });

  it("maps priority to the three displayed levels at stable thresholds", () => {
    expect(queuePriorityLevel(0)).toBe("low");
    expect(queuePriorityLevel(24)).toBe("low");
    expect(queuePriorityLevel(25)).toBe("medium");
    expect(queuePriorityLevel(44)).toBe("medium");
    expect(queuePriorityLevel(45)).toBe("high");
  });
});

describe("server-side input normalization", () => {
  it("accepts only YYYY-MM-DD dates", () => {
    expect(normalizeFeedbackDate("2026-08-05")).toBe("2026-08-05");
    expect(() => normalizeFeedbackDate("05/08/2026")).toThrow();
    expect(() => normalizeFeedbackDate("")).toThrow();
    expect(() => normalizeFeedbackDate("2026-08-05T10:00:00Z")).toThrow();
  });

  it("accepts only 24h HH:MM times", () => {
    expect(normalizeScheduleTime("09:30")).toBe("09:30");
    expect(normalizeScheduleTime("23:59")).toBe("23:59");
    expect(() => normalizeScheduleTime("24:00")).toThrow();
    expect(() => normalizeScheduleTime("9:30")).toThrow();
    expect(() => normalizeScheduleTime("")).toThrow();
  });

  it("rejects an unrecognized criterion value instead of silently dropping it", () => {
    // Dropping it would change the computed score with nothing to show for it.
    expect(() => normalizeCriteria({ opening: "done", needs: "maybe" })).toThrow();
  });

  it("passes through every recognized value, including unscored keys", () => {
    expect(normalizeCriteria({ opening: "done", custom: "na" })).toEqual({ opening: "done", custom: "na" });
    expect(normalizeCriteria(null)).toEqual({});
    expect(normalizeCriteria([])).toEqual({});
  });
});

describe("correcting a published evaluation requires a stated reason", () => {
  it("requires a non-empty reason when the record is already published", () => {
    expect(() => assertCorrectionReason(true, undefined)).toThrowError(PUBLISHED_CORRECTION_REASON_REQUIRED);
    expect(() => assertCorrectionReason(true, "   ")).toThrowError(PUBLISHED_CORRECTION_REASON_REQUIRED);
  });

  it("returns the trimmed reason when one is given", () => {
    expect(assertCorrectionReason(true, "  טעות בהקלדת הציון  ")).toBe("טעות בהקלדת הציון");
  });

  it("does not require a reason for a draft", () => {
    expect(assertCorrectionReason(false, undefined)).toBe("");
  });
});

describe("feedback write boundary", () => {
  it("keeps feedback and listening_schedules readable through the generic reader", () => {
    // Reads stay generic: RLS is a complete authorization answer for a read,
    // and store.tsx's scoped subscription is the single shared read path.
    expect(CLOUD_TABLES).toContain("feedback");
    expect(CLOUD_TABLES).toContain("listening_schedules");
    expect(CLOUD_TABLES).toContain("coaching_plans");
    expect(CLOUD_TABLES).toContain("feedback_revisions");
  });

  it("refuses generic WRITES to every table that needs a domain write path", () => {
    // The generic proxy forwards whatever object it is handed: it cannot
    // derive the score, enforce the future-date rule, check the caller's
    // expected updated_at, or write the revision row in the same transaction.
    for (const t of ["feedback", "listening_schedules", "coaching_plans", "feedback_revisions", "kpi_values"]) {
      expect(CLOUD_WRITE_PROTECTED_TABLES).toContain(t);
    }
  });

  it("never protects a table that is not readable in the first place", () => {
    for (const t of CLOUD_WRITE_PROTECTED_TABLES) {
      expect(CLOUD_TABLES).toContain(t);
    }
  });
});
