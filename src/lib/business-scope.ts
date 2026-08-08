// Business hierarchy & scope resolution — pure, dependency-free, unit-tested.
//
// The business ladder above teams:
//   סמנכ"ל / מנהל ממ"ט (executive, business-wide)
//     → פעילות (activity) → מוקד (center) → צוות (teams, unchanged) → נציג
//
// TECHNICAL ROLES ARE UNCHANGED: admin / manager / representative. The admin
// is the system administrator ("מנהל מערכת") and is deliberately NOT modeled
// as a business executive. Business scopes are additive metadata granted to
// manager users on top of teams.manager_id — which remains the authoritative
// direct team-manager ownership. A manager with no scope grants resolves to
// exactly their teams.manager_id teams; a representative always resolves to
// a personal scope.
//
// This module is the single source of truth for scope resolution: the server
// function (business-scope.functions.ts), the workspace context and the UI
// labels all call resolveBusinessScope rather than re-deriving the rules.

export type BusinessUnitType = "activity" | "center";

export type BusinessUnit = {
  id: string;
  name: string;
  unitType: BusinessUnitType;
  parentId: string | null;
};

export type BusinessScopeGrant = {
  scopeType: "center" | "activity" | "executive";
  businessUnitId: string | null;
};

export type ScopeTeam = {
  id: string;
  name: string;
  managerId: string | null;
  businessUnitId: string | null;
};

export type BusinessScopeKind =
  | "admin"
  | "executive"
  | "activity"
  | "center"
  | "team_manager"
  | "representative";

export type ResolvedBusinessScope = {
  kind: BusinessScopeKind;
  /** The Hebrew business title for this scope holder. */
  roleLabel: string;
  /** "היקף צפייה: …" — the visible scope line for manager screens. */
  scopeLabel: string;
  /** Teams covered by the resolved scope. Personal scope resolves to []. */
  teams: { id: string; name: string }[];
};

// ------------------------------------------------------------------ labels

export const BUSINESS_ROLE_LABEL: Record<BusinessScopeKind, string> = {
  admin: "מנהל מערכת",
  executive: 'סמנכ"ל / מנהל ממ"ט',
  activity: "מנהל פעילות",
  center: "מנהל מוקד",
  team_manager: "מנהל צוות",
  representative: "נציג",
};

export const BUSINESS_UNIT_TYPE_LABEL: Record<BusinessUnitType, string> = {
  activity: "פעילות",
  center: "מוקד",
};

export const VIEW_SCOPE_PREFIX = "היקף צפייה";
export const MANAGE_SCOPE_TITLE = "היקף ניהול";
export const AVAILABLE_TEAMS_PREFIX = "צוותים זמינים";
export const IMPORT_SCOPE_LIMIT_LINE = "הייבוא מוגבל להיקף הניהול שלך";
export const IMPORT_SCOPE_ADMIN_LINE = "מנהל מערכת — ניתן לייבא לכל הצוותים";
export const EXECUTIVE_SCOPE_LABEL = `${VIEW_SCOPE_PREFIX}: כלל הפעילות העסקית`;

// ------------------------------------------------------------- resolution

/**
 * Which teams a center/activity unit covers: a team is covered when it is
 * attached to the unit itself, or to a center whose parent is the unit.
 */
export function teamsUnderUnit(
  unitId: string,
  teams: ScopeTeam[],
  units: BusinessUnit[],
): ScopeTeam[] {
  const childCenterIds = new Set(
    units.filter((u) => u.unitType === "center" && u.parentId === unitId).map((u) => u.id),
  );
  return teams.filter(
    (t) =>
      t.businessUnitId !== null &&
      (t.businessUnitId === unitId || childCenterIds.has(t.businessUnitId)),
  );
}

/**
 * The single scope-resolution rule set:
 *  1. representative        → personal scope only (no team list here).
 *  2. admin                 → system administrator; sees every team but is
 *                             labeled "מנהל מערכת", never a business title.
 *  3. manager, no grants    → exactly the teams where teams.manager_id = user.
 *  4. manager + center      → those teams PLUS every team under the center.
 *  5. manager + activity    → those teams PLUS every team under the activity
 *                             (directly attached or via its centers).
 *  6. manager + executive   → every team (business-wide).
 * Multiple grants union; the kind/label reports the highest grant
 * (executive > activity > center > team_manager).
 */
