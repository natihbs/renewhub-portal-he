import { describe, it, expect } from "vitest";
import { KPI_PROFILE_LABEL, DEFAULT_KPI_PROFILE, ACHIEVEMENT_STATUS_LABEL, PACE_STATUS_LABEL } from "@/lib/performance-domain";
import { renewalSectionLines } from "@/routes/_authenticated/communications";

// Guards the core correctness rule across the whole KPI profile workflow: no
// generic/universal achievement label may ever say "renewal", and the renewals
// label must only ever appear attached to a team that actually opted into it.

describe("KPI profile labels", () => {
  it("defaults to generic_sales", () => {
    expect(DEFAULT_KPI_PROFILE).toBe("generic_sales");
  });

  it("generic_sales is never labeled as a renewal", () => {
    expect(KPI_PROFILE_LABEL.generic_sales).not.toContain("חידוש");
  });

  it("renewals is legitimately labeled as renewals", () => {
    expect(KPI_PROFILE_LABEL.renewals).toContain("חידוש");
  });

  it("no achievement status label anywhere says 'renewal'", () => {
    for (const label of [...Object.values(ACHIEVEMENT_STATUS_LABEL), ...Object.values(PACE_STATUS_LABEL)]) {
      expect(label).not.toContain("חידוש");
    }
  });
});

describe("communications renewalSectionLines — only ever real, available data", () => {
  it("produces nothing when no renewals team has an available rate", () => {
    const lines = renewalSectionLines([
      { teamId: "t1", teamName: "Team A", assigned: null, completed: 0, rate: { available: false, reason: "no_assigned" } },
    ]);
    expect(lines).toEqual([]);
  });

  it("produces a renewals section only for teams with a real available rate — in the assigned-book language", () => {
    const lines = renewalSectionLines([
      { teamId: "t1", teamName: "Team A", assigned: null, completed: 0, rate: { available: false, reason: "no_assigned" } },
      { teamId: "t2", teamName: "Team B", assigned: 20, completed: 15, rate: { available: true, pct: 75, assigned: 20, completed: 15 } },
    ]);
    const text = lines.join("\n");
    expect(text).toContain("Team B");
    expect(text).not.toContain("Team A");
    expect(text).toContain("מיועדות חודשיות");
    expect(text).toContain("חידושים שנסגרו");
  });
});
