import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Server layer for the Dashboard and Morning Routine.
 *
 * Three things live here that could not live in the client:
 *
 *  1. AUDITED, AUTHORIZED UNDERWRITING WRITES. These went through the generic
 *     cloud proxy under an RLS policy of `private.is_staff()` — any manager
 *     could re-status or delete any organization issue, with no audit entry.
 *     The policy is fixed in 20260807090000_underwriting_issues_scope.sql;
 *     this module is the write path that adds attribution on top of it.
 *  2. A SCOPED ACTIVITY FEED. audit_log is admin-only under RLS and holds
 *     user-administration entries (emails, role changes) that a manager must
 *     never see. Rather than widening that policy, listDashboardActivity
 *     authorizes the caller, then does the scoping itself under service_role
 *     and projects only a whitelisted set of actions into a safe shape.
 *  3. GENERATED STATE a client must not be able to forge — achievement
 *     snapshots (the basis of the day-over-day trend) and operational
 *     notifications.
 */

type Ctx = { supabase: any; userId: string; claims: any };

async function getRoles(ctx: Ctx): Promise<string[]> {
  const { data, error } = await ctx.supabase.from("user_roles").select("role").eq("user_id", ctx.userId);
  if (error) throw new Error("שגיאה באימות הרשאות");
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}

/** Admin, or the manager of the representative's own team — resolved through RLS. */
async function assertCanManageRep(ctx: Ctx, repId: string): Promise<{ isAdmin: boolean }> {
  const roles = await getRoles(ctx);
  if (roles.includes("admin")) return { isAdmin: true };
  if (!roles.includes("manager")) throw new Error("אין הרשאה לפעולה זו");
  const { data, error } = await ctx.supabase
    .from("representatives").select("id").eq("id", repId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("אין לך הרשאה לנציג זה — הוא אינו משויך לצוות שבניהולך");
  return { isAdmin: false };
}

/** Teams this caller manages, via the RLS-scoped client. Admins get every team. */
async function managedTeamIds(ctx: Ctx): Promise<{ teamIds: string[]; isAdmin: boolean }> {
  const roles = await getRoles(ctx);
  const isAdmin = roles.includes("admin");
  const { data, error } = await ctx.supabase.from("teams").select("id, manager_id");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { id: string; manager_id: string | null }[];
  return {
    isAdmin,
    teamIds: isAdmin ? rows.map((t) => t.id) : rows.filter((t) => t.manager_id === ctx.userId).map((t) => t.id),
  };
}

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

// ============================================================ underwriting

const UW_STATUSES = ["חדש", "בטיפול", "ממתין לחיתום", "ממתין לנציג", "הושלם"];
const UW_PRIORITIES = ["low", "medium", "high"];

export type UnderwritingInput = {
  representative_id: string;
  subject: string;
  priority: string;
  status: string;
  owner: string;
  due_on: string | null;
  opened_on?: string | null;
};

function normalizeDate(value: unknown, label: string): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!m) throw new Error(`${label} אינו תאריך תקין`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function validateUnderwriting(data: UnderwritingInput): UnderwritingInput {
  if (!data?.representative_id) throw new Error("יש לבחור נציג עבור נושא החיתום");
  if (!data.subject?.trim()) throw new Error("יש להזין נושא");
  if (!UW_PRIORITIES.includes(data.priority)) throw new Error("עדיפות לא חוקית");
  if (!UW_STATUSES.includes(data.status)) throw new Error("סטטוס לא חוקי");
  return {
    representative_id: data.representative_id,
    subject: data.subject.trim().slice(0, 300),
    priority: data.priority,
    status: data.status,
    owner: String(data.owner ?? "").trim().slice(0, 120),
    due_on: normalizeDate(data.due_on, "תאריך יעד"),
    opened_on: normalizeDate(data.opened_on, "תאריך פתיחה"),
  };
}

/**
 * A representative is now mandatory. The column is nullable and the previous
 * dialog allowed leaving it blank, but an issue with no representative cannot
 * be scoped to a manager at all — the corrected RLS policy treats those as
 * organization-level and admin-only. Requiring one here means a manager can
 * never create an issue they would then be unable to see.
 */
export const underwritingCreate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: UnderwritingInput) => validateUnderwriting(data))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertCanManageRep(ctx, data.representative_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error } = await supabaseAdmin
      .from("underwriting_issues")
      .insert({
        representative_id: data.representative_id,
        subject: data.subject,
        priority: data.priority,
        status: data.status,
        owner: data.owner,
        due_on: data.due_on,
        opened_on: data.opened_on ?? new Date().toISOString().slice(0, 10),
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await logAudit(supabaseAdmin, ctx, "underwriting.create", {
      issue_id: row.id,
      representative_id: data.representative_id,
      subject: data.subject,
      priority: data.priority,
      status: data.status,
      source: "morning_routine",
    });
    return { ok: true as const, issue_id: row.id as string };
  });

