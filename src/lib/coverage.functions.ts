import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadActorContext, assertSystemCapability, type ActorContext } from "@/lib/authorization";
import {
  classifyFreshness,
  type FreshnessInput,
  type FreshnessReport,
} from "@/lib/ingestion-domain";
import {
  aggregateCoverage,
  freshnessBlock,
  fromComponents,
  unavailable,
  type CoverageComponents,
  type CoverageResult,
  type CoverageScopeRef,
} from "@/lib/coverage-domain";

/**
 * Server layer for coverage.
 *
 * ONE AUTHORIZATION RULE, AND IT IS STRUCTURAL: no caller supplies a scope.
 * Every read derives its scopes from the actor's own assignments inside the
 * database, so there is no parameter to tamper with — an operator asking for a
 * team's coverage does not get "denied", they get their own figures, because
 * the request has no way to name someone else's book.
 *
 * The one exception is the admin/debug read, which does take a scope id and
 * requires `system.audit`. It is on the system axis deliberately: reading
 * arbitrary scopes is an administrative act, and a wide organizational span is
 * not a reason to acquire it.
 *
 * FRESHNESS IS CHECKED BEFORE ANY NUMBER IS RETURNED. Beyond the critical
 * threshold the figures are still computable — the rows are all still there —
 * and returning them anyway is exactly the failure mode: a confident number
 * derived from a book that stopped arriving on Tuesday.
 */

type Ctx = { supabase: any; userId: string; claims: any };

type AdminClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
  from: (table: string) => any;
};

export const COVERAGE_ERROR_CODES = {
  P0030: "scope_unavailable",
  P0031: "work_type_unavailable",
  P0032: "invalid_period",
} as const;

/** Default window: the current month to date. Callers may override. */
function defaultPeriod(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizePeriod(
  start?: string | null,
  end?: string | null,
): { start: string; end: string } {
  const fallback = defaultPeriod();
  const s = start && ISO_DATE.test(start) ? start : fallback.start;
  const e = end && ISO_DATE.test(end) ? end : fallback.end;
  if (e < s) throw new Error("תקופה לא חוקית — תאריך הסיום מוקדם מתאריך ההתחלה");
  return { start: s, end: e };
}

async function loadClient(ctx: Ctx): Promise<{ admin: AdminClient; actor: ActorContext }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const actor = await loadActorContext(supabaseAdmin as any, ctx.userId);
  return { admin: supabaseAdmin as unknown as AdminClient, actor };
}

/** Resolve a work type key to its id, and the freshness of the feed behind it. */
async function resolveWorkType(
  admin: AdminClient,
  workTypeKey: string,
): Promise<{ id: string | null; freshness: FreshnessReport | null }> {
  const { data: wt } = await admin
    .from("work_types")
    .select("id, key")
    .eq("key", workTypeKey)
    .maybeSingle();
  if (!wt) return { id: null, freshness: null };

  const { data: rows } = await admin.rpc("ingestion_freshness", {});
  const match = ((rows ?? []) as any[]).find((r) => r.out_work_type_key === workTypeKey);
  if (!match) return { id: (wt as any).id, freshness: null };

  const input: FreshnessInput = {
    sourceKey: match.out_source_key,
    sourceName: match.out_source_name,
    lastPublishedAt: match.out_last_published_at,
    lastBatchId: match.out_last_batch_id,
    lastRowCount: match.out_last_row_count,
    ageSeconds: match.out_age_seconds === null ? null : Number(match.out_age_seconds),
    lastAttemptAt: match.out_last_attempt_at,
    lastAttemptStatus: match.out_last_attempt_status,
    consecutiveFailures: match.out_consecutive_failures,
    warningHours: match.out_warning_hours,
    criticalHours: match.out_critical_hours,
    openItemCount: match.out_open_item_count,
  };
  return { id: (wt as any).id, freshness: classifyFreshness(input) };
}

