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
  /**
   * The header identity line for this scope holder — "מנהל מוקד · דירות
   * וחידושים", "מנהל פעילות · אלמנטרי", 'סמנכ"ל / מנהל ממ"ט'. For a plain
   * team manager this is just the role label; the home header keeps showing
   * the selected team name for them (unchanged behavior).
   */
  title: string;
  /** The highest granted unit's raw name (center/activity kinds), else null. */
  unitName: string | null;
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
export const TEAM_ATTACH_CENTER_ONLY_MESSAGE =
  "צוות ניתן לשייך למוקד בלבד. הפעילות נקבעת דרך המוקד.";
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
      title: BUSINESS_ROLE_LABEL.representative,
      unitName: null,
      teams: [],
    };
  }

  const asTeam = (t: ScopeTeam) => ({ id: t.id, name: t.name });

  if (role === "admin") {
    return {
      kind: "admin",
      roleLabel: BUSINESS_ROLE_LABEL.admin,
      scopeLabel: `${BUSINESS_ROLE_LABEL.admin} — כלל המערכת`,
      title: BUSINESS_ROLE_LABEL.admin,
      unitName: null,
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
      // The executive title stands alone — the business-wide reach is stated
      // by the scope line, not appended to the name.
      title: BUSINESS_ROLE_LABEL.executive,
      unitName: null,
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
      // "מנהל מוקד · דירות וחידושים" — same shape as effectiveBusinessTitle.
      title: `${BUSINESS_ROLE_LABEL[kind]} · ${highestUnit.name}`,
      unitName: highestUnit.name,
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
    title: BUSINESS_ROLE_LABEL.team_manager,
    unitName: null,
    teams: coveredTeams,
  };
}

// -------------------------------------------------- effective business title

export const EXECUTIVE_SCOPE_TARGET_LABEL = "כלל הפעילות העסקית";

/**
 * The business title a user row should DISPLAY, derived from the technical
 * role plus user_business_scopes — never stored, never a new role value:
 *   admin                      → מנהל מערכת (never a business executive)
 *   representative / no role   → נציג
 *   manager, no grants         → מנהל צוות
 *   manager + center grant     → "מנהל מוקד · <center>"
 *   manager + activity grant   → "מנהל פעילות · <activity>"
 *   manager + executive grant  → 'סמנכ"ל / מנהל ממ"ט · כלל הפעילות העסקית'
 * Multiple grants report the highest (executive > activity > center).
 */
export function effectiveBusinessTitle(input: {
  roles: string[];
  grants: { scopeType: "center" | "activity" | "executive"; unitName: string | null }[];
}): string {
  if (input.roles.includes("admin")) return BUSINESS_ROLE_LABEL.admin;
  if (!input.roles.includes("manager")) return BUSINESS_ROLE_LABEL.representative;
  if (input.grants.some((g) => g.scopeType === "executive")) {
    return `${BUSINESS_ROLE_LABEL.executive} · ${EXECUTIVE_SCOPE_TARGET_LABEL}`;
  }
  const activity = input.grants.find((g) => g.scopeType === "activity");
  if (activity) {
    return activity.unitName
      ? `${BUSINESS_ROLE_LABEL.activity} · ${activity.unitName}`
      : BUSINESS_ROLE_LABEL.activity;
  }
  const center = input.grants.find((g) => g.scopeType === "center");
  if (center) {
    return center.unitName
      ? `${BUSINESS_ROLE_LABEL.center} · ${center.unitName}`
      : BUSINESS_ROLE_LABEL.center;
  }
  return BUSINESS_ROLE_LABEL.team_manager;
}

// ------------------------------------------------------ user-creation titles

/**
 * The business-friendly "תפקיד" options offered when CREATING a user. The
 * managerial business titles all map to the technical role `manager` — the
 * actual center/activity/executive scope is assigned afterwards in the
 * hierarchy card, so no fake title is ever stored; postCreateNotice tells the
 * admin exactly that. The technical role enum is untouched.
 */
export type CreateRoleOption = {
  value: string;
  label: string;
  role: "admin" | "manager" | "representative";
  postCreateNotice?: string;
};

export const CREATE_ROLE_OPTIONS: CreateRoleOption[] = [
  { value: "admin", label: BUSINESS_ROLE_LABEL.admin, role: "admin" },
  { value: "team_manager", label: BUSINESS_ROLE_LABEL.team_manager, role: "manager" },
  {
    value: "center_manager",
    label: BUSINESS_ROLE_LABEL.center,
    role: "manager",
    postCreateNotice: "המשתמש נוצר כמנהל. יש לשייך אותו למוקד במסך היררכיה עסקית.",
  },
  {
    value: "activity_manager",
    label: BUSINESS_ROLE_LABEL.activity,
    role: "manager",
    postCreateNotice: "המשתמש נוצר כמנהל. יש לשייך אותו לפעילות במסך היררכיה עסקית.",
  },
  {
    value: "executive",
    label: BUSINESS_ROLE_LABEL.executive,
    role: "manager",
    postCreateNotice: "המשתמש נוצר כמנהל. יש להקצות לו היקף כלל-עסקי במסך היררכיה עסקית.",
  },
  { value: "representative", label: BUSINESS_ROLE_LABEL.representative, role: "representative" },
];

export const CREATE_ROLE_HELPER_TEXT =
  "התפקידים הניהוליים משתמשים בהרשאת מנהל. שיוך למוקד, פעילות או כלל הפעילות מתבצע במסך היררכיה עסקית.";
export const EDIT_SCOPE_HELPER_TEXT = "שינוי היקף ניהולי מתבצע במסך היררכיה עסקית.";

// ---------------------------------------------------------- team attachment

/**
 * The business model attaches a TEAM to a CENTER only — the activity is
 * inherited through the center, never assigned directly. Null detaches.
 * Throws the friendly Hebrew rule for anything that is not a center.
 */
export function validateAttachTargetUnitType(unitType: BusinessUnitType | null): void {
  if (unitType !== null && unitType !== "center") {
    throw new Error(TEAM_ATTACH_CENTER_ONLY_MESSAGE);
  }
}

/**
 * "מוקד דירות וחידושים · פעילות אלמנטרי" — the attach-dropdown option label
 * for a center: the center with its type word, then the parent activity for
 * clarity. Type words are not doubled when a unit's name already carries one.
 */
export function centerOptionLabel(center: BusinessUnit, units: BusinessUnit[]): string {
  const withTypeWord = (name: string, typeWord: string) =>
    name.startsWith(typeWord) ? name : `${typeWord} ${name}`;
  const centerLabel = withTypeWord(center.name, BUSINESS_UNIT_TYPE_LABEL.center);
  const parent = center.parentId ? units.find((u) => u.id === center.parentId) : undefined;
  if (!parent) return centerLabel;
  return `${centerLabel} · ${withTypeWord(parent.name, BUSINESS_UNIT_TYPE_LABEL.activity)}`;
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
