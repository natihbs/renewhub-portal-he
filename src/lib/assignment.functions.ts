import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ASSIGNMENT_CADENCES, type AssignmentCadence } from "@/lib/domain-types";
import { unknownCapabilities } from "@/lib/capability-domain";
import { checkPeriod, isIsoDate } from "@/lib/assignment-domain";
import { loadActorContext, assertSystemCapability, type ActorContext } from "@/lib/authorization";

/**
 * Server entry points for the assignment model.
 *
 * There is no UI in this PR. These exist because "validation must occur
 * server-side" needs a server side — this is the path every later surface
 * (People & Scopes admin, coverage reassignment, delegation) will call, and
 * building it now means the validation added in
 * 20260808092000_v2_assignment_validation.sql is reachable and testable rather
 * than theoretical.
 *
 * The division of labour is the one this codebase already uses:
 *
 *   this module   authenticates the actor, checks their capability, shapes and
 *                 range-checks the input, audits the write
 *   the RPC       enforces the domain invariants under a lock, in one
 *                 transaction, and is the only thing granted to service_role
 *
 * Neither trusts the other's job. The pre-flight checks here exist to give a
 * precise message before a round trip; the database is what makes the rule
 * true.
 */

type Ctx = { supabase: any; userId: string; claims: any };

/**
 * Domain error codes raised by the v2 assignment RPCs, mapped to what the
 * operator should do about them. The RPC already raises Hebrew text; this
 * exists so a caller can branch on the cause without parsing a message, and so
 * an unexpected database error is never presented as a validation failure.
 */
export const ASSIGNMENT_ERROR_CODES = {
  P0010: "accountable_overlap",
  P0011: "delegation_limit",
  P0012: "invalid_period",
  P0013: "unknown_capability",
  P0014: "scope_unavailable",
  P0015: "accountability_gap",
  P0016: "assignment_not_found",
} as const;

export type AssignmentErrorCode =
  (typeof ASSIGNMENT_ERROR_CODES)[keyof typeof ASSIGNMENT_ERROR_CODES];

function rethrowDomainError(error: { code?: string; message?: string } | null): never {
  const code = error?.code ?? "";
  if (code in ASSIGNMENT_ERROR_CODES) {
    // The RPC's message is already specific and in Hebrew — it names the
    // conflicting representative or capability. Passing it through beats
    // replacing it with a generic string.
    throw new Error(error?.message || "פעולת השיוך נדחתה");
  }
  throw new Error(error?.message || "שגיאה בביצוע פעולת השיוך");
}

/**
 * Managing assignments is a system capability, not an organizational one:
 * it is about who may reshape the permission model, and that must not widen
 * automatically as someone's span of control grows.
 */
async function requireAssignmentAdmin(ctx: Ctx): Promise<{ admin: any; actor: ActorContext }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const actor = await loadActorContext(supabaseAdmin as any, ctx.userId);
  assertSystemCapability(actor, "system.administer");
  return { admin: supabaseAdmin, actor };
}

async function logAudit(admin: any, ctx: Ctx, action: string, details: Record<string, unknown>) {
  try {
    const { error } = await admin.from("audit_log").insert({
      actor_id: ctx.userId,
      actor_email: (ctx.claims as any)?.email ?? null,
      action,
      target_user_id: (details.person_id as string) ?? null,
      target_email: null,
      details,
    });
    if (error) console.error("[audit_log] insert failed", action, error);
  } catch (e) {
    console.error("[audit_log] insert threw", action, e);
  }
}

// ============================================================ create

export type CreateAssignmentInput = {
  personId: string;
  scopeId: string;
  accountable?: boolean;
  grantedByAssignmentId?: string | null;
  validFrom: string;
  validTo?: string | null;
  cadence?: AssignmentCadence;
  label?: string | null;
  capabilities: string[];
};

function validateCreateInput(data: CreateAssignmentInput): CreateAssignmentInput {
  if (!data?.personId) throw new Error("יש לבחור משתמש עבור השיוך");
  if (!data?.scopeId) throw new Error("יש לבחור תחום אחריות");

  const period = checkPeriod({ validFrom: data.validFrom, validTo: data.validTo ?? null });
  if (period === "missing_from") throw new Error("יש לציין תאריך תחילת השיוך");
  if (period === "malformed_from" || period === "malformed_to")
    throw new Error("תאריך השיוך אינו תקין");
  if (period === "ends_before_start") throw new Error("תאריך סיום השיוך מוקדם מתאריך ההתחלה");

  const capabilities = Array.from(new Set(data.capabilities ?? []));
  const unknown = unknownCapabilities(capabilities);
  if (unknown.length > 0) throw new Error(`הרשאה לא מוכרת: ${unknown[0]}`);

  const cadence = data.cadence ?? "daily";
  if (!ASSIGNMENT_CADENCES.includes(cadence)) throw new Error("תדירות לא חוקית");

  // An accountable assignment that cannot answer for results is a
  // contradiction the model should not be able to express — the column and the
  // capability are two representations of one fact (see capability-domain.ts).
  if (data.accountable && !capabilities.includes("answer.results")) {
    capabilities.push("answer.results");
  }

  return {
    personId: data.personId,
    scopeId: data.scopeId,
    accountable: Boolean(data.accountable),
    grantedByAssignmentId: data.grantedByAssignmentId || null,
    validFrom: data.validFrom,
    validTo: data.validTo || null,
    cadence,
    label: data.label?.trim().slice(0, 120) || null,
    capabilities,
  };
}

