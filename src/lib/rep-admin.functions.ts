import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertTeamIsActiveForNewAssignment } from "@/lib/team-assignment-guards";

type Ctx = { supabase: any; userId: string; claims: any };

export type CloudRep = {
  id: string;
  name: string;
  team_id: string | null;
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

/**
 * Admin, or a manager creating a representative in a team they manage —
 * verified through the RLS-scoped client ("teams manager reads own"), same
 * pattern as assertCanManageTeam in goals.functions.ts. A manager must
 * always name a real team of their own; there is no "unassigned" option for
 * them (an unassigned rep would be invisible to every manager under RLS).
 */
async function assertCanCreateRep(ctx: Ctx, teamId: string | null): Promise<{ isAdmin: boolean }> {
  const roles = await getRoles(ctx);
  if (roles.includes("admin")) return { isAdmin: true };
  if (!roles.includes("manager")) throw new Error("אין הרשאה ליצור נציגים");
  if (!teamId) throw new Error("יש לבחור צוות ליצירת נציג");
  const { data, error } = await ctx.supabase.from("teams").select("id").eq("id", teamId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("אין לך הרשאה ליצור נציג בצוות זה — הוא אינו בניהולך");
  return { isAdmin: false };
}

/**
 * Admin, or a manager linking/unlinking a login account for a rep in a team
 * they manage. Linking (not unlinking) additionally requires the target
 * account to not itself hold an admin/manager role — a manager must never be
 * able to attach a rep record to a privileged account. Enforced here, not
 * just left to the caller's dropdown, since assertUserFree alone only checks
 * "not already linked to a different rep", not "safe for a manager to link".
 */
async function assertCanLinkUser(ctx: Ctx, admin: any, repId: string, targetUserId: string | null): Promise<{ isAdmin: boolean }> {
  const roles = await getRoles(ctx);
  const isAdmin = roles.includes("admin");
  if (!isAdmin) {
    if (!roles.includes("manager")) throw new Error("אין הרשאה לקשר חשבון משתמש");
    // Manager may only touch a rep in a team they manage — RLS-scoped read.
    const { data, error } = await ctx.supabase.from("representatives").select("id, team_id").eq("id", repId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("אין לך הרשאה לנציג זה — הוא אינו משויך לצוות שבניהולך");
  }
  // Target-account eligibility applies uniformly regardless of caller role —
  // a representative login must always be representative-role-only and not
  // already linked elsewhere, whoever performs the link (§5 hardening).
  // assertUserFree (called by linkRepresentativeToUserCore right after this)
  // separately guarantees "not already linked to a different representative"
  // — this only needs to guarantee the account's role shape is safe.
  if (targetUserId) {
    const { data: roleRows, error: roleErr } = await admin.from("user_roles").select("role").eq("user_id", targetUserId);
    if (roleErr) throw new Error(roleErr.message);
    const targetRoles = ((roleRows ?? []) as { role: string }[]).map((r) => r.role);
    if (targetRoles.includes("admin") || targetRoles.includes("manager")) {
      throw new Error("לא ניתן לקשר חשבון מנהל מערכת או מנהל צוות כנציג");
    }
    if (!targetRoles.includes("representative")) {
      throw new Error("ניתן לקשר רק חשבון מסוג נציג");
    }
  }
  return { isAdmin };
}

/**
 * Server-side eligibility lookup for the "link existing account" workflow
 * (§5 hardening): resolves exactly one account by exact email and reports
 * whether it is eligible to be linked, applying the identical rule
 * assertCanLinkUser enforces at write time — never returns or exposes a
 * browsable list of organizational users, admin or manager alike. Any
 * ineligibility reason (privileged role, wrong role, already linked) is
 * reported honestly rather than silently returning nothing.
 */
export const findEligibleLinkAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { email: string }) => {
    if (!data?.email?.trim()) throw new Error("יש להזין כתובת מייל");
    return { email: data.email.trim() };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const roles = await getRoles(ctx);
    if (!roles.includes("admin") && !roles.includes("manager")) throw new Error("אין הרשאה לחיפוש חשבונות");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: profile, error: pErr } = await supabaseAdmin.from("profiles").select("id, full_name, email").eq("email", data.email).maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!profile) throw new Error("לא נמצא חשבון עם כתובת מייל זו");

    const { data: roleRows, error: rErr } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", profile.id);
    if (rErr) throw new Error(rErr.message);
    const accountRoles = ((roleRows ?? []) as { role: string }[]).map((r) => r.role);
    if (accountRoles.includes("admin") || accountRoles.includes("manager")) {
      throw new Error("לא ניתן לקשר חשבון מנהל מערכת או מנהל צוות כנציג");
    }
    if (!accountRoles.includes("representative")) {
      throw new Error("החשבון אינו מסוג נציג — לא ניתן לקשר אותו");
    }

    const { data: existingLink, error: linkErr } = await supabaseAdmin.from("representatives").select("id, name").eq("user_id", profile.id).maybeSingle();
    if (linkErr) throw new Error(linkErr.message);
    if (existingLink) throw new Error(`החשבון כבר מקושר לנציג "${existingLink.name}"`);

    return { id: profile.id as string, full_name: profile.full_name as string | null, email: profile.email as string | null };
  });

