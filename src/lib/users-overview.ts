// /users derivations — pure, dependency-free, unit-tested.
//
// Every figure here is a COUNT over the user rows listUsers already returned to
// this admin, and every filter/sort is the page's own control moved out of the
// route component UNCHANGED. Nothing is fetched, inferred or estimated:
//   * health is NEVER recomputed here — computeUserHealth (user-health.ts) is
//     the single algorithm, and these counts only tally its result;
//   * business_title stays display-only: it is searched, never filtered on and
//     never treated as a technical role;
//   * there is no HR metric (tenure, activity score, engagement) — a number
//     that cannot be derived from a UserRow does not belong here.

import type { UserHealthStatus } from "@/lib/user-health";

export type UsersOverviewRole = "admin" | "manager" | "representative";

/** The subset of a listUsers row these derivations read. */
export type UsersOverviewInput = {
  active: boolean;
  roles: UsersOverviewRole[];
  last_login_at: string | null;
  auth_last_sign_in_at: string | null;
  representative_link: { id: string } | null;
  health: { status: UserHealthStatus };
};

export type UsersOverviewSummary = {
  total: number;
  active: number;
  inactive: number;
  /** Per health state, tallied from the SERVER-computed health only. */
  healthy: number;
  attention: number;
  issue: number;
  /** No login recorded at all — neither the profile stamp nor the auth one. */
  neverLoggedIn: number;
  /** Technical permission distribution; a user with no role counts in none. */
  byRole: Record<UsersOverviewRole, number>;
  /**
   * Representative-link coverage, counted ONLY over accounts whose technical
   * role is representative — the population where a link is actually expected.
   * An admin or manager without a link is not a gap and is never counted here.
   */
  representativeAccounts: number;
  representativesLinked: number;
  representativesUnlinked: number;
};

/** The band describes every user visible in the caller's current scope. */
export const USERS_SUMMARY_SCOPE_LABEL = "סיכום כלל המשתמשים בהיקף";

export function hasEverLoggedIn(u: {
  last_login_at: string | null;
  auth_last_sign_in_at: string | null;
}): boolean {
  return !!(u.last_login_at ?? u.auth_last_sign_in_at);
}

export function summarizeUsers(users: UsersOverviewInput[]): UsersOverviewSummary {
  const byRole: Record<UsersOverviewRole, number> = { admin: 0, manager: 0, representative: 0 };
  let active = 0;
  let healthy = 0;
  let attention = 0;
  let issue = 0;
  let neverLoggedIn = 0;
  let representativeAccounts = 0;
  let representativesLinked = 0;
  for (const u of users) {
    if (u.active) active += 1;
    if (u.health.status === "healthy") healthy += 1;
    else if (u.health.status === "attention") attention += 1;
    else issue += 1;
    if (!hasEverLoggedIn(u)) neverLoggedIn += 1;
    for (const r of u.roles) byRole[r] += 1;
    if (u.roles.includes("representative")) {
      representativeAccounts += 1;
      if (u.representative_link) representativesLinked += 1;
    }
  }
  return {
    total: users.length,
    active,
    inactive: users.length - active,
    healthy,
    attention,
    issue,
    neverLoggedIn,
    byRole,
    representativeAccounts,
    representativesLinked,
    representativesUnlinked: representativeAccounts - representativesLinked,
  };
}

// ------------------------------------------------------------ list controls

export type UsersSortKey =
  | "name"
  | "email"
  | "role"
  | "team"
  | "status"
  | "health"
  | "created"
  | "last_login";

/** The sort control's options, in the order the page offers them. */
export const USERS_SORT_OPTIONS: { value: UsersSortKey; label: string }[] = [
  { value: "name", label: "מיון לפי שם" },
  { value: "email", label: "מיון לפי אימייל" },
  { value: "role", label: "מיון לפי הרשאת מערכת" },
  { value: "team", label: "מיון לפי צוות" },
  { value: "status", label: "מיון לפי סטטוס" },
  { value: "health", label: "מיון לפי בריאות" },
  { value: "last_login", label: "מיון לפי כניסה אחרונה" },
  { value: "created", label: "מיון לפי תאריך יצירה" },
];

/** Fixed display order for role sorting — admins first. */
const ROLE_SORT_RANK: Record<string, number> = { admin: 0, manager: 1, representative: 2 };
/** Health sort surfaces the most severe state first. */
const HEALTH_SORT_RANK: Record<UserHealthStatus, number> = { issue: 0, attention: 1, healthy: 2 };

/** The subset of a listUsers row the filter/sort reads. */
export type UsersFilterRow = UsersOverviewInput & {
  full_name: string | null;
  email: string | null;
  team_id: string | null;
  manager_id: string | null;
  created_at: string;
  /** Effective business title — SEARCHED only, never a filter or a role. */
  business_title?: string;
};

