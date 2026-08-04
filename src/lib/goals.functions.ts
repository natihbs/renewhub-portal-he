import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: any; userId: string; claims: any };

async function getRoles(ctx: Ctx): Promise<string[]> {
  const { data, error } = await ctx.supabase.from("user_roles").select("role").eq("user_id", ctx.userId);
  if (error) throw new Error("שגיאה באימות הרשאות");
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}

/**
 * Admin, or the manager of this specific team — verified through the
 * RLS-scoped client ("teams manager reads own": manager_id = auth.uid()),
 * exactly like assertCanEdit in rep-admin.functions.ts does for representatives.
 * Never re-implements "is this my team" in application code.
 */
async function assertCanManageTeam(ctx: Ctx, teamId: string): Promise<{ isAdmin: boolean }> {
  const roles = await getRoles(ctx);
  if (roles.includes("admin")) return { isAdmin: true };
  if (!roles.includes("manager")) throw new Error("אין לך הרשאה לנהל יעדים");
  const { data, error } = await ctx.supabase.from("teams").select("id").eq("id", teamId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("אין לך הרשאה לנהל יעדים עבור צוות זה — הוא אינו בניהולך");
  return { isAdmin: false };
}

/** Accepts "YYYY-MM" or "YYYY-MM-DD" and always normalizes to the first of the month. */
function normalizeMonth(month: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(month ?? "");
  if (!m) throw new Error("חודש לא תקין");
  return `${m[1]}-${m[2]}-01`;
}

function previousMonth(month: string): string {
  const [y, mo] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function validateTargetValue(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error("יעד חייב להיות מספר לא שלילי");
  return Math.round(n);
}

// Audit logging is best-effort and must never be able to fail (or delay the
// response of) the operation it's recording — see the identical fix already
// applied to user-admin.functions.ts / rep-admin.functions.ts.
async function logAudit(admin: any, ctx: Ctx, action: string, details: Record<string, unknown>) {
  try {
    const { error } = await admin.from("audit_log").insert({
      actor_id: ctx.userId,
      actor_email: (ctx.claims as any)?.email ?? null,
      action,
      target_user_id: null,
      target_email: null,
      details,
    });
    if (error) console.error("[audit_log] insert failed", action, error);
  } catch (e) {
    console.error("[audit_log] insert threw", action, e);
  }
}

export type TargetWorkspaceRep = {
  id: string;
  name: string;
  active: boolean;
  current_result: number;
  target_value: number | null;
};

/**
 * Everything the Target Management screen needs for one team/month in a
 * single round trip: the official team target (or null if never set), every
 * representative on the team with their own official target (or null), and
 * the comparison figures the screen displays (sum of representative targets,
 * count of active representatives with no target yet). Admin or the team's
 * own manager only — never a representative (they read their own/team target
 * via the RLS-scoped generic cloud reader instead, see goals-hooks.ts).
 */
export const getTargetWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { team_id: string; month: string }) => {
    if (!data?.team_id) throw new Error("חסר מזהה צוות");
    if (!data?.month) throw new Error("חסר חודש");
    return { team_id: data.team_id, month: normalizeMonth(data.month) };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertCanManageTeam(ctx, data.team_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: team, error: teamErr }, { data: goal }, { data: reps, error: repsErr }] = await Promise.all([
      supabaseAdmin.from("teams").select("id, name").eq("id", data.team_id).maybeSingle(),
      supabaseAdmin.from("team_goals").select("target_value").eq("team_id", data.team_id).eq("goal_month", data.month).maybeSingle(),
      supabaseAdmin.from("representatives").select("id, name, active, current_result").eq("team_id", data.team_id).order("name"),
    ]);
    if (teamErr) throw new Error(teamErr.message);
    if (!team) throw new Error("הצוות לא נמצא");
    if (repsErr) throw new Error(repsErr.message);

    const repRows = (reps ?? []) as { id: string; name: string; active: boolean; current_result: number }[];
    const repIds = repRows.map((r) => r.id);
    const { data: repGoals, error: repGoalsErr } = repIds.length > 0
      ? await supabaseAdmin.from("representative_goals").select("representative_id, target_value").eq("goal_month", data.month).in("representative_id", repIds)
      : { data: [] as { representative_id: string; target_value: number }[], error: null };
    if (repGoalsErr) throw new Error(repGoalsErr.message);

    const goalByRepId = new Map((repGoals ?? []).map((g: { representative_id: string; target_value: number }) => [g.representative_id, g.target_value]));
    const representatives: TargetWorkspaceRep[] = repRows.map((r) => ({
      id: r.id,
      name: r.name,
      active: r.active,
      current_result: r.current_result,
      target_value: goalByRepId.get(r.id) ?? null,
    }));

    const representativeTargetSum = representatives.reduce((s, r) => s + (r.target_value ?? 0), 0);
    const activeRepresentativesWithoutTarget = representatives.filter((r) => r.active && r.target_value === null).length;

    return {
      team: { id: team.id as string, name: team.name as string },
      month: data.month,
      team_target: (goal?.target_value as number | undefined) ?? null,
      representative_target_sum: representativeTargetSum,
      active_representatives_without_target: activeRepresentativesWithoutTarget,
      representatives,
    };
  });

