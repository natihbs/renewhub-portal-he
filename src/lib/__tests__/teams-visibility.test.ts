import { describe, it, expect } from "vitest";
import { filterVisibleTeams } from "@/lib/teams-hooks";

// Regression coverage for P2a: useCloudTeams() used to unconditionally filter
// out every inactive team, which — because Workspace/Targets/Dashboard/
// Communications all consumed it — made a deactivated team's history
// unreachable everywhere at once. filterVisibleTeams is the pure gate that
// now backs both useActiveTeams() (assignment pickers, includeInactive:
// false) and useVisibleTeams() (history/reporting screens, includeInactive:
// true), factored out so the exact filtering rule gets direct unit coverage.

const rawTeams = [
  { id: "t1", name: "צוות פעיל", active: true, kpi_profile: "generic_sales", manager_id: "mgr-1" },
  { id: "t2", name: "צוות מושבת", active: false, kpi_profile: "renewals", manager_id: "mgr-2" },
];

describe("filterVisibleTeams", () => {
  it("excludes inactive teams by default (includeInactive: false) — assignment pickers must never offer one", () => {
    const teams = filterVisibleTeams(rawTeams, false);
    expect(teams.map((t) => t.id)).toEqual(["t1"]);
  });

  it("includes inactive teams when includeInactive: true — history/reporting screens must still reach them", () => {
    const teams = filterVisibleTeams(rawTeams, true);
    expect(teams.map((t) => t.id)).toEqual(["t1", "t2"]);
    const inactive = teams.find((t) => t.id === "t2")!;
    expect(inactive.active).toBe(false);
    expect(inactive.kpiProfile).toBe("renewals");
  });

  it("preserves each team's own active flag in the projection, regardless of includeInactive", () => {
    const teams = filterVisibleTeams(rawTeams, true);
    expect(teams.map((t) => t.active)).toEqual([true, false]);
  });

  it("defaults an unrecognized kpi_profile value to the generic sales profile", () => {
    const teams = filterVisibleTeams([{ id: "t3", name: "x", active: true, kpi_profile: "something_else", manager_id: null }], false);
    expect(teams[0].kpiProfile).toBe("generic_sales");
  });
});