function componentsFromRow(r: any): CoverageComponents {
  return {
    eligibleCount: Number(r.out_eligible_count ?? r.eligible_count ?? 0),
    engagedCount: Number(r.out_engaged_count ?? r.engaged_count ?? 0),
    expiredUnworkedCount: Number(r.out_expired_unworked_count ?? r.expired_unworked_count ?? 0),
    pendingCount: Number(r.out_pending_count ?? r.pending_count ?? 0),
    eligibleValue: Number(r.out_eligible_value ?? r.eligible_value ?? 0),
    engagedValue: Number(r.out_engaged_value ?? r.engaged_value ?? 0),
    expiredUnworkedValue: Number(r.out_expired_unworked_value ?? r.expired_unworked_value ?? 0),
    pendingValue: Number(r.out_pending_value ?? r.pending_value ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Operator
// ---------------------------------------------------------------------------

/**
 * The signed-in representative's own coverage.
 *
 * Their representative row is resolved from their user id inside the query —
 * an operator cannot ask about anyone else because there is no field in which
 * to name them.
 */
export const getMyCoverage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { workTypeKey?: string; from?: string; to?: string } | undefined) => ({
    workTypeKey: data?.workTypeKey?.trim() || "renewals",
    from: data?.from ?? null,
    to: data?.to ?? null,
  }))
  .handler(async ({ data, context }): Promise<CoverageResult> => {
    const ctx = context as unknown as Ctx;
    const { admin } = await loadClient(ctx);
    const period = normalizePeriod(data.from, data.to);

    const { data: rep } = await admin
      .from("representatives")
      .select("id, name")
      .eq("user_id", ctx.userId)
      .maybeSingle();

    const scope: CoverageScopeRef = {
      scopeId: null,
      scopeKey: null,
      displayName: (rep as any)?.name ?? "הנתונים שלי",
    };
    if (!rep) return unavailable(scope, period.start, period.end, "out_of_scope");

    const { id: workTypeId, freshness } = await resolveWorkType(admin, data.workTypeKey);
    if (!workTypeId) return unavailable(scope, period.start, period.end, "no_inventory");

    const blocked = freshnessBlock(freshness);
    if (blocked) return unavailable(scope, period.start, period.end, blocked);

    const { data: rows, error } = await admin.rpc("coverage_for_representative", {
      _representative_id: (rep as any).id,
      _work_type_id: workTypeId,
      _period_start: period.start,
      _period_end: period.end,
    });
    if (error) throw new Error(error.message);

    const row = (rows ?? [])[0];
    if (!row) return unavailable(scope, period.start, period.end, "no_eligible_work");

    return fromComponents(scope, period.start, period.end, componentsFromRow(row), {
      computedAt: new Date().toISOString(),
      source: "live",
    });
  });

// ---------------------------------------------------------------------------
// Manager scopes
// ---------------------------------------------------------------------------

export type ScopeCoverage = { accountable: boolean; coverage: CoverageResult };

/**
 * Coverage for every scope the actor holds `observe.work_items` over, plus the
 * roll-up across them.
 *
 * Serves the team manager and the operations manager with the same call — the
 * difference between them is the size and number of their scopes, not the
 * shape of the question, which is the finding the discovery work landed on and
 * the reason this is one function rather than two.
 *
 * The roll-up sums components and recomputes; it never averages the per-scope
 * ratios. A team of 8 at 95% and a team of 400 at 40% average to 67.5% and roll
 * up to 41%.
 */
export const getScopeCoverage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { workTypeKey?: string; from?: string; to?: string } | undefined) => ({
    workTypeKey: data?.workTypeKey?.trim() || "renewals",
    from: data?.from ?? null,
    to: data?.to ?? null,
  }))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ scopes: ScopeCoverage[]; rollup: CoverageResult; contributed: number }> => {
      const ctx = context as unknown as Ctx;
      const { admin } = await loadClient(ctx);
      const period = normalizePeriod(data.from, data.to);
      const orgScope: CoverageScopeRef = { scopeId: null, scopeKey: null, displayName: "סך הכול" };

      const { id: workTypeId, freshness } = await resolveWorkType(admin, data.workTypeKey);
      if (!workTypeId) {
        return {
          scopes: [],
          rollup: unavailable(orgScope, period.start, period.end, "no_inventory"),
          contributed: 0,
        };
      }

      const blocked = freshnessBlock(freshness);
      if (blocked) {
        return {
          scopes: [],
          rollup: unavailable(orgScope, period.start, period.end, blocked),
          contributed: 0,
        };
      }

      const { data: rows, error } = await admin.rpc("coverage_for_actor", {
        _person_id: ctx.userId,
        _work_type_id: workTypeId,
        _period_start: period.start,
        _period_end: period.end,
      });
      if (error) throw new Error(error.message);

      const computedAt = new Date().toISOString();
      const scopes: ScopeCoverage[] = ((rows ?? []) as any[]).map((r) => ({
        accountable: r.out_accountable,
        coverage: fromComponents(
          { scopeId: r.out_scope_id, scopeKey: r.out_scope_key, displayName: r.out_display_name },
          period.start,
          period.end,
          componentsFromRow(r),
          { computedAt, source: "live" },
        ),
      }));

      const { result, contributed } = aggregateCoverage(
        scopes.map((s) => s.coverage),
        orgScope,
        period.start,
        period.end,
        computedAt,
      );
      return { scopes, rollup: result, contributed };
    },
  );