export function resolveBusinessScope(params: {
  role: "admin" | "manager" | "representative";
  userId: string;
  teams: ScopeTeam[];
  units: BusinessUnit[];
  grants: BusinessScopeGrant[];
}): ResolvedBusinessScope {
  const { role, userId, teams, units, grants } = params;

  if (role === "representative") {
    return {
      kind: "representative",
      roleLabel: BUSINESS_ROLE_LABEL.representative,
      scopeLabel: `${VIEW_SCOPE_PREFIX}: אישי`,
      teams: [],
    };
  }

  const asTeam = (t: ScopeTeam) => ({ id: t.id, name: t.name });

  if (role === "admin") {
    return {
      kind: "admin",
      roleLabel: BUSINESS_ROLE_LABEL.admin,
      scopeLabel: `${BUSINESS_ROLE_LABEL.admin} — כלל המערכת`,
      teams: teams.map(asTeam),
    };
  }

  // Manager: authoritative direct ownership first…
  const owned = teams.filter((t) => t.managerId === userId);
  const covered = new Map(owned.map((t) => [t.id, t]));

  // …then each business grant adds its coverage.
  const executive = grants.some((g) => g.scopeType === "executive");
  const unitById = new Map(units.map((u) => [u.id, u]));
  let highestUnit: BusinessUnit | null = null;
  if (executive) {
    for (const t of teams) covered.set(t.id, t);
  } else {
    for (const g of grants) {
      if (!g.businessUnitId) continue;
      const unit = unitById.get(g.businessUnitId);
      if (!unit) continue;
      for (const t of teamsUnderUnit(unit.id, teams, units)) covered.set(t.id, t);
      if (!highestUnit || (highestUnit.unitType === "center" && unit.unitType === "activity")) {
        highestUnit = unit;
      }
    }
  }

  const coveredTeams = [...covered.values()].map(asTeam);

  if (executive) {
    return {
      kind: "executive",
      roleLabel: BUSINESS_ROLE_LABEL.executive,
      scopeLabel: EXECUTIVE_SCOPE_LABEL,
      teams: coveredTeams,
    };
  }
  if (highestUnit) {
    const kind = highestUnit.unitType === "activity" ? "activity" : "center";
    // "מוקד צפון" already carries its type word — don't double it.
    const typeWord = BUSINESS_UNIT_TYPE_LABEL[highestUnit.unitType];
    const unitLabel = highestUnit.name.startsWith(typeWord)
      ? highestUnit.name
      : `${typeWord} ${highestUnit.name}`;
    return {
      kind,
      roleLabel: BUSINESS_ROLE_LABEL[kind],
      scopeLabel: `${VIEW_SCOPE_PREFIX}: ${unitLabel}`,
      teams: coveredTeams,
    };
  }

  // Plain team manager — today's behavior, unchanged.
  const scopeLabel =
    owned.length === 1
      ? `${VIEW_SCOPE_PREFIX}: צוות ${owned[0].name}`
      : owned.length > 1
        ? `${VIEW_SCOPE_PREFIX}: ${owned.length} צוותים בניהולך`
        : `${VIEW_SCOPE_PREFIX}: לא הוגדר צוות לניהול`;
  return {
    kind: "team_manager",
    roleLabel: BUSINESS_ROLE_LABEL.team_manager,
    scopeLabel,
    teams: coveredTeams,
  };
}

// ------------------------------------------------------------- UI notices

/**
 * The visible import-scope notice on /data-import. The admin line states the
 * system-administrator fact; every other staff scope states the limit and
 * lists the available teams by name.
 */
export function importScopeNotice(scope: ResolvedBusinessScope): string[] {
  if (scope.kind === "admin") return [IMPORT_SCOPE_ADMIN_LINE];
  if (scope.kind === "representative") return [];
  const names = scope.teams.map((t) => t.name);
  return [
    IMPORT_SCOPE_LIMIT_LINE,
    names.length > 0
      ? `${AVAILABLE_TEAMS_PREFIX}: ${names.join(", ")}`
      : `${AVAILABLE_TEAMS_PREFIX}: אין צוותים בהיקף הניהול שלך`,
  ];
}