export const setTeamGoal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { team_id: string; month: string; target_value: number }) => {
    if (!data?.team_id) throw new Error("חסר מזהה צוות");
    if (!data?.month) throw new Error("חסר חודש");
    return { team_id: data.team_id, month: normalizeMonth(data.month), target_value: validateTargetValue(data.target_value) };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertCanManageTeam(ctx, data.team_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Two-step (not a blind upsert): an upsert would overwrite created_by on
    // every edit, losing who originally set the target.
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("team_goals").select("id").eq("team_id", data.team_id).eq("goal_month", data.month).maybeSingle();
    if (existingErr) throw new Error(existingErr.message);

    if (existing) {
      const { error } = await supabaseAdmin.from("team_goals")
        .update({ target_value: data.target_value, updated_by: ctx.userId })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("team_goals").insert({
        team_id: data.team_id, goal_month: data.month, target_value: data.target_value,
        created_by: ctx.userId, updated_by: ctx.userId,
      });
      if (error) throw new Error(error.message);
    }

    await logAudit(supabaseAdmin, ctx, "team_goal.set", { team_id: data.team_id, month: data.month, target_value: data.target_value });
    return { ok: true };
  });

export type RepresentativeGoalInput = { representative_id: string; target_value: number };

/**
 * Batch save for the Target Management screen's representative list — one
 * explicit save action for however many rows changed, not one round trip per
 * representative. Every representative_id is re-verified server-side to
 * actually belong to the authorized team (defense in depth: a manager
 * authorized for team A must never be able to slip a representative_id from
 * team B into the same batch call, regardless of what the client sent).
 */
export const setRepresentativeGoals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { team_id: string; month: string; goals: RepresentativeGoalInput[] }) => {
    if (!data?.team_id) throw new Error("חסר מזהה צוות");
    if (!data?.month) throw new Error("חסר חודש");
    if (!Array.isArray(data.goals) || data.goals.length === 0) throw new Error("לא נבחרו יעדים לשמירה");
    return {
      team_id: data.team_id,
      month: normalizeMonth(data.month),
      goals: data.goals.map((g) => {
        if (!g.representative_id) throw new Error("חסר מזהה נציג");
        return { representative_id: g.representative_id, target_value: validateTargetValue(g.target_value) };
      }),
    };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertCanManageTeam(ctx, data.team_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const repIds = data.goals.map((g) => g.representative_id);
    const { data: reps, error: repsErr } = await supabaseAdmin.from("representatives").select("id, team_id").in("id", repIds);
    if (repsErr) throw new Error(repsErr.message);
    const validIds = new Set((reps ?? []).filter((r: { id: string; team_id: string | null }) => r.team_id === data.team_id).map((r: { id: string }) => r.id));
    if (repIds.some((id) => !validIds.has(id))) {
      throw new Error("חלק מהנציגים שנבחרו אינם משויכים לצוות זה");
    }

    // target_value is selected here too (not just id) so callers that need a
    // restore point (e.g. the import wizard's target-aware undo, §4) get the
    // exact prior value in the same round trip — no separate "read before
    // write" call needed.
    const { data: existingRows, error: existingErr } = await supabaseAdmin
      .from("representative_goals").select("id, representative_id, target_value")
      .eq("goal_month", data.month).in("representative_id", repIds);
    if (existingErr) throw new Error(existingErr.message);
    const existingByRepId = new Map(
      (existingRows ?? []).map((r: { id: string; representative_id: string; target_value: number }) => [r.representative_id, r]),
    );

    const toInsert = data.goals.filter((g) => !existingByRepId.has(g.representative_id));
    const toUpdate = data.goals.filter((g) => existingByRepId.has(g.representative_id));

    if (toInsert.length > 0) {
      const { error } = await supabaseAdmin.from("representative_goals").insert(
        toInsert.map((g) => ({
          representative_id: g.representative_id, goal_month: data.month, target_value: g.target_value,
          created_by: ctx.userId, updated_by: ctx.userId,
        })),
      );
      if (error) throw new Error(error.message);
    }
    if (toUpdate.length > 0) {
      const results = await Promise.all(toUpdate.map((g) => {
        const rowId = (existingByRepId.get(g.representative_id) as { id: string }).id;
        return supabaseAdmin.from("representative_goals")
          .update({ target_value: g.target_value, updated_by: ctx.userId })
          .eq("id", rowId);
      }));
      const failed = results.find((r) => r.error);
      if (failed?.error) throw new Error(failed.error.message);
    }

    await logAudit(supabaseAdmin, ctx, "representative_goal.batch_set", { team_id: data.team_id, month: data.month, count: data.goals.length });
    return {
      ok: true,
      created: toInsert.length,
      updated: toUpdate.length,
      // Restore points for a caller that needs to undo this exact write:
      // rows that existed before (with their prior value, to put back), and
      // the representative_ids that were newly inserted (to delete outright
      // on undo, since they had no prior row at all).
      previously_existing: toUpdate.map((g) => ({
        representative_id: g.representative_id,
        target_value: (existingByRepId.get(g.representative_id) as { target_value: number }).target_value,
      })),
      newly_created_representative_ids: toInsert.map((g) => g.representative_id),
    };
  });

