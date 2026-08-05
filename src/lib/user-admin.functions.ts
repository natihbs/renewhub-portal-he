import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { linkRepresentativeToUserCore } from "@/lib/rep-admin.functions";
import { computeUserHealth, type UserHealth } from "@/lib/user-health";
import { assertTeamIsActiveForNewAssignment, isNewTeamAssignment } from "@/lib/team-assignment-guards";

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

type Ctx = { supabase: any; userId: string; claims: any };

async function assertAdmin(ctx: Ctx) {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error("שגיאה באימות הרשאות");
  if (!data) throw new Error("אין הרשאה לפעולה זו");
}

async function getRoles(ctx: Ctx): Promise<string[]> {
  const { data, error } = await ctx.supabase.from("user_roles").select("role").eq("user_id", ctx.userId);
  if (error) throw new Error("שגיאה באימות הרשאות");
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}

/**
 * Admin, or a manager creating a login for an EXISTING representative in a
 * team they manage (§21/§22 mode 2 continuation: inviting a rep created
 * earlier without login access). A manager may only ever create
 * representative-role accounts, never admin/manager accounts, and only for a
 * rep that doesn't already have a linked login. Returns the rep's team so the
 * handler can force team_id/manager_id rather than trust the client's values.
 */
async function assertCanCreateUser(ctx: Ctx, data: CreateInput): Promise<{ isAdmin: boolean; forcedTeamId?: string | null }> {
  const roles = await getRoles(ctx);
  if (roles.includes("admin")) return { isAdmin: true };
  if (!roles.includes("manager")) throw new Error("אין הרשאה ליצור משתמשים");
  if (data.role !== "representative") throw new Error("מנהל צוות רשאי ליצור חשבונות נציגים בלבד");
  if (!data.representative_id?.trim()) throw new Error("יש לבחור נציג קיים לקישור חשבון הכניסה");
  const { data: rep, error } = await ctx.supabase.from("representatives").select("id, team_id, user_id").eq("id", data.representative_id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!rep) throw new Error("אין לך הרשאה ליצור חשבון עבור נציג זה — הוא אינו בצוות שבניהולך");
  if (rep.user_id) throw new Error("לנציג זה כבר יש חשבון כניסה מקושר");
  return { isAdmin: false, forcedTeamId: rep.team_id ?? null };
}

/**
 * Admin, or a manager acting on a login account that is linked (through the
 * authoritative representatives.user_id, never profiles.team_id — §25) to a
 * representative in a team they manage. Used to gate password resets.
 */
