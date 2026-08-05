import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_KPI_PROFILE, type KpiProfile } from "@/lib/performance-domain";
import { syncLinkedProfileTeam } from "@/lib/rep-admin.functions";

type Ctx = { supabase: any; userId: string; claims: any };

/**
 * Team headcount, computed per team. `rep_count` MUST come from
 * representatives.team_id directly, independent of `people` (profiles/login
 * accounts) — a representative has no `profiles` row at all unless a login
 * account is linked to it, so deriving rep_count from `people` silently
 * excludes every representative that doesn't have a linked user account.
 */
export function aggregateTeamCounts(
  teamId: string,
  people: { team_id: string | null; active: boolean }[],
  representatives: { team_id: string | null }[],
): { member_count: number; rep_count: number; active_member_count: number } {
  const members = people.filter((p) => p.team_id === teamId);
  const teamReps = representatives.filter((r) => r.team_id === teamId);
  return {
    member_count: members.length,
    rep_count: teamReps.length,
    active_member_count: members.filter((m) => m.active).length,
  };
}

/**
 * Never return a raw database id to the UI. `profiles.representative_id` holds the
 * linked representative's uuid (despite the column being typed `text`), so it must
 * never be rendered directly — resolve it to a business-facing identifier instead.
 * `employeeNumber`/`representativeCode` have no backing column in the current schema;
 * they're accepted here so this stays correct without a UI change if those columns
 * are ever added.
 */
export function resolveBusinessIdentifier(input: {
  employeeNumber?: string | null;
  representativeCode?: string | null;
  email?: string | null;
  externalRef?: string | null;
}): string {
  return (
    input.employeeNumber?.trim() ||
    input.representativeCode?.trim() ||
    input.email?.trim() ||
    input.externalRef?.trim() ||
    "ללא מזהה עסקי"
  );
}

/**
 * Pure comparison used by reconcileProfileRepresentativeTeams: finds every
 * rep-linked user (representatives.user_id set) whose profiles.team_id disagrees
 * with representatives.team_id. Product rule — representatives.team_id is the
 * source of truth for rep-linked users, so every returned change realigns the
 * profile to the representative, never the other way. Reps without a linked user
 * and users without a linked rep never appear here.
 */
export function computeTeamReconciliation(
  representatives: { id: string; user_id: string | null; team_id: string | null; name: string }[],
  profiles: { id: string; team_id: string | null }[],
): { user_id: string; representative_id: string; representative_name: string; from_team_id: string | null; to_team_id: string | null }[] {
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const changes: ReturnType<typeof computeTeamReconciliation> = [];
  for (const rep of representatives) {
    if (!rep.user_id) continue;
    const profile = profileById.get(rep.user_id);
    if (!profile) continue;
    if (profile.team_id !== rep.team_id) {
      changes.push({
        user_id: rep.user_id,
        representative_id: rep.id,
        representative_name: rep.name,
        from_team_id: profile.team_id,
        to_team_id: rep.team_id,
      });
    }
  }
  return changes;
}

export type TeamDeletionDependencyType =
  | "profiles"
  | "representatives"
  | "team_goals"
  | "kpi_values"
  | "representative_goals"
  | "competition_scores";

export type TeamDeletionDependency = { type: TeamDeletionDependencyType; label: string; count: number };

const TEAM_DELETION_DEPENDENCY_LABELS: Record<TeamDeletionDependencyType, string> = {
  profiles: "משתמשים משויכים",
  representatives: "נציגים משויכים",
  team_goals: "יעדי צוות שנקבעו",
  kpi_values: "רשומות ביצועים היסטוריות",
  representative_goals: "יעדים אישיים של נציגי הצוות",
  competition_scores: "תוצאות תחרויות של נציגי הצוות",
};

/**
 * Pure gate for team deletion: every table that can hold data attributable to
 * a team (directly via team_id, or indirectly via its representatives) must
 * be empty before a hard delete is allowed. Returns only the dependency types
 * that actually block (count > 0), in the fixed order above, so the Hebrew
 * message and the UI both report a stable, deterministic list. Kept pure and
 * exported so the exact blocking logic gets direct unit coverage independent
 * of the network calls the handler needs to gather these counts.
 */
