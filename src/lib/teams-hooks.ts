import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAppMode } from "@/lib/app-mode";
import { useAuth } from "@/lib/auth";
import { listRepresentatives } from "@/lib/rep-admin.functions";
import { DEFAULT_KPI_PROFILE, type KpiProfile } from "@/lib/performance-domain";

export type CloudTeam = { id: string; name: string; active: boolean; kpiProfile: KpiProfile; managerId: string | null };

type RawTeam = { id: string; name: string; active: boolean; kpi_profile: string; manager_id: string | null };

/**
 * Pure projection + active/inactive gate, factored out of useCloudTeams so
 * the P2a filtering rule (inactive teams excluded unless includeInactive) is
 * directly unit-testable without mounting a query client / auth provider.
 */
export function filterVisibleTeams(rawTeams: RawTeam[], includeInactive: boolean): CloudTeam[] {
  return rawTeams
    .filter((t) => includeInactive || t.active)
    .map((t) => ({
      id: t.id,
      name: t.name,
      active: t.active,
      kpiProfile: (t.kpi_profile === "renewals" ? "renewals" : DEFAULT_KPI_PROFILE) as KpiProfile,
      managerId: t.manager_id,
    }));
}

/**
 * Every team visible to the signed-in user under RLS (admins see all teams,
 * managers see their own), active by default — an inactive team is unavailable
 * for new assignments, so callers that populate an assignment picker (assign a
 * representative to a team, transfer a user, import resolution) should use
 * this default. Pass `includeInactive: true` (or use `useVisibleTeams` below)
 * for read/history contexts — Workspace, Dashboard, Targets, Performance,
 * Communications — where a deactivated team's past data must stay reachable
 * (see the Teams Operational Hardening sprint, P2a). Never use includeInactive
 * to populate a picker whose selection creates a new assignment.
 *
 * Shares the exact query key/fn used by CloudRepsSync, so this never causes
 * an extra network round trip beyond the one the app already makes.
 */
export function useCloudTeams(options?: { includeInactive?: boolean }) {
  const { isDemo } = useAppMode();
  const { user } = useAuth();
  const load = useServerFn(listRepresentatives);
  const includeInactive = options?.includeInactive ?? false;

  const query = useQuery({
    queryKey: ["representatives"],
    queryFn: () => load(),
    enabled: !isDemo && !!user,
    staleTime: 30_000,
  });

  const teams: CloudTeam[] = filterVisibleTeams((query.data?.teams ?? []) as RawTeam[], includeInactive);
  return { teams, isLoading: query.isLoading };
}

/**
 * Active-only teams, explicitly — for call sites that want to be unambiguous
 * that they're populating a new-assignment picker (the current default
 * behavior of useCloudTeams()).
 */
export function useActiveTeams() {
  return useCloudTeams();
}

/**
 * Every team visible to this user, including inactive ones — for read/history
 * screens where a deactivated team's past data must stay reachable (Workspace,
 * Dashboard, Targets, Performance, Communications). Never use this to
 * populate an assignment picker — a deactivated team must not be offered for
 * new assignments (see useCloudTeams/useActiveTeams).
 */
export function useVisibleTeams() {
  return useCloudTeams({ includeInactive: true });
}