export type UsersFilterState = {
  search: string;
  /** "all" | a technical role value */
  roleFilter: string;
  /**
   * "all" or a team id — this is the shared Workspace Context scope
   * (workspaceTeamId), not a page-local control. Passing it through unchanged
   * keeps the header switcher the single source of team scope.
   */
  teamFilter: string;
  /** "all" | "active" | "inactive" */
  statusFilter: string;
  /** "all" | a UserHealthStatus */
  healthFilter: string;
  sortBy: UsersSortKey;
};

export type UsersNameResolvers = {
  teamName: (teamId: string) => string;
  managerName: (managerId: string) => string;
};

/**
 * The /users people list: search, technical-role filter, workspace team scope,
 * status, health and sorting applied to the rows the page already loaded.
 *
 * Extracted from the route component UNCHANGED — same predicate order, same
 * search fields (full_name, email, team name, responsible-manager name and the
 * effective business_title), same comparators. It filters what the caller
 * already holds and is not a permission boundary; listUsers + RLS decide what
 * exists at all.
 */
export function filterAndSortUsers<T extends UsersFilterRow>(
  users: T[],
  filters: UsersFilterState,
  resolve: UsersNameResolvers,
): T[] {
  const { search, roleFilter, teamFilter, statusFilter, healthFilter, sortBy } = filters;
  const q = search.trim().toLowerCase();
  let rows = users.filter((u) => {
    if (q) {
      const teamName = u.team_id ? resolve.teamName(u.team_id) : "";
      const managerName = u.manager_id ? resolve.managerName(u.manager_id) : "";
      // business_title makes scoped managers findable by their business
      // role ("מנהל מוקד") or unit name ("דירות וחידושים").
      const hay =
        `${u.full_name ?? ""} ${u.email ?? ""} ${teamName} ${managerName} ${u.business_title ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (roleFilter !== "all" && !u.roles.includes(roleFilter as UsersOverviewRole)) return false;
    if (teamFilter !== "all" && u.team_id !== teamFilter) return false;
    if (statusFilter === "active" && !u.active) return false;
    if (statusFilter === "inactive" && u.active) return false;
    if (healthFilter !== "all" && u.health.status !== healthFilter) return false;
    return true;
  });
  rows = [...rows].sort((a, b) => {
    if (sortBy === "email") return (a.email ?? "").localeCompare(b.email ?? "");
    if (sortBy === "role")
      return (ROLE_SORT_RANK[a.roles[0] ?? ""] ?? 99) - (ROLE_SORT_RANK[b.roles[0] ?? ""] ?? 99);
    if (sortBy === "team") {
      const an = a.team_id ? resolve.teamName(a.team_id) : "";
      const bn = b.team_id ? resolve.teamName(b.team_id) : "";
      return an.localeCompare(bn);
    }
    if (sortBy === "status") return (b.active ? 1 : 0) - (a.active ? 1 : 0);
    if (sortBy === "health")
      return HEALTH_SORT_RANK[a.health.status] - HEALTH_SORT_RANK[b.health.status];
    if (sortBy === "created") return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    if (sortBy === "last_login") {
      const av = a.last_login_at ?? a.auth_last_sign_in_at ?? "";
      const bv = b.last_login_at ?? b.auth_last_sign_in_at ?? "";
      return bv.localeCompare(av);
    }
    return (a.full_name ?? "").localeCompare(b.full_name ?? "");
  });
  return rows;
}

// --------------------------------------------------------------- audit log

/**
 * A concise, TRUTHFUL rendering of an audit row's `details` JSON.
 *
 * Only shallow scalar entries are turned into "key: value" chips — an unknown
 * action is never given an invented human sentence, and a nested/complex value
 * is reported by shape ("2 פריטים") rather than guessed at. The caller keeps
 * the raw JSON available; this only decides what is safe to show inline.
 */
export function auditDetailChips(details: unknown, limit = 4): string[] {
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
    if (out.length >= limit) break;
    if (value === null) out.push(`${key}: —`);
    else if (typeof value === "string") out.push(`${key}: ${value === "" ? "—" : value}`);
    else if (typeof value === "number" || typeof value === "boolean") out.push(`${key}: ${value}`);
    else if (Array.isArray(value)) out.push(`${key}: ${value.length} פריטים`);
    else out.push(`${key}: …`);
  }
  return out;
}

/** True when `details` carries anything at all worth opening the raw view for. */
export function hasAuditDetails(details: unknown): boolean {
  if (!details || typeof details !== "object") return false;
  if (Array.isArray(details)) return details.length > 0;
  return Object.keys(details as Record<string, unknown>).length > 0;
}