export function computeTeamDeletionBlockers(counts: Record<TeamDeletionDependencyType, number>): TeamDeletionDependency[] {
  return (Object.keys(TEAM_DELETION_DEPENDENCY_LABELS) as TeamDeletionDependencyType[])
    .map((type) => ({ type, label: TEAM_DELETION_DEPENDENCY_LABELS[type], count: counts[type] ?? 0 }))
    .filter((d) => d.count > 0);
}

/** Hebrew rejection message listing every blocking dependency type + count, recommending deactivation instead. */
export function formatTeamDeletionBlockedMessage(teamName: string, blockers: TeamDeletionDependency[]): string {
  const parts = blockers.map((b) => `${b.label} (${b.count})`).join(", ");
  return `לא ניתן למחוק את הצוות "${teamName}" — קיימים נתונים היסטוריים המשויכים אליו: ${parts}. יש לשייך את המשתמשים/הנציגים לצוות אחר, או לבחור ב"השבתת צוות" כדי לשמר את ההיסטוריה מבלי למחוק אותה.`;
}

/**
 * Whether a team's manager reassignment must cascade to profiles.manager_id
 * for the team's existing members, and what to write. profiles.manager_id is
 * a denormalized copy of "who runs my team", otherwise only ever stamped
 * per-user by set_user_team_with_representative_sync at team-assignment time
 * (see the migration) — without this cascade, every existing member keeps
 * showing the OLD manager (e.g. on the Users page) after a team-level
 * reassignment/removal, confirmed via a full local migration replay. Returns
 * null when there's nothing to cascade (no prior team row, or manager_id
 * unchanged) so the caller can skip the write entirely.
 */
export function computeManagerCascade(
  before: { manager_id: string | null } | null,
  data: { team_id: string; manager_id: string | null },
): { team_id: string; manager_id: string | null } | null {
  if (!before || before.manager_id === data.manager_id) return null;
  return { team_id: data.team_id, manager_id: data.manager_id };
}

/**
 * Pure gate for updateTeam's manager field-scoping (P2b): a manager may only
 * ever change a team's description and KPI profile — name, department,
 * manager assignment, and active status stay admin-only, regardless of
 * whether the UI would ever actually submit a change to them. Compares the
 * incoming payload against the row as it was before the write, so an
 * unrelated field carried through unchanged (as every current caller does)
 * never trips this — only an actual attempted change to a restricted field does.
 */
export function managerAttemptedAdminOnlyTeamChange(
  before: { name: string; department: string | null; manager_id: string | null; active: boolean },
  data: { name: string; department: string | null; manager_id: string | null; active: boolean },
): boolean {
  return (
    data.name !== before.name ||
    (data.department ?? null) !== (before.department ?? null) ||
    (data.manager_id ?? null) !== (before.manager_id ?? null) ||
    data.active !== before.active
  );
}

async function getRoles(ctx: Ctx): Promise<string[]> {
  const { data, error } = await ctx.supabase.from("user_roles").select("role").eq("user_id", ctx.userId);
  if (error) throw new Error("שגיאה באימות הרשאות");
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}

async function assertAdmin(ctx: Ctx) {
  const roles = await getRoles(ctx);
  if (!roles.includes("admin")) throw new Error("אין הרשאה לפעולה זו — פעולה זו מיועדת למנהלי מערכת בלבד");
}

async function assertAdminOrManager(ctx: Ctx) {
  const roles = await getRoles(ctx);
  if (!roles.includes("admin") && !roles.includes("manager")) throw new Error("אין לך הרשאה לצפות בניהול הצוותים");
  return roles;
}

/**
 * Pure decision core for setUserTeam's manager scoping (P2b): given every
 * team a reassignment actually touches (the user's current team, if any, and
 * the destination team, if any) and the set of teams the acting manager is
 * confirmed to manage (via RLS — see the handler), is this specific move
 * allowed? A manager may only move a user between "unassigned" and a team
 * they personally manage — every touched team must be one they manage.
 * Extracted so the exact authorization rule (not just "the handler compiles")
 * gets direct unit coverage independent of any network/RLS round trip.
 */
export function canManagerPerformTeamAssignment(teamIdsInvolved: string[], managedTeamIds: Set<string>): boolean {
  return teamIdsInvolved.every((id) => managedTeamIds.has(id));
}

