import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useAppMode } from "@/lib/app-mode";
import { useVisibleTeams } from "@/lib/teams-hooks";
import { useBusinessScope } from "@/lib/business-scope-hooks";

/**
 * Workspace = the operational scope the current screen should be read/filtered
 * against. This is a generic "organization | team" model, not a domain-specific
 * (vehicle/home/renewals) one — see the Product UX Audit for why. It's designed
 * to extend to a future third variant (e.g. a business unit) without a redesign:
 * add a case to this union, add it to WorkspaceOption, nothing else changes shape.
 *
 * SECURITY: this is a client-side UX convenience only, exactly like the local
 * per-page `teamFilter` state it replaces — it narrows what an already
 * RLS-scoped dataset *displays*, never what a query is allowed to *return*.
 * RLS remains the only real authorization boundary; nothing here should ever
 * be treated as one.
 */
export type Workspace =
  | { type: "org" }
  | { type: "team"; teamId: string; teamName: string };

export type WorkspaceOption =
  | { type: "org"; label: string }
  | { type: "team"; teamId: string; label: string; active: boolean };

type Ctx = {
  workspace: Workspace;
  /** Every workspace this user may switch into. 0 or 1 entries => no switcher should render (locked or not applicable). */
  options: WorkspaceOption[];
  setWorkspaceTeam: (teamId: string) => void;
  setWorkspaceOrg: () => void;
  /** False until real team data has loaded — avoids a flash of the wrong scope. */
  ready: boolean;
};

const WorkspaceCtx = createContext<Ctx | null>(null);

export const ORG_WORKSPACE_LABEL = "🌍 כלל הארגון";

/** Converts a Workspace into the "all" | teamId shape most pages already filter by. */
export function workspaceTeamId(workspace: Workspace): "all" | string {
  return workspace.type === "org" ? "all" : workspace.teamId;
}

export type WorkspaceTeamInput = { id: string; name: string; managerId: string | null; active: boolean };

/**
 * Pure derivation of "which workspaces can this user switch into" — the actual
 * role rules from the sprint spec, factored out so they're unit-testable
 * without mounting the provider:
 *  - System Administrator: entire organization + every team, including
 *    inactive ones (P2a — deactivating a team must not make its history
 *    unreachable; the UI marks it with a "מושבת" badge, see WorkspaceOption.active).
 *  - Manager: the teams they personally manage via teams.manager_id (never
 *    every team RLS happens to let them read — e.g. one they're merely a
 *    member of), including an inactive team they manage — otherwise a manager
 *    whose only team gets deactivated would lose all workspace access — PLUS
 *    any teams covered by a granted business scope (מוקד/פעילות/סמנכ"ל; see
 *    business-scope.ts). A manager with no grants gets exactly the
 *    manager_id set, unchanged.
 *  - Representative / Demo Mode: no switcher at all.
 */
export function computeWorkspaceOptions(params: {
  isAdmin: boolean;
  isManager: boolean;
  isRepresentative: boolean;
  isDemo: boolean;
  userId: string | null;
  teams: WorkspaceTeamInput[];
  /** Team ids covered by the user's resolved business scope (may be empty). */
  scopeTeamIds?: string[];
}): WorkspaceOption[] {
  const { isAdmin, isManager, isRepresentative, isDemo, userId, teams } = params;
  const scopeIds = new Set(params.scopeTeamIds ?? []);
  if (isDemo || isRepresentative) return [];
  if (isAdmin) {
    return [
      { type: "org", label: ORG_WORKSPACE_LABEL },
      ...teams.map((t) => ({ type: "team" as const, teamId: t.id, label: t.name, active: t.active })),
    ];
  }
  if (isManager) {
    return teams
      .filter((t) => t.managerId === userId || scopeIds.has(t.id))
      .map((t) => ({ type: "team" as const, teamId: t.id, label: t.name, active: t.active }));
  }
  return [];
}

export const NO_MANAGED_TEAM_LABEL = "לא הוגדר צוות לניהול";
export const TEAM_SCOPE_LOADING_LABEL = "טוען נתוני צוות…";