export const underwritingUpdate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { issue_id: string; status?: string; priority?: string; owner?: string; due_on?: string | null; subject?: string }) => {
    if (!data?.issue_id) throw new Error("חסר מזהה נושא חיתום");
    const out: { status?: string; priority?: string; owner?: string; subject?: string; due_on?: string | null } = {};
    if (data.status !== undefined) {
      if (!UW_STATUSES.includes(data.status)) throw new Error("סטטוס לא חוקי");
      out.status = data.status;
    }
    if (data.priority !== undefined) {
      if (!UW_PRIORITIES.includes(data.priority)) throw new Error("עדיפות לא חוקית");
      out.priority = data.priority;
    }
    if (data.owner !== undefined) out.owner = String(data.owner).trim().slice(0, 120);
    if (data.subject !== undefined) out.subject = String(data.subject).trim().slice(0, 300);
    if (data.due_on !== undefined) out.due_on = normalizeDate(data.due_on, "תאריך יעד");
    if (Object.keys(out).length === 0) throw new Error("אין שינויים לשמירה");
    return { issue_id: data.issue_id, values: out };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Resolve the owning representative first, so authorization is evaluated
    // against the real relationship before any write is attempted.
    const { data: before, error: readErr } = await supabaseAdmin
      .from("underwriting_issues")
      .select("id, representative_id, subject, status, priority, owner, due_on")
      .eq("id", data.issue_id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!before) throw new Error("נושא החיתום לא נמצא — ייתכן שנמחק");
    if (!before.representative_id) throw new Error("נושא חיתום ללא נציג משויך ניתן לעדכון על ידי מנהל מערכת בלבד");

    await assertCanManageRep(ctx, before.representative_id);

    const { error } = await supabaseAdmin
      .from("underwriting_issues").update(data.values).eq("id", data.issue_id);
    if (error) throw new Error(error.message);

    await logAudit(supabaseAdmin, ctx, "underwriting.update", {
      issue_id: data.issue_id,
      representative_id: before.representative_id,
      before: { status: before.status, priority: before.priority, owner: before.owner, due_on: before.due_on },
      after: data.values,
      source: "morning_routine",
    });
    return { ok: true as const };
  });

export const underwritingDelete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { issue_id: string }) => {
    if (!data?.issue_id) throw new Error("חסר מזהה נושא חיתום");
    return { issue_id: data.issue_id };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: before, error: readErr } = await supabaseAdmin
      .from("underwriting_issues")
      .select("id, representative_id, subject, status, priority, owner, opened_on, due_on")
      .eq("id", data.issue_id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!before) throw new Error("נושא החיתום לא נמצא — ייתכן שכבר נמחק");
    if (!before.representative_id) throw new Error("נושא חיתום ללא נציג משויך ניתן למחיקה על ידי מנהל מערכת בלבד");

    await assertCanManageRep(ctx, before.representative_id);

    const { error } = await supabaseAdmin.from("underwriting_issues").delete().eq("id", data.issue_id);
    if (error) throw new Error(error.message);

    // The full prior state goes into the audit entry, because this delete is
    // permanent and there is no revision table for underwriting issues.
    await logAudit(supabaseAdmin, ctx, "underwriting.delete", {
      issue_id: data.issue_id,
      representative_id: before.representative_id,
      deleted: before,
      source: "morning_routine",
    });
    return { ok: true as const };
  });