export type RepresentativeGoalRestoreEntry =
  | { representative_id: string; had_previous: true; previous_target_value: number }
  | { representative_id: string; had_previous: false; previous_target_value: null };

/**
 * Target-aware undo (§4): restores representative_goals rows for one team/month
 * to exactly what they were before a prior write — never a generic "undo the
 * whole import", specifically this. A row that had no prior value
 * (had_previous: false) is deleted outright (it didn't exist before); a row
 * that had a prior value is set back to it. Every representative_id is
 * re-verified server-side to belong to the authorized team, exactly like
 * setRepresentativeGoals — a snapshot the client holds is never trusted blindly.
 */
export const restoreRepresentativeGoals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { team_id: string; month: string; entries: RepresentativeGoalRestoreEntry[] }) => {
    if (!data?.team_id) throw new Error("חסר מזהה צוות");
    if (!data?.month) throw new Error("חסר חודש");
    if (!Array.isArray(data.entries) || data.entries.length === 0) throw new Error("אין נתונים לשחזור");
    return { team_id: data.team_id, month: normalizeMonth(data.month), entries: data.entries };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertCanManageTeam(ctx, data.team_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const repIds = data.entries.map((e) => e.representative_id);
    const { data: reps, error: repsErr } = await supabaseAdmin.from("representatives").select("id, team_id").in("id", repIds);
    if (repsErr) throw new Error(repsErr.message);
    const validIds = new Set((reps ?? []).filter((r: { id: string; team_id: string | null }) => r.team_id === data.team_id).map((r: { id: string }) => r.id));
    if (repIds.some((id) => !validIds.has(id))) {
      throw new Error("חלק מהנציגים בשחזור אינם משויכים לצוות זה");
    }

    const toDelete = data.entries.filter((e) => !e.had_previous).map((e) => e.representative_id);
    const toRestore = data.entries.filter((e) => e.had_previous);

    let deleted = 0, restored = 0, failed = 0;
    if (toDelete.length > 0) {
      const { error, count } = await supabaseAdmin.from("representative_goals")
        .delete({ count: "exact" })
        .eq("goal_month", data.month)
        .in("representative_id", toDelete);
      if (error) failed += toDelete.length;
      else deleted = count ?? toDelete.length;
    }
    if (toRestore.length > 0) {
      const results = await Promise.all(toRestore.map((e) =>
        supabaseAdmin.from("representative_goals")
          .update({ target_value: e.previous_target_value, updated_by: ctx.userId })
          .eq("representative_id", e.representative_id).eq("goal_month", data.month),
      ));
      for (const r of results) { if (r.error) failed++; else restored++; }
    }

    await logAudit(supabaseAdmin, ctx, "representative_goal.import_undo", { team_id: data.team_id, month: data.month, deleted, restored, failed });
    return { ok: failed === 0, deleted, restored, failed };
  });

export type CopyGoalsPreview = {
  previous_month: string;
  team_target_will_copy: number | null;
  team_target_skipped_reason: "no_previous" | "already_set" | null;
  representatives_to_copy: { representative_id: string; name: string; target_value: number }[];
  representatives_skipped: { representative_id: string; name: string }[];
};