export const createAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: CreateAssignmentInput) => validateCreateInput(data))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { admin } = await requireAssignmentAdmin(ctx);

    const { data: result, error } = await admin.rpc("create_assignment", {
      _person_id: data.personId,
      _scope_id: data.scopeId,
      _accountable: data.accountable ?? false,
      _granted_by_assignment_id: data.grantedByAssignmentId,
      _valid_from: data.validFrom,
      _valid_to: data.validTo,
      _cadence: data.cadence ?? "daily",
      _label: data.label,
      _capabilities: data.capabilities,
      _created_by: ctx.userId,
    });
    if (error) rethrowDomainError(error);

    const row = (result ?? [])[0] as
      | { out_assignment_id: string; out_capability_count: number }
      | undefined;
    if (!row) throw new Error("יצירת השיוך לא הושלמה");

    await logAudit(admin, ctx, "assignment.create", {
      assignment_id: row.out_assignment_id,
      person_id: data.personId,
      scope_id: data.scopeId,
      accountable: data.accountable ?? false,
      valid_from: data.validFrom,
      valid_to: data.validTo,
      capabilities: data.capabilities,
      granted_by: data.grantedByAssignmentId,
    });

    return { assignmentId: row.out_assignment_id, capabilityCount: row.out_capability_count };
  });

// ============================================================ end

export type EndAssignmentInput = {
  assignmentId: string;
  validTo: string;
  /** Explicit acknowledgement that ending this will leave representatives uncovered. */
  allowGap?: boolean;
  gapReason?: string | null;
};

export const endAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: EndAssignmentInput) => {
    if (!data?.assignmentId) throw new Error("יש לבחור שיוך");
    if (!isIsoDate(data?.validTo)) throw new Error("תאריך הסיום אינו תקין");
    if (data.allowGap && !data.gapReason?.trim()) throw new Error("אישור פער אחריות מחייב נימוק");
    return {
      assignmentId: data.assignmentId,
      validTo: data.validTo,
      allowGap: Boolean(data.allowGap),
      gapReason: data.gapReason?.trim().slice(0, 500) || null,
    };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { admin } = await requireAssignmentAdmin(ctx);

    const { data: result, error } = await admin.rpc("end_assignment", {
      _assignment_id: data.assignmentId,
      _valid_to: data.validTo,
      _allow_gap: data.allowGap,
      _gap_reason: data.gapReason,
    });
    if (error) rethrowDomainError(error);

    const row = (result ?? [])[0] as
      | { out_assignment_id: string; out_valid_to: string; out_orphaned_count: number }
      | undefined;
    if (!row) throw new Error("סיום השיוך לא הושלם");

    await logAudit(admin, ctx, "assignment.end", {
      assignment_id: data.assignmentId,
      valid_to: data.validTo,
      orphaned_count: row.out_orphaned_count,
      gap_acknowledged: data.allowGap,
      gap_reason: data.gapReason,
    });

    return {
      assignmentId: row.out_assignment_id,
      validTo: row.out_valid_to,
      orphanedCount: row.out_orphaned_count,
    };
  });

// ============================================================ revoke

export const revokeAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { assignmentId: string; reason: string }) => {
    if (!data?.assignmentId) throw new Error("יש לבחור שיוך");
    if (!data?.reason?.trim()) throw new Error("ביטול שיוך מחייב נימוק");
    return { assignmentId: data.assignmentId, reason: data.reason.trim().slice(0, 500) };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { admin } = await requireAssignmentAdmin(ctx);

    const { data: result, error } = await admin.rpc("revoke_assignment", {
      _assignment_id: data.assignmentId,
      _reason: data.reason,
    });
    if (error) rethrowDomainError(error);

    const row = (result ?? [])[0] as
      | { out_assignment_id: string; out_revoked_children: number }
      | undefined;
    if (!row) throw new Error("ביטול השיוך לא הושלם");

    await logAudit(admin, ctx, "assignment.revoke", {
      assignment_id: data.assignmentId,
      reason: data.reason,
      revoked_children: row.out_revoked_children,
    });

    return { assignmentId: row.out_assignment_id, revokedChildren: row.out_revoked_children };
  });

// ============================================================ reads

/**
 * The actor's own authorization context. The one read a v2 surface needs in
 * order to render "why can I see this?" — and the reason it returns
 * assignments rather than a boolean per feature.
 *
 * Returning this to the client is not a permission check. The client may use
 * it to avoid rendering a control that would fail; the server checks again on
 * every write regardless.
 */
export const getMyAuthorizationContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return await loadActorContext(supabaseAdmin as any, ctx.userId);
  });

/**
 * Active representatives with nobody accountable for them.
 *
 * Reporting, never enforcement. A representative created this morning has no
 * accountable assignment yet and that is a queue item for an administrator,
 * not an error — which is precisely why this is a list and not a constraint.
 */
export const listAccountabilityGaps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    const { admin } = await requireAssignmentAdmin(ctx);

    const { data, error } = await admin.rpc("accountability_gaps", {});
    if (error) throw new Error(error.message);

    return (
      (data ?? []) as {
        representative_id: string;
        representative_name: string;
        team_id: string | null;
      }[]
    ).map((r) => ({
      representativeId: r.representative_id,
      name: r.representative_name,
      teamId: r.team_id,
    }));
  });