// ---------------------------------------------------------------------------
// Admin / debug
// ---------------------------------------------------------------------------

/**
 * Coverage for an arbitrary scope, from STORED FACTS rather than live.
 *
 * The only read that accepts a scope id, and the only one gated on a system
 * capability. Reads facts rather than recomputing because its purpose is to
 * inspect what was recorded — a debug view that recomputed would show a
 * different answer from the one the product served, which is the opposite of
 * useful when something is being investigated.
 */
export const getScopeCoverageFacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { scopeIds: string[]; workTypeKey?: string; from?: string; to?: string }) => {
      if (!Array.isArray(data?.scopeIds) || data.scopeIds.length === 0) {
        throw new Error("יש לציין לפחות תחום אחריות אחד");
      }
      return {
        scopeIds: data.scopeIds.slice(0, 200),
        workTypeKey: data.workTypeKey?.trim() || "renewals",
        from: data.from ?? null,
        to: data.to ?? null,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { admin, actor } = await loadClient(ctx);
    assertSystemCapability(actor, "system.audit");
    const period = normalizePeriod(data.from, data.to);
    const scope: CoverageScopeRef = {
      scopeId: null,
      scopeKey: null,
      displayName: "בדיקת מנהל מערכת",
    };

    const { id: workTypeId } = await resolveWorkType(admin, data.workTypeKey);
    if (!workTypeId) {
      return {
        coverage: unavailable(scope, period.start, period.end, "no_inventory"),
        factCount: 0,
      };
    }

    const { data: rows, error } = await admin.rpc("coverage_facts_rollup", {
      _scope_ids: data.scopeIds,
      _work_type_id: workTypeId,
      _period_start: period.start,
      _period_end: period.end,
    });
    if (error) throw new Error(error.message);

    const row = (rows ?? [])[0];
    const factCount = Number(row?.out_fact_count ?? 0);
    if (!row || factCount === 0) {
      return {
        coverage: unavailable(scope, period.start, period.end, "no_eligible_work"),
        factCount: 0,
      };
    }

    return {
      coverage: fromComponents(scope, period.start, period.end, componentsFromRow(row), {
        computedAt: row.out_oldest_computed_at ?? new Date().toISOString(),
        source: "fact",
      }),
      factCount,
      // Stripped of the sort prefix the SQL used to order the states.
      worstFreshness: String(row.out_worst_freshness ?? "").replace(/^\d/, ""),
      oldestComputedAt: row.out_oldest_computed_at ?? null,
    };
  });

// ---------------------------------------------------------------------------
// Pre-aggregation
// ---------------------------------------------------------------------------

/**
 * Run the daily pre-aggregation by hand.
 *
 * No scheduler is introduced in this PR. This is idempotent — running it twice
 * for the same date updates rather than duplicates — which is what makes a
 * manual trigger acceptable rather than merely expedient.
 */
export const recomputeCoverageFacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { asOf?: string } | undefined) => {
    const asOf =
      data?.asOf && ISO_DATE.test(data.asOf) ? data.asOf : new Date().toISOString().slice(0, 10);
    return { asOf };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { admin, actor } = await loadClient(ctx);
    assertSystemCapability(actor, "system.import");

    const { data: rows, error } = await admin.rpc("compute_coverage_facts_for_date", {
      _as_of: data.asOf,
    });
    if (error) throw new Error(error.message);

    const row = (rows ?? [])[0];
    return {
      asOf: data.asOf,
      factsWritten: Number(row?.out_facts_written ?? 0),
      scopes: Number(row?.out_scopes ?? 0),
      durationMs: Number(row?.out_duration_ms ?? 0),
    };
  });

/** The dated unworked-at-deadline series, scoped by RLS on metric_facts. */
export const getUnworkedAtDeadline = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { from?: string; to?: string; limit?: number } | undefined) => ({
    from: data?.from ?? null,
    to: data?.to ?? null,
    limit: Math.min(Math.max(data?.limit ?? 60, 1), 400),
  }))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const period = normalizePeriod(data.from, data.to);

    // Read through the CALLER's client, not service_role: the RLS policy on
    // metric_facts already scopes this to the scopes they hold, and going
    // through it means there is one definition of who may see a fact rather
    // than a second one written here.
    const { data: rows, error } = await ctx.supabase
      .from("metric_facts")
      .select(
        "scope_id, work_type_id, period_start, expired_unworked_count, expired_unworked_value, eligible_count, eligible_value, freshness_state, scope_lineage, computed_at",
      )
      .eq("metric_key", "coverage")
      .eq("granularity", "day")
      .gte("period_start", period.start)
      .lte("period_end", period.end)
      .order("period_start", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);

    return ((rows ?? []) as any[]).map((r) => ({
      scopeId: r.scope_id,
      onDate: r.period_start,
      scopeName: r.scope_lineage?.displayName ?? "",
      expiredUnworkedCount: Number(r.expired_unworked_count),
      expiredUnworkedValue: Number(r.expired_unworked_value),
      eligibleCount: Number(r.eligible_count),
      eligibleValue: Number(r.eligible_value),
      freshnessState: r.freshness_state,
      computedAt: r.computed_at,
    }));
  });

