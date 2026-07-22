import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type AppRole = "admin" | "manager" | "representative";

type CreateInput = {
  email: string;
  password: string;
  full_name: string;
  role: AppRole;
  team_id: string | null;
  manager_id: string | null;
  representative_id: string | null;
  must_change_password: boolean;
};

type UpdateInput = {
  user_id: string;
  full_name?: string;
  role?: AppRole;
  team_id?: string | null;
  manager_id?: string | null;
  representative_id?: string | null;
  active?: boolean;
  must_change_password?: boolean;
};

async function assertAdmin(ctx: { supabase: any; userId: string; claims: any }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error("שגיאה באימות הרשאות");
  if (!data) throw new Error("אין הרשאה לפעולה זו");
}

async function logAudit(admin: any, actorId: string, actorEmail: string | null, action: string, targetUserId: string | null, targetEmail: string | null, details: Record<string, unknown> = {}) {
  await admin.from("audit_log").insert({
    actor_id: actorId,
    actor_email: actorEmail,
    action,
    target_user_id: targetUserId,
    target_email: targetEmail,
    details,
  });
}

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: profiles, error: pErr }, { data: roles, error: rErr }, { data: teams, error: tErr }, { data: authList, error: aErr }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, email, representative_id, manager_id, team_id, active, last_login_at, created_at, must_change_password"),
      supabaseAdmin.from("user_roles").select("user_id, role"),
      supabaseAdmin.from("teams").select("id, name, manager_id"),
      supabaseAdmin.auth.admin.listUsers({ perPage: 1000 }),
    ]);
    if (pErr) throw new Error(pErr.message);
    if (rErr) throw new Error(rErr.message);
    if (tErr) throw new Error(tErr.message);
    if (aErr) throw new Error(aErr.message);

    const rolesByUser = new Map<string, AppRole[]>();
    for (const r of roles ?? []) {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role as AppRole);
      rolesByUser.set(r.user_id, arr);
    }
    const authByUser = new Map<string, { last_sign_in_at: string | null }>();
    for (const u of authList?.users ?? []) {
      authByUser.set(u.id, { last_sign_in_at: (u as any).last_sign_in_at ?? null });
    }
    return {
      users: (profiles ?? []).map((p) => ({
        ...p,
        roles: rolesByUser.get(p.id) ?? [],
        auth_last_sign_in_at: authByUser.get(p.id)?.last_sign_in_at ?? null,
      })),
      teams: teams ?? [],
    };
  });

export const listAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("audit_log")
      .select("id, actor_email, action, target_email, details, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: CreateInput) => {
    if (!data.email?.trim()) throw new Error("יש להזין כתובת מייל");
    if (!data.password || data.password.length < 8) throw new Error("סיסמה חייבת להיות באורך 8 תווים לפחות");
    if (!data.full_name?.trim()) throw new Error("יש להזין שם מלא");
    if (!["admin", "manager", "representative"].includes(data.role)) throw new Error("תפקיד לא חוקי");
    if (data.role === "representative" && !data.representative_id?.trim()) {
      throw new Error("לנציג יש לשייך מזהה נציג");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email.trim(),
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (created.error || !created.data.user) throw new Error(created.error?.message ?? "יצירת חשבון נכשלה");
    const newId = created.data.user.id;

    // upsert profile (trigger may have already inserted it)
    const { error: pErr } = await supabaseAdmin.from("profiles").upsert({
      id: newId,
      email: data.email.trim(),
      full_name: data.full_name,
      team_id: data.team_id,
      manager_id: data.manager_id,
      representative_id: data.representative_id,
      active: true,
      must_change_password: data.must_change_password,
    });
    if (pErr) throw new Error(pErr.message);

    const { error: rErr } = await supabaseAdmin.from("user_roles").insert({ user_id: newId, role: data.role });
    if (rErr) throw new Error(rErr.message);

    await logAudit(supabaseAdmin, context.userId, (context.claims as any).email ?? null, "user.create", newId, data.email, { role: data.role });
    return { user_id: newId };
  });