// ============================================================ checklist

export const toggleChecklistItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { task_key: string; checklist_date: string; team_id: string | null }) => {
    if (!data?.task_key) throw new Error("חסר מזהה משימה");
    const date = normalizeDate(data.checklist_date, "תאריך");
    if (!date) throw new Error("חסר תאריך");
    return { task_key: String(data.task_key).slice(0, 120), checklist_date: date, team_id: data.team_id || null };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // The RPC is keyed by user_id and we always pass the authenticated
    // caller's own id — a caller can only ever toggle their own checklist.
    const { data: result, error } = await supabaseAdmin
      .rpc("toggle_morning_checklist_item", {
        _user_id: ctx.userId,
        _checklist_date: data.checklist_date,
        _task_key: data.task_key,
        // Generated RPC types omit nullability for DEFAULT NULL params.
        _team_id: data.team_id as string,
      })
      .single();
    if (error) throw new Error(error.message);
    const r = result as { out_task_key: string; out_checked: boolean; out_checklist_date: string };
    return { ok: true as const, task_key: r.out_task_key, checked: r.out_checked, checklist_date: r.out_checklist_date };
  });

// ============================================================ snapshots

export type TeamSnapshotInput = {
  team_id: string;
  result_value: number;
  target_value: number | null;
  achievement_pct: number | null;
  representative_count: number;
};

/**
 * Records today's achievement for a team, so tomorrow has something real to
 * compare against. Idempotent per team per day (the RPC upserts under a row
 * lock), so opening the dashboard repeatedly is harmless.
 *
 * Authorization is required even though this only writes derived figures: the
 * snapshot becomes the baseline for a trend, and a caller who could write
 * arbitrary snapshots for a team they do not manage could manufacture a
 * flattering — or damning — history for it.
 */
export const recordTeamAchievementSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: TeamSnapshotInput) => {
    if (!data?.team_id) throw new Error("חסר מזהה צוות");
    const result = Number(data.result_value);
    if (!Number.isFinite(result) || result < 0) throw new Error("ערך ביצוע לא תקין");
    return {
      team_id: data.team_id,
      result_value: Math.round(result),
      target_value: data.target_value === null || data.target_value === undefined ? null : Math.round(Number(data.target_value)),
      achievement_pct: data.achievement_pct === null || data.achievement_pct === undefined ? null : Number(data.achievement_pct),
      representative_count: Math.max(0, Math.round(Number(data.representative_count) || 0)),
    };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { teamIds, isAdmin } = await managedTeamIds(ctx);
    if (!isAdmin && !teamIds.includes(data.team_id)) {
      throw new Error("אין לך הרשאה לצוות זה");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin
      .rpc("record_team_achievement_snapshot", {
        _team_id: data.team_id,
        _snapshot_date: new Date().toISOString().slice(0, 10),
        _result_value: data.result_value,
        _target_value: data.target_value,
        _achievement_pct: data.achievement_pct,
        _representative_count: data.representative_count,
      })
      .single();
    if (error) throw new Error(error.message);
    const r = result as { out_snapshot_id: string; out_created: boolean };
    return { ok: true as const, snapshot_id: r.out_snapshot_id, created: r.out_created };
  });

// ============================================================ activity feed

/**
 * Actions from audit_log that are safe and meaningful to show a manager, with
 * the Hebrew phrasing and destination for each.
 *
 * This is an ALLOW-LIST, deliberately: audit_log also records user
 * administration (invites, role changes, deletions, emails), and a
 * deny-list would leak every future action added by another sprint. Anything
 * not named here simply never reaches the feed.
 */