/**
 * Copies last month's official targets into the given month. Never
 * overwrites a target that already exists for the target month — existing
 * current-month values always win silently over the copy, and every skip is
 * reported back, never hidden. dry_run (default true) returns the exact
 * preview the confirmation dialog shows before anything is written.
 */
export const copyGoalsFromPreviousMonth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { team_id: string; month: string; dry_run?: boolean }) => {
    if (!data?.team_id) throw new Error("חסר מזהה צוות");
    if (!data?.month) throw new Error("חסר חודש");
    return { team_id: data.team_id, month: normalizeMonth(data.month), dry_run: data.dry_run ?? true };
  })
  .handler(async ({ data, context }): Promise<{ ok: true; applied: boolean } & CopyGoalsPreview> => {
    const ctx = context as unknown as Ctx;
    await assertCanManageTeam(ctx, data.team_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const prevMonth = previousMonth(data.month);

    const [{ data: prevTeamGoal }, { data: curTeamGoal }, { data: reps }] = await Promise.all([
      supabaseAdmin.from("team_goals").select("target_value").eq("team_id", data.team_id).eq("goal_month", prevMonth).maybeSingle(),
      supabaseAdmin.from("team_goals").select("target_value").eq("team_id", data.team_id).eq("goal_month", data.month).maybeSingle(),
      supabaseAdmin.from("representatives").select("id, name").eq("team_id", data.team_id),
    ]);

    const repRows = (reps ?? []) as { id: string; name: string }[];
    const repIds = repRows.map((r) => r.id);
    const repNameById = new Map(repRows.map((r) => [r.id, r.name]));

    const [{ data: prevRepGoals }, { data: curRepGoals }] = await Promise.all([
      repIds.length > 0
        ? supabaseAdmin.from("representative_goals").select("representative_id, target_value").eq("goal_month", prevMonth).in("representative_id", repIds)
        : Promise.resolve({ data: [] as { representative_id: string; target_value: number }[] }),
      repIds.length > 0
        ? supabaseAdmin.from("representative_goals").select("representative_id").eq("goal_month", data.month).in("representative_id", repIds)
        : Promise.resolve({ data: [] as { representative_id: string }[] }),
    ]);
    const curRepGoalIds = new Set((curRepGoals ?? []).map((g: { representative_id: string }) => g.representative_id));

    const willCopyTeam = prevTeamGoal != null && curTeamGoal == null;
    const teamSkippedReason: CopyGoalsPreview["team_target_skipped_reason"] =
      willCopyTeam ? null : prevTeamGoal == null ? "no_previous" : "already_set";

    const repsToCopy = (prevRepGoals ?? []).filter((g: { representative_id: string }) => !curRepGoalIds.has(g.representative_id));
    const repsSkipped = (prevRepGoals ?? [])
      .filter((g: { representative_id: string }) => curRepGoalIds.has(g.representative_id))
      .map((g: { representative_id: string }) => ({ representative_id: g.representative_id, name: repNameById.get(g.representative_id) ?? "" }));

    const preview: CopyGoalsPreview = {
      previous_month: prevMonth,
      team_target_will_copy: willCopyTeam ? (prevTeamGoal!.target_value as number) : null,
      team_target_skipped_reason: teamSkippedReason,
      representatives_to_copy: repsToCopy.map((g: { representative_id: string; target_value: number }) => ({
        representative_id: g.representative_id, name: repNameById.get(g.representative_id) ?? "", target_value: g.target_value,
      })),
      representatives_skipped: repsSkipped,
    };

    if (data.dry_run) return { ok: true, applied: false, ...preview };

    if (willCopyTeam) {
      const { error } = await supabaseAdmin.from("team_goals").insert({
        team_id: data.team_id, goal_month: data.month, target_value: prevTeamGoal!.target_value,
        created_by: ctx.userId, updated_by: ctx.userId,
      });
      if (error) throw new Error(error.message);
    }
    if (repsToCopy.length > 0) {
      const { error } = await supabaseAdmin.from("representative_goals").insert(
        repsToCopy.map((g: { representative_id: string; target_value: number }) => ({
          representative_id: g.representative_id, goal_month: data.month, target_value: g.target_value,
          created_by: ctx.userId, updated_by: ctx.userId,
        })),
      );
      if (error) throw new Error(error.message);
    }

    await logAudit(supabaseAdmin, ctx, "goals.copied_from_previous_month", {
      team_id: data.team_id, month: data.month, previous_month: prevMonth,
      team_copied: willCopyTeam, reps_copied: repsToCopy.length,
    });
    return { ok: true, applied: true, ...preview };
  });
