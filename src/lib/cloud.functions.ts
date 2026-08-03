import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Generic, RLS-scoped data access for Pulse business entities.
 *
 * Every call runs as the signed-in user (never the service role), so the
 * database policies are the single source of authorization. The table
 * allow-list below prevents access to auth/admin surfaces.
 */
export const CLOUD_TABLES = [
  "announcements",
  "articles",
  "ideas",
  "activity_events",
  "competitions",
  "competition_categories",
  "competition_scores",
  "feedback",
  "listening_schedules",
  "rep_tasks",
  "rep_notes",
  "manager_calls",
  "underwriting_issues",
  "comms_messages",
  "comms_templates",
  "import_templates",
  "import_history",
  "notifications",
  "morning_checklist",
  "morning_settings",
  "kpi_values",
] as const;

export type CloudTable = (typeof CLOUD_TABLES)[number];
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type Row = Record<string, Json>;

type Filters = Record<string, string | number | boolean | null>;

function table(name: string) {
  if (!(CLOUD_TABLES as readonly string[]).includes(name)) {
    throw new Error("טבלה לא מורשית");
  }
  return name;
}

function db(client: unknown) {
  return client as SupabaseClient;
}

/**
 * Postgres error code 23514 = check_violation. Every closed-set text column in
 * this schema (comms kind, listening_schedules status, teams kpi_profile, ...)
 * is enforced by a CHECK constraint rather than a bespoke validator in this
 * generic layer — see the migrations under supabase/migrations for the actual
 * allowed values per column. This only replaces Postgres's raw constraint-name
 * message with something a user can read; it never weakens the constraint.
 */
function fail(error: { message: string; code?: string } | null) {
  if (error) {
    if (error.code === "23514") throw new Error("הערך שהוזן אינו חוקי עבור שדה זה");
    throw new Error(error.message || "שגיאה בגישה לנתוני הענן");
  }
}

export const cloudList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      table: string;
      eq?: Filters;
      in?: Record<string, (string | number)[]>;
      order?: { column: string; ascending?: boolean };
      limit?: number;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    let q = db(context.supabase).from(table(data.table)).select("*");
    for (const [k, v] of Object.entries(data.eq ?? {})) {
      q = v === null ? q.is(k, null) : q.eq(k, v);
    }
    for (const [k, v] of Object.entries(data.in ?? {})) {
      q = q.in(k, v);
    }
    if (data.order) q = q.order(data.order.column, { ascending: data.order.ascending ?? false });
    if (data.limit) q = q.limit(data.limit);
    const { data: rows, error } = await q;
    fail(error);
    return (rows ?? []) as unknown as Row[];
  });

export const cloudInsert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { table: string; values: Row; stampUser?: string }) => d)
  .handler(async ({ data, context }) => {
    const values = { ...data.values };
    if (data.stampUser) values[data.stampUser] = context.userId;
    const { data: row, error } = await db(context.supabase)
      .from(table(data.table))
      .insert(values)
      .select()
      .single();
    fail(error);
    return row as unknown as Row;
  });

export const cloudUpdate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { table: string; id: string; values: Row; idColumn?: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await db(context.supabase)
      .from(table(data.table))
      .update(data.values)
      .eq(data.idColumn ?? "id", data.id)
      .select()
      .single();
    fail(error);
    return row as unknown as Row;
  });

export const cloudUpsert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { table: string; values: Row; onConflict?: string; stampUser?: string }) => d)
  .handler(async ({ data, context }) => {
    const values = { ...data.values };
    if (data.stampUser) values[data.stampUser] = context.userId;
    const { data: row, error } = await db(context.supabase)
      .from(table(data.table))
      .upsert(values, data.onConflict ? { onConflict: data.onConflict } : undefined)
      .select()
      .single();
    fail(error);
    return row as unknown as Row;
  });

export const cloudDelete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { table: string; id: string; idColumn?: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase)
      .from(table(data.table))
      .delete()
      .eq(data.idColumn ?? "id", data.id);
    fail(error);
    return { ok: true };
  });

export const cloudDeleteWhere = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { table: string; eq: Filters }) => d)
  .handler(async ({ data, context }) => {
    let q = db(context.supabase).from(table(data.table)).delete();
    for (const [k, v] of Object.entries(data.eq)) {
      q = v === null ? q.is(k, null) : q.eq(k, v);
    }
    const { error } = await q;
    fail(error);
    return { ok: true };
  });
