import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadActorContext, assertSystemCapability } from "@/lib/authorization";
import {
  classifyFreshness,
  type BatchSummary,
  type FreshnessInput,
  type FreshnessReport,
  type ValidationResult,
} from "@/lib/ingestion-domain";

/**
 * Server layer for the work inventory pipeline.
 *
 * The pipeline core is `runIngestionPipeline`, a plain async function that
 * takes a service-role client. The server functions below are thin wrappers
 * that authenticate and authorize before calling it.
 *
 * That split is deliberate rather than stylistic. A production import of a
 * hundred thousand rows will be a scheduled worker reading from the source
 * system, not an HTTP request carrying a payload — and a worker must be able
 * to drive the same pipeline without inventing a second one. The benchmarks in
 * this PR call the core directly for the same reason.
 *
 * Ingestion is a SYSTEM capability, not an organizational one. It is about who
 * may replace the inventory, and that must not widen automatically as someone's
 * span of control grows.
 */

type Ctx = { supabase: any; userId: string; claims: any };

export const INGESTION_ERROR_CODES = {
  P0020: "ingestion_history_immutable",
  P0021: "batch_already_in_flight",
  P0022: "illegal_batch_state",
  P0023: "source_unavailable",
  P0024: "publish_without_validation",
} as const;

/**
 * How many staging rows go in one insert.
 *
 * A hundred thousand rows in one statement exceeds what PostgREST will accept
 * and would also hold a single transaction open for the whole load. Two
 * thousand keeps each request small and each transaction short; staging is
 * append-only into a table nothing reads yet, so a chunk boundary is not a
 * consistency boundary — the batch does not become real until publish.
 */
const STAGING_CHUNK_SIZE = 2000;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// The pipeline core
// ---------------------------------------------------------------------------

export type IngestionRowInput = {
  externalRef: string | null;
  subjectRef?: string | null;
  subjectLabel?: string | null;
  ownerExternalRef?: string | null;
  dueAtRaw?: string | null;
  eligibleFromRaw?: string | null;
  businessValueRaw?: string | null;
};

export type IngestionRunParams = {
  sourceKey: string;
  rows: readonly IngestionRowInput[];
  externalBatchRef?: string | null;
  triggeredBy?: string | null;
  triggerKind?: "scheduled" | "manual";
};

export type IngestionRunResult = {
  batchId: string;
  published: boolean;
  rowCount: number;
  checksum: string | null;
  rowsInserted: number;
  rowsUpdated: number;
  rowsUnchanged: number;
  rowsRejected: number;
  rowsVoided: number;
  durationMs: number | null;
  validationResult: ValidationResult | null;
  rejectionCode: string | null;
  timings: {
    stageMs: number;
    finalizeMs: number;
    validateMs: number;
    publishMs: number;
    totalMs: number;
  };
};

type AdminClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: any }>;
  from: (table: string) => any;
};

function rpcError(error: any, fallback: string): Error {
  return new Error(error?.message || fallback);
}

/**
 * Runs an import end to end and returns what happened, published or not.
 *
 * A REJECTED BATCH IS NOT AN EXCEPTION. It is the pipeline working: the
 * validation caught something and the previous inventory was preserved. So
 * this resolves with `published: false` and the reason, and throws only when
 * the pipeline itself could not run. Callers that treat rejection as a crash
 * end up retrying a batch that will be rejected again for the same reason.
 */
