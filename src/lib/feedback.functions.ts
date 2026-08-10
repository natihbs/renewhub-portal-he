import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeFeedbackScore, isFutureFeedbackDate, type CriterionValue } from "@/lib/feedback-domain";

/**
 * Domain write path for Feedback & Listening.
 *
 * Everything in this module used to go through the GENERIC cloud proxy
 * (cloudInsert/cloudUpdate/cloudDelete), called `void`-prefixed from the UI.
 * That combination produced the defects this file exists to remove:
 *
 *   1. FIRE-AND-FORGET. Every mutation was `void cloud.update(...)`, so a
 *      rejected promise was recorded by error-capture.ts and never shown. The
 *      manager saw "פורסם בהצלחה" whether or not anything had been written.
 *   2. CLIENT-ASSERTED SCORE. The quality score — the number driving the heat
 *      map, the coaching queue and Performance's risk model — was computed in
 *      the browser and forwarded verbatim. It is now always recomputed here
 *      from the submitted criteria (computeFeedbackScore, the SAME function
 *      the UI uses, so there is one implementation and it cannot drift).
 *   3. NO CONCURRENCY CONTROL. Editing was an unconditional
 *      UPDATE ... WHERE id = $1 built from a 15s-stale React Query cache.
 *      Edits now carry the updated_at the caller believes it is editing.
 *   4. NO HISTORY, NO PUBLISHED GUARD. A published evaluation could be
 *      silently rewritten with no trace. Every edit now writes the prior
 *      state to feedback_revisions in the same transaction, and correcting an
 *      already-published record requires a stated reason and re-notifies the
 *      representative.
 *   5. TWO-TABLE WRITES WITH NO TRANSACTION. "Save evaluation" wrote feedback
 *      and then marked the listening session completed as two independent
 *      fire-and-forget calls. Now one RPC = one transaction.
 *   6. NO FUTURE-DATE RULE. A feedback dated in the future is always wrong
 *      (an evaluation records a call that already happened) and it silently
 *      corrupted the coaching queue by making daysSince() negative, which
 *      LOWERED that representative's priority.
 *
 * Authorization is performed HERE, in full, before any RPC is invoked — the
 * RPCs are service_role-only and trust their caller completely, exactly like
 * every other RPC in this codebase.
 */

type Ctx = { supabase: any; userId: string; claims: any };

// ---------------------------------------------------------------- validation

const MAX_TEXT = 4000;
const MAX_SHORT = 200;
const CRITERION_VALUES: CriterionValue[] = ["done", "partial", "not_done", "na"];

/** Accepts YYYY-MM-DD only. A feedback row is a dated business fact. */
export function normalizeFeedbackDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!m) throw new Error("תאריך משוב לא תקין");
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export const FUTURE_FEEDBACK_DATE_MESSAGE =
  "לא ניתן לתעד משוב בתאריך עתידי — המשוב מתעד שיחה שכבר התקיימה";

/**
 * The future-date rule, enforced server-side. The dialog also blocks it, but
 * that is UX only: the browser is not where a business rule is enforced.
 */
export function assertFeedbackDateNotFuture(date: string, now = new Date()): void {
  if (isFutureFeedbackDate(date, now)) throw new Error(FUTURE_FEEDBACK_DATE_MESSAGE);
}

/**
 * Rejects a criteria object containing anything that is not one of the four
 * recognized values. Deliberately throws rather than dropping the offending
 * key: silently discarding a submitted assessment would change the computed
 * score without telling anyone. Keys not present in CRITERIA are preserved as
 * submitted (they are stored but, by design, not scored — see
 * computeFeedbackScore).
 */
export function normalizeCriteria(raw: unknown): Record<string, CriterionValue> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, CriterionValue> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!CRITERION_VALUES.includes(value as CriterionValue)) {
      throw new Error("ערך הערכה לא חוקי במחוון האיכות");
    }
    out[key] = value as CriterionValue;
  }
  return out;
}

function text(value: unknown, max = MAX_TEXT): string {
  return String(value ?? "").slice(0, max);
}

export type FeedbackFields = {
  feedback_date: string;
  call_id: string;
  call_type: string;
  listener: string;
  criteria: Record<string, CriterionValue>;
  keep_doing: string;
  improve: string;
  manager_summary: string;
  next_task: string;
};

