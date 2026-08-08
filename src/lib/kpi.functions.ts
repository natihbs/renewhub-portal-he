import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Domain write path for public.kpi_values (§P1 auditability).
 *
 * Before this file, KPI rows were written through the GENERIC cloudUpsert
 * proxy. That had three consequences worth stating plainly, because they are
 * exactly what this module exists to remove:
 *   1. No attribution. kpi_values has no created_by/updated_by column and no
 *      audit_log entry, so a corrupted or fat-fingered renewal number was
 *      untraceable after the fact — there was no way to answer "who set this,
 *      when, and what was it before".
 *   2. No validation. cloudUpsert forwards whatever object it is handed; the
 *      only checks were the table allow-list and RLS.
 *   3. Caller-supplied team attribution. The caller passed team_id, which was
 *      both the authorization input (see the RLS fix in
 *      20260806110000_...sql) and the stored historical attribution.
 *
 * This function is now the only application path that writes KPI values.
 * team_id is deliberately NOT part of the input at all: the database derives
 * it from the representative's authoritative state via the
 * kpi_values_team_attribution trigger, so there is no submitted value to
 * either trust or validate. cloud.functions.ts additionally refuses generic
 * writes to kpi_values so the old route cannot be used again.
 */

type Ctx = { supabase: any; userId: string; claims: any };

/**
 * Why a KPI row is being written. Recorded verbatim in the audit entry so a
 * later reviewer can tell an operator's manual correction apart from a bulk
 * import and from an undo.
 */
export type KpiWriteSource = "manual" | "import" | "import_reconciliation" | "historical_correction" | "undo";

const KPI_WRITE_SOURCES: KpiWriteSource[] = ["manual", "import", "import_reconciliation", "historical_correction", "undo"];

export type KpiValueWriteInput = {
  representative_id: string;
  metric_date: string;
  renewal_opportunities?: number | null;
  completed_renewals?: number | null;
  source: KpiWriteSource;
  source_screen?: string;
};