/**
 * Keep a representative's linked login account aligned with the representative's team,
 * so a rep with an account always shows up consistently under both "חברי הצוות" and
 * "נציגים בצוות" for the same team. Every write path that can change a representative's
 * team_id or user_id must call this for the (possibly new) linked user.
 *
 * Only ever pushes representative -> profile. Never call this to react to a user being
 * unlinked/removed from a representative — that profile's team_id must be left alone
 * (a login account's team membership doesn't depend on having a linked representative).
 */
export async function syncLinkedProfileTeam(admin: any, userId: string, teamId: string | null) {
  let managerId: string | null = null;
  if (teamId) {
    const { data: team } = await admin.from("teams").select("manager_id").eq("id", teamId).maybeSingle();
    managerId = team?.manager_id ?? null;
  }
  await admin.from("profiles").update({ team_id: teamId, manager_id: managerId }).eq("id", userId);
}

// Audit logging is best-effort and must never be able to fail (or delay the
// response of) the operation it's recording — see the identical fix in
// user-admin.functions.ts's logAudit for the full rationale.
async function logAudit(
  admin: any,
  ctx: Ctx,
  action: string,
  details: Record<string, unknown>,
  targetUserId: string | null = null,
  targetEmail: string | null = null,
) {
  try {
    const { error } = await admin.from("audit_log").insert({
      actor_id: ctx.userId,
      actor_email: (ctx.claims as any)?.email ?? null,
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

/** Visible to every authenticated user; rows are scoped by RLS. */
export const listRepresentatives = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const roles = await getRoles(ctx);
    const [{ data: reps, error: rErr }, { data: teams, error: tErr }, { data: profiles, error: pErr }] = await Promise.all([
      ctx.supabase
        .from("representatives")
        .select("id, name, team_id, monthly_target, current_result, external_ref, user_id, active, deactivated_at, created_at, updated_at")
        .order("created_at", { ascending: false }),
      ctx.supabase.from("teams").select("id, name, manager_id, active, kpi_profile"),
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
      teams: (teams ?? []) as { id: string; name: string; manager_id: string | null; active: boolean; kpi_profile: string }[],
      people: (profiles ?? []) as any[],
      isAdmin: roles.includes("admin"),
      isManager: roles.includes("manager"),
    };
  });

type RepInput = {
  name: string;
  team_id: string | null;
  // Legacy per-rep target column. No longer editable through this dialog —
  // the official target (representative_goals, see goals.functions.ts) is
  // the sole source of truth for personal targets going forward. Optional
  // here purely so create/update can omit it without a validation error;
  // when present it is still written (kept in sync defensively, never
  // consumed by any target calculation anymore).
  monthly_target?: number;
  current_result: number;
  external_ref: string | null;
  user_id: string | null;
  active: boolean;
};

function validateRep(data: RepInput): RepInput {
  if (!data?.name?.trim()) throw new Error("יש להזין שם נציג");
  if (data.name.trim().length > 80) throw new Error("שם הנציג ארוך מדי");
  const result = Number(data.current_result);
  if (!Number.isFinite(result) || result < 0) throw new Error("תוצאה נוכחית לא חוקית");
  let monthly_target: number | undefined;
  if (data.monthly_target !== undefined) {
    const target = Number(data.monthly_target);
    if (!Number.isFinite(target) || target < 0) throw new Error("יעד חודשי לא חוקי");
    monthly_target = Math.round(target);
  }
  return {
    ...data,
    name: data.name.trim(),
    monthly_target,
    current_result: Math.round(result),
    external_ref: data.external_ref?.trim() || null,
  };
}

export const createRepresentative = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: RepInput) => validateRep(data))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { isAdmin } = await assertCanCreateRep(ctx, data.team_id);
    if (!isAdmin && data.user_id) {
      throw new Error("קישור חשבון משתמש בעת יצירת נציג מתבצע דרך הזמנה או קישור ייעודי");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.team_id) {
      const { data: destTeam, error: destErr } = await supabaseAdmin.from("teams").select("active").eq("id", data.team_id).maybeSingle();
      if (destErr) throw new Error(destErr.message);
      assertTeamIsActiveForNewAssignment(destTeam);
    }
    if (data.user_id) await assertUserFree(supabaseAdmin, data.user_id, null);
    const { data: created, error } = await supabaseAdmin
      .from("representatives")
      .insert({
        name: data.name,
        team_id: data.team_id,
        monthly_target: data.monthly_target ?? 0,
        current_result: data.current_result,
        external_ref: data.external_ref,
        user_id: data.user_id,
        active: data.active,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    if (data.user_id) await syncLinkedProfileTeam(supabaseAdmin, data.user_id, data.team_id);
    await logAudit(supabaseAdmin, ctx, "rep.create", { rep_id: created.id, name: data.name, team_id: data.team_id }, data.user_id);
    return { rep_id: created.id as string };
  });

/**
 * Mode 2 of representative creation (§22): creates the representative
 * business record AND invites a login account for it in one workflow,
 * available to admins and to managers (scoped to teams they manage).
 *
 * Compensating-transaction strategy (no native cross-system transaction
 * between Postgres and Supabase Auth exists):
 *   1. Create the representative row first. On its own this is already a
 *      complete, valid, supported end state (a rep with no login access) —
 *      never a half-finished thing to clean up.
 *   2. Invite the auth account. If this fails, the representative from step
 *      1 is left standing — a real, reportable rep, not an orphan.
 *   3. Create profile + role + link. If any of these three fail, the auth
 *      user created in step 2 is not yet referenced by anything (no profile,
 *      no role, no representatives.user_id link), so it is safe to delete it
 *      as a compensating action — never left as an orphaned login with no
 *      profile/role. The representative row still stands, unlinked.
 * Every failure path throws a specific, honest message describing exactly
 * what succeeded and what didn't — never a generic "success" after partial
 * failure.
 */
type InviteRepInput = {
  name: string;
  team_id: string | null;
  external_ref: string | null;
  email: string;
  full_name: string;
  redirect_to: string;
};

/**
 * Shared compensating-transaction core for "invite a login for a
 * representative", used by both createRepresentativeWithInvite (new rep) and
 * inviteRepresentativeLogin (existing rep, §22 follow-up gap). Steps 2-3 of
 * the strategy documented above `createRepresentativeWithInvite`: invite the
 * auth account, then create profile + role + link, with the auth account
 * deleted as a compensating action if the second half fails. The caller is
 * responsible for step 1 (representative already exists, either just-created
 * or pre-existing) and for wording the "what already succeeded" prefix on
 * its own error message.
 */
async function inviteLoginForRep(
  admin: any,
  repId: string,
  teamId: string | null,
  email: string,
  fullName: string,
  redirectTo: string,
): Promise<{ user_id: string }> {
  const { data: existingProfile } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existingProfile) {
    throw new Error("קיים כבר חשבון עם כתובת מייל זו. ניתן לקשר את הנציג לחשבון הקיים דרך פעולת קישור חשבון קיים במקום.");
  }

  const invited = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { full_name: fullName },
  });
  if (invited.error || !invited.data.user) {
    throw new Error(`שליחת ההזמנה נכשלה: ${invited.error?.message ?? "שגיאה לא ידועה"}.`);
  }
  const newUserId = invited.data.user.id as string;

  try {
    const { error: pErr } = await admin.from("profiles").upsert({
      id: newUserId, email, full_name: fullName, team_id: teamId, active: true, must_change_password: false,
    });
    if (pErr) throw new Error(pErr.message);
    const { error: rErr } = await admin.from("user_roles").insert({ user_id: newUserId, role: "representative" });
    if (rErr) throw new Error(rErr.message);
    await linkRepresentativeToUserCore(admin, repId, newUserId);
  } catch {
    await admin.auth.admin.deleteUser(newUserId).catch((cleanupErr: unknown) => {
      console.error("[inviteLoginForRep] compensating cleanup failed", newUserId, cleanupErr);
    });
    throw new Error("יצירת חשבון הכניסה נכשלה ובוטלה — לא נוצר חשבון יתום. ניתן לנסות שוב.");
  }

  return { user_id: newUserId };
}