export const updateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: UpdateInput) => {
    if (!data.user_id) throw new Error("חסר מזהה משתמש");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Safety: last-active-admin protection when deactivating an admin
    if (data.active === false) {
      const isTargetAdmin = await isAdminUser(supabaseAdmin, data.user_id);
      if (isTargetAdmin) {
        const remaining = await countActiveAdmins(supabaseAdmin, data.user_id);
        if (remaining === 0) throw new Error("לא ניתן להשבית את חשבון המנהל הפעיל האחרון");
      }
    }

    const profileUpdate: Record<string, unknown> = {};
    if (data.full_name !== undefined) profileUpdate.full_name = data.full_name;
    if (data.team_id !== undefined) profileUpdate.team_id = data.team_id;
    if (data.manager_id !== undefined) profileUpdate.manager_id = data.manager_id;
    if (data.representative_id !== undefined) profileUpdate.representative_id = data.representative_id;
    if (data.active !== undefined) profileUpdate.active = data.active;
    if (data.must_change_password !== undefined) profileUpdate.must_change_password = data.must_change_password;

    if (Object.keys(profileUpdate).length > 0) {
      const { error } = await supabaseAdmin.from("profiles").update(profileUpdate).eq("id", data.user_id);
      if (error) throw new Error(error.message);
    }

    if (data.role !== undefined) {
      // last-admin protection when removing admin
      const currentAdmin = await isAdminUser(supabaseAdmin, data.user_id);
      if (currentAdmin && data.role !== "admin") {
        const remaining = await countActiveAdmins(supabaseAdmin, data.user_id);
        if (remaining === 0) throw new Error("לא ניתן להסיר את התפקיד מהמנהל הפעיל האחרון");
      }
      // Prevent admin from removing their own admin role
      if (data.user_id === context.userId && data.role !== "admin") {
        throw new Error("לא ניתן להסיר את תפקיד המנהל מהחשבון שלך");
      }
      await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
      const { error } = await supabaseAdmin.from("user_roles").insert({ user_id: data.user_id, role: data.role });
      if (error) throw new Error(error.message);
    }

    await logAudit(supabaseAdmin, context.userId, (context.claims as any).email ?? null, "user.update", data.user_id, null, {
      changed: Object.keys(profileUpdate),
      role: data.role ?? null,
    });
    return { ok: true };
  });

export const resetPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { user_id: string; new_password: string; must_change: boolean }) => {
    if (!data.user_id) throw new Error("חסר מזהה משתמש");
    if (!data.new_password || data.new_password.length < 8) throw new Error("סיסמה חייבת להיות באורך 8 תווים לפחות");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, { password: data.new_password });
    if (error) throw new Error(error.message);
    if (data.must_change) {
      await supabaseAdmin.from("profiles").update({ must_change_password: true }).eq("id", data.user_id);
    }
    await logAudit(supabaseAdmin, context.userId, (context.claims as any).email ?? null, "user.reset_password", data.user_id, null, { must_change: data.must_change });
    return { ok: true };
  });

export const sendPasswordResetEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { email: string; redirect_to: string }) => data)
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(data.email, { redirectTo: data.redirect_to });
    if (error) throw new Error(error.message);
    await logAudit(supabaseAdmin, context.userId, (context.claims as any).email ?? null, "user.email_password_reset", null, data.email, {});
    return { ok: true };
  });

async function isAdminUser(admin: any, userId: string): Promise<boolean> {
  const { data } = await admin.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  return !!data;
}

// Returns the number of OTHER active admins (excluding excludeUserId)
async function countActiveAdmins(admin: any, excludeUserId: string): Promise<number> {
  const { data: adminRoles } = await admin.from("user_roles").select("user_id").eq("role", "admin");
  const ids = ((adminRoles ?? []) as { user_id: string }[]).map((r) => r.user_id).filter((id) => id !== excludeUserId);
  if (ids.length === 0) return 0;
  const { data: profs } = await admin.from("profiles").select("id, active").in("id", ids);
  return ((profs ?? []) as { id: string; active: boolean }[]).filter((p) => p.active).length;
}