async function assertCanManageLoginViaRep(ctx: Ctx, targetUserId: string): Promise<{ isAdmin: boolean }> {
  const roles = await getRoles(ctx);
  if (roles.includes("admin")) return { isAdmin: true };
  if (!roles.includes("manager")) throw new Error("אין הרשאה לפעולה זו");
  const { data, error } = await ctx.supabase.from("representatives").select("id").eq("user_id", targetUserId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("אין לך הרשאה לאפס סיסמה עבור משתמש זה — הוא אינו נציג בצוות שבניהולך");
  return { isAdmin: false };
}

// Audit logging is best-effort and must never be able to fail (or delay the
// response of) the operation it's recording -- an admin action like deleting
// a user has already taken effect by the time we log it, and a broken audit
// insert must not turn that success into a client-visible error.
async function logAudit(admin: any, actorId: string, actorEmail: string | null, action: string, targetUserId: string | null, targetEmail: string | null, details: Record<string, unknown> = {}) {
  try {
    const { error } = await admin.from("audit_log").insert({
      actor_id: actorId,
      actor_email: actorEmail,
      action,
      target_user_id: targetUserId,
      target_email: targetEmail,
      details,
    });
    if (error) console.error("[audit_log] insert failed", action, error);
  } catch (e) {
    console.error("[audit_log] insert threw", action, e);
  }
}

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: profiles, error: pErr }, { data: roles, error: rErr }, { data: teams, error: tErr }, { data: authList, error: aErr }, { data: reps, error: repsErr }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, email, representative_id, manager_id, team_id, active, last_login_at, created_at, must_change_password"),
      supabaseAdmin.from("user_roles").select("user_id, role"),
      supabaseAdmin.from("teams").select("id, name, manager_id"),
      supabaseAdmin.auth.admin.listUsers({ perPage: 1000 }),
      // Bulk lookup of the authoritative representative link, used for the health badge —
      // representatives.user_id is the source of truth (see linkRepresentativeToUserCore),
      // not the legacy profiles.representative_id column.
      supabaseAdmin.from("representatives").select("id, name, user_id, team_id, active").not("user_id", "is", null),
    ]);
    if (pErr) throw new Error(pErr.message);
    if (rErr) throw new Error(rErr.message);
    if (tErr) throw new Error(tErr.message);
    if (aErr) throw new Error(aErr.message);
    if (repsErr) throw new Error(repsErr.message);

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
    const repByUser = new Map<string, { id: string; name: string; team_id: string | null; active: boolean }>();
    for (const r of (reps ?? []) as { id: string; name: string; user_id: string; team_id: string | null; active: boolean }[]) {
      repByUser.set(r.user_id, r);
    }

    return {
      users: (profiles ?? []).map((p) => {
        const roles = rolesByUser.get(p.id) ?? [];
        const rep = repByUser.get(p.id) ?? null;
        const health = computeUserHealth({
          roles,
          team_id: p.team_id,
          representative_link: rep ? { active: rep.active, team_id: rep.team_id } : null,
        });
        return {
          ...p,
          roles,
          auth_last_sign_in_at: authByUser.get(p.id)?.last_sign_in_at ?? null,
          representative_link: rep ? { id: rep.id, name: rep.name } : null,
          health,
        };
      }),
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
    const { isAdmin, forcedTeamId } = await assertCanCreateUser(context as any, data);
    if (!isAdmin) {
      // A manager's client-supplied team/manager fields are never trusted —
      // both are forced from the representative's own authoritative team.
      data.team_id = forcedTeamId ?? null;
      data.manager_id = context.userId;
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Validate the chosen representative is actually free BEFORE creating the auth
    // account, so a failed link can never leave a half-created account behind.
    if (data.role === "representative" && data.representative_id) {
      const { data: rep, error: repErr } = await supabaseAdmin
        .from("representatives")
        .select("id, user_id")
        .eq("id", data.representative_id)
        .maybeSingle();
      if (repErr) throw new Error(repErr.message);
      if (!rep) throw new Error("הנציג שנבחר לא נמצא");
      if (rep.user_id) throw new Error("הנציג שנבחר כבר מקושר לחשבון משתמש אחר. יש לנתק אותו קודם.");
    }

    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email.trim(),
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (created.error || !created.data.user) throw new Error(created.error?.message ?? "יצירת חשבון נכשלה");
    const newId = created.data.user.id;

    // §P1-1 hardening: profile/role/link used to be three unguarded writes
    // after the auth account already existed — a failure partway (e.g. the
    // role insert) left a real, working login with no role and possibly no
    // representative link: an orphan an admin would only discover later via
    // computeUserHealth's degraded-state badge, not at creation time. Every
    // write below is now caught as one unit; on any failure the auth account
    // itself is deleted as a compensating action (never left as an orphaned
    // login), exactly like inviteLoginForRep's identical pattern. profiles
    // and user_roles both cascade-delete from auth.users, and
    // representatives.user_id is ON DELETE SET NULL, so deleting the auth
    // user alone is a complete, clean rollback of everything below.
    try {
      // upsert profile (trigger may have already inserted it)
      // representative_id is kept for the legacy business-identifier display path (see
      // resolveBusinessIdentifier in team-admin.functions.ts) — it is NOT the authoritative
      // link; representatives.user_id (set below via linkRepresentativeToUserCore) is.
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

      if (data.role === "representative" && data.representative_id) {
        const link = await linkRepresentativeToUserCore(supabaseAdmin, data.representative_id, newId, {
          expectedCurrentUserId: null,
          checkExpected: true,
        });
        await logAudit(supabaseAdmin, context.userId, (context.claims as any).email ?? null, "rep.user_linked", newId, data.email, {
          rep_id: data.representative_id, representative_name: link.rep_name,
        });
      }
    } catch (e) {
      await supabaseAdmin.auth.admin.deleteUser(newId).catch((cleanupErr: unknown) => {
        console.error("[createUser] compensating cleanup failed", newId, cleanupErr);
      });
      throw new Error(`יצירת החשבון נכשלה ובוטלה — לא נוצר חשבון יתום: ${(e as Error).message}. ניתן לנסות שוב.`);
    }

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

    const { data: existingRoleRows } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", data.user_id);
    const existingRoles = ((existingRoleRows ?? []) as { role: AppRole }[]).map((r) => r.role);
    const wasAdmin = existingRoles.includes("admin");

    // Safety: last-active-admin protection when deactivating an admin
    if (data.active === false && wasAdmin) {
      const remaining = await countActiveAdmins(supabaseAdmin, data.user_id);
      if (remaining === 0) throw new Error("לא ניתן להשבית את חשבון המנהל הפעיל האחרון");
    }

    const profileUpdate: {
      full_name?: string | null;
      team_id?: string | null;
      manager_id?: string | null;
      representative_id?: string | null;
      active?: boolean;
      must_change_password?: boolean;
    } = {};
    if (data.full_name !== undefined) profileUpdate.full_name = data.full_name;
    if (data.team_id !== undefined) profileUpdate.team_id = data.team_id;
    if (data.manager_id !== undefined) profileUpdate.manager_id = data.manager_id;
    if (data.representative_id !== undefined) profileUpdate.representative_id = data.representative_id;
    if (data.active !== undefined) profileUpdate.active = data.active;
    if (data.must_change_password !== undefined) profileUpdate.must_change_password = data.must_change_password;

    // Correction (post-review, PR #19): a destination team must be active
    // only when this edit is an actual NEW assignment — never when the form
    // simply resubmits the user's own current (possibly inactive) team_id
    // alongside an unrelated field change (rename, active toggle, etc.), and
    // never for removal (team_id: null). Fetch the user's current team_id so
    // "unchanged" and "changed" can actually be told apart — the previous
    // check (`if (profileUpdate.team_id)`) fired on every non-null
    // resubmission and could block an unrelated edit for a user already on a
    // deactivated team.
    if (profileUpdate.team_id !== undefined) {
      const { data: currentProfile, error: cpErr } = await supabaseAdmin
        .from("profiles").select("team_id").eq("id", data.user_id).maybeSingle();
      if (cpErr) throw new Error(cpErr.message);
      if (isNewTeamAssignment(currentProfile?.team_id ?? null, profileUpdate.team_id)) {
        const { data: destTeam, error: destErr } = await supabaseAdmin.from("teams").select("active").eq("id", profileUpdate.team_id).maybeSingle();
        if (destErr) throw new Error(destErr.message);
        assertTeamIsActiveForNewAssignment(destTeam);
      }
    }

    if (Object.keys(profileUpdate).length > 0) {
      const { error } = await supabaseAdmin.from("profiles").update(profileUpdate).eq("id", data.user_id);
      if (error) throw new Error(error.message);
    }

    if (data.role !== undefined) {
      // last-admin protection when removing admin
      if (wasAdmin && data.role !== "admin") {
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

    // Keep the authoritative representative link (representatives.user_id) consistent
    // with the effective role, whether the role changed on this call or not — e.g. an
    // edit that only swaps the linked representative for an unchanged "representative"
    // role must still update the real link, not just the legacy display field above.
    const effectiveRole = data.role !== undefined ? data.role : (existingRoles[0] as AppRole | undefined) ?? null;
    if (effectiveRole === "representative" && data.representative_id) {
      const link = await linkRepresentativeToUserCore(supabaseAdmin, data.representative_id, data.user_id);
      if (link.from !== link.to) {
        await logAudit(supabaseAdmin, context.userId, (context.claims as any).email ?? null, "rep.user_linked", data.user_id, null, {
          rep_id: data.representative_id, representative_name: link.rep_name,
        });
      }
    } else if (effectiveRole !== "representative") {
      const { data: linkedRep } = await supabaseAdmin.from("representatives").select("id, name").eq("user_id", data.user_id).maybeSingle();
      if (linkedRep) {
        await linkRepresentativeToUserCore(supabaseAdmin, linkedRep.id, null);
        await logAudit(supabaseAdmin, context.userId, (context.claims as any).email ?? null, "rep.user_unlinked", data.user_id, null, {
          rep_id: linkedRep.id, representative_name: linkedRep.name, reason: "role_changed",
        });
      }
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
    // Password resets for a manager are authorized via the authoritative
    // representatives.user_id link only (§25) — never via profiles.team_id.
    await assertCanManageLoginViaRep(context as any, data.user_id);
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile, error: findErr } = await supabaseAdmin.from("profiles").select("id").eq("email", data.email).maybeSingle();
    if (findErr) throw new Error(findErr.message);
    if (!profile) throw new Error("לא נמצא משתמש עם כתובת מייל זו");
    await assertCanManageLoginViaRep(context as any, profile.id);
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(data.email, { redirectTo: data.redirect_to });
    if (error) throw new Error(error.message);
    await logAudit(supabaseAdmin, context.userId, (context.claims as any).email ?? null, "user.email_password_reset", profile.id, data.email, {});
    return { ok: true };
  });

/** Record tables with a plain (non-FK) created_by/owner_id column — used for the
 * delete-dependency "owns records" analysis. These never cascade or block deletion
 * (no FK constraint), so they're informational only in the dependency summary. */
async function collectOwnedRecordCounts(admin: any, userId: string): Promise<Record<string, number>> {
  const createdByTables = ["announcements", "articles", "competitions"] as const;
  const entries = await Promise.all(
    createdByTables.map(async (table) => {
      const { count } = await admin.from(table).select("id", { count: "exact", head: true }).eq("created_by", userId);
      return [table, count ?? 0] as const;
    }),
  );
  const { count: managerCallsCount } = await admin.from("manager_calls").select("id", { count: "exact", head: true }).eq("owner_id", userId);
  return { ...Object.fromEntries(entries), manager_calls: managerCallsCount ?? 0 };
}

export type UserDeleteBlocker = { label: string; count: number };

/**
 * Dependency analysis shared by getUserDeleteCheck (dry-run preview) and deleteUser
 * (server-side re-check, defense against stale client state) — mirrors collectBlockers
 * in rep-admin.functions.ts. Only "is self" and "manages a team" are hard blockers; a
 * representative link is intentionally NOT a blocker here — deleteUser offers "delete
 * login only" for that case instead of refusing outright.
 */
async function collectUserDeleteBlockers(admin: any, userId: string, actingUserId: string) {
  const { data: profile, error } = await admin.from("profiles").select("id, full_name, email").eq("id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile) throw new Error("המשתמש לא נמצא");

  const isSelf = userId === actingUserId;
  const [{ data: managedTeams }, { data: rep }, ownedRecords] = await Promise.all([
    admin.from("teams").select("id, name").eq("manager_id", userId),
    admin.from("representatives").select("id, name").eq("user_id", userId).maybeSingle(),
    collectOwnedRecordCounts(admin, userId),
  ]);

  const blockers: UserDeleteBlocker[] = [];
  if (isSelf) {
    blockers.push({ label: "לא ניתן למחוק את החשבון המחובר", count: 1 });
  }
  if ((managedTeams ?? []).length > 0) {
    const names = (managedTeams as { name: string }[]).map((t) => t.name).join(", ");
    blockers.push({ label: `מנהל הצוות של ${(managedTeams as unknown[]).length} צוות/ים (${names}) — יש לשייך מנהל אחר לצוות תחילה`, count: (managedTeams as unknown[]).length });
  }

  const ownedRecordsTotal = Object.values(ownedRecords).reduce((a: number, b: number) => a + b, 0);

  return {
    user: { id: profile.id as string, full_name: profile.full_name as string | null, email: profile.email as string | null },
    is_self: isSelf,
    managed_teams: (managedTeams ?? []) as { id: string; name: string }[],
    representative_link: rep ? { id: (rep as any).id as string, name: (rep as any).name as string } : null,
    owned_records: ownedRecords,
    owned_records_total: ownedRecordsTotal,
    blockers,
    can_delete: blockers.length === 0,
  };
}

export const getUserDeleteCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { user_id: string }) => {
    if (!data?.user_id) throw new Error("חסר מזהה משתמש");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return collectUserDeleteBlockers(supabaseAdmin, data.user_id, context.userId);
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { user_id: string; confirm_email: string }) => {
    if (!data?.user_id) throw new Error("חסר מזהה משתמש");
    if (!data?.confirm_email?.trim()) throw new Error("יש להקליד את כתובת המייל של המשתמש לאישור המחיקה");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.user_id === context.userId) throw new Error("לא ניתן למחוק את החשבון המחובר");

    // Server-side re-check — never trust a dependency summary the client fetched earlier.
    const check = await collectUserDeleteBlockers(supabaseAdmin, data.user_id, context.userId);
    if (check.blockers.length > 0) {
      throw new Error(`לא ניתן למחוק את המשתמש: ${check.blockers.map((b) => b.label).join("; ")}`);
    }
    if ((check.user.email ?? "").trim().toLowerCase() !== data.confirm_email.trim().toLowerCase()) {
      throw new Error("כתובת המייל שהוקלדה אינה תואמת את כתובת המייל של המשתמש");
    }

    const isTargetAdmin = await isAdminUser(supabaseAdmin, data.user_id);
    if (isTargetAdmin) {
      const remaining = await countActiveAdmins(supabaseAdmin, data.user_id);
      if (remaining === 0) throw new Error("לא ניתן למחוק את חשבון המנהל הפעיל האחרון");
    }

    // Representative data is never auto-deleted — only the login link is cleared,
    // exactly like the "מחיקת חשבון בלבד" path linkRepresentativeUser already supports.
    let unlinkedRepresentative: string | null = null;
    if (check.representative_link) {
      await linkRepresentativeToUserCore(supabaseAdmin, check.representative_link.id, null);
      unlinkedRepresentative = check.representative_link.name;
    }

    // profiles + user_roles cascade-delete automatically (ON DELETE CASCADE on
    // auth.users) — audit_log rows are untouched (no FK) so the trail survives.
    //
    // Idempotent by design: if the account is already gone — e.g. an admin
    // retrying after a connection drop hid a first attempt's (successful)
    // response — Supabase's admin API reports "not found" here. Treat that
    // as success rather than a scary error: the caller's desired end state
    // (this account no longer exists) is already true.
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    const alreadyGone = error && (error.status === 404 || /not.?found/i.test(error.message));
    if (error && !alreadyGone) throw new Error(error.message);

    await logAudit(supabaseAdmin, context.userId, (context.claims as any).email ?? null, "user.delete", data.user_id, check.user.email, {
      full_name: check.user.full_name,
      representative_unlinked: unlinkedRepresentative,
      owned_records_total: check.owned_records_total,
    });
    return { ok: true, representative_unlinked: unlinkedRepresentative };
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

export const getUserDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { user_id: string }) => {
    if (!data?.user_id) throw new Error("חסר מזהה משתמש");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profile, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, team_id, manager_id, active, last_login_at, created_at, must_change_password")
      .eq("id", data.user_id)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!profile) throw new Error("המשתמש לא נמצא");

    const [{ data: roleRows }, authResult, { data: team }, { data: rep }, { data: managedTeams }, ownedRecords] = await Promise.all([
      supabaseAdmin.from("user_roles").select("role").eq("user_id", data.user_id),
      supabaseAdmin.auth.admin.getUserById(data.user_id),
      profile.team_id
        ? supabaseAdmin.from("teams").select("id, name").eq("id", profile.team_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabaseAdmin.from("representatives").select("id, name, active, team_id").eq("user_id", data.user_id).maybeSingle(),
      supabaseAdmin.from("teams").select("id, name").eq("manager_id", data.user_id),
      collectOwnedRecordCounts(supabaseAdmin, data.user_id),
    ]);

    const roles = ((roleRows ?? []) as { role: AppRole }[]).map((r) => r.role);

    let repTeamName: string | null = null;
    if (rep?.team_id) {
      const { data: t } = await supabaseAdmin.from("teams").select("name").eq("id", rep.team_id).maybeSingle();
      repTeamName = t?.name ?? null;
    }

    const health: UserHealth = computeUserHealth({
      roles,
      team_id: profile.team_id,
      representative_link: rep ? { active: rep.active, team_id: rep.team_id } : null,
    });

    return {
      user: {
        ...profile,
        roles,
        auth_last_sign_in_at: (authResult?.data?.user as any)?.last_sign_in_at ?? null,
        team_name: (team as { name: string } | null)?.name ?? null,
      },
      representative_link: rep
        ? { id: rep.id as string, name: rep.name as string, active: rep.active as boolean, team_id: rep.team_id as string | null, team_name: repTeamName }
        : null,
      manages_teams: (managedTeams ?? []) as { id: string; name: string }[],
      owned_records: ownedRecords,
      health,
    };
  });
