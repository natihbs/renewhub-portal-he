import { describe, it, expect } from "vitest";
import { computeManagerCascade } from "@/lib/team-admin.functions";

// Regression coverage for: "a manager was removed from a team, but
// profiles.manager_id (the Users page's 'מנהל' column, and anything else
// that reads it) kept showing the old manager." Root cause was updateTeam
// writing teams.manager_id directly with no cascade to the existing members'
// profiles.manager_id — a denormalized copy only otherwise refreshed by
// set_user_team_with_representative_sync at team-ASSIGNMENT time, never at
// team-level reassignment time. Confirmed with an exact local Postgres replay
// of every migration: after clearing teams.manager_id, profiles.manager_id
// for both a manager and a rep who were already on the team stayed pointed
// at the removed manager until this fix.

describe("computeManagerCascade — profiles.manager_id must follow a team-level manager reassignment", () => {
  it("cascades when a manager is removed (set to null)", () => {
    const before = { manager_id: "manager-x" };
    const data = { team_id: "vehicle-renewals", manager_id: null };
    expect(computeManagerCascade(before, data)).toEqual({ team_id: "vehicle-renewals", manager_id: null });
  });

  it("cascades when a manager is reassigned to someone else", () => {
    const before = { manager_id: "manager-x" };
    const data = { team_id: "vehicle-renewals", manager_id: "manager-y" };
    expect(computeManagerCascade(before, data)).toEqual({ team_id: "vehicle-renewals", manager_id: "manager-y" });
  });

  it("cascades when a manager is assigned to a team that had none", () => {
    const before = { manager_id: null };
    const data = { team_id: "vehicle-renewals", manager_id: "manager-x" };
    expect(computeManagerCascade(before, data)).toEqual({ team_id: "vehicle-renewals", manager_id: "manager-x" });
  });

  it("does nothing when the manager is unchanged (avoids an unnecessary write on every unrelated team edit)", () => {
    const before = { manager_id: "manager-x" };
    const data = { team_id: "vehicle-renewals", manager_id: "manager-x" };
    expect(computeManagerCascade(before, data)).toBeNull();
  });

  it("does nothing when there is no prior team row (defensive — updateTeam always has one)", () => {
    const data = { team_id: "vehicle-renewals", manager_id: "manager-x" };
    expect(computeManagerCascade(null, data)).toBeNull();
  });
});
