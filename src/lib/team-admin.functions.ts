import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_KPI_PROFILE, type KpiProfile } from "@/lib/performance-domain";

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
      canManage: isAdmin,
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
    await assertAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("teams").select("manager_id, active, name, kpi_profile").eq("id", data.team_id).maybeSingle();
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
    if (before && before.manager_id !== data.manager_id) {
      await logAudit(supabaseAdmin, ctx, "team.manager_assigned", { team_id: data.team_id, from: before.manager_id, to: data.manager_id });
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
    await assertAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: linked, error: lErr } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .eq("team_id", data.team_id);
    if (lErr) throw new Error(lErr.message);
    if ((linked ?? []).length > 0) {
      const names = (linked ?? []).slice(0, 5).map((p: any) => p.full_name || p.email).join(", ");
      throw new Error(
        `לא ניתן למחוק את הצוות — משויכים אליו ${linked!.length} משתמשים (${names}). יש לשייך אותם לצוות אחר, או לבחור ב"השבתת צוות" במקום מחיקה.`,
      );
    }

    const { data: team } = await supabaseAdmin.from("teams").select("name").eq("id", data.team_id).maybeSingle();
    const { error } = await supabaseAdmin.from("teams").delete().eq("id", data.team_id);
    if (error) throw new Error(error.message);
    await logAudit(supabaseAdmin, ctx, "team.delete", { team_id: data.team_id, name: team?.name ?? null });
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
    await assertAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let managerId: string | null | undefined = undefined;
    if (data.team_id) {
      const { data: team } = await supabaseAdmin.from("teams").select("manager_id").eq("id", data.team_id).maybeSingle();
      managerId = team?.manager_id ?? null;
    }
    const update: { team_id: string | null; manager_id?: string | null } = { team_id: data.team_id };
    if (managerId !== undefined) update.manager_id = managerId;

    const { error } = await supabaseAdmin.from("profiles").update(update).eq("id", data.user_id);
    if (error) throw new Error(error.message);

    const { data: prof } = await supabaseAdmin.from("profiles").select("email").eq("id", data.user_id).maybeSingle();
    await logAudit(
      supabaseAdmin,
      ctx,
      data.team_id ? "team.member_added" : "team.member_removed",
      { team_id: data.team_id },
      data.user_id,
      prof?.email ?? null,
    );
    return { ok: true };
  });
