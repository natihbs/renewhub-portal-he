// Teams-page overview derivations — pure, dependency-free, unit-tested.
//
// Every figure here is a COUNT over the team rows the page already loaded
// (listTeams). Nothing is fetched, inferred or estimated: there is no
// performance metric on this page, because /teams is an administration
// surface and the teams list carries no targets or results. A count that
// cannot be derived from TeamRow does not belong here.

import { DEFAULT_KPI_PROFILE, type KpiProfile } from "@/lib/performance-domain";

/** The subset of a listTeams row these derivations read. */
export type TeamsOverviewInput = {
  active: boolean;
  manager_id: string | null;
  kpi_profile: KpiProfile | null;
  member_count: number;
  rep_count: number;
};

export type TeamsOverviewSummary = {
  total: number;
  active: number;
  inactive: number;
  /**
   * Teams with no teams.manager_id. Counted over ALL teams — an unmanaged
   * empty team is still unmanaged; the attention badge on a row is what
   * distinguishes "unmanaged but staffed" (see withoutManagerStaffed).
   */
  withoutManager: number;
  /** Unmanaged teams that actually have members — the actionable subset. */
  withoutManagerStaffed: number;
  /** Sum of representatives across the listed teams. */
  representatives: number;
  /** Sum of login-account members across the listed teams. */
  members: number;
  /** Per-KPI-profile team counts; a null profile counts as the default. */
  byProfile: Record<KpiProfile, number>;
};

/**
 * The manager-filter sentinel for "teams with no manager at all" — a filter
 * VALUE, not a manager id. Exported so the page and this module can never
 * drift apart on the literal.
 */
export const NO_MANAGER_FILTER = "__none__";

/** The subset of a listTeams row the filter/sort reads. */
export type TeamsFilterRow = {
  name: string;
  department: string | null;
  description: string | null;
  manager_id: string | null;
  active: boolean;
  kpi_profile: KpiProfile | null;
  created_at: string;
  member_count: number;
};

export type TeamsFilterState = {
  search: string;
  /** "all" | "active" | "inactive" */
  statusFilter: string;
  /** "all" | NO_MANAGER_FILTER | a specific manager's user id */
  managerFilter: string;
  profileFilter: "all" | KpiProfile;
  sortBy: "name" | "created" | "members";
};

/**
 * The /teams list view: the page's five controls applied to the rows the page
 * already loaded. Extracted from the route component UNCHANGED (same predicate
 * order, same search fields, same comparators) purely so the rule is unit
 * tested rather than only visually verified.
 *
 * It filters and sorts what the caller already holds — it is not a permission
 * boundary, adds no data source, and knows nothing about the business
 * hierarchy: there is deliberately no business-unit filter on this page.
 * The manager NAME used by the search is resolved by the caller, because only
 * the page holds the people index.
 */
export function filterAndSortTeams<T extends TeamsFilterRow>(
  teams: T[],
  filters: TeamsFilterState,
  resolveManagerName: (managerId: string) => string,
): T[] {
  const { search, statusFilter, managerFilter, profileFilter, sortBy } = filters;
  const q = search.trim().toLowerCase();
  let rows = teams.filter((t) => {
    if (q) {
      const mgr = t.manager_id ? resolveManagerName(t.manager_id) : "";
      const hay = `${t.name} ${t.department ?? ""} ${t.description ?? ""} ${mgr}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (statusFilter === "active" && !t.active) return false;
    if (statusFilter === "inactive" && t.active) return false;
    if (managerFilter === NO_MANAGER_FILTER && t.manager_id) return false;
    if (
      managerFilter !== "all" &&
      managerFilter !== NO_MANAGER_FILTER &&
      t.manager_id !== managerFilter
    )
      return false;
    if (profileFilter !== "all" && (t.kpi_profile ?? DEFAULT_KPI_PROFILE) !== profileFilter)
      return false;
    return true;
  });
  rows = [...rows].sort((a, b) => {
    if (sortBy === "created") return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    if (sortBy === "members") return b.member_count - a.member_count;
    return a.name.localeCompare(b.name, "he");
  });
  return rows;
}

export function summarizeTeams(teams: TeamsOverviewInput[]): TeamsOverviewSummary {
  const byProfile: Record<KpiProfile, number> = { renewals: 0, generic_sales: 0 };
  let active = 0;
  let withoutManager = 0;
  let withoutManagerStaffed = 0;
  let representatives = 0;
  let members = 0;
  for (const t of teams) {
    if (t.active) active += 1;
    if (!t.manager_id) {
      withoutManager += 1;
      if (t.member_count > 0) withoutManagerStaffed += 1;
    }
    representatives += t.rep_count;
    members += t.member_count;
    byProfile[t.kpi_profile ?? DEFAULT_KPI_PROFILE] += 1;
  }
  return {
    total: teams.length,
    active,
    inactive: teams.length - active,
    withoutManager,
    withoutManagerStaffed,
    representatives,
    members,
    byProfile,
  };
}