function normalizeFeedbackFields(data: any): FeedbackFields {
  const feedback_date = normalizeFeedbackDate(data?.feedback_date);
  assertFeedbackDateNotFuture(feedback_date);
  return {
    feedback_date,
    call_id: text(data?.call_id, MAX_SHORT).trim(),
    call_type: text(data?.call_type, MAX_SHORT).trim(),
    listener: text(data?.listener, MAX_SHORT).trim(),
    criteria: normalizeCriteria(data?.criteria),
    keep_doing: text(data?.keep_doing),
    improve: text(data?.improve),
    manager_summary: text(data?.manager_summary),
    next_task: text(data?.next_task),
  };
}

// ------------------------------------------------------------- authorization

async function getRoles(ctx: Ctx): Promise<string[]> {
  const { data, error } = await ctx.supabase.from("user_roles").select("role").eq("user_id", ctx.userId);
  if (error) throw new Error("שגיאה באימות הרשאות");
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}

/**
 * Admin, or the manager of the representative's own team — resolved through
 * the RLS-scoped client, so "is this rep mine" is answered by the same policy
 * the database enforces (private.can_manage_rep) rather than re-implemented
 * here. A representative can never reach any of these functions: reading their
 * own published feedback is a read, and every write in this module is a staff
 * action.
 */
