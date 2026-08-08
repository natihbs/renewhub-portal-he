import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveBusinessScope,
  importScopeNotice,
  type BusinessScopeGrant,
  type BusinessUnit,
  type ResolvedBusinessScope,
  type ScopeTeam,
} from "@/lib/business-scope";

/**
 * Business hierarchy server functions.
 *
 * AUTHORIZATION MODEL — three layers, all additive to what exists:
 *  * The technical role enum is untouched: admin / manager / representative.
 *    Admin stays the system administrator; business titles never map to it.
 *  * Real enforcement lives in RLS: the migration extends the single funnel
 *    (private.manages_team / private.rep_in_my_team) so a granted business
 *    scope widens exactly the rows those policies already govern, and grants
 *    live in tables only the admin can write.
 *  * These functions resolve the scope through ONE rule set
 *    (resolveBusinessScope) for labels and UI, and gate the admin
 *    configuration writes with a server-side role check + audit entry.
 *
 * DRIFT SAFETY — the hierarchy tables are introduced by an additive
 * migration the live database may not have run yet. getBusinessScope
 * degrades to the plain teams.manager_id scope when they are missing; the
 * admin configuration functions translate the failure into a clear Hebrew
 * message instead of a raw SQL error.
 */

type Ctx = { supabase: SupabaseClient; userId: string; claims: Record<string, unknown> | null };

export const HIERARCHY_TABLES_MISSING_MESSAGE =
  "טבלאות ההיררכיה העסקית טרם הוקמו במסד הנתונים — יש להריץ את המיגרציה העדכנית ולנסות שוב";
export const HIERARCHY_ADMIN_ONLY_MESSAGE = "רק מנהל מערכת יכול להגדיר את ההיררכיה העסקית";

function isMissingTableError(message: string): boolean {
  return /does not exist|schema cache|PGRST205|42P01/i.test(message);
}

async function getRoles(ctx: Ctx): Promise<string[]> {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId);
  if (error) throw new Error("שגיאה באימות הרשאות");
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}

async function requireAdmin(ctx: Ctx): Promise<void> {
  const roles = await getRoles(ctx);
  if (!roles.includes("admin")) throw new Error(HIERARCHY_ADMIN_ONLY_MESSAGE);
}

async function logAudit(
  admin: SupabaseClient,
  ctx: Ctx,
  action: string,
  details: Record<string, unknown>,
) {
  try {
    const { error } = await admin.from("audit_log").insert({
      actor_id: ctx.userId,
      actor_email: typeof ctx.claims?.email === "string" ? ctx.claims.email : null,
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

type UnitRow = { id: string; name: string; unit_type: string; parent_id: string | null };
type GrantRow = { user_id: string; scope_type: string; business_unit_id: string | null };

/** Caller-RLS reads of the hierarchy tables; [] when the migration is absent. */
async function readUnitsAndGrants(
  ctx: Ctx,
  opts: { allGrants: boolean },
): Promise<{ units: BusinessUnit[]; grantRows: GrantRow[] }> {
  const unitsRes = await ctx.supabase
    .from("business_units")
    .select("id, name, unit_type, parent_id")
    .order("name");
  if (unitsRes.error) return { units: [], grantRows: [] };

  let grantsQ = ctx.supabase
    .from("user_business_scopes")
    .select("user_id, scope_type, business_unit_id");
  if (!opts.allGrants) grantsQ = grantsQ.eq("user_id", ctx.userId);
  const grantsRes = await grantsQ;

  const units = ((unitsRes.data ?? []) as UnitRow[]).map((u) => ({
    id: u.id,
    name: u.name,
    unitType: (u.unit_type === "activity" ? "activity" : "center") as BusinessUnit["unitType"],
    parentId: u.parent_id,
  }));
  return { units, grantRows: grantsRes.error ? [] : ((grantsRes.data ?? []) as GrantRow[]) };
}

/** Caller-RLS teams read, tolerating a live DB without teams.business_unit_id. */
async function readScopeTeams(ctx: Ctx): Promise<ScopeTeam[]> {
  type TeamRow = {
    id: string;
    name: string;
    manager_id: string | null;
    business_unit_id?: string | null;
  };
  let rows: TeamRow[] = [];
  const withUnit = await ctx.supabase
    .from("teams")
    .select("id, name, manager_id, business_unit_id");
  if (!withUnit.error) {
    rows = (withUnit.data ?? []) as TeamRow[];
  } else {
    const bare = await ctx.supabase.from("teams").select("id, name, manager_id");
    if (bare.error) throw new Error(bare.error.message);
    rows = (bare.data ?? []) as TeamRow[];
  }
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    managerId: t.manager_id,
    businessUnitId: t.business_unit_id ?? null,
  }));
}

export type BusinessScopePayload = ResolvedBusinessScope & {
  importNotice: string[];
  teamIds: string[];
};

/**
 * The caller's resolved business scope — the single source of truth the UI
 * (home header, /performance, /data-import, workspace switcher) reads.
 */
export const getBusinessScope = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BusinessScopePayload> => {
    const ctx = context as unknown as Ctx;
    const roles = await getRoles(ctx);
    const role = roles.includes("admin")
      ? ("admin" as const)
      : roles.includes("manager")
        ? ("manager" as const)
        : ("representative" as const);

    if (role === "representative") {
      const resolved = resolveBusinessScope({
        role,
        userId: ctx.userId,
        teams: [],
        units: [],
        grants: [],
      });
      return { ...resolved, importNotice: [], teamIds: [] };
    }

    const teams = await readScopeTeams(ctx);
    const { units, grantRows } = await readUnitsAndGrants(ctx, { allGrants: false });
    const grants: BusinessScopeGrant[] = grantRows.map((g) => ({
      scopeType: (g.scope_type === "executive"
        ? "executive"
        : g.scope_type === "activity"
          ? "activity"
          : "center") as BusinessScopeGrant["scopeType"],
      businessUnitId: g.business_unit_id,
    }));

    const resolved = resolveBusinessScope({ role, userId: ctx.userId, teams, units, grants });
    return {
      ...resolved,
      importNotice: importScopeNotice(resolved),
      teamIds: resolved.teams.map((t) => t.id),
    };
  });

