// Authorization + scoping rules for the dashboard activity feed.
//
// The feed reads audit_log under service_role (audit_log is admin-only under
// RLS and holds user-administration entries a manager must never see), so this
// module is the only thing standing between a caller and another team's
// history. Two defects it exists to close:
//
//  1. `visibleTeamIds` used to be `new Set(data.team_id ? [data.team_id] : …)`.
//     The requested team was TRUSTED: any manager could pass a foreign team id
//     and the service-role read would then surface that team's audit entries.
//     Authorization is now decided against the caller's canonical business
//     scope (resolveBusinessScope — direct teams.manager_id ownership PLUS
//     center/activity/executive grants), never against the request.
//  2. The scoping ran in JavaScript AFTER `limit(400)`, so a team whose events
//     sat behind 400 more recent rows from other teams silently vanished and
//     `total` was the size of that filtered window rather than a real count.
//     The scope is now expressed as a database filter, so the count is exact
//     and pagination is stable.
//
// Pure and dependency-free so both rules are unit-tested without a database.

export const ACTIVITY_TEAM_FORBIDDEN_MESSAGE = "אין לך הרשאה לצוות זה";
export const ACTIVITY_TEAM_INVALID_MESSAGE = "מזהה צוות לא תקין";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical UUID. Everything reaching a PostgREST filter goes through this. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** jsonb keys in audit_log.details that name a representative. */
export const ACTIVITY_DETAIL_REP_KEYS = ["representative_id", "rep_id"] as const;
/** jsonb keys in audit_log.details that name a team. */
export const ACTIVITY_DETAIL_TEAM_KEYS = ["team_id", "to_team", "from_team"] as const;

export type ActivityScope =
  /** Admin with no workspace narrowing: every audit entry in the allow-list. */
  | { kind: "all" }
  /** Everyone else: only entries naming one of these representatives or teams. */
  | { kind: "scoped"; repIds: string[]; teamIds: string[] }
  /** Authorized, but the resolved scope covers nothing — always an empty feed. */
  | { kind: "none" };

export type ActivityScopeInput = {
  isAdmin: boolean;
  /** Teams the caller is authorized for, from resolveBusinessScope. */
  authorizedTeamIds: string[];
  /** Representatives the caller can see, already narrowed to the workspace. */
  scopedRepIds: string[];
  /** The workspace team the client asked to narrow to — UNTRUSTED. */
  requestedTeamId: string | null;
};

/**
 * Decides what the caller may read. Throws (never silently widens or narrows)
 * when the requested team is malformed or outside the caller's scope.
 *
 * An admin is authorized for every team, so a requested team only NARROWS for
 * them; a manager must have the team in their resolved scope, which already
 * accounts for center/activity/executive grants, not just teams.manager_id.
 */
export function resolveActivityScope(input: ActivityScopeInput): ActivityScope {
  const authorized = new Set(input.authorizedTeamIds.filter(isUuid));
  const requested = input.requestedTeamId;

  if (requested !== null && requested !== undefined && requested !== "") {
    if (!isUuid(requested)) throw new Error(ACTIVITY_TEAM_INVALID_MESSAGE);
    if (!input.isAdmin && !authorized.has(requested)) {
      throw new Error(ACTIVITY_TEAM_FORBIDDEN_MESSAGE);
    }
    return { kind: "scoped", repIds: input.scopedRepIds.filter(isUuid), teamIds: [requested] };
  }

  if (input.isAdmin) return { kind: "all" };

  const teamIds = [...authorized];
  const repIds = input.scopedRepIds.filter(isUuid);
  if (teamIds.length === 0 && repIds.length === 0) return { kind: "none" };
  return { kind: "scoped", repIds, teamIds };
}

/**
 * The PostgREST `or=` expression that pushes the scope into the database.
 * Every value is a validated UUID, so no value can carry a comma, quote or
 * parenthesis into the filter grammar.
 */
export function activityScopeOrFilter(scope: ActivityScope): string | null {
  if (scope.kind !== "scoped") return null;
  const clauses: string[] = [];
  if (scope.repIds.length > 0) {
    const list = scope.repIds.join(",");
    for (const key of ACTIVITY_DETAIL_REP_KEYS) clauses.push(`details->>${key}.in.(${list})`);
  }
  if (scope.teamIds.length > 0) {
    const list = scope.teamIds.join(",");
    for (const key of ACTIVITY_DETAIL_TEAM_KEYS) clauses.push(`details->>${key}.in.(${list})`);
  }
  return clauses.length > 0 ? clauses.join(",") : null;
}

/**
 * Belt-and-braces row check, applied to whatever the database returns. Keeps
 * the same alias handling and null tolerance the previous JS filter had, so a
 * row whose details name neither a permitted representative nor a permitted
 * team can never be projected even if the query were ever relaxed.
 */
export function activityRowInScope(
  details: Record<string, unknown> | null | undefined,
  scope: ActivityScope,
): boolean {
  if (scope.kind === "all") return true;
  if (scope.kind === "none") return false;
  const d = details ?? {};
  const reps = new Set(scope.repIds);
  const teams = new Set(scope.teamIds);
  for (const key of ACTIVITY_DETAIL_REP_KEYS) {
    const v = d[key];
    if (typeof v === "string" && reps.has(v)) return true;
  }
  for (const key of ACTIVITY_DETAIL_TEAM_KEYS) {
    const v = d[key];
    if (typeof v === "string" && teams.has(v)) return true;
  }
  return false;
}

/** Clamped, validated pagination window. */
export function activityPageRange(limit: number, offset: number): { from: number; to: number } {
  const safeLimit = Math.min(200, Math.max(1, Math.round(Number(limit) || 1)));
  const safeOffset = Math.max(0, Math.round(Number(offset) || 0));
  return { from: safeOffset, to: safeOffset + safeLimit - 1 };
}

export type ActivityAuditRow = {
  id: string;
  action: string;
  actor_id: string | null;
  actor_email: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

/** Minimal PostgREST surface used here, so this stays testable with a fake. */
export type ActivityQueryClient = {
  from: (table: string) => any;
};

/**
 * Scope -> database filter -> range. The filter and the exact count are applied
 * by Postgres BEFORE pagination, so a team's events stay visible no matter how
 * many more recent events belong to other teams, and `total` is real.
 */
export async function queryScopedActivity(
  client: ActivityQueryClient,
  opts: { scope: ActivityScope; actions: string[]; limit: number; offset?: number },
): Promise<{ rows: ActivityAuditRow[]; total: number }> {
  if (opts.scope.kind === "none") return { rows: [], total: 0 };
  const { from, to } = activityPageRange(opts.limit, opts.offset ?? 0);

  let q = client
    .from("audit_log")
    .select("id, action, actor_id, actor_email, details, created_at", { count: "exact" })
    .in("action", opts.actions);

  const orFilter = activityScopeOrFilter(opts.scope);
  if (opts.scope.kind === "scoped") {
    if (!orFilter) return { rows: [], total: 0 };
    q = q.or(orFilter);
  }

  const res = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
  if (res.error) throw new Error(res.error.message);
  const rows = ((res.data ?? []) as ActivityAuditRow[]).filter((r) =>
    activityRowInScope(r.details, opts.scope),
  );
  return { rows, total: typeof res.count === "number" ? res.count : rows.length };
}
