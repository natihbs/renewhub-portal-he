import { describe, it, expect } from "vitest";
import { visibleFeedback } from "@/lib/store";
import type { Feedback } from "@/lib/seed";

// Regression coverage for the Feedback & Listening production-readiness audit,
// Phase 5 (permissions): a representative must never see draft feedback, another
// representative's feedback, or feedback that isn't published — and this must not
// depend on currentRepId ever being resolved (a missing/empty currentRepId must
// fail closed to an empty list, not to "everything").

function mkFeedback(overrides: Partial<Feedback>): Feedback {
  return {
    id: "f1", repId: "rep-1", date: "2026-01-01", callId: "C-1", callType: "חידוש",
    listener: "מנהל", criteria: {}, score: 80, keep: "", improve: "",
    managerSummary: "", nextTask: "", published: true, scheduleId: null,
    ...overrides,
  };
}

describe("visibleFeedback", () => {
  it("a manager sees every row, published or draft, for every rep", () => {
    const list = [
      mkFeedback({ id: "f1", repId: "rep-1", published: true }),
      mkFeedback({ id: "f2", repId: "rep-2", published: false }),
    ];
    expect(visibleFeedback(list, true, "")).toHaveLength(2);
  });

  it("a representative sees only their own published feedback", () => {
    const list = [
      mkFeedback({ id: "f1", repId: "rep-1", published: true }),
      mkFeedback({ id: "f2", repId: "rep-1", published: false }), // own draft — must be hidden
      mkFeedback({ id: "f3", repId: "rep-2", published: true }), // someone else's — must be hidden
    ];
    const visible = visibleFeedback(list, false, "rep-1");
    expect(visible.map((f) => f.id)).toEqual(["f1"]);
  });

  it("a representative never sees draft feedback, even their own", () => {
    const list = [mkFeedback({ id: "f1", repId: "rep-1", published: false })];
    expect(visibleFeedback(list, false, "rep-1")).toHaveLength(0);
  });

  it("fails closed to an empty list when currentRepId hasn't resolved yet, instead of leaking everything", () => {
    const list = [
      mkFeedback({ id: "f1", repId: "rep-1", published: true }),
      mkFeedback({ id: "f2", repId: "rep-2", published: true }),
    ];
    expect(visibleFeedback(list, false, "")).toHaveLength(0);
  });
});
