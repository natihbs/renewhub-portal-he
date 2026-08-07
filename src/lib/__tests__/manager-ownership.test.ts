import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { computeStructuralGaps } from "@/lib/dashboard-domain";
import { computeWorkspaceOptions } from "@/lib/workspace-context";

// ---------------------------------------------------------------------------
// Manager team ownership: "manages this team" is teams.manager_id and nothing
// else. profiles.team_id is profile membership. These tests pin the gap
// surfacing, the scope source, and the audited assignment path.
// ---------------------------------------------------------------------------

describe("computeStructuralGaps — staffed team without a manager", () => {
  const team = (id: string, managerId: string | null, active = true) => ({
    id,
    name: `צוות ${id}`,
    active,
    managerId,
  });

  it("surfaces an active team that has representatives but no teams.manager_id", () => {
    const gaps = computeStructuralGaps([team("t1", null)], [{ teamId: "t1" }]);
    expect(gaps.map((g) => g.label)).toContain("צוותים מאוישים ללא מנהל צוות");
    expect(gaps.find((g) => g.label.includes("ללא מנהל צוות"))?.count).toBe(1);
    expect(gaps.find((g) => g.label.includes("ללא מנהל צוות"))?.href).toBe("/teams");
  });

  it("does not flag a staffed team whose manager is assigned", () => {
    const gaps = computeStructuralGaps([team("t1", "u-manager")], [{ teamId: "t1" }]);
    expect(gaps.map((g) => g.label)).not.toContain("צוותים מאוישים ללא מנהל צוות");
  });

  it("an unstaffed manager-less team is the 'no representatives' gap, not the manager gap", () => {
    const gaps = computeStructuralGaps([team("t1", null)], []);
    expect(gaps.map((g) => g.label)).toEqual(["צוותים פעילים ללא נציגים"]);
  });

  it("ignores inactive teams entirely", () => {
    const gaps = computeStructuralGaps([team("t1", null, false)], [{ teamId: "t1" }]);
    expect(gaps).toEqual([]);
  });

  it("keeps the pre-existing gaps and lists the manager gap first — it is the most consequential", () => {
    const gaps = computeStructuralGaps(
      [team("staffed-unmanaged", null), team("empty", "u1")],
      [{ teamId: "staffed-unmanaged" }, { teamId: null }],
    );
    expect(gaps.map((g) => g.label)).toEqual([
      "צוותים מאוישים ללא מנהל צוות",
      "צוותים פעילים ללא נציגים",
      "נציגים ללא צוות משויך",
    ]);
  });
});

describe("manager scope comes from teams.manager_id, never profiles.team_id", () => {
  it("a manager sees exactly the teams whose manager_id is them — profile membership is not an input at all", () => {
    const options = computeWorkspaceOptions({
      isAdmin: false,
      isManager: true,
      isRepresentative: false,
      isDemo: false,
      userId: "hen-atar",
      teams: [
        { id: "t-dira", name: "חידושי דירה", active: true, managerId: null },
        { id: "t-rechev", name: "חידושי רכב", active: true, managerId: "hen-atar" },
      ] as never,
    });
    // Only the team that names them as manager — the team their profile might
    // point at (t-dira, manager_id null) is NOT in their manager scope.
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ type: "team", teamId: "t-rechev" });
  });

  it("the חן עטר state — manager of nothing — yields an empty manager scope, not a guessed one", () => {
    const options = computeWorkspaceOptions({
      isAdmin: false,
      isManager: true,
      isRepresentative: false,
      isDemo: false,
      userId: "hen-atar",
      teams: [{ id: "t-dira", name: "חידושי דירה", active: true, managerId: null }] as never,
    });
    expect(options).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Source pins (no database in vitest): assignment path and labels.
// ---------------------------------------------------------------------------

describe("manager assignment path (source-pinned)", () => {
  const teamFns = readFileSync(resolve(__dirname, "../team-admin.functions.ts"), "utf8");
  const teamsPage = readFileSync(
    resolve(__dirname, "../../routes/_authenticated/teams.tsx"),
    "utf8",
  );
  const usersPage = readFileSync(
    resolve(__dirname, "../../routes/_authenticated/users.tsx"),
    "utf8",
  );

  it("assigning a manager writes teams.manager_id and is explicitly audited with from/to", () => {
    expect(teamFns).toContain('"team.manager_assigned"');
    expect(teamFns).toContain("from: before!.manager_id, to: data.manager_id");
  });

  it("the Teams page labels ownership as מנהל הצוות and offers the explicit assignment control", () => {
    expect(teamsPage).toContain("<TableHead>מנהל הצוות</TableHead>");
    expect(teamsPage).toContain("<Label>מנהל הצוות</Label>");
    expect(teamsPage).toContain("ללא מנהל צוות");
    expect(teamsPage).not.toContain("מנהל משויך");
  });

  it("the Users page distinguishes profile membership from managerial ownership", () => {
    expect(usersPage).toContain("צוות (פרופיל)");
    expect(usersPage).toContain("צוות (שיוך פרופיל)");
    expect(usersPage).toContain("מנהל הצוות של");
    expect(usersPage).toContain("אינו מוגדר כמנהל של אף צוות");
    expect(usersPage).toContain("שיוך פרופיל בלבד");
  });

  it("nothing assigns a manager silently — the only manager_id write is the explicit updateTeam/createTeam path", () => {
    const userFns = readFileSync(resolve(__dirname, "../user-admin.functions.ts"), "utf8");
    // user-admin writes profiles fields only; it must never touch teams.manager_id.
    expect(userFns).not.toContain('from("teams").update');
  });
});
