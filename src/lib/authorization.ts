// Pulse v2 — the server authorization layer.
//
// One place answers "may this person do this to this subject", and every v2
// server function calls it rather than re-deriving the rule. v1's version of
// this is a private `assertCanManageRep` copied into four *.functions.ts
// files, each subtly different; that is exactly how a permission model drifts.
//
// SHAPE. The module is split into a PURE half and an IO half:
//
//   * the pure half decides, given a context that has already been loaded. It
//     is exhaustively unit-tested, has no imports beyond types, and is where
//     every rule actually lives.
//   * the IO half loads that context through the v2 authorization RPCs. It
//     takes the Supabase client as a PARAMETER and never imports
//     client.server itself — a top-level import of the service-role client
//     would put it in the client bundle.
//
// NO UI PERMISSION CHECKS. Nothing here is exported for a component to branch
// on. A screen may hide a control it knows will fail, but the decision that
// matters is always taken again on the server, on the write path, before the
// row is touched.
//
// COEXISTENCE WITH v1. The v1 admin role still short-circuits every check, and
// team-manager access still flows through the RLS policies v1 already has.
// This layer is additive: during coexistence it can only widen access, never
// narrow it, so nothing a manager can do today stops working when a v2 surface
// starts calling it.

import { isSystemCapability } from "@/lib/capability-domain";
import type { AssignmentCadence, ScopeKind } from "@/lib/domain-types";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/** One assignment the actor currently holds, as the authorization RPC returns it. */
export type ActorAssignment = {
  assignmentId: string;
  scopeId: string;
  scopeKind: ScopeKind;
  scopeDisplayName: string;
  accountable: boolean;
  validFrom: string;
  validTo: string | null;
  label: string | null;
  cadence: AssignmentCadence;
  capabilities: string[];
};

export type ActorContext = {
  personId: string;
  /**
   * The v1 admin role. Kept as a distinct field rather than folded into
   * capabilities so that retiring it later is a visible, greppable change
   * rather than a silent behavioural one.
   */
  isAdmin: boolean;
  assignments: ActorAssignment[];
};

/** One capability the actor holds over a specific representative, and how. */
export type RepresentativeGrant = {
  capabilityKey: string;
  assignmentId: string;
  accountable: boolean;
};

export type AccessDecision = {
  allowed: boolean;
  /**
   * The assignment that granted access, or null when access came from the
   * admin role or was denied. This is what makes "why can I see this?"
   * answerable (PRD FR-28); a decision that cannot name its source is an
   * oracle, and operators work around oracles.
   */
  viaAssignmentId: string | null;
  /** Hebrew, user-facing, and specific about which capability was missing. */
  reason: string;
};

// ---------------------------------------------------------------------------
// Pure decisions
// ---------------------------------------------------------------------------

/** Every organizational capability the actor holds anywhere, deduplicated. */
export function heldCapabilities(ctx: ActorContext): string[] {
  const all = new Set<string>();
  for (const a of ctx.assignments) for (const c of a.capabilities) all.add(c);
  return [...all].sort();
}

export function accountableAssignments(ctx: ActorContext): ActorAssignment[] {
  return ctx.assignments.filter((a) => a.accountable);
}

/**
 * System capabilities carry no scope, so this is a flat membership test rather
 * than a question about a subject. The v1 admin role satisfies any of them,
 * matching private.has_system_capability.
 */
export function hasSystemCapability(ctx: ActorContext, capabilityKey: string): boolean {
  if (ctx.isAdmin) return true;
  if (!isSystemCapability(capabilityKey)) return false;
  return ctx.assignments.some((a) => a.capabilities.includes(capabilityKey));
}

/**
 * The core decision, over a set of grants already resolved for one subject.
 *
 * Kept separate from the fetch so the rule can be tested against every
 * combination without a database, and so the same rule serves a single check
 * and a bulk one.
 */
export function decideFromGrants(
  grants: readonly RepresentativeGrant[],
  requiredCapability: string,
  options: { isAdmin: boolean; requireAccountable?: boolean } = { isAdmin: false },
): AccessDecision {
  if (options.isAdmin) {
    return { allowed: true, viaAssignmentId: null, reason: "הרשאת מנהל מערכת" };
  }

  const matching = grants.filter((g) => g.capabilityKey === requiredCapability);
  if (matching.length === 0) {
    return {
      allowed: false,
      viaAssignmentId: null,
      reason: `אין לך הרשאת ${requiredCapability} על נציג זה`,
    };
  }

  if (options.requireAccountable) {
    const accountable = matching.find((g) => g.accountable);
    if (!accountable) {
      return {
        allowed: false,
        viaAssignmentId: null,
        reason: "פעולה זו מחייבת אחריות ניהולית ישירה על הנציג",
      };
    }
    return { allowed: true, viaAssignmentId: accountable.assignmentId, reason: "אחריות ניהולית" };
  }

  // Prefer the accountable grant when several apply, so the reason shown to
  // the user names their primary relationship rather than an incidental one —
  // and say which kind it was, or the preference would be invisible.
  const accountable = matching.find((g) => g.accountable);
  const chosen = accountable ?? matching[0];
  return {
    allowed: true,
    viaAssignmentId: chosen.assignmentId,
    reason: accountable ? "אחריות ניהולית" : "שיוך תפעולי",
  };
}