/**
 * Admin, or the manager of this specific team — verified through the
 * RLS-scoped client ("teams manager reads own": manager_id = auth.uid()),
 * exactly like assertCanManageTeam in goals.functions.ts. Never re-implements
 * "is this my team" in application code. Managers may only manage a team they
 * personally manage; they may never create/delete teams, reassign another
 * manager, or touch a team outside their own — those stay admin-only and are
 * enforced by the callers of this guard, not here.
 */
async function assertCanManageTeam(ctx: Ctx, teamId: string): Promise<{ isAdmin: boolean }> {
  const roles = await getRoles(ctx);
  if (roles.includes("admin")) return { isAdmin: true };
  if (!roles.includes("manager")) throw new Error("אין לך הרשאה לנהל צוותים");
  const { data, error } = await ctx.supabase.from("teams").select("id").eq("id", teamId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("אין לך הרשאה לנהל את הצוות הזה — הוא אינו בניהולך");
  return { isAdmin: false };
}

type TeamSyncResult = {
  previous_profile_team_id: string | null;
  representative_id: string | null;
  previous_representative_team_id: string | null;
};

/**
 * Atomically sets a user's team (profiles.team_id + derived manager_id) and, if
 * they have a linked representative, keeps representatives.team_id in sync — via
 * the set_user_team_with_representative_sync SECURITY DEFINER function, which
 * runs as a single Postgres transaction. supabase-js has no cross-table
 * client-side transaction API, so this RPC is the safest atomicity primitive
 * available: either both writes commit, or (on any error) neither does — there
 * is no partial-update state to leave inconsistent.
 */
async function syncLinkedRepresentativeTeam(
  admin: any,
  userId: string,
  teamId: string | null,
): Promise<{ data: TeamSyncResult | null; error: { message: string } | null }> {
  const { data, error } = await admin
    .rpc("set_user_team_with_representative_sync", { _user_id: userId, _team_id: teamId })
    .single();
  return { data: (data as TeamSyncResult) ?? null, error };
}

async function logAudit(
  admin: any,
  ctx: Ctx,
  action: string,
  details: Record<string, unknown>,
  targetUserId: string | null = null,
  targetEmail: string | null = null,
) {
  await admin.from("audit_log").insert({
    actor_id: ctx.userId,
    actor_email: (ctx.claims as any)?.email ?? null,
    action,
    target_user_id: targetUserId,
    target_email: targetEmail,
    details,
  });
}

export const listTeams = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const roles = await assertAdminOrManager(ctx);
    const isAdmin = roles.includes("admin");

    const [{ data: teams, error: tErr }, { data: profiles, error: pErr }, { data: userRoles, error: rErr }, { data: reps, error: repErr }] =
      await Promise.all([
        ctx.supabase
          .from("teams")
          .select("id, name, department, description, manager_id, active, kpi_profile, created_at, updated_at")
          .order("created_at", { ascending: false }),
        ctx.supabase.from("profiles").select("id, full_name, email, team_id, manager_id, representative_id, active"),
        ctx.supabase.from("user_roles").select("user_id, role"),
        // Representative headcount must come from representatives.team_id directly — a
        // representative has no `profiles` row at all unless a login account is linked
        // to it, so counting via profiles silently drops every representative without
        // an account. See rep_count below.
        ctx.supabase.from("representatives").select("id, team_id, active"),
      ]);
    if (tErr) throw new Error(tErr.message);
    if (pErr) throw new Error(pErr.message);
    if (rErr) throw new Error(rErr.message);
    if (repErr) throw new Error(repErr.message);

    const rolesByUser = new Map<string, string[]>();
    for (const r of (userRoles ?? []) as { user_id: string; role: string }[]) {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role);
      rolesByUser.set(r.user_id, arr);
    }

    const people = ((profiles ?? []) as any[]).map((p) => ({ ...p, roles: rolesByUser.get(p.id) ?? [] }));
    const repRows = (reps ?? []) as { id: string; team_id: string | null; active: boolean }[];

    const rows = ((teams ?? []) as any[]).map((t) => ({
      ...t,
      ...aggregateTeamCounts(t.id, people, repRows),
    }));

    return {
      teams: rows,
      people,
      // canManage: organization-wide capabilities only (create/delete teams,
      // reassign a manager, change status) — always admin-only. A manager's
      // per-team capability (edit own team's description/KPI profile/members)
      // is computed client-side from isManager + currentUserId + a team's own
      // manager_id, and re-enforced server-side by assertCanManageTeam on
      // every mutation — this flag never gates that, only the UI affordances
      // that stay admin-only regardless of which team is open.
      canManage: isAdmin,
      isAdmin,
      isManager: roles.includes("manager"),
      currentUserId: ctx.userId,
    };
  });

