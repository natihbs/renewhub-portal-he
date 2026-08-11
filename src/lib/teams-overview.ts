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