// ------------------------------------------------------- admin configuration

export type BusinessHierarchyView = {
  units: BusinessUnit[];
  teams: { id: string; name: string; businessUnitId: string | null }[];
  grants: {
    userId: string;
    userName: string;
    scopeType: "center" | "activity" | "executive";
    businessUnitId: string | null;
    unitName: string | null;
  }[];
  managers: { userId: string; name: string }[];
  /** False when the hierarchy migration has not been applied to the live DB. */
  ready: boolean;
};

/** Admin-only: everything the hierarchy configuration card renders. */
export const listBusinessHierarchy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BusinessHierarchyView> => {
    const ctx = context as unknown as Ctx;
    await requireAdmin(ctx);

    const teams = await readScopeTeams(ctx);
    const teamsView = teams.map((t) => ({
      id: t.id,
      name: t.name,
      businessUnitId: t.businessUnitId,
    }));

    const unitsRes = await ctx.supabase
      .from("business_units")
      .select("id, name, unit_type, parent_id")
      .order("name");
    if (unitsRes.error) {
      if (isMissingTableError(unitsRes.error.message)) {
        return { units: [], teams: teamsView, grants: [], managers: [], ready: false };
      }
      throw new Error(unitsRes.error.message);
    }
    const { units, grantRows } = await readUnitsAndGrants(ctx, { allGrants: true });

    // Names for grant holders and manager candidates (admin reads profiles
    // and user_roles under the existing admin RLS policies).
    const { data: managerRoleRows } = await ctx.supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "manager");
    const managerIds = ((managerRoleRows ?? []) as { user_id: string }[]).map((r) => r.user_id);
    const nameIds = [...new Set([...managerIds, ...grantRows.map((g) => g.user_id)])];
    const nameById = new Map<string, string>();
    if (nameIds.length > 0) {
      const { data: profileRows } = await ctx.supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", nameIds);
      for (const p of (profileRows ?? []) as { id: string; full_name: string | null }[]) {
        if (p.full_name) nameById.set(p.id, p.full_name);
      }
    }
    const unitNameById = new Map(units.map((u) => [u.id, u.name]));

    return {
      units,
      teams: teamsView,
      grants: grantRows.map((g) => ({
        userId: g.user_id,
        userName: nameById.get(g.user_id) ?? g.user_id,
        scopeType: (g.scope_type === "executive"
          ? "executive"
          : g.scope_type === "activity"
            ? "activity"
            : "center") as "center" | "activity" | "executive",
        businessUnitId: g.business_unit_id,
        unitName: g.business_unit_id ? (unitNameById.get(g.business_unit_id) ?? null) : null,
      })),
      managers: managerIds.map((id) => ({ userId: id, name: nameById.get(id) ?? id })),
      ready: true,
    };
  });