export const createRepresentativeWithInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: InviteRepInput) => {
    if (!data?.name?.trim()) throw new Error("יש להזין שם נציג");
    if (data.name.trim().length > 80) throw new Error("שם הנציג ארוך מדי");
    if (!data?.email?.trim()) throw new Error("יש להזין כתובת מייל להזמנה");
    if (!data?.redirect_to?.trim()) throw new Error("חסרה כתובת הפניה להזמנה");
    return {
      name: data.name.trim(),
      team_id: data.team_id ?? null,
      external_ref: data.external_ref?.trim() || null,
      email: data.email.trim(),
      full_name: data.full_name?.trim() || data.name.trim(),
      redirect_to: data.redirect_to,
    };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertCanCreateRep(ctx, data.team_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.team_id) {
      const { data: destTeam, error: destErr } = await supabaseAdmin.from("teams").select("active").eq("id", data.team_id).maybeSingle();
      if (destErr) throw new Error(destErr.message);
      assertTeamIsActiveForNewAssignment(destTeam);
    }

    const { data: created, error: repErr } = await supabaseAdmin
      .from("representatives")
      .insert({
        name: data.name, team_id: data.team_id, monthly_target: 0, current_result: 0,
        external_ref: data.external_ref, user_id: null, active: true,
      })
      .select("id")
      .single();
    if (repErr) throw new Error(repErr.message);

    try {
      const { user_id } = await inviteLoginForRep(supabaseAdmin, created.id, data.team_id, data.email, data.full_name, data.redirect_to);
      await logAudit(supabaseAdmin, ctx, "rep.create_with_invite", { rep_id: created.id, name: data.name, team_id: data.team_id }, user_id, data.email);
      return { rep_id: created.id as string, user_id };
    } catch (e) {
      await logAudit(supabaseAdmin, ctx, "rep.create", { rep_id: created.id, name: data.name, team_id: data.team_id, invite_failed: true });
      throw new Error(
        `הנציג "${data.name}" נוצר בהצלחה. ${(e as Error).message} ניתן להזמין או לקשר חשבון מרשימת הנציגים בכל עת.`,
      );
    }
  });