/** Accepts YYYY-MM-DD only — a KPI row is a dated fact, never "now". */
export function normalizeMetricDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!m) throw new Error("תאריך מדד לא תקין");
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Non-negative integer, or null for "not reported". Never coerces null to 0. */
export function normalizeKpiMetric(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} חייב להיות מספר לא שלילי`);
  return Math.round(n);
}

async function getRoles(ctx: Ctx): Promise<string[]> {
  const { data, error } = await ctx.supabase.from("user_roles").select("role").eq("user_id", ctx.userId);
  if (error) throw new Error("שגיאה באימות הרשאות");
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}

/**
 * Admin, or the manager of the representative's own team — resolved through
 * the RLS-scoped client so "is this rep mine" is answered by the same
 * policy the database enforces, never re-implemented here. This mirrors the
 * corrected RLS rule exactly: authorization derives from the representative
 * relationship, never from a submitted team id.
 */
async function assertCanWriteKpi(ctx: Ctx, repId: string): Promise<void> {
  const roles = await getRoles(ctx);
  if (roles.includes("admin")) return;
  if (!roles.includes("manager")) throw new Error("אין הרשאה לעדכן נתוני מדדים");
  const { data, error } = await ctx.supabase
    .from("representatives").select("id").eq("id", repId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("אין לך הרשאה לנציג זה — הוא אינו משויך לצוות שבניהולך");
}

// Best-effort audit, identical policy to every other module here: recording
// the action must never be able to fail the action it records.
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

export type KpiValueWriteResult = {
  ok: true;
  representative_id: string;
  metric_date: string;
  team_id: string | null;
  created: boolean;
};

/**
 * Create or correct one representative's KPI values for one date.
 *
 * Writes go through the service-role client so the committed team attribution
 * can be read back and audited, but ONLY after assertCanWriteKpi has verified
 * the actor against the real representative relationship — the same
 * "authorize fully before any write" ordering used across this codebase.
 */
export const writeRepresentativeKpiValue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: KpiValueWriteInput) => {
    if (!data?.representative_id) throw new Error("חסר מזהה נציג");
    if (!KPI_WRITE_SOURCES.includes(data.source)) throw new Error("מקור עדכון לא חוקי");
    const opportunities = normalizeKpiMetric(data.renewal_opportunities, "מיועדות חודשיות");
    const completed = normalizeKpiMetric(data.completed_renewals, "חידושים שנסגרו");
    if (opportunities === null && completed === null) {
      throw new Error("אין נתוני מדדים לשמירה");
    }
    return {
      representative_id: data.representative_id,
      metric_date: normalizeMetricDate(data.metric_date),
      renewal_opportunities: opportunities,
      completed_renewals: completed,
      source: data.source,
      source_screen: data.source_screen ? String(data.source_screen).slice(0, 60) : undefined,
    };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertCanWriteKpi(ctx, data.representative_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Read the prior row so the audit entry can carry real before/after
    // values rather than only the submitted ones.
    const { data: before, error: beforeErr } = await supabaseAdmin
      .from("kpi_values")
      .select("id, team_id, renewal_opportunities, completed_renewals")
      .eq("representative_id", data.representative_id)
      .eq("metric_date", data.metric_date)
      .maybeSingle();
    if (beforeErr) throw new Error(beforeErr.message);

    // team_id is intentionally absent from this payload. The
    // kpi_values_team_attribution trigger derives it from the representative
    // on INSERT and pins it on UPDATE, so historical attribution can be
    // neither chosen by a caller nor rewritten by a later transfer.
    const { data: written, error } = await supabaseAdmin
      .from("kpi_values")
      .upsert(
        {
          representative_id: data.representative_id,
          metric_date: data.metric_date,
          renewal_opportunities: data.renewal_opportunities,
          completed_renewals: data.completed_renewals,
        },
        { onConflict: "representative_id,metric_date" },
      )
      .select("id, team_id")
      .single();
    if (error) throw new Error(error.message);

    await logAudit(supabaseAdmin, ctx, before ? "kpi.update" : "kpi.create", {
      representative_id: data.representative_id,
      metric_date: data.metric_date,
      team_id: written.team_id,
      source: data.source,
      source_screen: data.source_screen ?? null,
      before: before
        ? { renewal_opportunities: before.renewal_opportunities, completed_renewals: before.completed_renewals }
        : null,
      after: {
        renewal_opportunities: data.renewal_opportunities,
        completed_renewals: data.completed_renewals,
      },
    });

    return {
      ok: true as const,
      representative_id: data.representative_id,
      metric_date: data.metric_date,
      team_id: (written.team_id as string | null) ?? null,
      created: !before,
    };
  });

/**
 * Delete one representative's KPI row for one date. Separate from the write
 * path so a deletion is always an explicit, separately audited act rather
 * than an upsert of nulls.
 */
export const deleteRepresentativeKpiValue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { representative_id: string; metric_date: string; source: KpiWriteSource; source_screen?: string }) => {
    if (!data?.representative_id) throw new Error("חסר מזהה נציג");
    if (!KPI_WRITE_SOURCES.includes(data.source)) throw new Error("מקור עדכון לא חוקי");
    return {
      representative_id: data.representative_id,
      metric_date: normalizeMetricDate(data.metric_date),
      source: data.source,
      source_screen: data.source_screen ? String(data.source_screen).slice(0, 60) : undefined,
    };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertCanWriteKpi(ctx, data.representative_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: before, error: beforeErr } = await supabaseAdmin
      .from("kpi_values")
      .select("team_id, renewal_opportunities, completed_renewals")
      .eq("representative_id", data.representative_id)
      .eq("metric_date", data.metric_date)
      .maybeSingle();
    if (beforeErr) throw new Error(beforeErr.message);
    if (!before) throw new Error("לא נמצאו נתוני מדדים לתאריך זה");

    const { error } = await supabaseAdmin
      .from("kpi_values")
      .delete()
      .eq("representative_id", data.representative_id)
      .eq("metric_date", data.metric_date);
    if (error) throw new Error(error.message);

    await logAudit(supabaseAdmin, ctx, "kpi.delete", {
      representative_id: data.representative_id,
      metric_date: data.metric_date,
      team_id: before.team_id,
      source: data.source,
      source_screen: data.source_screen ?? null,
      before: { renewal_opportunities: before.renewal_opportunities, completed_renewals: before.completed_renewals },
      after: null,
    });

    return { ok: true as const };
  });