const ACTIVITY_ACTIONS: Record<string, { label: string; kind: string; href: string }> = {
  "kpi.create": { label: "עודכנו נתוני חידושים", kind: "performance", href: "/performance" },
  "kpi.update": { label: "תוקנו נתוני חידושים", kind: "performance", href: "/performance" },
  "kpi.delete": { label: "נמחקו נתוני חידושים", kind: "performance", href: "/performance" },
  "rep.metrics_update": { label: "עודכנו נתוני ביצוע", kind: "performance", href: "/performance" },
  "rep.transfer": { label: "נציג הועבר בין צוותים", kind: "rep", href: "/representatives" },
  "rep.create": { label: "נוסף נציג", kind: "rep", href: "/representatives" },
  "rep.deactivate": { label: "נציג הושבת", kind: "rep", href: "/representatives" },
  "rep.reactivate": { label: "נציג הופעל מחדש", kind: "rep", href: "/representatives" },
  "feedback.create": { label: "נרשמה האזנה", kind: "feedback", href: "/feedback" },
  "feedback.publish": { label: "משוב פורסם לנציג", kind: "feedback", href: "/feedback" },
  "feedback.retract": { label: "בוטל פרסום משוב", kind: "feedback", href: "/feedback" },
  "feedback.correct_published": { label: "תוקן משוב שפורסם", kind: "feedback", href: "/feedback" },
  "feedback.bulk_publish": { label: "פורסמו משובים קיימים", kind: "feedback", href: "/feedback" },
  "feedback.assign_article": { label: "הוקצה מאמר לנציג", kind: "knowledge", href: "/knowledge" },
  "coaching_plan.create": { label: "נקבעה תוכנית אימון", kind: "feedback", href: "/feedback" },
  "coaching_plan.update": { label: "עודכנה תוכנית אימון", kind: "feedback", href: "/feedback" },
  "listening.create": { label: "תוזמנה האזנה", kind: "feedback", href: "/feedback" },
  "listening.delete": { label: "נמחקה האזנה מתוזמנת", kind: "feedback", href: "/feedback" },
  "underwriting.create": { label: "נפתח נושא חיתום", kind: "underwriting", href: "/" },
  "underwriting.update": { label: "עודכן נושא חיתום", kind: "underwriting", href: "/" },
  "goals.set_representative": { label: "עודכן יעד אישי", kind: "performance", href: "/targets" },
  "goals.set_team": { label: "עודכן יעד צוות", kind: "performance", href: "/targets" },
  "import.apply": { label: "בוצע ייבוא נתונים", kind: "performance", href: "/data-import" },
  "import.undo": { label: "בוטל ייבוא נתונים", kind: "performance", href: "/data-import" },
};

export type DashboardActivityItem = {
  id: string;
  kind: string;
  label: string;
  href: string;
  createdAt: string;
  actorName: string | null;
  representativeName: string | null;
};

/**
 * The dashboard activity feed, from audit_log.
 *
 * The previous feed read public.activity_events, which had a
 * `USING (true)` SELECT policy (readable by every representative in the
 * organization) and exactly two writers, both feedback publishes — while
 * rendering five event kinds and a badge count capped by the fetch limit. It
 * presented itself as a general activity feed and was a two-event feed with
 * org-wide visibility.
 *
 * audit_log already records every material action with a real actor and
 * structured details. It stays admin-only under RLS; this function checks the
 * caller's role first and then does the scoping itself:
 *   - admin   -> organization-wide
 *   - manager -> only entries about a representative they manage or a team
 *                they manage. An entry that names neither is excluded, so an
 *                action with no resolvable scope is never shown by default.
 *   - anyone else -> refused outright.
 *
 * `total` is a real count of the scoped, whitelisted rows, not the page size,
 * so the badge stops reporting the fetch limit as a fact about the business.
 */
