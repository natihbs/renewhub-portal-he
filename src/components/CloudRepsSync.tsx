import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useApp } from "@/lib/store";
import { useAppMode } from "@/lib/app-mode";
import { useAuth } from "@/lib/auth";
import { listRepresentatives } from "@/lib/rep-admin.functions";
import { UNASSIGNED_TEAM_LABEL } from "@/lib/seed";

/**
 * In Live Mode representatives come from the cloud only — the local demo seed
 * is replaced by whatever the signed-in user is allowed to see (RLS scoped).
 * Demo Mode keeps its own local store untouched.
 */
export function CloudRepsSync() {
  const { mode } = useAppMode();
  const { user } = useAuth();
  const { replaceReps } = useApp();
  const load = useServerFn(listRepresentatives);

  const { data } = useQuery({
    queryKey: ["representatives"],
    queryFn: () => load(),
    enabled: mode === "live" && !!user,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (mode !== "live" || !data) return;
    replaceReps(
      data.reps
        .filter((r) => r.active)
        .map((r) => ({
          id: r.id,
          name: r.name,
          teamId: r.team_id,
          teamName: r.team_name ?? UNASSIGNED_TEAM_LABEL,
          monthlyTarget: r.monthly_target,
          currentResult: r.current_result,
          lastUpdatedAt: r.updated_at,
        })),
    );
  }, [mode, data, replaceReps]);

  return null;
}