// ---------------------------------------------------------------------------
// MVP runtime reads
// ---------------------------------------------------------------------------

/**
 * Today's coverage for every scope the actor manages, plus the roll-up.
 *
 * The single figure a team manager opens the product for. "Today" means items
 * DUE today — coverage is deadline-based, so this answers "can today's book be
 * finished", not "what did we do today", and those are different questions
 * with different answers.
 *
 * Computed live rather than read from facts, deliberately: today's facts are
 * stale the moment an operator records anything, and a manager acting on a
 * morning figure needs it to move when the team does.
 */
export const getTeamTodayCoverage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { workTypeKey?: string; onDate?: string } | undefined) => ({
    workTypeKey: data?.workTypeKey?.trim() || "renewals",
    onDate:
      data?.onDate && ISO_DATE.test(data.onDate)
        ? data.onDate
        : new Date().toISOString().slice(0, 10),
  }))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { admin } = await loadClient(ctx);
    const orgScope: CoverageScopeRef = { scopeId: null, scopeKey: null, displayName: "סך הכול" };

    const { id: workTypeId, freshness } = await resolveWorkType(admin, data.workTypeKey);
    if (!workTypeId) {
      return {
        onDate: data.onDate,
        scopes: [] as ScopeCoverage[],
        rollup: unavailable(orgScope, data.onDate, data.onDate, "no_inventory"),
        freshness: null,
      };
    }

    const blocked = freshnessBlock(freshness);
    if (blocked) {
      return {
        onDate: data.onDate,
        scopes: [] as ScopeCoverage[],
        rollup: unavailable(orgScope, data.onDate, data.onDate, blocked),
        freshness,
      };
    }

    const { data: rows, error } = await admin.rpc("coverage_for_actor", {
      _person_id: ctx.userId,
      _work_type_id: workTypeId,
      _period_start: data.onDate,
      _period_end: data.onDate,
    });
    if (error) throw new Error(error.message);

    const computedAt = new Date().toISOString();
    const scopes: ScopeCoverage[] = ((rows ?? []) as any[]).map((r) => ({
      accountable: r.out_accountable,
      coverage: fromComponents(
        { scopeId: r.out_scope_id, scopeKey: r.out_scope_key, displayName: r.out_display_name },
        data.onDate,
        data.onDate,
        componentsFromRow(r),
        { computedAt, source: "live" },
      ),
    }));

    const { result } = aggregateCoverage(
      scopes.map((s) => s.coverage),
      orgScope,
      data.onDate,
      data.onDate,
      computedAt,
    );

    // Freshness travels WITH the figure rather than being fetched separately.
    // A consumer that has to make a second call to learn when the book last
    // arrived is a consumer that will forget to.
    return { onDate: data.onDate, scopes, rollup: result, freshness };
  });

/**
 * Recompute coverage facts for a date, by hand.
 *
 * Exposed under the name the UI will call, and identical in effect to
 * `recomputeCoverageFacts` above — kept as a separate export because the MVP
 * surfaces refer to it, and renaming a published API later costs more than
 * carrying an alias now.
 */
export const refreshCoverageFacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { asOf?: string } | undefined) => ({
    asOf:
      data?.asOf && ISO_DATE.test(data.asOf) ? data.asOf : new Date().toISOString().slice(0, 10),
  }))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { admin, actor } = await loadClient(ctx);
    assertSystemCapability(actor, "system.import");

    const { data: rows, error } = await admin.rpc("compute_coverage_facts_for_date", {
      _as_of: data.asOf,
    });
    if (error) throw new Error(error.message);

    const row = (rows ?? [])[0];
    return {
      asOf: data.asOf,
      factsWritten: Number(row?.out_facts_written ?? 0),
      scopes: Number(row?.out_scopes ?? 0),
      durationMs: Number(row?.out_duration_ms ?? 0),
    };
  });
