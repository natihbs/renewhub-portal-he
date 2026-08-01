import { describe, it, expect } from "vitest";
import { SCHEDULE_STATUSES } from "@/lib/listening-store";

// Regression coverage: listening_schedules.status now has a CHECK constraint
// (supabase/migrations/20260801221500_feedback_score_and_schedule_status_constraints.sql)
// limited to exactly these three values. This pins the client-side constant so any
// future change to the supported status set is a deliberate, visible edit here —
// not a silent drift that only surfaces as a database write failure in production.

describe("SCHEDULE_STATUSES", () => {
  it("matches exactly the values allowed by the database CHECK constraint", () => {
    expect(SCHEDULE_STATUSES).toEqual(["planned", "completed", "cancelled"]);
  });
});
