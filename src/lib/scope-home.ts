// Scope-level home dashboard domain — pure, dependency-free, unit-tested.
//
// A business-scope manager (מנהל מוקד / מנהל פעילות / סמנכ"ל) is a first-class
// manager whose reach comes from user_business_scopes, not from a single
// teams.manager_id row. Their home screen therefore leads with the TEAMS in
// their scope — grouped by the hierarchy level they manage — and only then
// drills into one selected team. This module holds every derivation for that
// view, for the usual reason: one implementation that is tested cannot drift
// between the card that shows a number and the card that summarises it.
//
// Two standing rules from home-domain.ts apply here too:
//   * a count is never shown without its denominator;
//   * an unknown is never rendered as a zero — a team without an official
//     target has pct null, not 0%, and is excluded from aggregate rates
//     rather than dragging them down.
//
// KPI-profile awareness: scope teams are NOT all renewals. Each team row is
// labeled by its own teams.kpi_profile, and aggregates are computed PER
// PROFILE — a renewals book and a generic sales target are different units
// and are never summed into one misleading total.

import type { BusinessUnit } from "@/lib/business-scope";
import { BUSINESS_UNIT_TYPE_LABEL } from "@/lib/business-scope";
import { calculateAchievement, type KpiProfile } from "@/lib/performance-domain";
import { calculateAssignedRenewalRate } from "@/lib/renewal-rate";
import { ASSIGNED_RENEWALS_LABEL, CLOSED_RENEWALS_LABEL } from "@/lib/renewal-rate";

// ------------------------------------------------------------------ labels

/** Per-profile metric wording — the row and the aggregate speak the team's own business language. */
export const SCOPE_METRIC_LABELS: Record<
  KpiProfile,
  { target: string; result: string; rate: string }
> = {
  renewals: {
    target: ASSIGNED_RENEWALS_LABEL,
    result: CLOSED_RENEWALS_LABEL,
    rate: "אחוז חידוש",
  },
  generic_sales: { target: "יעד", result: "ביצוע", rate: "אחוז עמידה" },
};

export const SCOPE_TEAMS_TITLE = "צוותים בהיקף הניהול";
export const SCOPE_MISSING_TARGETS_TITLE = "יעדים חסרים לפי צוות";
export const SCOPE_NO_TEAMS_MESSAGE =
  "אין צוותים משויכים להיקף הניהול. שיוך צוותים למוקד מתבצע בעמוד הצוותים.";
export const SCOPE_DIRECT_ACTIVITY_GROUP_LABEL = "משויכים ישירות לפעילות";
export const SCOPE_UNATTACHED_GROUP_LABEL = "ללא שיוך להיררכיה";
export const SCOPE_SELECTED_TEAM_SECTION_TITLE = "פירוט הצוות הנבחר";
export const SCOPE_SELECT_TEAM_HINT = "בחרו צוות בבורר שבסרגל העליון לפירוט ברמת הנציגים.";

/** "יעדי הצוות" assumes one team; a scope manager gets the plural. */
export const TEAM_TARGETS_ACTION_LABEL = "יעדי הצוות";
export const SCOPE_TARGETS_ACTION_LABEL = "יעדי צוותים";

export const SCOPED_MANAGER_KINDS = ["center", "activity", "executive"] as const;
export type ScopedManagerKind = (typeof SCOPED_MANAGER_KINDS)[number];

export function isScopedManagerKind(kind: string | null | undefined): kind is ScopedManagerKind {
  return kind === "center" || kind === "activity" || kind === "executive";
}

/**
 * The primary identity line of a manager's home header.
 *
 * A business-scope manager shows their business title ("מנהל מוקד · דירות
 * וחידושים") — NEVER the "לא הוגדר צוות לניהול" warning, because having no
 * profile team and no direct teams.manager_id rows is a VALID setup for them.
 * Everyone else keeps the existing workspace-derived label unchanged
 * (selected team name, or the honest warning for a manager with nothing).
 */
export function managerHeaderPrimaryLine(
  scope: { kind: string; title: string } | null,
  fallbackLabel: string,
): string {
  return scope && isScopedManagerKind(scope.kind) ? scope.title : fallbackLabel;
}

// ------------------------------------------------------------- team rows

export type ScopeHomeTeamInput = {
  id: string;
  name: string;
  kpiProfile: KpiProfile;
  businessUnitId: string | null;
};