async function assertCanManageRep(ctx: Ctx, repId: string): Promise<{ isAdmin: boolean }> {
  const roles = await getRoles(ctx);
  if (roles.includes("admin")) return { isAdmin: true };
  if (!roles.includes("manager")) throw new Error("אין הרשאה לפעולה זו במודול המשוב");
  const { data, error } = await ctx.supabase
    .from("representatives").select("id").eq("id", repId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("אין לך הרשאה לנציג זה — הוא אינו משויך לצוות שבניהולך");
  return { isAdmin: false };
}

export const INACTIVE_REP_NEW_ACTIVITY_MESSAGE =
  "הנציג מושבת — לא ניתן לתעד פעילות חדשה עבורו. יש להפעיל מחדש את הנציג.";

/**
 * NEWLY FOUND (not in the original audit), same class as the Representatives
 * sprint's inactive-representative metric policy: nothing stopped a manager
 * from filing a brand-new evaluation, booking a listening session or assigning
 * an article to a representative who no longer works here. Recording NEW
 * operational activity against a deactivated person is always wrong; the
 * remedy is reactivation.
 *
 * Deliberately applied only to new activity. Correcting, publishing or
 * retracting an EXISTING evaluation of an inactive representative stays
 * allowed — refusing corrections would strand known-bad records permanently.
 */
async function assertRepAcceptsNewActivity(admin: any, repId: string): Promise<void> {
  const { data, error } = await admin.from("representatives").select("active").eq("id", repId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("הנציג לא נמצא");
  if (!data.active) throw new Error(INACTIVE_REP_NEW_ACTIVITY_MESSAGE);
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

/**
 * Notify the representative's linked login account, if they have one. Used for
 * events the notify_feedback_published trigger deliberately does NOT cover:
 * that trigger only fires on published false->true, so a CORRECTION to an
 * already-published evaluation — the exact case where the rep is looking at
 * something that just changed under them — would otherwise be silent.
 *
 * Best-effort, for the same reason as logAudit: failing to tell someone about
 * a committed change must not roll back or fail the change itself.
 */
async function notifyRepresentative(
  admin: any,
  repId: string,
  kind: "feedback" | "knowledge",
  title: string,
  body: string,
  href: string,
): Promise<boolean> {
  try {
    const { data: rep } = await admin.from("representatives").select("user_id").eq("id", repId).maybeSingle();
    if (!rep?.user_id) return false;
    const { error } = await admin.from("notifications").insert({
      user_id: rep.user_id, kind, title, body, href,
    });
    if (error) {
      console.error("[notifications] insert failed", kind, error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[notifications] insert threw", kind, e);
    return false;
  }
}

function displayDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// ------------------------------------------------------------ create feedback

export type CreateFeedbackInput = FeedbackFields & {
  representative_id: string;
  schedule_id?: string | null;
};

export type CreateFeedbackResult = {
  ok: true;
  feedback_id: string;
  schedule_completed: boolean;
  score: number;
};

/**
 * Records one evaluation and, when it came from a scheduled listening session,
 * closes that session — atomically, in a single transaction.
 *
 * The row is always created as a DRAFT. Publishing is a separate, separately
 * audited act (setFeedbackPublished): it is what makes the evaluation visible
 * to the representative and what fires their notification, so it must never be
 * a side effect of pressing "save".
 */
export const createFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: CreateFeedbackInput) => {
    if (!data?.representative_id) throw new Error("חסר מזהה נציג");
    return {
      representative_id: data.representative_id,
      schedule_id: data.schedule_id || null,
      ...normalizeFeedbackFields(data),
    };
  })
  .handler(async ({ data, context }): Promise<CreateFeedbackResult> => {
    const ctx = context as unknown as Ctx;
    await assertCanManageRep(ctx, data.representative_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertRepAcceptsNewActivity(supabaseAdmin, data.representative_id);

    // The score is derived here and nowhere else. Any score the client sent is
    // not part of the input shape at all, so there is nothing to trust.
    const score = computeFeedbackScore(data.criteria);

    const { data: result, error } = await supabaseAdmin
      .rpc("create_feedback_with_schedule_completion", {
        _representative_id: data.representative_id,
        _feedback_date: data.feedback_date,
        _call_id: data.call_id,
        _call_type: data.call_type,
        _listener: data.listener,
        _criteria: data.criteria as never,
        _score: score,
        _keep_doing: data.keep_doing,
        _improve: data.improve,
        _manager_summary: data.manager_summary,
        _next_task: data.next_task,
        // Generated RPC types omit nullability for DEFAULT NULL params.
        _schedule_id: data.schedule_id as string,
        _created_by: ctx.userId,
      })
      .single();
    if (error) {
      if (error.code === "P0002") throw new Error("ההאזנה המתוזמנת לא נמצאה — ייתכן שנמחקה");
      if (error.code === "P0007") throw new Error("ההאזנה המתוזמנת שייכת לנציג אחר");
      if (error.code === "P0003") throw new Error("ההאזנה המתוזמנת כבר סומנה כבוצעה על ידי משתמש אחר — יש לרענן");
      throw new Error(error.message);
    }
    const r = result as { feedback_id: string; schedule_completed: boolean };

    await logAudit(supabaseAdmin, ctx, "feedback.create", {
      feedback_id: r.feedback_id,
      representative_id: data.representative_id,
      feedback_date: data.feedback_date,
      score,
      schedule_id: data.schedule_id,
      schedule_completed: r.schedule_completed,
      published: false,
    });

    return { ok: true, feedback_id: r.feedback_id, schedule_completed: r.schedule_completed, score };
  });

// ------------------------------------------------------------ update feedback

export type UpdateFeedbackInput = FeedbackFields & {
  feedback_id: string;
  /** What the caller believes it is editing. Rejected if the row has moved. */
  expected_updated_at: string | null;
  /** Required when the record is already published. */
  reason?: string;
};

export type UpdateFeedbackResult = {
  ok: true;
  feedback_id: string;
  score: number;
  updated_at: string;
  was_published: boolean;
  representative_notified: boolean;
};

export const PUBLISHED_CORRECTION_REASON_REQUIRED =
  "המשוב כבר פורסם לנציג — יש לציין סיבת תיקון שתישמר בהיסטוריית השינויים";

/** Correcting something a representative has already read must be explainable. */
export function assertCorrectionReason(isPublished: boolean, reason: string | undefined): string {
  const trimmed = (reason ?? "").trim();
  if (isPublished && !trimmed) throw new Error(PUBLISHED_CORRECTION_REASON_REQUIRED);
  return trimmed;
}

/**
 * Applies an edit under a row lock, writing the full prior state to
 * feedback_revisions in the same transaction and rejecting outright if the row
 * changed since the caller read it.
 *
 * Publication state is deliberately NOT an input: an edit can never publish or
 * unpublish as a side effect.
 */
export const updateFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: UpdateFeedbackInput) => {
    if (!data?.feedback_id) throw new Error("חסר מזהה משוב");
    return {
      feedback_id: data.feedback_id,
      expected_updated_at: data.expected_updated_at || null,
      reason: typeof data.reason === "string" ? data.reason.slice(0, MAX_SHORT * 2) : "",
      ...normalizeFeedbackFields(data),
    };
  })
  .handler(async ({ data, context }): Promise<UpdateFeedbackResult> => {
    const ctx = context as unknown as Ctx;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Resolve the owning representative first so authorization is evaluated
    // against the real relationship, before any write is attempted.
    const { data: existing, error: readErr } = await supabaseAdmin
      .from("feedback")
      .select("id, representative_id, published, score, feedback_date")
      .eq("id", data.feedback_id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!existing) throw new Error("המשוב לא נמצא — ייתכן שנמחק");

    await assertCanManageRep(ctx, existing.representative_id);
    const reason = assertCorrectionReason(existing.published, data.reason);

    const score = computeFeedbackScore(data.criteria);

    const { data: result, error } = await supabaseAdmin
      .rpc("update_feedback_with_revision", {
        _feedback_id: data.feedback_id,
        _expected_updated_at: data.expected_updated_at as string,
        _feedback_date: data.feedback_date,
        _call_id: data.call_id,
        _call_type: data.call_type,
        _listener: data.listener,
        _criteria: data.criteria as never,
        _score: score,
        _keep_doing: data.keep_doing,
        _improve: data.improve,
        _manager_summary: data.manager_summary,
        _next_task: data.next_task,
        _reason: reason,
        _changed_by: ctx.userId,
      })
      .single();
    if (error) {
      if (error.code === "P0002") throw new Error("המשוב לא נמצא — ייתכן שנמחק");
      if (error.code === "P0003") {
        throw new Error("המשוב עודכן בינתיים על ידי משתמש אחר — יש לרענן את הדף ולנסות שוב");
      }
      throw new Error(error.message);
    }
    const r = result as {
      out_feedback_id: string;
      out_representative_id: string;
      out_was_published: boolean;
      out_new_updated_at: string;
    };

    // A correction to an evaluation the representative has already read is a
    // material change to something they were shown. The publish trigger only
    // fires on false->true, so without this the change would reach them
    // silently — or not at all.
    let notified = false;
    if (r.out_was_published) {
      notified = await notifyRepresentative(
        supabaseAdmin,
        existing.representative_id,
        "feedback",
        "משוב עודכן",
        `המשוב על שיחה מתאריך ${displayDate(data.feedback_date)} עודכן על ידי המנהל.`,
        "/feedback",
      );
    }

    await logAudit(supabaseAdmin, ctx, r.out_was_published ? "feedback.correct_published" : "feedback.update", {
      feedback_id: data.feedback_id,
      representative_id: existing.representative_id,
      was_published: r.out_was_published,
      reason,
      before: { score: existing.score, feedback_date: existing.feedback_date },
      after: { score, feedback_date: data.feedback_date },
      representative_notified: notified,
    });

    return {
      ok: true,
      feedback_id: data.feedback_id,
      score,
      updated_at: r.out_new_updated_at,
      was_published: r.out_was_published,
      representative_notified: notified,
    };
  });

// ------------------------------------------------------- publish / retract

export type SetFeedbackPublishedResult = {
  ok: true;
  feedback_id: string;
  published: boolean;
  published_at: string | null;
  /** false when the record was already in the requested state (idempotent no-op). */
  changed: boolean;
};

export const RETRACT_REASON_REQUIRED =
  "ביטול פרסום מסתיר משוב שהנציג כבר יכול היה לקרוא — יש לציין סיבה";

/**
 * Publish or retract one evaluation. Separate from editing because publishing
 * is what makes the record visible to the representative and fires their
 * notification, and retraction is the un-showing of something a person may
 * already have read — both are material events, both are audited, and the RPC
 * is idempotent so a double-click never produces a second notification.
 */
export const setFeedbackPublished = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { feedback_id: string; published: boolean; reason?: string }) => {
    if (!data?.feedback_id) throw new Error("חסר מזהה משוב");
    if (typeof data.published !== "boolean") throw new Error("חסר מצב פרסום");
    const reason = (data.reason ?? "").trim().slice(0, MAX_SHORT * 2);
    if (!data.published && !reason) throw new Error(RETRACT_REASON_REQUIRED);
    return { feedback_id: data.feedback_id, published: data.published, reason };
  })
  .handler(async ({ data, context }): Promise<SetFeedbackPublishedResult> => {
    const ctx = context as unknown as Ctx;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing, error: readErr } = await supabaseAdmin
      .from("feedback")
      .select("id, representative_id")
      .eq("id", data.feedback_id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!existing) throw new Error("המשוב לא נמצא — ייתכן שנמחק");

    await assertCanManageRep(ctx, existing.representative_id);

    const { data: result, error } = await supabaseAdmin
      .rpc("set_feedback_published", {
        _feedback_id: data.feedback_id,
        _published: data.published,
        _reason: data.reason,
        _changed_by: ctx.userId,
      })
      .single();
    if (error) {
      if (error.code === "P0002") throw new Error("המשוב לא נמצא — ייתכן שנמחק");
      throw new Error(error.message);
    }
    const r = result as {
      out_feedback_id: string;
      out_representative_id: string;
      out_previous_published: boolean;
      out_now_published: boolean;
      out_published_at: string | null;
    };
    const changed = r.out_previous_published !== r.out_now_published;

    if (changed) {
      await logAudit(supabaseAdmin, ctx, data.published ? "feedback.publish" : "feedback.retract", {
        feedback_id: data.feedback_id,
        representative_id: existing.representative_id,
        reason: data.reason,
        published_at: r.out_published_at,
      });
    }

    return {
      ok: true,
      feedback_id: data.feedback_id,
      published: r.out_now_published,
      published_at: r.out_published_at,
      changed,
    };
  });

