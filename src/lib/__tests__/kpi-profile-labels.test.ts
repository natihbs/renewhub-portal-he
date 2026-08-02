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
      { teamId: "t1", teamName: "Team A", totals: { opportunities: null, completed: null }, rate: { available: false, reason: "no_opportunities" } },
    ]);
    expect(lines).toEqual([]);
  });

  it("produces a renewals section only for teams with a real available rate", () => {
    const lines = renewalSectionLines([
      { teamId: "t1", teamName: "Team A", totals: { opportunities: null, completed: null }, rate: { available: false, reason: "no_opportunities" } },
      { teamId: "t2", teamName: "Team B", totals: { opportunities: 20, completed: 15 }, rate: { available: true, pct: 75 } },
    ]);
    expect(lines.join("\n")).toContain("Team B");
    expect(lines.join("\n")).not.toContain("Team A");
  });
});
