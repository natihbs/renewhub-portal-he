import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: any; userId: string; claims: any };

export type RepTeamKey = "car" | "home";

export type CloudRep = {
  id: string;
  name: string;
  team_id: string | null;
  team_key: RepTeamKey;
  monthly_target: number;
  current_result: number;
  external_ref: string | null;
  user_id: string | null;
  active: boolean;
  deactivated_at: string | null;
  created_at: string;
  updated_at: string;
};

async function getRoles(ctx: Ctx): Promise<string[]> {
  const { data, error } = await ctx.supabase.from("user_roles").select("role").eq("user_id", ctx.userId);
  if (error) throw new Error("שגיאה באימות הרשאות");
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}

async function assertAdmin(ctx: Ctx) {
  const roles = await getRoles(ctx);
  if (!roles.includes("admin")) throw new Error("אין הרשאה לפעולה זו — פעולה זו מיועדת למנהלי מערכת בלבד");
}

async function assertCanEdit(ctx: Ctx, repId: string) {
  const roles = await getRoles(ctx);
  if (roles.includes("admin")) return { isAdmin: true };
  if (!roles.includes("manager")) throw new Error("אין לך הרשאה לעדכן נציגים");
  // Manager may only touch reps in teams they manage — verified through RLS-scoped client.
  const { data, error } = await ctx.supabase.from("representatives").select("id").eq("id", repId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("אין לך הרשאה לעדכן נציג זה — הוא אינו משויך לצוות שבניהולך");
  return { isAdmin: false };
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

/** Visible to every authenticated user; rows are scoped by RLS. */
export const listRepresentatives = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const roles = await getRoles(ctx);
    const [{ data: reps, error: rErr }, { data: teams, error: tErr }, { data: profiles, error: pErr }] = await Promise.all([
      ctx.supabase
        .from("representatives")
        .select("id, name, team_id, team_key, monthly_target, current_result, external_ref, user_id, active, deactivated_at, created_at, updated_at")
        .order("created_at", { ascending: false }),
      ctx.supabase.from("teams").select("id, name, manager_id, active"),
      ctx.supabase.from("profiles").select("id, full_name, email, active, team_id, representative_id"),
    ]);
    if (rErr) throw new Error(rErr.message);
    if (tErr) throw new Error(tErr.message);
    if (pErr) throw new Error(pErr.message);

    const profileById = new Map<string, any>();
    for (const p of (profiles ?? []) as any[]) profileById.set(p.id, p);
    const teamById = new Map<string, any>();
    for (const t of (teams ?? []) as any[]) teamById.set(t.id, t);

    return {
      reps: ((reps ?? []) as CloudRep[]).map((r) => {
        const team = r.team_id ? teamById.get(r.team_id) : null;
        const linked = r.user_id ? profileById.get(r.user_id) : null;
        return {
          ...r,
          team_name: team?.name ?? null,
          manager_id: team?.manager_id ?? null,
          linked_user: linked
            ? { id: linked.id, full_name: linked.full_name, email: linked.email, active: linked.active }
            : null,
        };
      }),
      teams: (teams ?? []) as { id: string; name: string; manager_id: string | null; active: boolean }[],
      people: (profiles ?? []) as any[],
      isAdmin: roles.includes("admin"),
      isManager: roles.includes("manager"),
    };
  });

type RepInput = {
  name: string;
  team_id: string | null;
  team_key: RepTeamKey;
  monthly_target: number;
  current_result: number;
  external_ref: string | null;
  user_id: string | null;
  active: boolean;
};

function validateRep(data: RepInput): RepInput {
  if (!data?.name?.trim()) throw new Error("יש להזין שם נציג");
  if (data.name.trim().length > 80) throw new Error("שם הנציג ארוך מדי");
  if (!["car", "home"].includes(data.team_key)) throw new Error("סוג צוות לא חוקי");
  const target = Number(data.monthly_target);
  const result = Number(data.current_result);
  if (!Number.isFinite(target) || target < 0) throw new Error("יעד חודשי לא חוקי");
  if (!Number.isFinite(result) || result < 0) throw new Error("תוצאה נוכחית לא חוקית");
  return {
    ...data,
    name: data.name.trim(),
    monthly_target: Math.round(target),
    current_result: Math.round(result),
    external_ref: data.external_ref?.trim() || null,
  };
}