/** Is this actor the one person answerable for the subject? */
export function isAccountableFor(grants: readonly RepresentativeGrant[]): boolean {
  return grants.some((g) => g.accountable);
}

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

/**
 * Minimal structural type for the service-role Supabase client. Declared here
 * rather than imported so this module pulls in nothing that must not reach the
 * client bundle; the concrete client is always passed in by the caller.
 */
type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: unknown,
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
};

type ContextRow = {
  out_assignment_id: string;
  out_scope_id: string;
  out_scope_kind: ScopeKind;
  out_scope_display_name: string;
  out_accountable: boolean;
  out_valid_from: string;
  out_valid_to: string | null;
  out_label: string | null;
  out_cadence: AssignmentCadence;
  out_capabilities: string[] | null;
};

/**
 * Load everything the actor currently holds. One RPC plus one role read.
 *
 * Deliberately not cached across requests. v1's require-role.ts caches roles
 * for 30 seconds, which is defensible for a navigation guard and is not
 * defensible here: an assignment ended at 09:00 because someone left must not
 * still authorize a write at 09:00:20.
 */
export async function loadActorContext(admin: RpcClient, personId: string): Promise<ActorContext> {
  const [ctxResult, rolesResult] = await Promise.all([
    admin.rpc("actor_authorization_context", { _person_id: personId }),
    admin.from("user_roles").select("role").eq("user_id", personId),
  ]);

  if (ctxResult.error) throw new Error("שגיאה בטעינת הרשאות המשתמש");
  if (rolesResult.error) throw new Error("שגיאה בטעינת תפקידי המשתמש");

  const roles = ((rolesResult.data ?? []) as { role: string }[]).map((r) => r.role);
  const rows = (ctxResult.data ?? []) as ContextRow[];

  return {
    personId,
    isAdmin: roles.includes("admin"),
    assignments: rows.map((r) => ({
      assignmentId: r.out_assignment_id,
      scopeId: r.out_scope_id,
      scopeKind: r.out_scope_kind,
      scopeDisplayName: r.out_scope_display_name,
      accountable: r.out_accountable,
      validFrom: r.out_valid_from,
      validTo: r.out_valid_to,
      label: r.out_label,
      cadence: r.out_cadence,
      capabilities: r.out_capabilities ?? [],
    })),
  };
}

/** Which capabilities the actor holds over one representative, and through which assignment. */
export async function loadRepresentativeGrants(
  admin: RpcClient,
  personId: string,
  representativeId: string,
): Promise<RepresentativeGrant[]> {
  const { data, error } = await admin.rpc("actor_capabilities_over_rep", {
    _person_id: personId,
    _rep: representativeId,
  });
  if (error) throw new Error("שגיאה בבדיקת הרשאות מול הנציג");

  return (
    (data ?? []) as {
      out_capability_key: string;
      out_assignment_id: string;
      out_accountable: boolean;
    }[]
  ).map((r) => ({
    capabilityKey: r.out_capability_key,
    assignmentId: r.out_assignment_id,
    accountable: r.out_accountable,
  }));
}

export async function authorizeRepresentative(
  admin: RpcClient,
  ctx: ActorContext,
  representativeId: string,
  requiredCapability: string,
  options: { requireAccountable?: boolean } = {},
): Promise<AccessDecision> {
  if (ctx.isAdmin) return { allowed: true, viaAssignmentId: null, reason: "הרשאת מנהל מערכת" };
  const grants = await loadRepresentativeGrants(admin, ctx.personId, representativeId);
  return decideFromGrants(grants, requiredCapability, { isAdmin: false, ...options });
}

/**
 * The form most call sites want: authorize, or fail with a message that says
 * what was missing.
 *
 * Throwing rather than returning is deliberate. A boolean that a caller can
 * forget to check is the shape of every authorization bug this codebase has
 * fixed so far; a throw cannot be forgotten.
 */
export async function assertRepresentativeCapability(
  admin: RpcClient,
  ctx: ActorContext,
  representativeId: string,
  requiredCapability: string,
  options: { requireAccountable?: boolean } = {},
): Promise<AccessDecision> {
  const decision = await authorizeRepresentative(
    admin,
    ctx,
    representativeId,
    requiredCapability,
    options,
  );
  if (!decision.allowed) throw new Error(decision.reason);
  return decision;
}

export function assertSystemCapability(ctx: ActorContext, capabilityKey: string): void {
  if (!hasSystemCapability(ctx, capabilityKey)) {
    throw new Error("אין לך הרשאת מערכת לפעולה זו");
  }
}

/** Every representative currently in reach, with the assignment that puts them there. */
export async function loadReachableRepresentatives(
  admin: RpcClient,
  personId: string,
): Promise<{ representativeId: string; assignmentId: string; accountable: boolean }[]> {
  const { data, error } = await admin.rpc("actor_scope_representatives", { _person_id: personId });
  if (error) throw new Error("שגיאה בטעינת תחום האחריות");
  return (
    (data ?? []) as {
      out_representative_id: string;
      out_assignment_id: string;
      out_accountable: boolean;
    }[]
  ).map((r) => ({
    representativeId: r.out_representative_id,
    assignmentId: r.out_assignment_id,
    accountable: r.out_accountable,
  }));
}