/**
 * Mode 2 follow-up (§22 gap): invite a login for a representative that
 * already exists but has no linked account yet. Admin, or a manager of the
 * rep's own team (assertCanEdit — same authorization already proven for
 * update/deactivate). Uses the rep's real, current team_id as the
 * authoritative team for the new profile — never a client-supplied value.
 * Shares the exact same invite+profile+role+link compensating-transaction
 * guarantees as createRepresentativeWithInvite via inviteLoginForRep.
 */
type InviteExistingRepInput = { rep_id: string; email: string; full_name: string; redirect_to: string };

export const inviteRepresentativeLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: InviteExistingRepInput) => {
    if (!data?.rep_id) throw new Error("חסר מזהה נציג");
    if (!data?.email?.trim()) throw new Error("יש להזין כתובת מייל להזמנה");
    if (!data?.redirect_to?.trim()) throw new Error("חסרה כתובת הפניה להזמנה");
    return { rep_id: data.rep_id, email: data.email.trim(), full_name: data.full_name?.trim() || "", redirect_to: data.redirect_to };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertCanEdit(ctx, data.rep_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rep, error: repErr } = await supabaseAdmin
      .from("representatives").select("id, name, team_id, user_id").eq("id", data.rep_id).maybeSingle();
    if (repErr) throw new Error(repErr.message);
    if (!rep) throw new Error("הנציג לא נמצא");
    if (rep.user_id) throw new Error("לנציג זה כבר יש חשבון כניסה מקושר");

    const fullName = data.full_name || rep.name;
    const { user_id } = await inviteLoginForRep(supabaseAdmin, rep.id, rep.team_id, data.email, fullName, data.redirect_to);

    await logAudit(supabaseAdmin, ctx, "rep.invite_login", { rep_id: rep.id, name: rep.name, team_id: rep.team_id }, user_id, data.email);
    return { ok: true, user_id };
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
    const { isAdmin } = await assertCanEdit(ctx, data.rep_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin
      .from("representatives")
      .select("name, team_id, monthly_target, current_result, external_ref, user_id, active")
      .eq("id", data.rep_id)
      .maybeSingle();
    if (!before) throw new Error("הנציג לא נמצא");

    // Team reassignment stays admin-only this sprint (§23); login linking for
    // a manager goes exclusively through the dedicated link/invite workflows
    // (assertCanLinkUser, createRepresentativeWithInvite) so the manager
    // role-safety check there can never be bypassed via this generic edit.
    if (!isAdmin && data.team_id !== before.team_id) {
      throw new Error("רק מנהל מערכת רשאי להעביר נציג בין צוותים");
    }
    if (!isAdmin && data.user_id !== before.user_id) {
      throw new Error("קישור חשבון משתמש מתבצע דרך פעולת הקישור הייעודית ברשימת הנציגים");
    }
    // A new destination team (any actual change, not a no-op resubmission)
    // must be active — mirrors setUserTeam's rule so "inactive team is
    // unavailable for new assignments" holds on every path that writes team_id.
    if (data.team_id && data.team_id !== before.team_id) {
      const { data: destTeam, error: destErr } = await supabaseAdmin.from("teams").select("active").eq("id", data.team_id).maybeSingle();
      if (destErr) throw new Error(destErr.message);
      assertTeamIsActiveForNewAssignment(destTeam);
    }
    if (data.user_id && data.user_id !== before.user_id) await assertUserFree(supabaseAdmin, data.user_id, data.rep_id);

    const { error } = await supabaseAdmin
      .from("representatives")
      .update({
        name: data.name,
        team_id: data.team_id,
        monthly_target: data.monthly_target ?? before.monthly_target,
        current_result: data.current_result,
        external_ref: data.external_ref,
        user_id: data.user_id,
        active: data.active,
        deactivated_at: data.active ? null : (before.active ? new Date().toISOString() : undefined),
      })
      .eq("id", data.rep_id);
    if (error) throw new Error(error.message);
    if (data.user_id) await syncLinkedProfileTeam(supabaseAdmin, data.user_id, data.team_id);

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
  .inputValidator((data: { rep_id: string; team_id: string | null }) => {
    if (!data?.rep_id) throw new Error("חסר מזהה נציג");
    return data;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rep } = await supabaseAdmin.from("representatives").select("team_id, user_id, name").eq("id", data.rep_id).maybeSingle();
    if (!rep) throw new Error("הנציג לא נמצא");
    if (data.team_id && data.team_id !== rep.team_id) {
      const { data: destTeam, error: destErr } = await supabaseAdmin.from("teams").select("active").eq("id", data.team_id).maybeSingle();
      if (destErr) throw new Error(destErr.message);
      assertTeamIsActiveForNewAssignment(destTeam);
    }

    const { error } = await supabaseAdmin.from("representatives").update({ team_id: data.team_id }).eq("id", data.rep_id);
    if (error) throw new Error(error.message);

    if (rep.user_id) await syncLinkedProfileTeam(supabaseAdmin, rep.user_id, data.team_id);

    await logAudit(supabaseAdmin, ctx, "rep.transfer", {
      rep_id: data.rep_id, name: rep.name, from_team: rep.team_id, to_team: data.team_id,
    }, rep.user_id ?? null);
    return { ok: true };
  });

export type LinkRepresentativeResult = { rep_name: string; from: string | null; to: string | null };

/**
 * Core of the User ↔ Representative link, factored out of linkRepresentativeUser so
 * other admin server-function files (e.g. user-admin.functions.ts) can establish/clear
 * the authoritative representatives.user_id link without duplicating this logic. This
 * is the ONLY place that should write representatives.user_id — callers must not
 * update that column directly.
 */
export async function linkRepresentativeToUserCore(
  admin: any,
  repId: string,
  userId: string | null,
): Promise<LinkRepresentativeResult> {
  const { data: rep } = await admin.from("representatives").select("user_id, name, team_id").eq("id", repId).maybeSingle();
  if (!rep) throw new Error("הנציג לא נמצא");
  if (userId) await assertUserFree(admin, userId, repId);

  const { error } = await admin.from("representatives").update({ user_id: userId }).eq("id", repId);
  if (error) throw new Error(error.message);
  // Newly-linked user inherits the rep's current team. Unlinking must NOT touch the
  // previous user's profile — their team membership as a login account stands on its
  // own regardless of representative linkage.
  if (userId) await syncLinkedProfileTeam(admin, userId, rep.team_id);
  return { rep_name: rep.name, from: rep.user_id, to: userId };
}

export const linkRepresentativeUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { rep_id: string; user_id: string | null }) => {
    if (!data?.rep_id) throw new Error("חסר מזהה נציג");
    return data;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertCanLinkUser(ctx, supabaseAdmin, data.rep_id, data.user_id);
    const result = await linkRepresentativeToUserCore(supabaseAdmin, data.rep_id, data.user_id);
    await logAudit(supabaseAdmin, ctx, data.user_id ? "rep.user_linked" : "rep.user_unlinked", {
      rep_id: data.rep_id, name: result.rep_name, from: result.from, to: result.to,
    }, data.user_id ?? result.from ?? null);
    return { ok: true };
  });

