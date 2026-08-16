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
/** A center manager manages TEAMS — their primary board says so. */
export const CENTER_TEAMS_TITLE = "מצב הצוותים";
/** An activity manager manages CENTERS — their primary board says so. */
export const ACTIVITY_CENTERS_TITLE = "מצב המוקדים";
/** An executive manages ACTIVITIES — their primary board says so. */
export const EXECUTIVE_ACTIVITIES_TITLE = "מבט על הפעילויות";
/** Honest structural empty state for a business with no activity units yet. */
export const EXECUTIVE_NO_ACTIVITIES_MESSAGE =
  "לא הוגדרו פעילויות בהיררכיה העסקית. הגדרת פעילויות ומוקדים מתבצעת בעמוד הצוותים.";
/** Honest structural empty state for a center unit with no teams attached. */
export const CENTER_NO_TEAMS_MESSAGE = "אין צוותים משויכים למוקד";
export const ACTIVITY_NO_CENTERS_MESSAGE = "אין מוקדים משויכים לפעילות.";
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
 *   activity  → teams grouped by center, then directly-attached teams, then
 *               any covered team outside the hierarchy (e.g. also-owned via
 *               teams.manager_id with no unit attachment);
 *   executive → activities, each with its centers as subgroups, plus teams
 *               outside the hierarchy (an executive covers ALL teams, and
 *               hiding the unattached ones would silently shrink the total).
 * Every covered row appears in EXACTLY one group — nothing in scope may
 * disappear from the grouped view while still being counted in aggregates.
 * Empty groups are dropped — a header over nothing is noise, not structure.
 *
 * SCOPE OF USE: only the CENTER level still renders from this function. The
 * activity and executive screens render from buildActivityCenterBoard and
 * buildExecutiveActivityBoard, which start from the hierarchy UNITS instead of
 * from the rows — so an empty center or an empty activity survives, and a team
 * under a center that hangs off no activity lands in the unattached bucket
 * rather than being silently dropped, which is exactly what the executive
 * branch below does to it.
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
    const placed = new Set<string>();
    for (const center of centers) {
      const centerRows = rowsByUnit(center.id);
      if (centerRows.length > 0) {
        groups.push({ key: center.id, label: centerLabel(center), rows: centerRows });
        for (const r of centerRows) placed.add(r.id);
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
      for (const r of direct) placed.add(r.id);
    }
    // Covered teams with no hierarchy attachment — e.g. a team this manager
    // ALSO owns via teams.manager_id that was never attached to a unit. It is
    // in scope, in the switcher and in the aggregates, so hiding it from the
    // grouped view would silently drop a team the numbers still count.
    const unattached = rows.filter((r) => !placed.has(r.id));
    if (unattached.length > 0) {
      groups.push({ key: "unattached", label: SCOPE_UNATTACHED_GROUP_LABEL, rows: unattached });
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

// ------------------------------------------------- activity center board

/**
 * One center of an activity manager's scope, summarised at the level they
 * actually manage. Derived from the hierarchy UNITS first, so a center with
 * zero teams still exists on the board — an empty center is a real structural
 * fact, not a rendering accident. `hasTeams === false` means every
 * performance field is meaningless and the UI must show a structural empty
 * state, never 0 / 0%.
 */
export type ActivityCenterSummary = {
  centerId: string;
  /** Display name with the "מוקד" type word ("מוקד רכב"). */
  centerName: string;
  teamCount: number;
  repCount: number;
  hasTeams: boolean;
  /** This center's team rows ONLY — the drill-down population. */
  teams: ScopeTeamRow[];
  /** Per-profile aggregates over this center's teams (renewals ≠ generic). */
  profileAggregates: ScopeProfileAggregate[];
  /** Representatives in this center with no positive official target. */
  missingRepresentativeTargets: number;
};

export type ActivityCenterBoard = {
  /** Every center UNIT of the activity — including empty ones. */
  centers: ActivityCenterSummary[];
  /** Teams attached straight to the activity unit (legacy attachments). */
  directRows: ScopeTeamRow[];
  /** Covered teams with no hierarchy attachment at all. */
  unattachedRows: ScopeTeamRow[];
};

/**
 * The activity manager's primary board: starts from the activity's OWN center
 * UNITS (so empty centers render), assigns each covered team row to exactly
 * one bucket (its center / directly-on-activity / unattached), and summarises
 * each center per KPI profile. Nothing in scope is dropped and nothing empty
 * is inflated into fake performance.
 *
 * `activityUnitId` is the manager's resolved activity unit (scope.unitId) and
 * is what makes the board honest in a multi-activity organization: the units
 * list handed in is the org-wide business_units table (authenticated-readable),
 * so the board must select ONLY this activity's subtree — centers are matched
 * by `parentId === activityUnitId`, never by name. A covered team pointing at
 * a unit outside that subtree (another activity's center, or an unknown unit)
 * is NOT silently attached to that foreign center; it falls into
 * `unattachedRows`, where it stays visible and counted. Passing null (no
 * resolved unit) yields no centers — every covered row is then unattached,
 * which is the truthful reading of "we don't know this manager's activity".
 */
/**
 * One center UNIT summarised from the rows attached to it BY ID. Shared by the
 * activity board and the executive board so a center can never be summarised
 * two different ways depending on who is looking at it.
 */
function summarizeCenter(center: BusinessUnit, rows: ScopeTeamRow[]): ActivityCenterSummary {
  const teams = rows.filter((r) => r.businessUnitId === center.id);
  return {
    centerId: center.id,
    centerName: withTypeWord(center.name, BUSINESS_UNIT_TYPE_LABEL.center),
    teamCount: teams.length,
    repCount: teams.reduce((a, t) => a + t.repCount, 0),
    hasTeams: teams.length > 0,
    teams,
    profileAggregates: aggregateByProfile(teams),
    missingRepresentativeTargets: teams.reduce((a, t) => a + t.missingTargets, 0),
  };
}

export function buildActivityCenterBoard(params: {
  units: BusinessUnit[];
  rows: ScopeTeamRow[];
  activityUnitId: string | null;
}): ActivityCenterBoard {
  const { units, rows, activityUnitId } = params;
  const unitById = new Map(units.map((u) => [u.id, u]));
  const centers = units
    .filter(
      (u) => u.unitType === "center" && activityUnitId !== null && u.parentId === activityUnitId,
    )
    .map((center) => summarizeCenter(center, rows))
    .sort((a, b) => a.centerName.localeCompare(b.centerName, "he"));
  // Direct attachments count only for THIS activity — a team hanging off some
  // other activity unit is not "directly attached" from this manager's point
  // of view, it is simply outside their hierarchy subtree.
  const directRows = rows.filter((r) => {
    if (!r.businessUnitId || r.businessUnitId !== activityUnitId) return false;
    return unitById.get(r.businessUnitId)?.unitType === "activity";
  });
  const centerIds = new Set(centers.map((c) => c.centerId));
  const unattachedRows = rows.filter(
    (r) => !(r.businessUnitId && centerIds.has(r.businessUnitId)) && !directRows.includes(r),
  );
  return { centers, directRows, unattachedRows };
}

/**
 * The structural figures an activity manager leads with — how the activity is
 * BUILT, before how it performs. Counts cover the full covered population
 * (center teams + direct + unattached), so the totals always match the board
 * below them.
 */
export type ActivityStructureSummary = {
  centerCount: number;
  teamCount: number;
  repCount: number;
  centersWithoutTeams: number;
};

export function activityStructureSummary(board: ActivityCenterBoard): ActivityStructureSummary {
  const allRows = [
    ...board.centers.flatMap((c) => c.teams),
    ...board.directRows,
    ...board.unattachedRows,
  ];
  return {
    centerCount: board.centers.length,
    teamCount: allRows.length,
    repCount: allRows.reduce((a, r) => a + r.repCount, 0),
    centersWithoutTeams: board.centers.filter((c) => !c.hasTeams).length,
  };
}

// ---------------------------------------------- executive activity board

/**
 * One ACTIVITY of the business, summarised at the level an executive actually
 * manages from. Derived from the hierarchy UNITS first, so an activity with no
 * centers — and a center with no teams — is a first-class entry rather than a
 * rendering accident.
 *
 * `hasTeams === false` means every performance figure below this activity is
 * meaningless and the UI must render a structural empty state, never 0 / 0%.
 * `profileAggregates` stays PER KPI PROFILE for exactly the reason the rest of
 * this module does: a renewals book and a generic sales target are different
 * units and are never summed into one activity-wide number.
 */
export type ExecutiveActivitySummary = {
  activityId: string;
  /** Display name with the "פעילות" type word ("פעילות אלמנטרי"). */
  activityName: string;
  /** Every center UNIT whose parentId is this activity — including empty ones. */
  centers: ActivityCenterSummary[];
  /** Teams attached straight to the activity unit (legacy attachments). */
  directRows: ScopeTeamRow[];
  centerCount: number;
  centersWithoutTeams: number;
  /** Teams anywhere under this activity (its centers + directly attached). */
  teamCount: number;
  repCount: number;
  hasTeams: boolean;
  profileAggregates: ScopeProfileAggregate[];
  missingRepresentativeTargets: number;
};

export type ExecutiveActivityBoard = {
  /** Every activity UNIT of the business — including empty ones. */
  activities: ExecutiveActivitySummary[];
  /**
   * Covered teams that hang off no activity subtree: no unit at all, an
   * unknown unit, or a center whose parent is missing / is not an activity.
   * They stay visible here rather than vanishing from the board while still
   * being counted in every aggregate.
   */
  unattachedRows: ScopeTeamRow[];
};

/**
 * The executive's primary board: ACTIVITIES first, each carrying its own
 * centers, each center carrying its own teams — the hierarchy as it is built,
 * before how it performs.
 *
 * Placement is by ID and parent only; a name is never used to infer a
 * relationship. Every covered row lands in EXACTLY one bucket:
 *   * a row whose unit is a center with `parentId === activity.id` → that
 *     center, inside that activity;
 *   * a row whose unit IS an activity unit → that activity's `directRows`;
 *   * anything else (no unit, unknown unit, or a center orphaned from every
 *     activity) → `unattachedRows`.
 * The third bucket is the one the old grouped view silently dropped: a team
 * under a parentless center was neither placed nor unattached, so it
 * disappeared from the board while still inflating the totals beside it.
 *
 * An executive covers the whole business, so `units` is used in full — there
 * is no subtree to narrow to, and nothing is filtered out for being empty.
 */
export function buildExecutiveActivityBoard(params: {
  units: BusinessUnit[];
  rows: ScopeTeamRow[];
}): ExecutiveActivityBoard {
  const { units, rows } = params;
  const placed = new Set<string>();
  const activities = units
    .filter((u) => u.unitType === "activity")
    .map((activity): ExecutiveActivitySummary => {
      const centers = units
        .filter((u) => u.unitType === "center" && u.parentId === activity.id)
        .map((center) => summarizeCenter(center, rows))
        .sort((a, b) => a.centerName.localeCompare(b.centerName, "he"));
      const directRows = rows.filter((r) => r.businessUnitId === activity.id);
      for (const c of centers) for (const t of c.teams) placed.add(t.id);
      for (const r of directRows) placed.add(r.id);
      const allRows = [...centers.flatMap((c) => c.teams), ...directRows];
      return {
        activityId: activity.id,
        activityName: withTypeWord(activity.name, BUSINESS_UNIT_TYPE_LABEL.activity),
        centers,
        directRows,
        centerCount: centers.length,
        centersWithoutTeams: centers.filter((c) => !c.hasTeams).length,
        teamCount: allRows.length,
        repCount: allRows.reduce((a, r) => a + r.repCount, 0),
        hasTeams: allRows.length > 0,
        profileAggregates: aggregateByProfile(allRows),
        missingRepresentativeTargets: allRows.reduce((a, r) => a + r.missingTargets, 0),
      };
    })
    .sort((a, b) => a.activityName.localeCompare(b.activityName, "he"));
  return { activities, unattachedRows: rows.filter((r) => !placed.has(r.id)) };
}

/**
 * The structural figures an executive leads with — how the BUSINESS is built,
 * before how it performs. There is deliberately no combined achievement
 * percentage and no combined target here: the activities below may mix KPI
 * profiles, and no truthful single number spans them.
 *
 * Counts cover the full covered population (activity teams + unattached), so
 * the headline can never disagree with the board underneath it. `repCount`
 * counts ACTIVE representatives — the store's roster is filtered to active
 * rows before it ever reaches these derivations.
 */
export type ExecutiveStructureSummary = {
  activityCount: number;
  centerCount: number;
  teamCount: number;
  repCount: number;
  /** Activities carrying no center unit at all. */
  activitiesWithoutCenters: number;
  /** Center units carrying no team, across every activity. */
  centersWithoutTeams: number;
  /** Covered teams outside every activity subtree. */
  unattachedTeamCount: number;
};

export function executiveStructureSummary(
  board: ExecutiveActivityBoard,
): ExecutiveStructureSummary {
  const allRows = [
    ...board.activities.flatMap((a) => [...a.centers.flatMap((c) => c.teams), ...a.directRows]),
    ...board.unattachedRows,
  ];
  return {
    activityCount: board.activities.length,
    centerCount: board.activities.reduce((a, x) => a + x.centerCount, 0),
    teamCount: allRows.length,
    repCount: allRows.reduce((a, r) => a + r.repCount, 0),
    activitiesWithoutCenters: board.activities.filter((a) => a.centerCount === 0).length,
    centersWithoutTeams: board.activities.reduce((a, x) => a + x.centersWithoutTeams, 0),
    unattachedTeamCount: board.unattachedRows.length,
  };
}

// ------------------------------------------------------- target readiness

/**
 * "How ready are these teams' targets for the selected month" — the /targets
 * management question, derived from the SAME ScopeTeamRow values the home
 * dashboards use, so the two screens can never disagree about who is missing
 * a target.
 *
 * Every field is a count over rows that exist. There is deliberately no
 * percentage and no combined target: a set of teams may mix KPI profiles, and
 * "מיועדות" + "יעד" is not a number. `kpiProfiles` reports which profiles are
 * present so the UI can label per profile instead of inventing one unit.
 */
export type TargetReadiness = {
  teamCount: number;
  /** Teams with an official team target for the month. */
  teamsWithTarget: number;
  /** Teams still missing their official team target. */
  teamsMissingTarget: number;
  repCount: number;
  /** Representatives with no positive official personal target. */
  repsMissingPersonalTarget: number;
  /** Profiles actually present among these teams, renewals first. */
  kpiProfiles: KpiProfile[];
};

export function targetReadiness(rows: ScopeTeamRow[]): TargetReadiness {
  const withTarget = rows.filter((r) => r.target !== null && r.target > 0).length;
  const order: KpiProfile[] = ["renewals", "generic_sales"];
  return {
    teamCount: rows.length,
    teamsWithTarget: withTarget,
    teamsMissingTarget: rows.length - withTarget,
    repCount: rows.reduce((a, r) => a + r.repCount, 0),
    repsMissingPersonalTarget: rows.reduce((a, r) => a + r.missingTargets, 0),
    kpiProfiles: order.filter((p) => rows.some((r) => r.kpiProfile === p)),
  };
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