export const listDashboardActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { team_id?: string | null; limit?: number }) => ({
    team_id: data?.team_id ?? null,
    limit: Math.min(Math.max(Number(data?.limit) || 8, 1), 30),
  }))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const roles = await getRoles(ctx);
    const isAdmin = roles.includes("admin");
    const isManager = roles.includes("manager");
    if (!isAdmin && !isManager) throw new Error("אין הרשאה לצפייה בפעילות המערכת");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const actions = Object.keys(ACTIVITY_ACTIONS);

    // Resolve the caller's scope from the real relationships, through their
    // OWN client, so RLS decides what they may see rather than this function.
    const { data: scopeReps, error: repErr } = await ctx.supabase
      .from("representatives").select("id, name, team_id");
    if (repErr) throw new Error(repErr.message);
    const repRows = (scopeReps ?? []) as { id: string; name: string; team_id: string | null }[];

    // Workspace narrowing on top of the permission scope, so the feed
    // describes the same population as the rest of the page.
    const inWorkspace = data.team_id
      ? repRows.filter((r) => r.team_id === data.team_id)
      : repRows;
    const repNameById = new Map(inWorkspace.map((r) => [r.id, r.name]));
    const visibleRepIds = new Set(inWorkspace.map((r) => r.id));
    const { teamIds } = await managedTeamIds(ctx);
    const visibleTeamIds = new Set(data.team_id ? [data.team_id] : teamIds);

    const { data: rows, error } = await supabaseAdmin
      .from("audit_log")
      .select("id, action, actor_id, actor_email, details, created_at")
      .in("action", actions)
      .order("created_at", { ascending: false })
      .limit(400);
    if (error) throw new Error(error.message);

    const scoped = ((rows ?? []) as any[]).filter((row) => {
      if (isAdmin && !data.team_id) return true;
      const d = (row.details ?? {}) as Record<string, unknown>;
      const repId = (d.representative_id ?? d.rep_id) as string | undefined;
      const teamId = (d.team_id ?? d.to_team ?? d.from_team) as string | undefined;
      if (repId && visibleRepIds.has(repId)) return true;
      if (teamId && visibleTeamIds.has(teamId)) return true;
      return false;
    });

    // Actor display names, resolved in one round trip.
    const actorIds = [...new Set(scoped.map((r) => r.actor_id).filter(Boolean))] as string[];
    const actorNames = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: profiles } = await supabaseAdmin.from("profiles").select("id, full_name").in("id", actorIds);
      for (const p of (profiles ?? []) as { id: string; full_name: string | null }[]) {
        if (p.full_name) actorNames.set(p.id, p.full_name);
      }
    }

    const items: DashboardActivityItem[] = scoped.slice(0, data.limit).map((row) => {
      const meta = ACTIVITY_ACTIONS[row.action as string];
      const d = (row.details ?? {}) as Record<string, unknown>;
      const repId = (d.representative_id ?? d.rep_id) as string | undefined;
      return {
        id: row.id as string,
        kind: meta.kind,
        label: meta.label,
        href: meta.href,
        createdAt: row.created_at as string,
        actorName: row.actor_id ? (actorNames.get(row.actor_id as string) ?? null) : null,
        representativeName: repId ? (repNameById.get(repId) ?? null) : null,
      };
    });

    return { items, total: scoped.length, truncated: scoped.length > data.limit };
  });

// ============================================================ notifications

export type OperationalNotification = {
  userId: string;
  kind: "import" | "pace" | "listening" | "underwriting" | "competition";
  title: string;
  body: string;
  href: string;
  dedupeKey: string;
};

/**
 * A small, fixed set of operational events a manager should be told about,
 * evaluated on demand when the dashboard opens.
 *
 * Deliberately NOT a rules engine: no scheduler, no subscriptions, no
 * user-authored conditions. Those are a later product phase and building them
 * now would be speculative. What this fixes is that the notification channel
 * existed and no manager-facing event ever produced anything, so the bell was
 * permanently empty for exactly the people the dashboard serves.
 *
 * Storm control is structural rather than conventional: every notification
 * carries a dedupe_key of the form "<event>:<subject>:<date>", and the
 * database enforces uniqueness on (user_id, dedupe_key). Running this on every
 * dashboard open is therefore idempotent by construction — the second call of
 * the day is a no-op inside Postgres, not a decision this function has to
 * remember to make.
 */