export type ScopeRepLike = {
  id: string;
  teamId: string | null;
  currentResult: number;
};

export type ScopeTeamRow = {
  id: string;
  name: string;
  kpiProfile: KpiProfile;
  businessUnitId: string | null;
  repCount: number;
  /** Representatives in this team with no positive official monthly target. */
  missingTargets: number;
  /** The team's official monthly target (renewals: the assigned book), or null. */
  target: number | null;
  /** Sum of the team's representatives' current results. */
  completed: number;
  /** אחוז חידוש / אחוז עמידה — null whenever there is no target denominator. */
  pct: number | null;
};

/**
 * One row per scope team. The rate is computed by the team's OWN profile:
 * renewals through calculateAssignedRenewalRate (closed/assigned), generic
 * through calculateAchievement — and stays null without a target, because a
 * missing denominator is a missing target, not a 0% performance.
 */
export function buildScopeTeamRows(params: {
  teams: ScopeHomeTeamInput[];
  reps: ScopeRepLike[];
  goalsByTeamId: Map<string, number>;
  goalsByRepId: Map<string, number>;
}): ScopeTeamRow[] {
  const { teams, reps, goalsByTeamId, goalsByRepId } = params;
  return teams
    .map((team) => {
      const teamReps = reps.filter((r) => r.teamId === team.id);
      const completed = teamReps.reduce((a, r) => a + r.currentResult, 0);
      const target = goalsByTeamId.get(team.id) ?? null;
      const missingTargets = teamReps.filter((r) => {
        const g = goalsByRepId.get(r.id);
        return g === undefined || g <= 0;
      }).length;
      let pct: number | null = null;
      if (team.kpiProfile === "renewals") {
        const rate = calculateAssignedRenewalRate("renewals", completed, target);
        pct = rate.available ? rate.pct : null;
      } else if (target !== null && target > 0) {
        pct = calculateAchievement(completed, target);
      }
      return {
        id: team.id,
        name: team.name,
        kpiProfile: team.kpiProfile,
        businessUnitId: team.businessUnitId,
        repCount: teamReps.length,
        missingTargets,
        target,
        completed,
        pct,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "he"));
}

// ------------------------------------------------- missing targets by team

export type MissingTargetsRow = {
  teamId: string;
  teamName: string;
  missing: number;
  repCount: number;
  /** "חידושי רכב · 9 נציגים ללא יעד" — the actionable per-team line. */
  line: string;
};

/**
 * Missing representative targets, grouped BY TEAM — "9 נציגים ללא יעד" as one
 * org-wide number is numerically true but tells a center manager nothing
 * about where to act. Teams with the most gaps first; complete teams are
 * listed too (their "0" is the good news and the denominator).
 */
export function missingTargetsByTeam(rows: ScopeTeamRow[]): MissingTargetsRow[] {
  return [...rows]
    .sort((a, b) =>
      a.missingTargets === b.missingTargets
        ? a.name.localeCompare(b.name, "he")
        : b.missingTargets - a.missingTargets,
    )
    .map((r) => ({
      teamId: r.id,
      teamName: r.name,
      missing: r.missingTargets,
      repCount: r.repCount,
      line: `${r.name} · ${r.missingTargets} נציגים ללא יעד`,
    }));
}

// -------------------------------------------------------- hierarchy groups

export type ScopeSubgroup = { key: string; label: string; rows: ScopeTeamRow[] };

export type ScopeGroup = {
  key: string;
  /** null = flat listing (a center manager needs no group headers). */
  label: string | null;
  rows: ScopeTeamRow[];
  /** Only the executive view nests (activity → its centers). */
  subgroups?: ScopeSubgroup[];
};

const withTypeWord = (name: string, typeWord: string) =>
  name.startsWith(typeWord) ? name : `${typeWord} ${name}`;

/**
 * The grouping each scope level actually manages by:
 *   center    → flat team rows (the center IS the group);
 *   activity  → teams grouped by center, plus directly-attached teams;
 *   executive → activities, each with its centers as subgroups, plus teams
 *               outside the hierarchy (an executive covers ALL teams, and
 *               hiding the unattached ones would silently shrink the total).
 * Empty groups are dropped — a header over nothing is noise, not structure.
 */
export function groupScopeRows(params: {
  kind: ScopedManagerKind;
  rows: ScopeTeamRow[];
  units: BusinessUnit[];
}): ScopeGroup[] {
  const { kind, rows, units } = params;
  if (kind === "center") {
    return rows.length > 0 ? [{ key: "all", label: null, rows }] : [];
  }

  const unitById = new Map(units.map((u) => [u.id, u]));
  const centerLabel = (u: BusinessUnit) => withTypeWord(u.name, BUSINESS_UNIT_TYPE_LABEL.center);
  const activityLabel = (u: BusinessUnit) =>
    withTypeWord(u.name, BUSINESS_UNIT_TYPE_LABEL.activity);
  const rowsByUnit = (unitId: string | null) => rows.filter((r) => r.businessUnitId === unitId);

  if (kind === "activity") {
    const centers = units.filter((u) => u.unitType === "center");
    const groups: ScopeGroup[] = [];
    for (const center of centers) {
      const centerRows = rowsByUnit(center.id);
      if (centerRows.length > 0) {
        groups.push({ key: center.id, label: centerLabel(center), rows: centerRows });
      }
    }
    // Teams attached straight to the activity (legacy attachments): still in
    // scope, shown under an honest header rather than invented into a center.
    const direct = rows.filter((r) => {
      const unit = r.businessUnitId ? unitById.get(r.businessUnitId) : undefined;
      return unit?.unitType === "activity";
    });
    if (direct.length > 0) {
      groups.push({ key: "direct", label: SCOPE_DIRECT_ACTIVITY_GROUP_LABEL, rows: direct });
    }
    return groups;
  }

  // Executive: activity → centers, then the outside-the-hierarchy remainder.
  const groups: ScopeGroup[] = [];
  const activities = units.filter((u) => u.unitType === "activity");
  for (const activity of activities) {
    const directRows = rowsByUnit(activity.id);
    const subgroups: ScopeSubgroup[] = [];
    for (const center of units.filter(
      (u) => u.unitType === "center" && u.parentId === activity.id,
    )) {
      const centerRows = rowsByUnit(center.id);
      if (centerRows.length > 0) {
        subgroups.push({ key: center.id, label: centerLabel(center), rows: centerRows });
      }
    }
    if (directRows.length > 0 || subgroups.length > 0) {
      groups.push({
        key: activity.id,
        label: activityLabel(activity),
        rows: directRows,
        subgroups,
      });
    }
  }
  const unattached = rows.filter((r) => !r.businessUnitId || !unitById.has(r.businessUnitId));
  if (unattached.length > 0) {
    groups.push({ key: "unattached", label: SCOPE_UNATTACHED_GROUP_LABEL, rows: unattached });
  }
  return groups;
}

// ---------------------------------------------------- per-profile aggregates

export type ScopeProfileAggregate = {
  kpiProfile: KpiProfile;
  teamCount: number;
  /** Teams that actually have an official target — the rate's denominator population. */
  teamsWithTarget: number;
  /** Sum of official targets over teams that have one; null when none has. */
  target: number | null;
  /** Sum of results over ALL teams of this profile (results exist regardless of targets). */
  completed: number;
  /**
   * Aggregate rate = results of TARGETED teams / their summed target. Teams
   * without a target are excluded from both sides — including their results
   * against a partial denominator would inflate the rate.
   */
  pct: number | null;
};

/**
 * One aggregate PER KPI PROFILE, renewals first. A mixed scope gets two
 * clearly-separated aggregates; renewals and generic sales are never summed
 * into a single figure because "מיועדות" and "יעד" are different units.
 */
export function aggregateByProfile(rows: ScopeTeamRow[]): ScopeProfileAggregate[] {
  const order: KpiProfile[] = ["renewals", "generic_sales"];
  const out: ScopeProfileAggregate[] = [];
  for (const profile of order) {
    const profileRows = rows.filter((r) => r.kpiProfile === profile);
    if (profileRows.length === 0) continue;
    const targeted = profileRows.filter((r) => r.target !== null && r.target > 0);
    const targetSum = targeted.reduce((a, r) => a + (r.target ?? 0), 0);
    const completedOfTargeted = targeted.reduce((a, r) => a + r.completed, 0);
    out.push({
      kpiProfile: profile,
      teamCount: profileRows.length,
      teamsWithTarget: targeted.length,
      target: targeted.length > 0 ? targetSum : null,
      completed: profileRows.reduce((a, r) => a + r.completed, 0),
      pct: targetSum > 0 ? (completedOfTargeted / targetSum) * 100 : null,
    });
  }
  return out;
}
