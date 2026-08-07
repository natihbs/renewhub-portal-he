import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  compareQueueItems,
  orderQueue,
  describeQueueReason,
  isRecordableOutcomeState,
  isResolvingOutcomeState,
  RECORDABLE_OUTCOME_STATES,
  OUTCOME_STATE_LABELS,
  type QueueItem,
} from "@/lib/queue-domain";
import { CANONICAL_OUTCOME_STATES, DERIVED_EXPIRED_UNWORKED } from "@/lib/domain-types";

const item = (over: Partial<QueueItem> = {}): QueueItem => ({
  workItemId: "wi-500",
  externalRef: "POL-0000500",
  subjectRef: "CUST-1",
  subjectLabel: "לקוח",
  dueAt: "2026-08-20T00:00:00.000Z",
  eligibleFrom: "2026-07-20T00:00:00.000Z",
  businessValue: 4200,
  touchCount: 0,
  hoursToDue: 264,
  overdue: false,
  position: 1,
  ...over,
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

describe("queue ordering", () => {
  it("puts the earliest due date first", () => {
    const soon = item({ workItemId: "a", dueAt: "2026-08-10T00:00:00.000Z" });
    const later = item({ workItemId: "b", dueAt: "2026-08-20T00:00:00.000Z" });
    expect(orderQueue([later, soon]).map((i) => i.workItemId)).toEqual(["a", "b"]);
  });

  it("puts an OVERDUE item ahead of everything — it is already costing money", () => {
    const overdue = item({ workItemId: "a", dueAt: "2026-08-01T00:00:00.000Z", overdue: true });
    const today = item({ workItemId: "b", dueAt: "2026-08-09T00:00:00.000Z" });
    expect(orderQueue([today, overdue])[0].workItemId).toBe("a");
  });

  it("breaks a due-date tie on the higher business value", () => {
    const cheap = item({ workItemId: "a", businessValue: 900 });
    const rich = item({ workItemId: "b", businessValue: 18_000 });
    expect(orderQueue([cheap, rich]).map((i) => i.workItemId)).toEqual(["b", "a"]);
  });

  it("breaks a value tie on FEWER prior touches, so one hard item cannot absorb a morning", () => {
    const worked = item({ workItemId: "a", touchCount: 4 });
    const untouched = item({ workItemId: "b", touchCount: 0 });
    expect(orderQueue([worked, untouched]).map((i) => i.workItemId)).toEqual(["b", "a"]);
  });

  it("is a TOTAL order — identical items still sort deterministically by id", () => {
    // Without this an operator who reloads sees a different "next" and stops
    // trusting the queue, after which they cherry-pick.
    const a = item({ workItemId: "aaa" });
    const b = item({ workItemId: "bbb" });
    expect(orderQueue([b, a]).map((i) => i.workItemId)).toEqual(["aaa", "bbb"]);
    expect(orderQueue([a, b]).map((i) => i.workItemId)).toEqual(["aaa", "bbb"]);
    expect(compareQueueItems(a, a)).toBe(0);
  });

  it("sorts an item with no due date LAST — it can never expire", () => {
    const dated = item({ workItemId: "a", dueAt: "2030-01-01T00:00:00.000Z" });
    const undated = item({ workItemId: "b", dueAt: null, hoursToDue: null });
    expect(orderQueue([undated, dated]).map((i) => i.workItemId)).toEqual(["a", "b"]);
  });

  it("applies the terms in priority order — urgency beats value", () => {
    const urgentCheap = item({
      workItemId: "a",
      dueAt: "2026-08-10T00:00:00.000Z",
      businessValue: 100,
    });
    const distantRich = item({
      workItemId: "b",
      dueAt: "2026-09-10T00:00:00.000Z",
      businessValue: 99_000,
    });
    expect(orderQueue([distantRich, urgentCheap])[0].workItemId).toBe("a");
  });

  it("does not mutate its input", () => {
    const input = [item({ workItemId: "b" }), item({ workItemId: "a" })];
    orderQueue(input);
    expect(input.map((i) => i.workItemId)).toEqual(["b", "a"]);
  });

  it("matches the SQL ORDER BY in the migration, term for term", () => {
    const sql = readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../supabase/migrations/20260811090000_v2_mvp_runtime_loop.sql",
      ),
      "utf8",
    );
    expect(sql).toContain(
      "ORDER BY w.due_at ASC NULLS LAST, w.business_value DESC, t.touches ASC, w.id",
    );
  });
});