// ------------------------------------------------------- revision history

export type FeedbackRevision = {
  id: string;
  created_at: string;
  reason: string;
  was_published_at_change: boolean;
  changed_by: string | null;
  changed_by_name: string | null;
  previous_score: number;
  previous_feedback_date: string | null;
  previous_published: boolean;
};

/**
 * The change history of one evaluation, so "what did this record say before"
 * is answerable in the product and not only in the database. Read through the
 * caller's own client — the feedback_revisions RLS policy mirrors the parent
 * feedback's visibility exactly, so scope needs no re-implementation here.
 */
export const listFeedbackRevisions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { feedback_id: string }) => {
    if (!data?.feedback_id) throw new Error("חסר מזהה משוב");
    return { feedback_id: data.feedback_id };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { data: rows, error } = await ctx.supabase
      .from("feedback_revisions")
      .select("id, created_at, reason, was_published_at_change, changed_by, previous_score, previous_feedback_date, previous_published")
      .eq("feedback_id", data.feedback_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const list = (rows ?? []) as any[];
    const actorIds = [...new Set(list.map((r) => r.changed_by).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: profiles } = await ctx.supabase.from("profiles").select("id, full_name").in("id", actorIds);
      for (const p of (profiles ?? []) as { id: string; full_name: string | null }[]) {
        if (p.full_name) names.set(p.id, p.full_name);
      }
    }

    return {
      revisions: list.map((r) => ({
        ...r,
        changed_by_name: r.changed_by ? (names.get(r.changed_by) ?? null) : null,
      })) as FeedbackRevision[],
    };
  });

