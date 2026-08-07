import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Publishing an internal announcement from the Communications Center.
 *
 * AUDIENCE — deliberately organization-wide, labeled "לכל הארגון".
 * The announcements schema has no team/audience column, and its RLS makes
 * every row readable by every authenticated user ("announcements read"
 * USING (true)) — every announcement that exists today IS org-wide.
 * Pretending a team scope in the UI over an org-visible row would be a lie,
 * and adding an audience column would mean another migration on a live
 * database that is still awaiting a schema repair. So the product tells the
 * truth instead: the confirmation dialog states the message goes to the whole
 * organization, and the audit entry records exactly that audience.
 *
 * AUTHORIZATION — the REAL authenticated role, resolved server-side from
 * user_roles: admin or manager may publish, a representative is rejected.
 * The client's presentation state (admin view switcher) never reaches this
 * check, and the announcements staff-write RLS policy (private.is_staff())
 * backs the same rule at the database.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type Ctx = { supabase: SupabaseClient; userId: string; claims: Record<string, unknown> | null };

export const ANNOUNCEMENT_AUDIENCE_ORG_LABEL = "לכל הארגון";
export const ANNOUNCEMENT_PUBLISH_FORBIDDEN_MESSAGE = "אין הרשאה לפרסום הודעות פנימיות";

const MAX_TITLE = 200;
const MAX_BODY = 8000;

export type PublishAnnouncementInput = {
  title: string;
  body: string;
  /** Recorded in the audit entry — where this announcement came from. */
  source: "communications";
};

/**
 * Pure input normalization for publishAnnouncement — exported so the
 * validation rules are unit-testable without mounting the server middleware.
 */
export function normalizeAnnouncementInput(
  data: PublishAnnouncementInput,
): PublishAnnouncementInput {
  const title = String(data?.title ?? "")
    .trim()
    .slice(0, MAX_TITLE);
  const body = String(data?.body ?? "")
    .trim()
    .slice(0, MAX_BODY);
  if (!title) throw new Error("נדרשת כותרת להודעה");
  if (!body) throw new Error("נדרש תוכן להודעה");
  if (data?.source !== "communications") throw new Error("מקור פרסום לא מוכר");
  return { title, body, source: "communications" };
}

async function getRoles(ctx: Ctx): Promise<string[]> {
  const { data, error } = await ctx.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId);
  if (error) throw new Error("שגיאה באימות הרשאות");
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}

// Best-effort audit, identical policy to every other module here: recording
// the action must never be able to fail the action it records.
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

export type PublishAnnouncementResult = {
  ok: true;
  announcement_id: string;
  published_on: string;
  audience_label: string;
};

export const publishAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(normalizeAnnouncementInput)
  .handler(async ({ data, context }): Promise<PublishAnnouncementResult> => {
    const ctx = context as unknown as Ctx;

    const roles = await getRoles(ctx);
    if (!roles.includes("admin") && !roles.includes("manager")) {
      throw new Error(ANNOUNCEMENT_PUBLISH_FORBIDDEN_MESSAGE);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = new Date().toISOString().slice(0, 10);
    const { data: row, error } = await supabaseAdmin
      .from("announcements")
      .insert({
        title: data.title,
        body: data.body,
        published_on: today,
        created_by: ctx.userId,
      })
      .select("id, published_on")
      .single();
    if (error) throw new Error(error.message);

    await logAudit(supabaseAdmin, ctx, "announcement.published", {
      announcement_id: row.id,
      title: data.title,
      audience: "org",
      audience_label: ANNOUNCEMENT_AUDIENCE_ORG_LABEL,
      source: data.source,
      body_length: data.body.length,
    });

    return {
      ok: true,
      announcement_id: row.id,
      published_on: row.published_on,
      audience_label: ANNOUNCEMENT_AUDIENCE_ORG_LABEL,
    };
  });
