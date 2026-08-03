import { describe, it, expect } from "vitest";
import { processRows } from "@/lib/import-processing";
import type { ImportFieldKey } from "@/lib/import-store";
import type { Rep } from "@/lib/seed";

// Regression coverage for the import-flow requirements: generic teams import
// successfully without renewal fields; renewals teams get real renewal data
// persisted; a generic team with renewal fields mapped gets a visible warning and
// the values are never silently written.

const GENERIC_TEAM = { id: "t-generic", name: "Sales North", kpiProfile: "generic_sales" as const };
const RENEWAL_TEAM = { id: "t-renewals", name: "Renewals Team", kpiProfile: "renewals" as const };
const teams = [GENERIC_TEAM, RENEWAL_TEAM];
const reps: Rep[] = [];

const universalMapping: Record<string, ImportFieldKey> = {
  "שם": "name", "צוות": "team", "יעד": "monthlyTarget", "ביצוע": "currentResult", "תאריך": "updatedAt",
};
const withRenewalMapping: Record<string, ImportFieldKey> = {
  ...universalMapping, "הזדמנויות": "renewalOpportunities", "חידושים": "completedRenewals",
};

describe("processRows — renewal-field profile gating", () => {
  it("a generic team imports successfully with no renewal fields mapped at all", () => {
    const rows = [{ "שם": "Dana", "צוות": "Sales North", "יעד": 100, "ביצוע": 80, "תאריך": "2026-08-01" }];
    const [row] = processRows(rows, universalMapping, reps, teams);
    expect(row.issues.some((i) => i.severity === "error")).toBe(false);
    expect(row.renewalOpportunities).toBeNull();
    expect(row.completedRenewals).toBeNull();
    expect(row.renewalFieldsSkipped).toBe(false);
  });

  it("persists renewal data for a row resolved to a renewals-profile team", () => {
    const rows = [{ "שם": "Roi", "צוות": "Renewals Team", "יעד": 100, "ביצוע": 80, "תאריך": "2026-08-01", "הזדמנויות": 20, "חידושים": 15 }];
    const [row] = processRows(rows, withRenewalMapping, reps, teams);
    expect(row.renewalOpportunities).toBe(20);
    expect(row.completedRenewals).toBe(15);
    expect(row.renewalFieldsSkipped).toBe(false);
    expect(row.issues.some((i) => i.message.includes("פרופיל"))).toBe(false);
  });

  it("warns and nulls out renewal values mapped to a generic_sales team — never silently discarded", () => {
    const rows = [{ "שם": "Mia", "צוות": "Sales North", "יעד": 100, "ביצוע": 80, "תאריך": "2026-08-01", "הזדמנויות": 20, "חידושים": 15 }];
    const [row] = processRows(rows, withRenewalMapping, reps, teams);
    expect(row.renewalOpportunities).toBeNull();
    expect(row.completedRenewals).toBeNull();
    expect(row.renewalFieldsSkipped).toBe(true);
    expect(row.issues.some((i) => i.severity === "warning")).toBe(true);
    // the row itself must still be importable for its universal fields — a rejected
    // renewal mapping must not block the generic target/result import.
    expect(row.action).toBe("create");
  });

  it("warns the same way for an unassigned team (no team resolved at all)", () => {
    const rows = [{ "שם": "Noam", "צוות": "Unknown Team", "יעד": 100, "ביצוע": 80, "תאריך": "2026-08-01", "הזדמנויות": 20, "חידושים": 15 }];
    const [row] = processRows(rows, withRenewalMapping, reps, teams);
    expect(row.teamId).toBeNull();
    expect(row.renewalOpportunities).toBeNull();
    expect(row.renewalFieldsSkipped).toBe(true);
  });
});

describe("processRows — unresolved-team warning must match what applyImport actually does", () => {
  // applyImport() only ever sends team_id on an UPDATE when a real team was
  // resolved (existing.teamId preserved otherwise) — a typo in the file can
  // never wipe a rep's real team assignment. A CREATE has no prior assignment
  // to protect, so an unresolved team really is saved unassigned. The row's
  // warning text must say whichever of those is actually about to happen.
  const existingRep = { id: "rep-1", name: "Dana Cohen", teamId: "t-generic", teamName: "Sales North", monthlyTarget: 100, currentResult: 80, lastUpdatedAt: "2026-08-01" } as Rep;

  it("tells the truth for a row that will UPDATE an existing rep: the existing team is kept, not cleared", () => {
    const rows = [{ "שם": "Dana Cohen", "צוות": "Sales Nrth", "יעד": 100, "ביצוע": 85, "תאריך": "2026-08-01" }];
    const [row] = processRows(rows, universalMapping, [existingRep], teams);
    expect(row.action).toBe("update");
    expect(row.teamId).toBeNull();
    const warning = row.issues.find((i) => i.severity === "warning");
    expect(warning?.message).toContain("יישאר ללא שינוי");
    expect(warning?.message).not.toContain("ללא שיוך צוות");
  });

  it("tells the truth for a row that will CREATE a new rep: it really is saved unassigned", () => {
    const rows = [{ "שם": "New Person", "צוות": "Sales Nrth", "יעד": 100, "ביצוע": 85, "תאריך": "2026-08-01" }];
    const [row] = processRows(rows, universalMapping, [existingRep], teams);
    expect(row.action).toBe("create");
    expect(row.teamId).toBeNull();
    const warning = row.issues.find((i) => i.severity === "warning");
    expect(warning?.message).toContain("ללא שיוך צוות");
  });
});