function hierarchyWriteError(message: string): Error {
  return new Error(isMissingTableError(message) ? HIERARCHY_TABLES_MISSING_MESSAGE : message);
}

/** Admin-only: create an activity (פעילות) or a center (מוקד) under an activity. */
export const createBusinessUnit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { name: string; unitType: "activity" | "center"; parentId?: string | null }) => {
      const name = String(data?.name ?? "")
        .trim()
        .slice(0, 120);
      if (!name) throw new Error("נדרש שם ליחידה העסקית");
      const unitType = data?.unitType === "activity" ? ("activity" as const) : ("center" as const);
      const parentId = data?.parentId ?? null;
      if (unitType === "center" && !parentId) throw new Error("מוקד חייב להשתייך לפעילות");
      if (unitType === "activity" && parentId)
        throw new Error("פעילות היא יחידת שורש — ללא יחידת אב");
      return { name, unitType, parentId };
    },
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireAdmin(ctx);
    const { data: row, error } = await ctx.supabase
      .from("business_units")
      .insert({ name: data.name, unit_type: data.unitType, parent_id: data.parentId })
      .select("id")
      .single();
    if (error) throw hierarchyWriteError(error.message);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await logAudit(supabaseAdmin as unknown as SupabaseClient, ctx, "business_unit.created", {
      business_unit_id: (row as { id: string }).id,
      name: data.name,
      unit_type: data.unitType,
      parent_id: data.parentId,
    });
    return { ok: true as const, id: (row as { id: string }).id };
  });

/** Admin-only: attach a team to a center/activity, or detach it (unitId null). */
export const attachTeamToUnit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { teamId: string; unitId: string | null }) => {
    const teamId = String(data?.teamId ?? "");
    if (!teamId) throw new Error("נדרש צוות");
    return { teamId, unitId: data?.unitId ?? null };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireAdmin(ctx);
    const { error } = await ctx.supabase
      .from("teams")
      .update({ business_unit_id: data.unitId })
      .eq("id", data.teamId);
    if (error) throw hierarchyWriteError(error.message);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await logAudit(supabaseAdmin as unknown as SupabaseClient, ctx, "team.business_unit_set", {
      team_id: data.teamId,
      business_unit_id: data.unitId,
    });
    return { ok: true as const };
  });

/**
 * Admin-only: set a manager user's business scope. One scope per user in this
 * foundation — the write REPLACES the user's existing grants ("none" clears).
 * Grants only widen viewing/management scope; teams.manager_id is untouched.
 */
export const setUserBusinessScope = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      userId: string;
      scopeType: "none" | "center" | "activity" | "executive";
      unitId?: string | null;
    }) => {
      const userId = String(data?.userId ?? "");
      if (!userId) throw new Error("נדרש משתמש");
      const scopeType = (["none", "center", "activity", "executive"] as const).includes(
        data?.scopeType,
      )
        ? data.scopeType
        : "none";
      const unitId = data?.unitId ?? null;
      if ((scopeType === "center" || scopeType === "activity") && !unitId) {
        throw new Error("יש לבחור מוקד או פעילות עבור ההיקף");
      }
      return { userId, scopeType, unitId: scopeType === "executive" ? null : unitId };
    },
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await requireAdmin(ctx);

    const del = await ctx.supabase.from("user_business_scopes").delete().eq("user_id", data.userId);
    if (del.error) throw hierarchyWriteError(del.error.message);
    if (data.scopeType !== "none") {
      const ins = await ctx.supabase.from("user_business_scopes").insert({
        user_id: data.userId,
        scope_type: data.scopeType,
        business_unit_id: data.unitId,
      });
      if (ins.error) throw hierarchyWriteError(ins.error.message);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await logAudit(supabaseAdmin as unknown as SupabaseClient, ctx, "user.business_scope_set", {
      target_user_id: data.userId,
      scope_type: data.scopeType,
      business_unit_id: data.unitId,
    });
    return { ok: true as const };
  });