export const createRepresentative = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: RepInput) => validateRep(data))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.user_id) await assertUserFree(supabaseAdmin, data.user_id, null);
    const { data: created, error } = await supabaseAdmin
      .from("representatives")
      .insert({
        name: data.name,
        team_id: data.team_id,
        team_key: data.team_key,
        monthly_target: data.monthly_target,
        current_result: data.current_result,
        external_ref: data.external_ref,
        user_id: data.user_id,
        active: data.active,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await logAudit(supabaseAdmin, ctx, "rep.create", { rep_id: created.id, name: data.name, team_id: data.team_id }, data.user_id);
    return { rep_id: created.id as string };
  });

async function assertUserFree(admin: any, userId: string, exceptRepId: string | null) {
  const { data } = await admin.from("representatives").select("id, name").eq("user_id", userId).maybeSingle();
  if (data && data.id !== exceptRepId) {
    throw new Error(`חשבון המשתמש כבר מקושר לנציג "${data.name}". יש לנתק אותו קודם.`);
  }
}

export const updateRepresentative = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: RepInput & { rep_id: string }) => {
    if (!data?.rep_id) throw new Error("חסר מזהה נציג");
    return { ...validateRep(data), rep_id: data.rep_id };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertCanEdit(ctx, data.rep_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin
      .from("representatives")
      .select("name, team_id, team_key, monthly_target, current_result, external_ref, user_id, active")
      .eq("id", data.rep_id)
      .maybeSingle();
    if (!before) throw new Error("הנציג לא נמצא");
    if (data.user_id && data.user_id !== before.user_id) await assertUserFree(supabaseAdmin, data.user_id, data.rep_id);

    const { error } = await supabaseAdmin
      .from("representatives")
      .update({
        name: data.name,
        team_id: data.team_id,
        team_key: data.team_key,
        monthly_target: data.monthly_target,
        current_result: data.current_result,
        external_ref: data.external_ref,
        user_id: data.user_id,
        active: data.active,
        deactivated_at: data.active ? null : (before.active ? new Date().toISOString() : undefined),
      })
      .eq("id", data.rep_id);
    if (error) throw new Error(error.message);

    await logAudit(supabaseAdmin, ctx, "rep.update", { rep_id: data.rep_id, before, after: data });
    if (before.team_id !== data.team_id) {
      await logAudit(supabaseAdmin, ctx, "rep.transfer", { rep_id: data.rep_id, from_team: before.team_id, to_team: data.team_id });
    }
    if (before.active !== data.active) {
      await logAudit(supabaseAdmin, ctx, data.active ? "rep.reactivate" : "rep.deactivate", { rep_id: data.rep_id });
    }
    if (before.user_id !== data.user_id) {
      await logAudit(supabaseAdmin, ctx, data.user_id ? "rep.user_linked" : "rep.user_unlinked", {
        rep_id: data.rep_id, from: before.user_id, to: data.user_id,
      }, data.user_id ?? before.user_id);
    }
    return { ok: true };
  });

export const setRepresentativeActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { rep_id: string; active: boolean; deactivate_user?: boolean }) => {
    if (!data?.rep_id) throw new Error("חסר מזהה נציג");
    return data;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { isAdmin } = await assertCanEdit(ctx, data.rep_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rep } = await supabaseAdmin.from("representatives").select("user_id, name, active").eq("id", data.rep_id).maybeSingle();
    if (!rep) throw new Error("הנציג לא נמצא");

    const { error } = await supabaseAdmin
      .from("representatives")
      .update({ active: data.active, deactivated_at: data.active ? null : new Date().toISOString() })
      .eq("id", data.rep_id);
    if (error) throw new Error(error.message);

    if (data.deactivate_user && rep.user_id) {
      if (!isAdmin) throw new Error("רק מנהל מערכת רשאי להשבית חשבון משתמש");
      const { error: uErr } = await supabaseAdmin.from("profiles").update({ active: data.active }).eq("id", rep.user_id);
      if (uErr) throw new Error(uErr.message);
      await logAudit(supabaseAdmin, ctx, data.active ? "user.activate" : "user.deactivate", { via: "rep", rep_id: data.rep_id }, rep.user_id);
    }

    await logAudit(supabaseAdmin, ctx, data.active ? "rep.reactivate" : "rep.deactivate", {
      rep_id: data.rep_id, name: rep.name, also_user: !!data.deactivate_user,
    }, rep.user_id ?? null);
    return { ok: true };
  });

