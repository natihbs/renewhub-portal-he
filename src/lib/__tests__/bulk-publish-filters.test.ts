import { describe, it, expect } from "vitest";
import { toBulkPublishFilters, BULK_PUBLISH_NONE } from "@/lib/feedback-admin.functions";

// Regression coverage for the admin "פרסום משובים קיימים" bulk-publish dialog: its
// Select controls use a sentinel value for "all teams"/"all representatives", and
// date inputs are empty strings when unset. Neither must ever leak into the actual
// API filter payload as a literal value — the server would try to match rows
// against "__all__" or "" instead of skipping the filter entirely.

describe("toBulkPublishFilters", () => {
  it("maps the 'no filter' sentinel and empty dates to null on every field", () => {
    const filters = toBulkPublishFilters({ teamId: BULK_PUBLISH_NONE, repId: BULK_PUBLISH_NONE, from: "", to: "" });
    expect(filters).toEqual({ teamId: null, repId: null, from: null, to: null });
  });

  it("passes through a real team/rep id and date range unchanged", () => {
    const filters = toBulkPublishFilters({ teamId: "team-1", repId: "rep-1", from: "2026-01-01", to: "2026-01-31" });
    expect(filters).toEqual({ teamId: "team-1", repId: "rep-1", from: "2026-01-01", to: "2026-01-31" });
  });

  it("a rep filter can be set while the team filter stays 'all'", () => {
    const filters = toBulkPublishFilters({ teamId: BULK_PUBLISH_NONE, repId: "rep-1", from: "", to: "" });
    expect(filters.teamId).toBeNull();
    expect(filters.repId).toBe("rep-1");
  });
});