export async function runIngestionPipeline(
  admin: AdminClient,
  params: IngestionRunParams,
): Promise<IngestionRunResult> {
  const t0 = Date.now();

  const { data: beginData, error: beginError } = await admin.rpc("ingestion_begin_batch", {
    _source_key: params.sourceKey,
    _external_batch_ref: params.externalBatchRef ?? null,
    _triggered_by: params.triggeredBy ?? null,
    _trigger_kind: params.triggerKind ?? "scheduled",
  });
  if (beginError) throw rpcError(beginError, "לא ניתן לפתוח אצווה חדשה");

  const begin = (beginData ?? [])[0] as { out_batch_id: string } | undefined;
  if (!begin) throw new Error("פתיחת האצווה לא הושלמה");
  const batchId = begin.out_batch_id;

  let stageMs = 0;
  let finalizeMs = 0;
  let validateMs = 0;
  let publishMs = 0;

  try {
    // ---------- stage ----------
    const tStage = Date.now();
    let rowNumber = 0;
    for (const group of chunk(params.rows, STAGING_CHUNK_SIZE)) {
      const payload = group.map((r) => ({
        batch_id: batchId,
        row_number: ++rowNumber,
        external_ref: r.externalRef,
        subject_ref: r.subjectRef ?? null,
        subject_label: r.subjectLabel ?? null,
        owner_external_ref: r.ownerExternalRef ?? null,
        due_at_raw: r.dueAtRaw ?? null,
        eligible_from_raw: r.eligibleFromRaw ?? null,
        business_value_raw: r.businessValueRaw ?? null,
      }));
      const { error } = await admin.from("ingestion_staging_rows").insert(payload);
      if (error) throw rpcError(error, "שגיאה בהעלאת שורות לאצווה");
    }
    stageMs = Date.now() - tStage;

    // ---------- finalize ----------
    const tFinalize = Date.now();
    const { data: finalData, error: finalError } = await admin.rpc("ingestion_finalize_staging", {
      _batch_id: batchId,
    });
    if (finalError) throw rpcError(finalError, "שגיאה בסגירת ההעלאה");
    finalizeMs = Date.now() - tFinalize;

    const finalRow = (finalData ?? [])[0] as
      | { out_row_count: number; out_checksum: string }
      | undefined;
    const rowCount = finalRow?.out_row_count ?? 0;
    const checksum = finalRow?.out_checksum ?? null;

    // ---------- validate ----------
    const tValidate = Date.now();
    const { data: valData, error: valError } = await admin.rpc("ingestion_validate_batch", {
      _batch_id: batchId,
    });
    if (valError) throw rpcError(valError, "שגיאה באימות האצווה");
    validateMs = Date.now() - tValidate;

    const val = (valData ?? [])[0] as
      | {
          out_passed: boolean;
          out_validation_result: ValidationResult;
          out_rejection_code: string | null;
        }
      | undefined;

    if (!val?.out_passed) {
      // The batch is already marked rejected by the validator, and the live
      // inventory was never touched. Read back the stored counts rather than
      // trusting what we think we sent.
      const summary = await readBatchRow(admin, batchId);
      return {
        batchId,
        published: false,
        rowCount,
        checksum,
        rowsInserted: 0,
        rowsUpdated: 0,
        rowsUnchanged: 0,
        rowsRejected: summary?.rows_rejected ?? 0,
        rowsVoided: 0,
        durationMs: summary?.duration_ms ?? null,
        validationResult: val?.out_validation_result ?? null,
        rejectionCode: val?.out_rejection_code ?? summary?.rejection_code ?? null,
        timings: { stageMs, finalizeMs, validateMs, publishMs: 0, totalMs: Date.now() - t0 },
      };
    }

    // ---------- publish ----------
    const tPublish = Date.now();
    const { data: pubData, error: pubError } = await admin.rpc("ingestion_publish_batch", {
      _batch_id: batchId,
    });
    if (pubError) throw rpcError(pubError, "שגיאה בפרסום האצווה");
    publishMs = Date.now() - tPublish;

    const pub = (pubData ?? [])[0] as
      | {
          out_rows_inserted: number;
          out_rows_updated: number;
          out_rows_unchanged: number;
          out_rows_voided: number;
          out_duration_ms: number;
        }
      | undefined;

    const rejected = (await readBatchRow(admin, batchId))?.rows_rejected ?? 0;

    return {
      batchId,
      published: true,
      rowCount,
      checksum,
      rowsInserted: pub?.out_rows_inserted ?? 0,
      rowsUpdated: pub?.out_rows_updated ?? 0,
      rowsUnchanged: pub?.out_rows_unchanged ?? 0,
      rowsRejected: rejected,
      rowsVoided: pub?.out_rows_voided ?? 0,
      durationMs: pub?.out_duration_ms ?? null,
      validationResult: val.out_validation_result,
      rejectionCode: null,
      timings: { stageMs, finalizeMs, validateMs, publishMs, totalMs: Date.now() - t0 },
    };
  } catch (e) {
    // Something went wrong outside validation — the source stream died, the
    // process was killed, a chunk insert failed. Close the batch out so the
    // source is not left locked by an open batch nobody will ever finish, then
    // surface the original failure.
    try {
      await admin.rpc("ingestion_reject_batch", {
        _batch_id: batchId,
        _code: "pipeline_error",
        _detail: e instanceof Error ? e.message.slice(0, 500) : "שגיאה לא צפויה",
      });
    } catch (cleanupError) {
      console.error("[ingestion] failed to close batch after error", batchId, cleanupError);
    }
    throw e;
  }
}