// ---------------------------------------------------------- article assignment

export type AssignArticleResult = {
  ok: true;
  task_id: string;
  article_title: string;
  representative_notified: boolean;
};

/**
 * The Coaching tab's "הקצאת מאמר" button had no handler at all — it looked
 * like an action and did nothing. It now creates a real, dated task on the
 * representative's list and tells them about it.
 *
 * The unique partial index rep_tasks_open_article_assignment_idx makes
 * assigning the same article twice while the first assignment is still open a
 * constraint violation rather than a pile of duplicate tasks; it is reported
 * here as a plain statement of fact, not an error the manager caused.
 */
export const assignArticleToRepresentative = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { representative_id: string; article_id: string; due_on?: string | null }) => {
    if (!data?.representative_id) throw new Error("חסר מזהה נציג");
    if (!data?.article_id) throw new Error("חסר מזהה מאמר");
    return {
      representative_id: data.representative_id,
      article_id: data.article_id,
      due_on: data.due_on ? normalizeFeedbackDate(data.due_on) : null,
    };
  })
  .handler(async ({ data, context }): Promise<AssignArticleResult> => {
    const ctx = context as unknown as Ctx;
    await assertCanManageRep(ctx, data.representative_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertRepAcceptsNewActivity(supabaseAdmin, data.representative_id);

    const { data: article, error: articleErr } = await supabaseAdmin
      .from("articles").select("id, title").eq("id", data.article_id).maybeSingle();
    if (articleErr) throw new Error(articleErr.message);
    if (!article) throw new Error("המאמר לא נמצא — ייתכן שנמחק");

    const { data: task, error } = await supabaseAdmin
      .from("rep_tasks")
      .insert({
        representative_id: data.representative_id,
        article_id: data.article_id,
        title: `קריאת מאמר: ${article.title}`,
        due_on: data.due_on,
        priority: "medium",
        done: false,
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("המאמר כבר הוקצה לנציג זה והמשימה עדיין פתוחה");
      throw new Error(error.message);
    }

    const notified = await notifyRepresentative(
      supabaseAdmin,
      data.representative_id,
      "knowledge",
      "מאמר הוקצה לך",
      `המנהל הקצה לך לקריאה: ${article.title}`,
      "/knowledge",
    );

    await logAudit(supabaseAdmin, ctx, "feedback.assign_article", {
      representative_id: data.representative_id,
      article_id: data.article_id,
      article_title: article.title,
      task_id: task.id,
      due_on: data.due_on,
      representative_notified: notified,
    });

    return { ok: true, task_id: task.id as string, article_title: article.title as string, representative_notified: notified };
  });

// -------------------------------------------------------------- coaching plan

export type CoachingPlanInput = {
  representative_id: string;
  target_score: number;
  review_on: string;
  focus_sections?: string;
  notes?: string;
  /** Also book the review as a real listening session on the calendar. */
  book_review?: boolean;
  review_time?: string;
};

export type SaveCoachingPlanResult = {
  ok: true;
  plan_id: string;
  review_booked: boolean;
  /** Present only when booking was requested and failed — the plan still saved. */
  review_booking_error: string | null;
};

/** HH:MM, 24h. */
export function normalizeScheduleTime(value: unknown): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? ""));
  if (!m) throw new Error("שעה לא תקינה");
  return `${m[1]}:${m[2]}`;
}