export const getTeamDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { team_id: string }) => {
    if (!data?.team_id) throw new Error("חסר מזהה צוות");
    return data;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertAdminOrManager(ctx);
    const [{ data: team, error: tErr }, { data: members, error: mErr }, { data: userRoles }, { data: reps, error: repErr }] = await Promise.all([
      ctx.supabase
        .from("teams")
        .select("id, name, department, description, manager_id, active, kpi_profile, created_at, updated_at")
        .eq("id", data.team_id)
        .maybeSingle(),
      ctx.supabase
        .from("profiles")
        .select("id, full_name, email, team_id, manager_id, representative_id, active, last_login_at")
        .eq("team_id", data.team_id),
      ctx.supabase.from("user_roles").select("user_id, role"),
      // Independent of `members` (profiles/login accounts) — representatives.team_id
      // is the source of truth for representative team membership regardless of
      // whether a login account is linked.
      ctx.supabase
        .from("representatives")
        .select("id, name, external_ref, user_id, active")
        .eq("team_id", data.team_id)
        .order("name"),
    ]);
    if (tErr) throw new Error(tErr.message);
    if (mErr) throw new Error(mErr.message);
    if (repErr) throw new Error(repErr.message);
    if (!team) throw new Error("הצוות לא נמצא");

    const rolesByUser = new Map<string, string[]>();
    for (const r of ((userRoles ?? []) as { user_id: string; role: string }[])) {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role);
      rolesByUser.set(r.user_id, arr);
    }

    // profiles.representative_id holds a representative uuid, not a business code — it
    // must never reach the client raw. Resolve it to that representative's external_ref
    // (may point outside this team if the two assignments have ever drifted) so the UI
    // can show a real identifier instead.
    const linkedRepIds = Array.from(
      new Set(((members ?? []) as any[]).map((m) => m.representative_id).filter((v): v is string => !!v)),
    );
    let externalRefByRepId = new Map<string, string | null>();
    if (linkedRepIds.length > 0) {
      const { data: linkedReps, error: lrErr } = await ctx.supabase
        .from("representatives")
        .select("id, external_ref")
        .in("id", linkedRepIds);
      if (lrErr) throw new Error(lrErr.message);
      externalRefByRepId = new Map(((linkedReps ?? []) as { id: string; external_ref: string | null }[]).map((r) => [r.id, r.external_ref]));
    }

    return {
      team,
      members: ((members ?? []) as any[]).map((m) => {
        const { representative_id, ...rest } = m;
        return {
          ...rest,
          roles: rolesByUser.get(m.id) ?? [],
          business_id: representative_id
            ? resolveBusinessIdentifier({
                email: m.email,
                externalRef: externalRefByRepId.get(representative_id) ?? null,
              })
            : null,
        };
      }),
      representatives: (reps ?? []) as { id: string; name: string; external_ref: string | null; user_id: string | null; active: boolean }[],
    };
  });

type TeamInput = {
  name: string;
  department: string | null;
  description: string | null;
  manager_id: string | null;
  active: boolean;
  /** Optional on input so existing callers keep working; defaults to generic_sales. Never inferred from name. */
  kpi_profile?: KpiProfile;
};

const KPI_PROFILES: KpiProfile[] = ["generic_sales", "renewals"];

function validateTeam(data: TeamInput) {
  if (!data?.name?.trim()) throw new Error("יש להזין שם צוות");
  if (data.name.trim().length > 80) throw new Error("שם הצוות ארוך מדי");
  const kpi_profile = data.kpi_profile ?? DEFAULT_KPI_PROFILE;
  if (!KPI_PROFILES.includes(kpi_profile)) throw new Error("פרופיל KPI לא חוקי");
  return {
    ...data,
    name: data.name.trim(),
    department: data.department?.trim() || null,
    description: data.description?.trim() || null,
    kpi_profile,
  };
}

export const createTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: TeamInput) => validateTeam(data))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin
      .from("teams")
      .insert({
        name: data.name,
        department: data.department,
        description: data.description,
        manager_id: data.manager_id,
        active: data.active,
        kpi_profile: data.kpi_profile,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await logAudit(supabaseAdmin, ctx, "team.create", { team_id: created.id, name: data.name, manager_id: data.manager_id, kpi_profile: data.kpi_profile });
    return { team_id: created.id };
  });