async function readBatchRow(admin: AdminClient, batchId: string) {
  const { data } = await admin
    .from("ingestion_batches")
    .select("rows_rejected, duration_ms, rejection_code")
    .eq("id", batchId)
    .maybeSingle();
  return data as {
    rows_rejected: number;
    duration_ms: number | null;
    rejection_code: string | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Server functions
// ---------------------------------------------------------------------------

async function requireImporter(ctx: Ctx): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const actor = await loadActorContext(supabaseAdmin as any, ctx.userId);
  assertSystemCapability(actor, "system.import");
  return supabaseAdmin as unknown as AdminClient;
}

async function requireReader(ctx: Ctx): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const actor = await loadActorContext(supabaseAdmin as any, ctx.userId);
  // Reading pipeline health is a weaker right than replacing the inventory,
  // so either capability suffices — but it is still a system capability, not
  // something a wide organizational scope confers.
  if (!actor.isAdmin) {
    const held = actor.assignments.flatMap((a) => a.capabilities);
    if (!held.includes("system.audit") && !held.includes("system.import")) {
      throw new Error("אין לך הרשאת מערכת לצפייה בנתוני הקליטה");
    }
  }
  return supabaseAdmin as unknown as AdminClient;
}

export const runIngestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { sourceKey: string; rows: IngestionRowInput[]; externalBatchRef?: string | null }) => {
      if (!data?.sourceKey?.trim()) throw new Error("יש לציין מקור קליטה");
      if (!Array.isArray(data?.rows)) throw new Error("חסרות שורות לקליטה");
      return {
        sourceKey: data.sourceKey.trim(),
        rows: data.rows,
        externalBatchRef: data.externalBatchRef?.trim() || null,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const admin = await requireImporter(ctx);
    return await runIngestionPipeline(admin, {
      sourceKey: data.sourceKey,
      rows: data.rows,
      externalBatchRef: data.externalBatchRef,
      triggeredBy: ctx.userId,
      triggerKind: "manual",
    });
  });

/**
 * Batch history. Everything the PR's "each batch should expose" list asks for,
 * read from stored columns rather than recomputed, so a batch whose staging
 * detail has been purged still answers every question.
 */
export const listIngestionBatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { sourceKey?: string | null; limit?: number } | undefined) => ({
    sourceKey: data?.sourceKey?.trim() || null,
    limit: Math.min(Math.max(data?.limit ?? 25, 1), 200),
  }))
  .handler(async ({ data, context }): Promise<BatchSummary[]> => {
    const ctx = context as unknown as Ctx;
    const admin = await requireReader(ctx);

    let query = admin
      .from("ingestion_batches")
      .select(
        "id, status, external_batch_ref, row_count, checksum, rows_inserted, rows_updated, rows_unchanged, rows_rejected, rows_voided, started_at, completed_at, duration_ms, validation_result, rejection_code, rejection_detail, trigger_kind, ingestion_sources!inner(key)",
      )
      .order("started_at", { ascending: false })
      .limit(data.limit);

    if (data.sourceKey) query = query.eq("ingestion_sources.key", data.sourceKey);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    return ((rows ?? []) as any[]).map((r) => ({
      id: r.id,
      sourceKey: r.ingestion_sources?.key ?? "",
      status: r.status,
      externalBatchRef: r.external_batch_ref,
      rowCount: r.row_count,
      checksum: r.checksum,
      rowsInserted: r.rows_inserted,
      rowsUpdated: r.rows_updated,
      rowsUnchanged: r.rows_unchanged,
      rowsRejected: r.rows_rejected,
      rowsVoided: r.rows_voided,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      durationMs: r.duration_ms,
      validationResult: r.validation_result,
      rejectionCode: r.rejection_code,
      rejectionDetail: r.rejection_detail,
      triggerKind: r.trigger_kind,
    }));
  });

