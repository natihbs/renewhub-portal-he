import { useMemo } from "react";
import { useCloudCollection } from "@/lib/cloud-hooks";
import { currentMonthStart } from "@/lib/kpi-values";

// Read-side access to the official monthly target system (team_goals /
// representative_goals). Reads go through the same generic, RLS-scoped
// cloud-collection reader every other per-user/per-team table in this app
// already uses (feedback, competitions, kpi_values, ...) — RLS alone (see
// the goals migration) is the real boundary, so there is no bespoke
// server-function needed just to read. Writes (which need cross-row
// validation beyond plain RLS — batch save, copy-with-preview) go through
// src/lib/goals.functions.ts instead.

export type TeamGoalRow = { id: string; team_id: string; goal_month: string; target_value: number };
export type RepresentativeGoalRow = { id: string; representative_id: string; goal_month: string; target_value: number };

/**
 * First day of the current calendar month — the "current" goal period every
 * dashboard/consumer reads by default. Re-exported from kpi-values.ts's
 * currentMonthStart rather than redefining "start of month" a second time.
 */
export const currentGoalMonth = currentMonthStart;

/**
 * Official monthly target for one team, for the given month (defaults to the
 * current month). `targetValue` is null when no official target has been
 * set for that team/month — every caller must treat that as genuinely
 * missing, never silently as zero or as a sum of representative targets.
 */
export function useTeamGoal(teamId: string | null | undefined, month: string = currentGoalMonth()) {
  const goals = useCloudCollection<TeamGoalRow>("team_goals", {
    eq: teamId ? { team_id: teamId, goal_month: month } : undefined,
    enabled: !!teamId,
  });
  return {
    targetValue: (goals.rows[0]?.target_value as number | undefined) ?? null,
    isLoading: goals.isLoading,
    isError: goals.isError,
  };
}

/**
 * Official monthly targets for a set of teams, for the given month. Returns
 * a Map so callers can look up "does this team have a target" without
 * re-filtering an array per row — a team absent from the map has no
 * official target for this month, never assume 0 or fall back to summing
 * its representatives' targets.
 */
export function useTeamGoals(teamIds: string[], month: string = currentGoalMonth()) {
  const ids = useMemo(() => [...teamIds].sort(), [teamIds]);
  const goals = useCloudCollection<TeamGoalRow>("team_goals", {
    in: ids.length > 0 ? { team_id: ids } : undefined,
    eq: { goal_month: month },
    enabled: ids.length > 0,
  });
  const goalsByTeamId = useMemo(
    () => new Map(goals.rows.map((g) => [g.team_id, g.target_value])),
    [goals.rows],
  );
  return { goalsByTeamId, isLoading: goals.isLoading, isError: goals.isError };
}

/**
 * Official monthly targets for a set of representatives, for the given
 * month. Returns a Map so callers can look up "does this rep have a target"
 * without re-filtering an array per row — a representative absent from the
 * map has no official target for this month, never assume 0.
 */
export function useRepresentativeGoals(repIds: string[], month: string = currentGoalMonth()) {
  const ids = useMemo(() => [...repIds].sort(), [repIds]);
  const goals = useCloudCollection<RepresentativeGoalRow>("representative_goals", {
    in: ids.length > 0 ? { representative_id: ids } : undefined,
    eq: { goal_month: month },
    enabled: ids.length > 0,
  });
  const goalsByRepId = useMemo(
    () => new Map(goals.rows.map((g) => [g.representative_id, g.target_value])),
    [goals.rows],
  );
  return { goalsByRepId, isLoading: goals.isLoading, isError: goals.isError };
}

/** Official monthly target for exactly one representative. */
export function useRepresentativeGoal(repId: string | null | undefined, month: string = currentGoalMonth()) {
  const { goalsByRepId, isLoading, isError } = useRepresentativeGoals(repId ? [repId] : [], month);
  return { targetValue: repId ? goalsByRepId.get(repId) ?? null : null, isLoading, isError };
}
