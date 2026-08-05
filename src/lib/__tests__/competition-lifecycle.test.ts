import { describe, it, expect } from "vitest";
import { hasRecordedScores } from "@/routes/_authenticated/competitions";
import type { Competition } from "@/lib/seed";

// Regression coverage for the P0 competition-lifecycle fix: a completed
// competition used to be a dead end (not clickable, no actions at all).
// The fix adds Reopen/Edit/Archive/Unarchive actions plus a real Delete —
// but only ever `hasRecordedScores` decides whether Delete is actually
// offered vs. permanently disabled in favor of Archive, since deleting a
// competition with real recorded achievement would destroy representatives'
// history. This is the one rule the whole safety story rests on, so it gets
// direct, exhaustive coverage independent of any UI rendering.

function comp(overrides: Partial<Competition> = {}): Competition {
  return {
    id: "c1",
    name: "מבחן",
    startDate: "2026-08-01",
    endDate: "2026-08-05",
    rules: "",
    prize: "",
    active: false,
    archived: false,
    categories: [{ id: "cat1", label: "קטגוריה", points: 3 }],
    scores: [],
    ...overrides,
  };
}

describe("hasRecordedScores — gates whether a completed/archived competition may be hard-deleted", () => {
  it("a competition with no score rows at all can be deleted", () => {
    expect(hasRecordedScores(comp({ scores: [] }))).toBe(false);
  });

  it("a competition where every score row is exactly 0 can still be deleted (never touched, not real achievement)", () => {
    expect(hasRecordedScores(comp({ scores: [{ repId: "r1", categoryId: "cat1", count: 0 }] }))).toBe(false);
  });

  it("a single positive score anywhere blocks deletion", () => {
    expect(hasRecordedScores(comp({ scores: [{ repId: "r1", categoryId: "cat1", count: 1 }] }))).toBe(true);
  });

  it("a mix of zero and positive scores still blocks deletion (any real achievement is enough)", () => {
    expect(hasRecordedScores(comp({
      scores: [
        { repId: "r1", categoryId: "cat1", count: 0 },
        { repId: "r2", categoryId: "cat1", count: 12 },
      ],
    }))).toBe(true);
  });

  it("is unaffected by active/archived state — the same rule applies whether completed or already archived", () => {
    const withScore = { scores: [{ repId: "r1", categoryId: "cat1", count: 5 }] };
    expect(hasRecordedScores(comp({ active: false, archived: false, ...withScore }))).toBe(true);
    expect(hasRecordedScores(comp({ active: false, archived: true, ...withScore }))).toBe(true);
  });
});