export const setRepresentativeTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { rep_id: string; team_id: string | null; team_key?: RepTeamKey }) => {
    if (!data?.rep_id) throw new Error("חסר מזהה נציג");
    return data;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rep } = await supabaseAdmin.from("representatives").select("team_id, user_id, name").eq("id", data.rep_id).maybeSingle();
    if (!rep) throw new Error("הנציג לא נמצא");

    const update: Record<string, unknown> = { team_id: data.team_id };
    if (data.team_key) update['team_key'] = data.team_key;
    const { error } = await supabaseAdmin.from("representatives").update(update).eq("id", data.rep_id);
    if (error) throw new Error(error.message);

    // Keep the linked user's profile aligned with the new team + manager.
    if (rep.user_id) {
      let managerId: string | null = null;
      if (data.team_id) {
        const { data: team } = await supabaseAdmin.from("teams").select("manager_id").eq("id", data.team_id).maybeSingle();
        managerId = team?.manager_id ?? null;
      }
      await supabaseAdmin.from("profiles").update({ team_id: data.team_id, manager_id: managerId }).eq("id", rep.user_id);
    }

    await logAudit(supabaseAdmin, ctx, "rep.transfer", {
      rep_id: data.rep_id, name: rep.name, from_team: rep.team_id, to_team: data.team_id,
    }, rep.user_id ?? null);
    return { ok: true };
  });

export const linkRepresentativeUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { rep_id: string; user_id: string | null }) => {
    if (!data?.rep_id) throw new Error("חסר מזהה נציג");
    return data;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rep } = await supabaseAdmin.from("representatives").select("user_id, name").eq("id", data.rep_id).maybeSingle();
    if (!rep) throw new Error("הנציג לא נמצא");
    if (data.user_id) await assertUserFree(supabaseAdmin, data.user_id, data.rep_id);

    const { error } = await supabaseAdmin.from("representatives").update({ user_id: data.user_id }).eq("id", data.rep_id);
    if (error) throw new Error(error.message);
    await logAudit(supabaseAdmin, ctx, data.user_id ? "rep.user_linked" : "rep.user_unlinked", {
      rep_id: data.rep_id, name: rep.name, from: rep.user_id, to: data.user_id,
    }, data.user_id ?? rep.user_id ?? null);
    return { ok: true };
  });

export type DeleteBlocker = { label: string; count: number };

/** Cloud-side links that must be cleared before a permanent delete. */
async function collectBlockers(admin: any, repId: string): Promise<DeleteBlocker[]> {
  const { data: rep } = await admin
    .from("representatives")
    .select("id, name, user_id, external_ref")
    .eq("id", repId)
    .maybeSingle();
  if (!rep) throw new Error("הנציג לא נמצא");
  const blockers: DeleteBlocker[] = [];
  if (rep.user_id) blockers.push({ label: "חשבון משתמש מקושר", count: 1 });
  if (rep.external_ref) {
    const { count } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("representative_id", rep.external_ref);
    if (count && count > 0) blockers.push({ label: "פרופילי משתמשים עם מזהה נציג זהה", count });
  }
  return blockers;
}

export const getRepresentativeDeleteCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { rep_id: string }) => {
    if (!data?.rep_id) throw new Error("חסר מזהה נציג");
    return data;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const blockers = await collectBlockers(supabaseAdmin, data.rep_id);
    return { blockers, canDelete: blockers.length === 0 };
  });

export const deleteRepresentative = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { rep_id: string; confirm_name: string; local_links?: DeleteBlocker[] }) => {
    if (!data?.rep_id) throw new Error("חסר מזהה נציג");
    if (!data.confirm_name?.trim()) throw new Error("יש להקליד את שם הנציג לאישור המחיקה");
    return data;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rep } = await supabaseAdmin
      .from("representatives")
      .select("id, name, team_id, user_id, external_ref")
      .eq("id", data.rep_id)
      .maybeSingle();
    if (!rep) throw new Error("הנציג לא נמצא");
    if (rep.name.trim() !== data.confirm_name.trim()) throw new Error("שם הנציג שהוקלד אינו תואם");

    const blockers = [
      ...(await collectBlockers(supabaseAdmin, data.rep_id)),
      ...((data.local_links ?? []).filter((l) => l && l.count > 0)),
    ];
    if (blockers.length > 0) {
      const list = blockers.map((b) => `${b.label} (${b.count})`).join(", ");
      throw new Error(
        `לא ניתן למחוק את הנציג משום שקיימים נתונים היסטוריים מקושרים: ${list}. ניתן להשבית את הנציג או להעביר את הרשומות.`,
      );
    }

    const { error } = await supabaseAdmin.from("representatives").delete().eq("id", data.rep_id);
    if (error) throw new Error(error.message);
    await logAudit(supabaseAdmin, ctx, "rep.delete", { rep_id: rep.id, name: rep.name, team_id: rep.team_id });
    return { ok: true };
  });
