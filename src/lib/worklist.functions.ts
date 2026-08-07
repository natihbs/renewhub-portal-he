import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadActorContext, authorizeRepresentative } from "@/lib/authorization";
import { classifyFreshness, type FreshnessInput } from "@/lib/ingestion-domain";
import { freshnessBlock } from "@/lib/coverage-domain";
import { describeQueueReason, isRecordableOutcomeState, type QueueItem } from "@/lib/queue-domain";
import type { CanonicalOutcomeState } from "@/lib/domain-types";

/**
 * The operator's two actions: be handed the next item, and say what happened.
 *
 * NOTHING HERE FAILS SILENTLY. A write that does not commit throws, and the
 * caller gets the database's own message. The pattern this replaces — a
 * fire-and-forget mutation whose toast says "saved" before the promise settles
 * — is how the previous version of this product managed to report success on
 * writes that never landed.
 *
 * The coverage refresh after an outcome is AWAITED and its result returned. If
 * the outcome committed and the refresh failed, the caller is told exactly
 * that, because "your figure is stale and here is why" is recoverable and
 * "saved!" over a stale figure is not.
 */

type Ctx = { supabase: any; userId: string; claims: any };

type AdminClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
  from: (table: string) => any;
};

export const WORKLIST_ERROR_CODES = {
  P0040: "not_recordable_state",
  P0041: "item_unavailable",
  P0042: "not_item_owner",
} as const;

async function loadClient(ctx: Ctx): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AdminClient;
}

/** The signed-in user's representative row, or null when they are not one. */
async function myRepresentative(
  admin: AdminClient,
  userId: string,
): Promise<{ id: string; name: string; teamId: string | null } | null> {
  const { data } = await admin
    .from("representatives")
    .select("id, name, team_id, active")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data || (data as any).active === false) return null;
  return { id: (data as any).id, name: (data as any).name, teamId: (data as any).team_id };
}

async function resolveWorkTypeId(admin: AdminClient, key: string): Promise<string | null> {
  const { data } = await admin.from("work_types").select("id").eq("key", key).maybeSingle();
  return (data as any)?.id ?? null;
}

async function freshnessFor(admin: AdminClient, workTypeKey: string) {
  const { data } = await admin.rpc("ingestion_freshness", {});
  const match = ((data ?? []) as any[]).find((r) => r.out_work_type_key === workTypeKey);
  if (!match) return null;
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
  return classifyFreshness(input);
}

// ---------------------------------------------------------------------------
// getMyNextWorkItem
// ---------------------------------------------------------------------------

export type NextWorkItem = {
  item: QueueItem;
  /** Built from the terms that actually decided the position, never a guess. */
  reason: string;
  /** How many workable items remain, so the operator knows the shape of the day. */
  remaining: number;
};

export type NextWorkItemResult =
  | { available: true; next: NextWorkItem; upcoming: { workItemId: string; reason: string }[] }
  | {
      available: false;
      reason: "not_a_representative" | "no_inventory" | "stale_inventory" | "queue_empty";
      detail: string;
    };

const UNAVAILABLE: Record<string, string> = {
  not_a_representative: "החשבון שלך אינו משויך לנציג — אין רשימת עבודה",
  no_inventory: "לא נקלט מלאי עבודה — לא ניתן להציג רשימה",
  stale_inventory: "המלאי אינו עדכני — הרשימה עלולה שלא לשקף את הספר הנוכחי",
  queue_empty: "אין פריטים פתוחים לטיפול כרגע",
};

/**
 * The next item, plus a short look-ahead.
 *
 * The look-ahead is deliberately small. Handing over the whole list invites
 * cherry-picking — working the easy ones first produces good conversion and
 * terrible coverage, which is the exact failure this product exists to expose.
 * Three rows is enough to see the shape of the next few minutes and not enough
 * to shop in.
 */