export const evaluateManagerNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { events: OperationalNotification[] }) => {
    const events = Array.isArray(data?.events) ? data.events.slice(0, 20) : [];
    return { events };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const roles = await getRoles(ctx);
    if (!roles.includes("admin") && !roles.includes("manager")) {
      return { delivered: 0, skipped: 0 };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let delivered = 0;
    let skipped = 0;
    for (const ev of data.events) {
      // The recipient is always the caller. A client cannot address a
      // notification to anyone else through this path.
      if (!ev?.dedupeKey || !ev?.kind) continue;
      try {
        const { data: result, error } = await supabaseAdmin
          .rpc("deliver_operational_notification", {
            _user_id: ctx.userId,
            _kind: ev.kind,
            _title: String(ev.title ?? "").slice(0, 200),
            _body: String(ev.body ?? "").slice(0, 500),
            _href: String(ev.href ?? "/"),
            _dedupe_key: String(ev.dedupeKey).slice(0, 200),
          })
          .single();
        if (error) throw new Error(error.message);
        if ((result as { out_created: boolean }).out_created) delivered += 1;
        else skipped += 1;
      } catch (e) {
        // A failed notification must never fail the dashboard that generated
        // it — this is advisory delivery, not business state.
        console.error("[notifications] delivery failed", ev.dedupeKey, e);
        skipped += 1;
      }
    }
    return { delivered, skipped };
  });

// ============================================================ freshness read

/**
 * The newest dated performance measurement in the caller's scope — the
 * authoritative answer to "how old is the data on this screen".
 *
 * Read through the caller's own client so RLS decides the scope. This
 * replaces representatives.updated_at, which moved when a name was corrected
 * and stayed still when a renewals-only import landed, making it uncorrelated
 * with data freshness in both directions.
 */
export const getPerformanceDataFreshness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { team_id?: string | null }) => ({ team_id: data?.team_id ?? null }))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;

    let q = ctx.supabase
      .from("kpi_values")
      .select("metric_date")
      .order("metric_date", { ascending: false })
      .limit(1);
    if (data.team_id) q = q.eq("team_id", data.team_id);
    const { data: kpiRows, error } = await q;
    if (error) throw new Error(error.message);

    // The period column is additive (20260808120000) and a live database may
    // not carry it yet — read without it rather than failing freshness.
    type ImportFreshnessRow = { created_at: string; status: string; period?: string | null };
    let importRow: ImportFreshnessRow | null = null;
    const withPeriod = await ctx.supabase
      .from("import_history")
      .select("created_at, status, period")
      .order("created_at", { ascending: false })
      .limit(1);
    if (!withPeriod.error) {
      importRow = ((withPeriod.data ?? [])[0] as unknown as ImportFreshnessRow | undefined) ?? null;
    } else {
      const { data: bareRows, error: importErr } = await ctx.supabase
        .from("import_history")
        .select("created_at, status")
        .order("created_at", { ascending: false })
        .limit(1);
      if (importErr) throw new Error(importErr.message);
      importRow = ((bareRows ?? [])[0] as ImportFreshnessRow | undefined) ?? null;
    }

    return {
      // The newest kpi_values.metric_date. For monthly data this is a PERIOD
      // MARKER (always the first of the month), not an update timestamp.
      sourceDataDate: ((kpiRows ?? [])[0]?.metric_date as string | undefined) ?? null,
      lastImportAt: importRow?.created_at ?? null,
      lastImportStatus: importRow?.status ?? null,
      lastImportPeriod: importRow?.period ?? null,
    };
  });