export const updateTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: TeamInput & { team_id: string }) => {
    if (!data?.team_id) throw new Error("חסר מזהה צוות");
    return { ...validateTeam(data), team_id: data.team_id };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { isAdmin } = await assertCanManageTeam(ctx, data.team_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before, error: beforeErr } = await supabaseAdmin
      .from("teams")
      .select("manager_id, active, name, department, kpi_profile")
      .eq("id", data.team_id)
      .maybeSingle();
    if (beforeErr) throw new Error(beforeErr.message);
    if (!before) throw new Error("הצוות לא נמצא");

    // A manager may edit only their own team's description and KPI profile —
    // never its name, department, manager assignment, or active status. This
    // is enforced here regardless of what the client sends (never trust a
    // hidden-button-only restriction): any attempt to change an admin-only
    // field is rejected outright, not silently ignored.
    if (!isAdmin && managerAttemptedAdminOnlyTeamChange(before, data)) {
      throw new Error("כמנהל צוות ניתן לערוך רק תיאור ופרופיל KPI של הצוות שלך — שינויים נוספים (שם, מחלקה, מנהל, סטטוס) מיועדים למנהלי מערכת בלבד");
    }

    const { error } = await supabaseAdmin
      .from("teams")
      .update({
        name: data.name,
        department: data.department,
        description: data.description,
        manager_id: data.manager_id,
        active: data.active,
        kpi_profile: data.kpi_profile,
      })
      .eq("id", data.team_id);
    if (error) throw new Error(error.message);

    await logAudit(supabaseAdmin, ctx, "team.update", { team_id: data.team_id, name: data.name });
    const cascade = computeManagerCascade(before, data);
    if (cascade) {
      const { error: cascadeErr } = await supabaseAdmin
        .from("profiles")
        .update({ manager_id: cascade.manager_id })
        .eq("team_id", cascade.team_id);
      if (cascadeErr) throw new Error(cascadeErr.message);
      await logAudit(supabaseAdmin, ctx, "team.manager_assigned", { team_id: data.team_id, from: before!.manager_id, to: data.manager_id });
    }
    if (before && before.active !== data.active) {
      await logAudit(supabaseAdmin, ctx, data.active ? "team.activate" : "team.deactivate", { team_id: data.team_id });
    }
    if (before && before.kpi_profile !== data.kpi_profile) {
      await logAudit(supabaseAdmin, ctx, "team.kpi_profile_changed", { team_id: data.team_id, from: before.kpi_profile, to: data.kpi_profile });
    }
    return { ok: true };
  });

export const setTeamActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { team_id: string; active: boolean }) => {
    if (!data?.team_id) throw new Error("חסר מזהה צוות");
    return data;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("teams").update({ active: data.active }).eq("id", data.team_id);
    if (error) throw new Error(error.message);
    await logAudit(supabaseAdmin, ctx, data.active ? "team.activate" : "team.deactivate", { team_id: data.team_id });
    return { ok: true };
  });