export type DeleteBlocker = { label: string; count: number };

/**
 * Cloud-side links that must be cleared before a permanent delete. This is
 * the single, authoritative list — every table with a foreign key to
 * representatives(id) must be represented here (all currently cascade-delete
 * or set-null at the DB level, so nothing here is caught by a constraint
 * violation; this check is the only thing standing between a delete and
 * silently destroying that history). Called both by the dry-run preview
 * (getRepresentativeDeleteCheck) and, again, server-side inside
 * deleteRepresentative itself — never trust a dependency summary the client
 * computed or fetched earlier, exactly like collectUserDeleteBlockers in
 * user-admin.functions.ts.
 */
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

  // feedback/listening_schedules/rep_notes/rep_tasks/competition_scores/
  // kpi_values all cascade-delete with the representative — surface them as
  // blockers so an admin can't silently wipe a rep's entire quality-review,
  // competition, or renewal history with a single delete.
  const [feedbackCount, scheduleCount, notesCount, tasksCount, scoresCount, kpiCount] = await Promise.all([
    admin.from("feedback").select("id", { count: "exact", head: true }).eq("representative_id", repId),
    admin.from("listening_schedules").select("id", { count: "exact", head: true }).eq("representative_id", repId),
    admin.from("rep_notes").select("id", { count: "exact", head: true }).eq("representative_id", repId),
    admin.from("rep_tasks").select("id", { count: "exact", head: true }).eq("representative_id", repId),
    admin.from("competition_scores").select("id", { count: "exact", head: true }).eq("representative_id", repId),
    admin.from("kpi_values").select("id", { count: "exact", head: true }).eq("representative_id", repId),
  ]);
  if (feedbackCount.count && feedbackCount.count > 0) blockers.push({ label: "רשומות משוב והאזנה", count: feedbackCount.count });
  if (scheduleCount.count && scheduleCount.count > 0) blockers.push({ label: "האזנות מתוזמנות", count: scheduleCount.count });
  if (notesCount.count && notesCount.count > 0) blockers.push({ label: "הערות מנהל", count: notesCount.count });
  if (tasksCount.count && tasksCount.count > 0) blockers.push({ label: "משימות פתוחות וסגורות", count: tasksCount.count });
  if (scoresCount.count && scoresCount.count > 0) blockers.push({ label: "ניקוד תחרויות (כולל תחרויות שהסתיימו)", count: scoresCount.count });
  if (kpiCount.count && kpiCount.count > 0) blockers.push({ label: "נתוני ביצועים/חידושים היסטוריים", count: kpiCount.count });

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
  .inputValidator((data: { rep_id: string; confirm_name: string }) => {
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

    // Server-side re-check — never trust a dependency summary the client
    // fetched earlier (see the identical comment on deleteUser above).
    // collectBlockers is now the single, complete list; a client-supplied
    // blocker list was never authoritative and is no longer accepted.
    const blockers = await collectBlockers(supabaseAdmin, data.rep_id);
    if (blockers.length > 0) {
      const list = blockers.map((b) => `${b.label} (${b.count})`).join(", ");
      throw new Error(
        `לא ניתן למחוק את הנציג משום שקיימים נתונים היסטוריים מקושרים: ${list}. ניתן להשבית את הנציג או להעביר את הרשומות.`,
      );
    }

    const { error } = await supabaseAdmin.from("representatives").delete().eq("id", data.rep_id);
    if (error) {
      // collectBlockers above already checks every table with a foreign key to
      // representatives(id), so this should be unreachable in normal operation.
      // If it ever fires anyway (a future constraint, a concurrent write), the
      // admin must still get a graceful, truthful Hebrew message — never a raw
      // Postgres error string (e.g. "update or delete on table ... violates
      // foreign key constraint ...").
      if (error.code === "23503") {
        throw new Error(
          "לא ניתן למחוק את הנציג: נמצאו נתונים היסטוריים מקושרים נוספים שלא זוהו בבדיקה המקדימה. ניתן להשבית את הנציג במקום, או לפנות לתמיכה.",
        );
      }
      console.error("[deleteRepresentative] delete failed", data.rep_id, error);
      throw new Error("אירעה שגיאה במחיקת הנציג. נסו שוב מאוחר יותר.");
    }
    await logAudit(supabaseAdmin, ctx, "rep.delete", { rep_id: rep.id, name: rep.name, team_id: rep.team_id });
    return { ok: true };
  });

