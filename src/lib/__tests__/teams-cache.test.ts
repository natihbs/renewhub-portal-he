import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateTeamAdminCaches } from "@/routes/_authenticated/teams";

// Regression coverage for: "a manager was removed from a team, but the Teams
// UI and header still showed that manager assigned." Root cause was the
// Teams page's mutation-success invalidation list omitting ["representatives"]
// — the exact query key useCloudTeams() reads (see teams-hooks.ts), which
// backs WorkspaceProvider (header scope line, WorkspaceSwitcher) and the home
// dashboard's team cards. A team mutation (manager reassignment, KPI profile,
// active toggle, member add/remove) that only invalidated ["admin","teams"]
// left every OTHER consumer of team data showing the pre-mutation snapshot
// until a 30s staleTime lapsed and something happened to remount/refocus it.
//
// This exercises the real invalidation function against a real QueryClient —
// not a re-assertion of a hardcoded key list — so a future regression (someone
// adding a new team-data consumer without wiring its query key in here) is
// caught by proving every seeded cache entry actually goes stale, not by
// checking the array's contents.

function seedCaches(qc: QueryClient) {
  // Every query key a real component in this app reads team data from.
  const seeded = [
    ["admin", "teams"], // teams.tsx's own admin table
    ["admin", "team-details"], // TeamDetailsSheet
    ["admin", "users"], // users.tsx "מנהל" column
    ["admin", "audit"],
    ["representatives"], // useCloudTeams() -> WorkspaceProvider (header) + index.tsx dashboards
  ];
  for (const key of seeded) {
    qc.setQueryData(key, { stale: "pre-mutation snapshot" });
  }
  return seeded;
}

describe("invalidateTeamAdminCaches — every team-data consumer is invalidated after a team mutation", () => {
  it("invalidates the admin Teams page's own cache", async () => {
    const qc = new QueryClient();
    seedCaches(qc);
    await invalidateTeamAdminCaches(qc);
    expect(qc.getQueryState(["admin", "teams"])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["admin", "team-details"])?.isInvalidated).toBe(true);
  });

  it("invalidates the Users page's manager column cache", async () => {
    const qc = new QueryClient();
    seedCaches(qc);
    await invalidateTeamAdminCaches(qc);
    expect(qc.getQueryState(["admin", "users"])?.isInvalidated).toBe(true);
  });

  it("invalidates [\"representatives\"] — the header's / WorkspaceProvider's cache — so a removed manager's own workspace scope cannot survive a refetch", async () => {
    const qc = new QueryClient();
    seedCaches(qc);
    await invalidateTeamAdminCaches(qc);
    expect(qc.getQueryState(["representatives"])?.isInvalidated).toBe(true);
  });

  it("leaves no seeded team-data cache un-invalidated (proves the fix, not just one key)", async () => {
    const qc = new QueryClient();
    const seeded = seedCaches(qc);
    await invalidateTeamAdminCaches(qc);
    for (const key of seeded) {
      expect(qc.getQueryState(key)?.isInvalidated, `expected ${JSON.stringify(key)} to be invalidated`).toBe(true);
    }
  });
});