export const getMyNextWorkItem = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { workTypeKey?: string; lookAhead?: number } | undefined) => ({
    workTypeKey: data?.workTypeKey?.trim() || "renewals",
    lookAhead: Math.min(Math.max(data?.lookAhead ?? 3, 1), 10),
  }))
  .handler(async ({ data, context }): Promise<NextWorkItemResult> => {
    const ctx = context as unknown as Ctx;
    const admin = await loadClient(ctx);

    const rep = await myRepresentative(admin, ctx.userId);
    if (!rep) {
      return {
        available: false,
        reason: "not_a_representative",
        detail: UNAVAILABLE.not_a_representative,
      };
    }

    const workTypeId = await resolveWorkTypeId(admin, data.workTypeKey);
    if (!workTypeId) {
      return { available: false, reason: "no_inventory", detail: UNAVAILABLE.no_inventory };
    }

    const blocked = freshnessBlock(await freshnessFor(admin, data.workTypeKey));
    if (blocked === "no_inventory") {
      return { available: false, reason: "no_inventory", detail: UNAVAILABLE.no_inventory };
    }
    if (blocked === "stale_inventory") {
      return { available: false, reason: "stale_inventory", detail: UNAVAILABLE.stale_inventory };
    }

    const { data: rows, error } = await admin.rpc("next_work_items_for_representative", {
      _representative_id: rep.id,
      _work_type_id: workTypeId,
      _limit: data.lookAhead + 1,
    });
    if (error) throw new Error(error.message);

    const items: QueueItem[] = ((rows ?? []) as any[]).map((r) => ({
      workItemId: r.out_work_item_id,
      externalRef: r.out_external_ref,
      subjectRef: r.out_subject_ref,
      subjectLabel: r.out_subject_label,
      dueAt: r.out_due_at,
      eligibleFrom: r.out_eligible_from,
      businessValue: Number(r.out_business_value ?? 0),
      touchCount: Number(r.out_touch_count ?? 0),
      hoursToDue: r.out_hours_to_due === null ? null : Number(r.out_hours_to_due),
      overdue: Boolean(r.out_overdue),
      position: Number(r.out_position ?? 0),
    }));

    if (items.length === 0) {
      return { available: false, reason: "queue_empty", detail: UNAVAILABLE.queue_empty };
    }

    const { count } = await admin
      .from("work_items")
      .select("id", { count: "exact", head: true })
      .eq("owner_representative_id", rep.id)
      .eq("work_type_id", workTypeId)
      .eq("state", "open");

    return {
      available: true,
      next: {
        item: items[0],
        reason: describeQueueReason(items[0]),
        remaining: count ?? items.length,
      },
      upcoming: items
        .slice(1)
        .map((i) => ({ workItemId: i.workItemId, reason: describeQueueReason(i) })),
    };
  });

// ---------------------------------------------------------------------------
// recordWorkItemOutcome
// ---------------------------------------------------------------------------

export type RecordOutcomeInput = {
  workItemId: string;
  state: CanonicalOutcomeState;
  reasonCode?: string | null;
  valueRealized?: number | null;
  /** Set when correcting an earlier record. Requires a reason. */
  supersedesId?: string | null;
  correctionReason?: string | null;
};

export type RecordOutcomeResult = {
  outcomeId: string;
  workItemId: string;
  itemState: string;
  resolving: boolean;
  touchCount: number;
  /** Awaited, not fired and forgotten. */
  coverage: {
    refreshed: boolean;
    scopesRefreshed: number;
    onDate: string | null;
    error: string | null;
  };
};

/**
 * Record what happened to one work item.
 *
 * Authorization is two-sided: a representative may record against their own
 * items, and a manager holding `intervene.assign_work` may record against
 * items belonging to a representative in their scope. Neither can reach an
 * item outside both, and the database re-checks ownership regardless.
 */
