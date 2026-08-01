import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = { supabase: any; userId: string; claims: any };

async function getRoles(ctx: Ctx): Promise<string[]> {
  const { data, error } = await ctx.supabase.from("user_roles").select("role").eq("user_id", ctx.userId);
  if (error) throw new Error("שגיאה באימות הרשאות");
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}

async function assertAdmin(ctx: Ctx) {
  const roles = await getRoles(ctx);
  if (!roles.includes("admin")) throw new Error("אין הרשאה לפעולה זו — פעולה זו מיועדת למנהלי מערכת בלבד");
}

export type BulkPublishFilters = {
  repId?: string | null;
  teamId?: string | null;
  from?: string | null;
  to?: string | null;
};

/** Sentinel used by the "all teams" / "all representatives" Select options in the UI. */
export const BULK_PUBLISH_NONE = "__all__";

/** Maps the bulk-publish form's local state (Select sentinels, possibly-empty date strings) to the API's filter shape. Pure and unit-tested — the request payload must never accidentally carry "" or the sentinel string as a real filter value. */
export function toBulkPublishFilters(input: { teamId: string; repId: string; from: string; to: string }): BulkPublishFilters {
  return {
    teamId: input.teamId === BULK_PUBLISH_NONE ? null : input.teamId || null,
    repId: input.repId === BULK_PUBLISH_NONE ? null : input.repId || null,
    from: input.from || null,
    to: input.to || null,
  };
}

type NormalizedFilters = { repId: string | null; teamId: string | null; from: string | null; to: string | null };

function validateFilters(data: BulkPublishFilters): NormalizedFilters {
  return {
    repId: data?.repId || null,
    teamId: data?.teamId || null,
    from: data?.from || null,
    to: data?.to || null,
  };
}

/** Representative ids for a team, or null if no team filter was requested. */
async function resolveTeamRepIds(admin: any, teamId: string | null): Promise<string[] | null> {
  if (!teamId) return null;
  const { data, error } = await admin.from("representatives").select("id").eq("team_id", teamId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

function applyFilters(query: any, filters: BulkPublishFilters, teamRepIds: string[] | null) {
  let q = query.eq("published", false);
  if (filters.repId) q = q.eq("representative_id", filters.repId);
  if (teamRepIds) q = q.in("representative_id", teamRepIds);
  if (filters.from) q = q.gte("feedback_date", filters.from);
  if (filters.to) q = q.lte("feedback_date", filters.to);
  return q;
}

/**
 * Admin-only preview for the "פרסום משובים קיימים" bulk action: counts draft
 * feedback matching the given filters without changing anything, so an admin
 * can see exactly what a bulk publish would affect before confirming it.
 */
export const previewUnpublishedFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: BulkPublishFilters) => validateFilters(data ?? {}))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const teamRepIds = await resolveTeamRepIds(supabaseAdmin, data.teamId);
    if (data.teamId && teamRepIds!.length === 0) return { count: 0 };

    const { count, error } = await applyFilters(
      supabaseAdmin.from("feedback").select("id", { count: "exact", head: true }),
      data,
      teamRepIds,
    );
    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
  });

/**
 * Admin-only bulk publish: flips published=false -> true for every draft feedback
 * row matching the filters (never touches already-published rows). Existing
 * historical feedback defaults to draft (see the published-state migration) for
 * safety — this is the explicit, filtered, audited action an admin uses to make
 * historical feedback visible to representatives when they're ready.
 */
export const publishFeedbackBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: BulkPublishFilters) => validateFilters(data ?? {}))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertAdmin(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const teamRepIds = await resolveTeamRepIds(supabaseAdmin, data.teamId);
    if (data.teamId && teamRepIds!.length === 0) return { updated: 0 };

    const { data: updated, error } = await applyFilters(
      supabaseAdmin.from("feedback").update({ published: true }),
      data,
      teamRepIds,
    ).select("id");
    if (error) throw new Error(error.message);

    const count = updated?.length ?? 0;
    await supabaseAdmin.from("audit_log").insert({
      actor_id: ctx.userId,
      actor_email: (ctx.claims as any)?.email ?? null,
      action: "feedback.bulk_publish",
      details: { filters: data, count },
    });
    return { updated: count };
  });