/**
 * Narrow, high-frequency patch path for Performance edits and Data Import writes.
 * Only ever touches name/team_id/monthly_target/current_result — never external_ref,
 * user_id or active — so callers that don't carry those fields (Performance, Import)
 * can never accidentally wipe them. Uses the same authorization as updateRepresentative.
 */
export type RepMetricsInput = {
  rep_id: string;
  name?: string;
  team_id?: string | null;
  monthly_target?: number;
  current_result?: number;
};

export const updateRepresentativeMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: RepMetricsInput) => {
    if (!data?.rep_id) throw new Error("חסר מזהה נציג");
    const out: RepMetricsInput = { rep_id: data.rep_id };
    if (data.name !== undefined) {
      const name = data.name.trim();
      if (!name) throw new Error("יש להזין שם נציג");
      if (name.length > 80) throw new Error("שם הנציג ארוך מדי");
      out.name = name;
    }
    if (data.team_id !== undefined) out.team_id = data.team_id;
    if (data.monthly_target !== undefined) {
      const t = Number(data.monthly_target);
      if (!Number.isFinite(t) || t < 0) throw new Error("יעד חודשי לא חוקי");
      out.monthly_target = Math.round(t);
    }
    if (data.current_result !== undefined) {
      const c = Number(data.current_result);
      if (!Number.isFinite(c) || c < 0) throw new Error("תוצאה נוכחית לא חוקית");
      out.current_result = Math.round(c);
    }
    return out;
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { isAdmin } = await assertCanEdit(ctx, data.rep_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin
      .from("representatives")
      .select("name, team_id, monthly_target, current_result, user_id")
      .eq("id", data.rep_id)
      .maybeSingle();
    if (!before) throw new Error("הנציג לא נמצא");
    // Team reassignment stays admin-only this sprint (§23) — this narrow patch
    // path is also reachable from Data Import, which a manager may open.
    if (!isAdmin && data.team_id !== undefined && data.team_id !== before.team_id) {
      throw new Error("רק מנהל מערכת רשאי להעביר נציג בין צוותים");
    }
    if (data.team_id && data.team_id !== before.team_id) {
      const { data: destTeam, error: destErr } = await supabaseAdmin.from("teams").select("active").eq("id", data.team_id).maybeSingle();
      if (destErr) throw new Error(destErr.message);
      assertTeamIsActiveForNewAssignment(destTeam);
    }

    const update: { name?: string; team_id?: string | null; monthly_target?: number; current_result?: number } = {};
    if (data.name !== undefined) update.name = data.name;
    if (data.team_id !== undefined) update.team_id = data.team_id;
    if (data.monthly_target !== undefined) update.monthly_target = data.monthly_target;
    if (data.current_result !== undefined) update.current_result = data.current_result;
    if (Object.keys(update).length === 0) return { ok: true };

    const { error } = await supabaseAdmin.from("representatives").update(update).eq("id", data.rep_id);
    if (error) throw new Error(error.message);
    if (before.user_id && update.team_id !== undefined && update.team_id !== before.team_id) {
      await syncLinkedProfileTeam(supabaseAdmin, before.user_id, update.team_id);
    }

    await logAudit(supabaseAdmin, ctx, "rep.metrics_update", { rep_id: data.rep_id, before, after: update });
    if (update.team_id !== undefined && before.team_id !== update.team_id) {
      await logAudit(supabaseAdmin, ctx, "rep.transfer", { rep_id: data.rep_id, from_team: before.team_id, to_team: update.team_id });
    }
    return { ok: true };
  });