// ---------------------------------------------------------------------------
// Reason strings
// ---------------------------------------------------------------------------

describe("queue reason", () => {
  it("names all three ordering terms", () => {
    const text = describeQueueReason(item({ hoursToDue: 6, businessValue: 4200, touchCount: 0 }));
    expect(text).toContain("נותרו 6 שעות");
    expect(text).toContain("₪");
    expect(text).toContain("טרם נוצר קשר");
  });

  it("says how overdue an item is rather than how long remains", () => {
    const text = describeQueueReason(item({ overdue: true, hoursToDue: -30 }));
    expect(text).toContain("עבר את מועד היעד לפני 30 שעות");
  });

  it("switches to days beyond two", () => {
    expect(describeQueueReason(item({ hoursToDue: 120 }))).toContain("נותרו 5 ימים");
    expect(describeQueueReason(item({ overdue: true, hoursToDue: -96 }))).toContain(
      "באיחור 4 ימים",
    );
  });

  it("distinguishes one prior attempt from several", () => {
    expect(describeQueueReason(item({ touchCount: 1 }))).toContain("ניסיון אחד קודם");
    expect(describeQueueReason(item({ touchCount: 3 }))).toContain("3 ניסיונות קודמים");
  });

  it("handles an item with no deadline without inventing one", () => {
    const text = describeQueueReason(item({ dueAt: null, hoursToDue: null }));
    expect(text).toContain("ללא מועד יעד");
    expect(text).not.toContain("נותרו");
  });
});

// ---------------------------------------------------------------------------
// Recordable states
// ---------------------------------------------------------------------------

describe("recordable outcome states", () => {
  it("offers exactly the canonical five", () => {
    expect([...RECORDABLE_OUTCOME_STATES].sort()).toEqual([...CANONICAL_OUTCOME_STATES].sort());
  });

  it("never offers the derived state", () => {
    // Offering it would mean asking people to declare their own silent loss,
    // which nobody does — which is exactly why it must be derived.
    expect(RECORDABLE_OUTCOME_STATES).not.toContain(DERIVED_EXPIRED_UNWORKED as never);
    expect(isRecordableOutcomeState(DERIVED_EXPIRED_UNWORKED)).toBe(false);
  });

  it("rejects anything outside the five", () => {
    expect(isRecordableOutcomeState("renewed")).toBe(false);
    expect(isRecordableOutcomeState("")).toBe(false);
    expect(isRecordableOutcomeState(null)).toBe(false);
    expect(isRecordableOutcomeState(undefined)).toBe(false);
  });

  it("identifies only the two states that conclude an item", () => {
    expect(isResolvingOutcomeState("resolved_positive")).toBe(true);
    expect(isResolvingOutcomeState("resolved_negative")).toBe(true);
    expect(isResolvingOutcomeState("pending_external")).toBe(false);
    expect(isResolvingOutcomeState("pending_internal")).toBe(false);
    expect(isResolvingOutcomeState("unreachable")).toBe(false);
  });

  it("labels every recordable state in Hebrew", () => {
    for (const state of RECORDABLE_OUTCOME_STATES) {
      expect(OUTCOME_STATE_LABELS[state]).toBeTruthy();
    }
  });

  it("guards the derived state in the SQL write path too", () => {
    const sql = readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../supabase/migrations/20260811090000_v2_mvp_runtime_loop.sql",
      ),
      "utf8",
    );
    expect(sql).toContain("IF _canonical_state = 'expired_unworked' THEN");
    expect(sql).toContain("P0040");
  });
});