export const recordWorkItemOutcome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: RecordOutcomeInput) => {
    if (!data?.workItemId) throw new Error("יש לציין פריט עבודה");
    if (!isRecordableOutcomeState(data?.state)) {
      // Named explicitly rather than folded into "invalid state": a caller
      // reaching for the derived state has misunderstood the model.
      if ((data?.state as string) === "expired_unworked") {
        throw new Error("לא ניתן לרשום 'לא טופל בזמן' — זהו מצב נגזר מהיעדר רישום עד למועד היעד");
      }
      throw new Error("מצב תוצאה לא חוקי");
    }
    if (data.supersedesId && !data.correctionReason?.trim()) {
      throw new Error("תיקון תוצאה מחייב נימוק");
    }
    if (
      data.valueRealized !== null &&
      data.valueRealized !== undefined &&
      !Number.isFinite(data.valueRealized)
    ) {
      throw new Error("ערך שהתממש אינו מספר תקין");
    }
    return {
      workItemId: data.workItemId,
      state: data.state,
      reasonCode: data.reasonCode?.trim().slice(0, 120) || null,
      valueRealized: data.valueRealized ?? null,
      supersedesId: data.supersedesId || null,
      correctionReason: data.correctionReason?.trim().slice(0, 500) || null,
    };
  })
  .handler(async ({ data, context }): Promise<RecordOutcomeResult> => {
    const ctx = context as unknown as Ctx;
    const admin = await loadClient(ctx);

    const { data: item, error: itemError } = await admin
      .from("work_items")
      .select("id, owner_representative_id, state")
      .eq("id", data.workItemId)
      .maybeSingle();
    if (itemError) throw new Error(itemError.message);
    if (!item) throw new Error("פריט העבודה לא נמצא");

    const ownerId = (item as any).owner_representative_id as string | null;
    const rep = await myRepresentative(admin, ctx.userId);

    let actingRepresentativeId: string | null = null;
    if (rep && ownerId && rep.id === ownerId) {
      actingRepresentativeId = rep.id;
    } else {
      // Not the owner: this must be a manager acting on someone in their
      // scope. Checked through the PR #1 authorization layer rather than a
      // bespoke rule, so it cannot drift from every other capability check.
      const actor = await loadActorContext(admin as any, ctx.userId);
      if (!ownerId) throw new Error("פריט העבודה אינו משויך לנציג");
      const decision = await authorizeRepresentative(
        admin as any,
        actor,
        ownerId,
        "intervene.assign_work",
      );
      if (!decision.allowed) throw new Error(decision.reason);
      // The outcome is still attributed to the OWNER, not to the manager who
      // entered it. A manager keying in a call the representative made must
      // not have it counted as their own work.
      actingRepresentativeId = ownerId;
    }

    const { data: rows, error } = await admin.rpc("record_work_item_outcome", {
      _work_item_id: data.workItemId,
      _actor_id: ctx.userId,
      _actor_representative_id: actingRepresentativeId,
      _canonical_state: data.state,
      _reason_code: data.reasonCode,
      _value_realized: data.valueRealized,
      _supersedes_id: data.supersedesId,
      _correction_reason: data.correctionReason,
      _occurred_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);

    const row = (rows ?? [])[0];
    if (!row) throw new Error("רישום התוצאה לא הושלם");

    // Awaited. A failure here does NOT roll back the outcome — the outcome is
    // the fact and it is recorded — but it is reported, because a caller told
    // "saved" over a stale coverage figure has been told the calmest possible
    // lie.
    let coverage: RecordOutcomeResult["coverage"] = {
      refreshed: false,
      scopesRefreshed: 0,
      onDate: null,
      error: null,
    };
    try {
      const { data: refreshRows, error: refreshError } = await admin.rpc(
        "refresh_coverage_for_work_item",
        {
          _work_item_id: data.workItemId,
        },
      );
      if (refreshError) throw new Error(refreshError.message);
      const rr = (refreshRows ?? [])[0];
      coverage = {
        refreshed: true,
        scopesRefreshed: Number(rr?.out_scopes_refreshed ?? 0),
        onDate: rr?.out_on_date ?? null,
        error: null,
      };
    } catch (e) {
      console.error("[coverage] refresh failed after outcome", data.workItemId, e);
      coverage = {
        refreshed: false,
        scopesRefreshed: 0,
        onDate: null,
        error: e instanceof Error ? e.message : "רענון הכיסוי נכשל",
      };
    }

    return {
      outcomeId: row.out_outcome_id,
      workItemId: row.out_work_item_id,
      itemState: row.out_item_state,
      resolving: Boolean(row.out_resolving),
      touchCount: Number(row.out_touch_count ?? 0),
      coverage,
    };
  });

/** One work item's full outcome history, oldest first. Read through RLS. */
export const getWorkItemOutcomes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { workItemId: string }) => {
    if (!data?.workItemId) throw new Error("יש לציין פריט עבודה");
    return { workItemId: data.workItemId };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { data: rows, error } = await ctx.supabase
      .from("outcomes")
      .select(
        "id, canonical_state, reason_code, value_realized, occurred_at, supersedes_id, correction_reason",
      )
      .eq("work_item_id", data.workItemId)
      .order("occurred_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