export const deleteTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { team_id: string }) => {
    if (!data?.team_id) throw new Error("חסר מזהה צוות");
    return data;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    // Deletion is destructive and irreversible for every dependency type checked
    // below — kept admin-only even though managers may manage their own team's
    // day-to-day data (see assertCanManageTeam / P2b). Deactivation, not
    // deletion, is the manager-safe way to retire a team.
    await assertAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: team, error: teamErr } = await supabaseAdmin.from("teams").select("id, name").eq("id", data.team_id).maybeSingle();
    if (teamErr) throw new Error(teamErr.message);
    if (!team) throw new Error("הצוות לא נמצא");

    // Every table that can hold data attributable to this team — directly via
    // team_id (profiles, representatives, team_goals, kpi_values) or indirectly
    // via its representatives (representative_goals, competition_scores, which
    // have no team_id column of their own). This is the complete inventory of
    // FKs referencing teams.id plus the two representative-scoped historical
    // tables — see the FK audit in the accompanying migration.
    const [
      { count: profilesCount, error: pErr },
      { data: repRows, error: rErr },
      { count: teamGoalsCount, error: tgErr },
      { count: kpiCount, error: kvErr },
    ] = await Promise.all([
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).eq("team_id", data.team_id),
      supabaseAdmin.from("representatives").select("id").eq("team_id", data.team_id),
      supabaseAdmin.from("team_goals").select("id", { count: "exact", head: true }).eq("team_id", data.team_id),
      supabaseAdmin.from("kpi_values").select("id", { count: "exact", head: true }).eq("team_id", data.team_id),
    ]);
    if (pErr) throw new Error(pErr.message);
    if (rErr) throw new Error(rErr.message);
    if (tgErr) throw new Error(tgErr.message);
    if (kvErr) throw new Error(kvErr.message);

    const repIds = ((repRows ?? []) as { id: string }[]).map((r) => r.id);
    let representativeGoalsCount = 0;
    let competitionScoresCount = 0;
    if (repIds.length > 0) {
      const [{ count: rgCount, error: rgErr }, { count: csCount, error: csErr }] = await Promise.all([
        supabaseAdmin.from("representative_goals").select("id", { count: "exact", head: true }).in("representative_id", repIds),
        supabaseAdmin.from("competition_scores").select("id", { count: "exact", head: true }).in("representative_id", repIds),
      ]);
      if (rgErr) throw new Error(rgErr.message);
      if (csErr) throw new Error(csErr.message);
      representativeGoalsCount = rgCount ?? 0;
      competitionScoresCount = csCount ?? 0;
    }

    const blockers = computeTeamDeletionBlockers({
      profiles: profilesCount ?? 0,
      representatives: repIds.length,
      team_goals: teamGoalsCount ?? 0,
      kpi_values: kpiCount ?? 0,
      representative_goals: representativeGoalsCount,
      competition_scores: competitionScoresCount,
    });

    if (blockers.length > 0) {
      throw new Error(formatTeamDeletionBlockedMessage(team.name, blockers));
    }

    // Nothing references this team — safe to hard delete. The FK migration
    // (RESTRICT on all four teams.id references) is a second, DB-level
    // guarantee of the same invariant checked above: even if this application
    // check is ever bypassed or drifts, Postgres itself refuses the delete
    // rather than silently cascading or nulling out historical data.
    const { error } = await supabaseAdmin.from("teams").delete().eq("id", data.team_id);
    if (error) throw new Error(error.message);
    await logAudit(supabaseAdmin, ctx, "team.delete", {
      team_id: data.team_id,
      name: team.name,
      note: "נמחק כשהצוות היה ריק — ללא משתמשים, נציגים, יעדים או היסטוריית ביצועים משויכים",
    });
    return { ok: true };
  });