/**
 * The scope line under "שלום, {name}" on a manager's home. Resolution order:
 *
 *  1. A selected team workspace → that team's name (the switcher and the
 *     header can never contradict each other).
 *  2. Workspace not resolved yet (provider default effect hasn't run, or the
 *     context isn't ready) but the user manages at least one team — by
 *     teams.manager_id, NEVER profiles.team_id — → the first managed team,
 *     which is exactly the team the provider is about to select by default.
 *  3. Genuinely zero managed teams, once team data has loaded → the honest
 *     warning. While still loading, a neutral loading label — "no team" is a
 *     claim about the world and must not be made before the data that could
 *     refute it has arrived.
 *
 * Display only: permissions never flow from this label, and profiles.team_id
 * (profile membership) is not an input at all.
 */
export function managerScopeLabel(params: {
  workspace: Workspace;
  managedTeams: { name: string }[];
  ready: boolean;
}): string {
  if (params.workspace.type === "team") return params.workspace.teamName;
  if (params.managedTeams.length > 0) return params.managedTeams[0].name;
  return params.ready ? NO_MANAGED_TEAM_LABEL : TEAM_SCOPE_LOADING_LABEL;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { isAdmin, isManager, isRepresentative, user } = useAuth();
  const { isDemo } = useAppMode();
  const { teams, isLoading } = useVisibleTeams();
  // Additive business scope (מוקד/פעילות/סמנכ"ל) — widens which teams a
  // manager may switch into; a manager with no grants resolves to exactly
  // their teams.manager_id set (see business-scope.ts).
  const { scope } = useBusinessScope();
  const scopeTeamIds = useMemo(() => scope?.teamIds ?? [], [scope]);

  const managedTeams = useMemo(() => {
    const scopeIds = new Set(scopeTeamIds);
    return teams.filter(
      (t) => isManager && !isAdmin && (t.managerId === user?.id || scopeIds.has(t.id)),
    );
  }, [teams, isManager, isAdmin, user, scopeTeamIds]);

  const options: WorkspaceOption[] = useMemo(
    () =>
      computeWorkspaceOptions({
        isAdmin,
        isManager,
        isRepresentative,
        isDemo,
        userId: user?.id ?? null,
        teams,
        scopeTeamIds,
      }),
    [isAdmin, isManager, isRepresentative, isDemo, user, teams, scopeTeamIds],
  );

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [selectedOrg, setSelectedOrg] = useState(false);

  // Defaults: an admin starts scoped to the entire organization; a manager
  // starts on their first (or only) managed team — never "all teams", since a
  // manager has no use for an org-wide view. Nothing to resolve for a
  // representative — they never see a switcher and never consume `workspace`.
  useEffect(() => {
    if (isDemo || selectedTeamId || selectedOrg) return;
    if (isAdmin) {
      setSelectedOrg(true);
    } else if (isManager && managedTeams.length > 0) {
      setSelectedTeamId(managedTeams[0].id);
    }
  }, [isDemo, isAdmin, isManager, managedTeams, selectedTeamId, selectedOrg]);

  // If a manager's set of managed teams changes (e.g. reassigned) and their
  // current selection is no longer in it, fall back to the first available
  // team rather than silently keep showing a team they no longer manage.
  useEffect(() => {
    if (isDemo || isAdmin || !isManager || !selectedTeamId) return;
    if (managedTeams.some((t) => t.id === selectedTeamId)) return;
    setSelectedTeamId(managedTeams[0]?.id ?? null);
  }, [isDemo, isAdmin, isManager, managedTeams, selectedTeamId]);

  const workspace: Workspace = useMemo(() => {
    if (isAdmin && selectedOrg) return { type: "org" };
    if (selectedTeamId) {
      const t = teams.find((x) => x.id === selectedTeamId);
      if (t) return { type: "team", teamId: t.id, teamName: t.name };
    }
    return { type: "org" };
  }, [isAdmin, selectedOrg, selectedTeamId, teams]);

  const value: Ctx = useMemo(
    () => ({
      workspace,
      options,
      setWorkspaceTeam: (teamId: string) => { setSelectedTeamId(teamId); setSelectedOrg(false); },
      setWorkspaceOrg: () => { if (isAdmin) { setSelectedOrg(true); setSelectedTeamId(null); } },
      ready: !isLoading,
    }),
    [workspace, options, isAdmin, isLoading],
  );

  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) {
    return { workspace: { type: "org" } as Workspace, options: [], setWorkspaceTeam: () => {}, setWorkspaceOrg: () => {}, ready: false };
  }
  return ctx;
}