/**
 * Why a batch was rejected, down to the rows.
 *
 * Returns a bounded SAMPLE of failing rows, not all of them: a batch can fail
 * with fifty thousand bad rows and nobody diagnoses a fault by scrolling
 * through fifty thousand of anything. The per-error-code counts in the stored
 * validation result carry the magnitude; these carry the shape.
 */
export const getIngestionBatchDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { batchId: string }) => {
    if (!data?.batchId) throw new Error("יש לציין אצווה");
    return { batchId: data.batchId };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const admin = await requireReader(ctx);

    const { data: batch, error } = await admin
      .from("ingestion_batches")
      .select("*, ingestion_sources!inner(key, display_name)")
      .eq("id", data.batchId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!batch) throw new Error("אצווה לא נמצאה");

    const { data: badRows } = await admin
      .from("ingestion_staging_rows")
      .select("row_number, external_ref, error_code, error_detail")
      .eq("batch_id", data.batchId)
      .eq("valid", false)
      .order("row_number")
      .limit(50);

    return {
      batch: batch as any,
      invalidRowSample: (badRows ?? []) as {
        row_number: number;
        external_ref: string | null;
        error_code: string;
        error_detail: string | null;
      }[],
      /** False once staging has been purged — the sample above is then empty for a reason. */
      stagingRetained: (badRows ?? []).length > 0 || (batch as any).rows_rejected === 0,
    };
  });

/**
 * Data freshness for every active source.
 *
 * This is the API PR #2 owes later features. Nothing renders it yet; Coverage,
 * the operator queue and the Data Health screen will all need to say what,
 * when and from where before they show a figure, and this is where that answer
 * comes from.
 */
export const getIngestionFreshness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FreshnessReport[]> => {
    const ctx = context as unknown as Ctx;
    const admin = await requireReader(ctx);

    const { data, error } = await admin.rpc("ingestion_freshness", {});
    if (error) throw new Error(error.message);

    return ((data ?? []) as any[]).map((r) => {
      const input: FreshnessInput = {
        sourceKey: r.out_source_key,
        sourceName: r.out_source_name,
        lastPublishedAt: r.out_last_published_at,
        lastBatchId: r.out_last_batch_id,
        lastRowCount: r.out_last_row_count,
        ageSeconds: r.out_age_seconds === null ? null : Number(r.out_age_seconds),
        lastAttemptAt: r.out_last_attempt_at,
        lastAttemptStatus: r.out_last_attempt_status,
        consecutiveFailures: r.out_consecutive_failures,
        warningHours: r.out_warning_hours,
        criticalHours: r.out_critical_hours,
        openItemCount: r.out_open_item_count,
      };
      return classifyFreshness(input);
    });
  });

export const listIngestionEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { limit?: number; severity?: string | null } | undefined) => ({
    limit: Math.min(Math.max(data?.limit ?? 50, 1), 200),
    severity: data?.severity ?? null,
  }))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const admin = await requireReader(ctx);

    let query = admin
      .from("ingestion_events")
      .select("id, severity, event_code, message, detail, created_at, batch_id, source_id")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.severity) query = query.eq("severity", data.severity);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Abandon a batch stuck in flight, so a failed run cannot lock its source forever. */
export const rejectIngestionBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { batchId: string; reason: string }) => {
    if (!data?.batchId) throw new Error("יש לציין אצווה");
    if (!data?.reason?.trim()) throw new Error("דחיית אצווה מחייבת נימוק");
    return { batchId: data.batchId, reason: data.reason.trim().slice(0, 500) };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const admin = await requireImporter(ctx);

    const { data: result, error } = await admin.rpc("ingestion_reject_batch", {
      _batch_id: data.batchId,
      _code: "manual_cancel",
      _detail: data.reason,
    });
    if (error) throw new Error(error.message);
    return (result ?? [])[0] ?? null;
  });

export const purgeIngestionStaging = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { olderThanDays?: number } | undefined) => ({
    olderThanDays: Math.min(Math.max(data?.olderThanDays ?? 30, 1), 365),
  }))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const admin = await requireImporter(ctx);

    const { data: result, error } = await admin.rpc("ingestion_purge_staging", {
      _older_than_days: data.olderThanDays,
    });
    if (error) throw new Error(error.message);
    return (result ?? [])[0] ?? { out_batches_purged: 0, out_rows_purged: 0 };
  });