export const setUserTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { user_id: string; team_id: string | null }) => {
    if (!data?.user_id) throw new Error("חסר מזהה משתמש");
    return data;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const roles = await getRoles(ctx);
    const isAdmin = roles.includes("admin");
    if (!isAdmin && !roles.includes("manager")) throw new Error("אין לך הרשאה לשייך משתמשים לצוותים");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // A manager may only move a user between "unassigned" and a team they
    // personally manage — never touch a user currently on, or being moved
    // into, a team they don't manage (P2b: "must not transfer users into
    // teams they don't manage"). Checked via the RLS-scoped client so "which
    // teams do I manage" is never re-implemented in application code — same
    // pattern as assertCanManageTeam.
    if (!isAdmin) {
      const { data: currentProfile, error: cpErr } = await supabaseAdmin
        .from("profiles").select("team_id").eq("id", data.user_id).maybeSingle();
      if (cpErr) throw new Error(cpErr.message);
      const teamIdsInvolved = Array.from(
        new Set([currentProfile?.team_id ?? null, data.team_id].filter((id): id is string => !!id)),
      );
      if (teamIdsInvolved.length > 0) {
        const { data: managedTeams, error: mtErr } = await ctx.supabase.from("teams").select("id").in("id", teamIdsInvolved);
        if (mtErr) throw new Error(mtErr.message);
        const managedIds = new Set(((managedTeams ?? []) as { id: string }[]).map((t) => t.id));
        if (!canManagerPerformTeamAssignment(teamIdsInvolved, managedIds)) {
          throw new Error("אין לך הרשאה לשייך משתמש זה — הפעולה מוגבלת למשתמשים ולצוותים שבניהולך");
        }
      }
    }

    // Single atomic write (profiles + representatives, see the migration comment on
    // set_user_team_with_representative_sync). On failure this throws before any
    // audit entry is written — never report success after a partial update.
    const { data: sync, error } = await syncLinkedRepresentativeTeam(supabaseAdmin, data.user_id, data.team_id);
    if (error) throw new Error(error.message);

    const { data: prof } = await supabaseAdmin.from("profiles").select("email").eq("id", data.user_id).maybeSingle();

    // Audit details must never carry raw UUIDs (they render verbatim in the admin
    // audit-log UI) — resolve to human-readable names instead. target_user_id /
    // target_email (structural columns below, not rendered raw) already record the
    // affected user; representative_id below the ORM boundary is superseded here by
    // representative_name for the same reason.
    let representativeName: string | null = null;
    let previousUserTeamName: string | null = null;
    let previousRepresentativeTeamName: string | null = null;
    let newTeamName: string | null = null;
    if (sync?.representative_id) {
      const { data: rep } = await supabaseAdmin.from("representatives").select("name").eq("id", sync.representative_id).maybeSingle();
      representativeName = rep?.name ?? null;
    }
    // previous_profile_team_id is the user's own prior team (P3a: what the
    // "transfer" confirmation warns about) — distinct from
    // previous_representative_team_id, which is the *linked representative's*
    // prior team and can differ if the two assignments had ever drifted.
    if (sync?.previous_profile_team_id) {
      const { data: t } = await supabaseAdmin.from("teams").select("name").eq("id", sync.previous_profile_team_id).maybeSingle();
      previousUserTeamName = t?.name ?? null;
    }
    if (sync?.previous_representative_team_id) {
      const { data: t } = await supabaseAdmin.from("teams").select("name").eq("id", sync.previous_representative_team_id).maybeSingle();
      previousRepresentativeTeamName = t?.name ?? null;
    }
    if (data.team_id) {
      const { data: t } = await supabaseAdmin.from("teams").select("name").eq("id", data.team_id).maybeSingle();
      newTeamName = t?.name ?? null;
    }

    // A real transfer (previous team + new team both set, and different) gets
    // its own audit action distinct from a plain add/remove — P3a asks that
    // this not be conflated with "הוספה" in either the UI or the audit trail.
    const action = data.team_id && previousUserTeamName ? "team.member_transferred" : data.team_id ? "team.member_added" : "team.member_removed";

    await logAudit(
      supabaseAdmin,
      ctx,
      action,
      {
        team_name: newTeamName,
        previous_team_name: previousUserTeamName,
        representative_name: representativeName,
        previous_representative_team_name: previousRepresentativeTeamName,
      },
      data.user_id,
      prof?.email ?? null,
    );
    return { ok: true };
  });

/**
 * Preview (dryRun: true) or apply (dryRun: false) the one-time reconciliation of
 * existing profile/representative team mismatches, per computeTeamReconciliation's
 * rule (representatives.team_id wins). Always call with dryRun: true first and
 * review the returned count/changes before applying — this does not run
 * automatically from a migration.
 */
export const reconcileProfileRepresentativeTeams = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { dryRun: boolean }) => data)
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: reps, error: rErr }, { data: profiles, error: pErr }] = await Promise.all([
      supabaseAdmin.from("representatives").select("id, user_id, team_id, name").not("user_id", "is", null),
      supabaseAdmin.from("profiles").select("id, team_id"),
    ]);
    if (rErr) throw new Error(rErr.message);
    if (pErr) throw new Error(pErr.message);

    const changes = computeTeamReconciliation(
      (reps ?? []) as { id: string; user_id: string | null; team_id: string | null; name: string }[],
      (profiles ?? []) as { id: string; team_id: string | null }[],
    );

    if (data.dryRun) {
      return { count: changes.length, applied: false, changes };
    }

    // Each row's own update is a single atomic UPDATE against a different
    // user's profile — if the batch is interrupted partway, already-reconciled
    // rows stay correctly reconciled and reconciliation is idempotent to
    // re-run (re-running finds fewer/no mismatches next time). That property
    // holds regardless of ordering, so there's no reason to pay for N
    // sequential round trips one at a time — run them concurrently.
    await Promise.all(changes.map((change) => syncLinkedProfileTeam(supabaseAdmin, change.user_id, change.to_team_id)));
    const applied = changes.length;

    await logAudit(supabaseAdmin, ctx, "team.reconciliation_run", { rows_changed: applied });
    return { count: applied, applied: true, changes: [] };
  });
