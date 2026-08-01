import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAppMode } from "@/lib/app-mode";
import { useAuth } from "@/lib/auth";
import { listRepresentatives } from "@/lib/rep-admin.functions";

export type CloudTeam = { id: string; name: string; active: boolean };

/**
 * Every active team visible to the signed-in user under RLS (admins see all
 * teams, managers see their own). Used by every "assign a representative to
 * a team" picker so newly-created teams show up immediately, even before any
 * representative has been assigned to them yet.
 *
 * Shares the exact query key/fn used by CloudRepsSync, so this never causes
 * an extra network round trip beyond the one the app already makes.
 */
export function useCloudTeams() {
  const { isDemo } = useAppMode();
  const { user } = useAuth();
  const load = useServerFn(listRepresentatives);

  const query = useQuery({
    queryKey: ["representatives"],
    queryFn: () => load(),
    enabled: !isDemo && !!user,
    staleTime: 30_000,
  });

  const teams: CloudTeam[] = (query.data?.teams ?? []).filter((t) => t.active);
  return { teams, isLoading: query.isLoading };
}