/**
 * The Coaching tab showed a "תוכנית פעולה" card with a target score and a
 * "next manager meeting" date that were recomputed on every render from
 * today + 3 or 7 days and stored nowhere. Reloading the page moved the
 * meeting. Nothing was ever booked and no follow-up could happen.
 *
 * The plan is now a real row (one per representative — superseding a plan is
 * an update, so "the plan" is never ambiguous) and the review can optionally
 * be booked as an actual listening session.
 *
 * Ordering is deliberate: the plan is written FIRST, because a saved plan with
 * no booked review is a complete and valid end state, whereas a booked session
 * with no plan is an orphan on someone's calendar. If the optional booking
 * then fails, the caller is told exactly that rather than being shown a
 * blanket failure for work that did commit.
 */
export const saveCoachingPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: CoachingPlanInput) => {
    if (!data?.representative_id) throw new Error("חסר מזהה נציג");
    const target = Number(data.target_score);
    if (!Number.isFinite(target) || target < 0 || target > 100) throw new Error("יעד ציון חייב להיות בין 0 ל-100");
    const review_on = normalizeFeedbackDate(data.review_on);
    return {
      representative_id: data.representative_id,
      target_score: Math.round(target),
      review_on,
      focus_sections: text(data.focus_sections, MAX_SHORT * 2),
      notes: text(data.notes),
      book_review: !!data.book_review,
      review_time: data.book_review ? normalizeScheduleTime(data.review_time ?? "09:00") : "09:00",
    };
  })
  .handler(async ({ data, context }): Promise<SaveCoachingPlanResult> => {
    const ctx = context as unknown as Ctx;
    await assertCanManageRep(ctx, data.representative_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertRepAcceptsNewActivity(supabaseAdmin, data.representative_id);

    const { data: before } = await supabaseAdmin
      .from("coaching_plans")
      .select("id, target_score, review_on, review_schedule_id")
      .eq("representative_id", data.representative_id)
      .maybeSingle();

    const { data: plan, error } = await supabaseAdmin
      .from("coaching_plans")
      .upsert(
        {
          representative_id: data.representative_id,
          target_score: data.target_score,
          review_on: data.review_on,
          focus_sections: data.focus_sections,
          notes: data.notes,
          created_by: before ? undefined : ctx.userId,
          updated_by: ctx.userId,
        },
        { onConflict: "representative_id" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    let reviewBooked = false;
    let bookingError: string | null = null;
    if (data.book_review) {
      try {
        const { data: session, error: sErr } = await supabaseAdmin
          .from("listening_schedules")
          .insert({
            representative_id: data.representative_id,
            scheduled_on: data.review_on,
            scheduled_time: data.review_time,
            topic: "פגישת מנהל — סקירת תוכנית אימון",
            status: "planned",
            created_by: ctx.userId,
          })
          .select("id")
          .single();
        if (sErr) throw new Error(sErr.message);
        const { error: linkErr } = await supabaseAdmin
          .from("coaching_plans")
          .update({ review_schedule_id: session.id })
          .eq("id", plan.id);
        if (linkErr) throw new Error(linkErr.message);
        reviewBooked = true;
      } catch (e) {
        // Honest partial result: the plan saved, the booking did not.
        bookingError = (e as Error).message;
        console.error("[saveCoachingPlan] review booking failed", data.representative_id, e);
      }
    }

    await logAudit(supabaseAdmin, ctx, before ? "coaching_plan.update" : "coaching_plan.create", {
      representative_id: data.representative_id,
      plan_id: plan.id,
      before: before ? { target_score: before.target_score, review_on: before.review_on } : null,
      after: { target_score: data.target_score, review_on: data.review_on },
      review_booked: reviewBooked,
      review_booking_error: bookingError,
    });

    return { ok: true, plan_id: plan.id as string, review_booked: reviewBooked, review_booking_error: bookingError };
  });

// --------------------------------------------------------- listening schedules

export type ListeningScheduleInput = {
  representative_id: string;
  scheduled_on: string;
  scheduled_time: string;
  topic: string;
};

export const createListeningSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: ListeningScheduleInput) => {
    if (!data?.representative_id) throw new Error("חסר מזהה נציג");
    return {
      representative_id: data.representative_id,
      scheduled_on: normalizeFeedbackDate(data.scheduled_on),
      scheduled_time: normalizeScheduleTime(data.scheduled_time),
      topic: text(data.topic, MAX_SHORT).trim(),
    };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertCanManageRep(ctx, data.representative_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertRepAcceptsNewActivity(supabaseAdmin, data.representative_id);

    const { data: row, error } = await supabaseAdmin
      .from("listening_schedules")
      .insert({ ...data, status: "planned", created_by: ctx.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await logAudit(supabaseAdmin, ctx, "listening.create", {
      schedule_id: row.id, representative_id: data.representative_id,
      scheduled_on: data.scheduled_on, scheduled_time: data.scheduled_time, topic: data.topic,
    });
    return { ok: true as const, schedule_id: row.id as string };
  });

export const SCHEDULE_REOPEN_BLOCKED_MESSAGE =
  "לא ניתן להחזיר את ההאזנה למצב מתוכנן — כבר תועד עבורה משוב. יש למחוק את המשוב קודם.";

/**
 * Edit a listening session. Two guards beyond authorization:
 *
 *  - A session that already produced an evaluation cannot be moved back to
 *    "planned" or "cancelled". Doing so would leave an evaluation attached to
 *    a listening that the calendar claims never happened, and would re-inflate
 *    the manager's outstanding workload in Morning Routine and the Dashboard.
 *    (NEWLY FOUND — not in the original audit; same class as the schedule
 *    deletion defect it sits next to.)
 *  - representative_id is not editable. Moving a session between
 *    representatives after the fact would silently rewrite whose evaluation
 *    history it belongs to.
 */
export const updateListeningSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { schedule_id: string; scheduled_on?: string; scheduled_time?: string; topic?: string; status?: string }) => {
    if (!data?.schedule_id) throw new Error("חסר מזהה האזנה");
    const out: { scheduled_on?: string; scheduled_time?: string; topic?: string; status?: string } = {};
    if (data.scheduled_on !== undefined) out.scheduled_on = normalizeFeedbackDate(data.scheduled_on);
    if (data.scheduled_time !== undefined) out.scheduled_time = normalizeScheduleTime(data.scheduled_time);
    if (data.topic !== undefined) out.topic = text(data.topic, MAX_SHORT).trim();
    if (data.status !== undefined) {
      if (!["planned", "completed", "cancelled"].includes(data.status)) throw new Error("סטטוס האזנה לא חוקי");
      out.status = data.status;
    }
    if (Object.keys(out).length === 0) throw new Error("אין שינויים לשמירה");
    return { schedule_id: data.schedule_id, values: out };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing, error: readErr } = await supabaseAdmin
      .from("listening_schedules")
      .select("id, representative_id, status, scheduled_on, scheduled_time, topic")
      .eq("id", data.schedule_id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!existing) throw new Error("ההאזנה לא נמצאה — ייתכן שנמחקה");

    await assertCanManageRep(ctx, existing.representative_id);

    const nextStatus = data.values.status;
    if (nextStatus && nextStatus !== "completed" && existing.status === "completed") {
      const { count, error: cErr } = await supabaseAdmin
        .from("feedback").select("id", { count: "exact", head: true }).eq("schedule_id", data.schedule_id);
      if (cErr) throw new Error(cErr.message);
      if ((count ?? 0) > 0) throw new Error(SCHEDULE_REOPEN_BLOCKED_MESSAGE);
    }

    const { error } = await supabaseAdmin
      .from("listening_schedules").update(data.values).eq("id", data.schedule_id);
    if (error) throw new Error(error.message);

    await logAudit(supabaseAdmin, ctx, "listening.update", {
      schedule_id: data.schedule_id,
      representative_id: existing.representative_id,
      before: {
        scheduled_on: existing.scheduled_on, scheduled_time: existing.scheduled_time,
        topic: existing.topic, status: existing.status,
      },
      after: data.values,
    });
    return { ok: true as const };
  });

export const SCHEDULE_DELETE_BLOCKED_MESSAGE =
  "לא ניתן למחוק האזנה שכבר תועד עבורה משוב — המחיקה הייתה מנתקת את המשוב מההאזנה שיצרה אותו. ניתן לסמן את ההאזנה כבוטלה במקום.";

/**
 * Delete a listening session.
 *
 * feedback.schedule_id used to be ON DELETE SET NULL, so deleting a completed
 * session silently severed the evaluation's provenance with no warning. The
 * foreign key is now RESTRICT (20260806120000_...sql); this check exists so
 * the user gets an actionable Hebrew explanation instead of a raw constraint
 * error, and the constraint remains the actual guarantee.
 */
export const deleteListeningSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { schedule_id: string }) => {
    if (!data?.schedule_id) throw new Error("חסר מזהה האזנה");
    return { schedule_id: data.schedule_id };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing, error: readErr } = await supabaseAdmin
      .from("listening_schedules")
      .select("id, representative_id, status, scheduled_on, topic")
      .eq("id", data.schedule_id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!existing) throw new Error("ההאזנה לא נמצאה — ייתכן שכבר נמחקה");

    await assertCanManageRep(ctx, existing.representative_id);

    const { count, error: cErr } = await supabaseAdmin
      .from("feedback").select("id", { count: "exact", head: true }).eq("schedule_id", data.schedule_id);
    if (cErr) throw new Error(cErr.message);
    if ((count ?? 0) > 0) throw new Error(SCHEDULE_DELETE_BLOCKED_MESSAGE);

    // A coaching plan pointing at this session is ON DELETE SET NULL: the plan
    // survives, it just stops having a booked review. Recorded in the audit so
    // the disappearance of the booking is explainable later.
    const { data: linkedPlans } = await supabaseAdmin
      .from("coaching_plans").select("id").eq("review_schedule_id", data.schedule_id);

    const { error } = await supabaseAdmin.from("listening_schedules").delete().eq("id", data.schedule_id);
    if (error) {
      if (error.code === "23503") throw new Error(SCHEDULE_DELETE_BLOCKED_MESSAGE);
      throw new Error(error.message);
    }

    await logAudit(supabaseAdmin, ctx, "listening.delete", {
      schedule_id: data.schedule_id,
      representative_id: existing.representative_id,
      scheduled_on: existing.scheduled_on,
      topic: existing.topic,
      status: existing.status,
      unlinked_coaching_plans: (linkedPlans ?? []).length,
    });
    return { ok: true as const };
  });
