-- Feedback & Listening Operational Hardening (P0/P1): lifecycle integrity
--
-- PROBLEM 1 — a published feedback could be silently rewritten.
-- FeedbackView rendered its edit button with no published guard, and the
-- "feedback staff write" policy is FOR ALL, so a manager could change the
-- score and summary of an evaluation the representative had already read and
-- discussed. There was no versioning, no published_at, and — outside the
-- admin bulk-publish path — no audit entry at all. Nobody could answer "what
-- did this record say when it was published to the rep".
--
-- PROBLEM 2 — deleting a listening session silently detached its feedback.
-- feedback.schedule_id was ON DELETE SET NULL, so deleting a completed
-- session nulled the link with no warning, losing the provenance of the
-- evaluation.
--
-- This migration adds the durable state those two fixes need. The behavioral
-- rules themselves (who may correct what, when a correction requires a
-- reason) live in feedback.functions.ts, which is now the only application
-- write path — feedback and listening_schedules are removed from the generic
-- cloud writer's allow-list in the same change.

-- ---------- publication state ----------

-- When the record actually became visible to the representative. NULL for a
-- draft. Distinct from created_at/updated_at, both of which move for reasons
-- that have nothing to do with the representative ever seeing anything.
ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- Backfill: rows already published before this migration have no recorded
-- moment of publication. updated_at is the closest honest approximation and
-- is explicitly marked as such rather than silently presented as exact.
UPDATE public.feedback
SET published_at = updated_at
WHERE published AND published_at IS NULL;

COMMENT ON COLUMN public.feedback.published_at IS
  'When this evaluation first became visible to the representative. NULL while it is a draft. Rows published before this column existed were backfilled from updated_at, which is an approximation.';

-- ---------- revision history ----------

-- Append-only prior-state capture. Every application write to feedback
-- records the state BEFORE the change, so the full history of an evaluation
-- is reconstructable and a published record can never change without a trace.
CREATE TABLE IF NOT EXISTS public.feedback_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id uuid NOT NULL REFERENCES public.feedback(id) ON DELETE CASCADE,
  -- Full prior state of the mutable business fields.
  previous_criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_score integer NOT NULL DEFAULT 0,
  previous_keep_doing text NOT NULL DEFAULT '',
  previous_improve text NOT NULL DEFAULT '',
  previous_manager_summary text NOT NULL DEFAULT '',
  previous_next_task text NOT NULL DEFAULT '',
  previous_feedback_date date,
  previous_call_id text NOT NULL DEFAULT '',
  previous_call_type text NOT NULL DEFAULT '',
  previous_listener text NOT NULL DEFAULT '',
  previous_published boolean NOT NULL DEFAULT false,
  -- Why. Required by the application when the record was already published;
  -- a correction to something a representative has read must be explainable.
  reason text NOT NULL DEFAULT '',
  -- Whether this revision changed a record that was already visible to the rep.
  was_published_at_change boolean NOT NULL DEFAULT false,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_revisions_feedback_id_idx
  ON public.feedback_revisions (feedback_id, created_at DESC);

GRANT SELECT ON public.feedback_revisions TO authenticated;
GRANT ALL ON public.feedback_revisions TO service_role;
ALTER TABLE public.feedback_revisions ENABLE ROW LEVEL SECURITY;

-- Read follows the parent evaluation exactly: whoever may read the feedback
-- may read its history. Writes are service_role only — revisions are written
-- by the server function that performs the change, never by a client, so a
-- revision can never be forged or omitted independently of the change itself.
CREATE POLICY "feedback_revisions read" ON public.feedback_revisions
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.feedback f
  WHERE f.id = feedback_id
    AND (private.can_manage_rep(f.representative_id) OR (f.published AND private.rep_is_self(f.representative_id)))
));

COMMENT ON TABLE public.feedback_revisions IS
  'Append-only prior-state history for public.feedback. Written exclusively by feedback.functions.ts under service_role, in the same transaction as the change it records, so a feedback row can never be modified without a corresponding revision.';

-- ---------- listening session provenance ----------

-- feedback.schedule_id was ON DELETE SET NULL: deleting a completed listening
-- session silently severed the link to the evaluation it produced. RESTRICT
-- makes that impossible at the database level, and deleteListeningSchedule
-- surfaces it as a clear, actionable message rather than a raw constraint error.
ALTER TABLE public.feedback
  DROP CONSTRAINT IF EXISTS feedback_schedule_id_fkey;

ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_schedule_id_fkey
    FOREIGN KEY (schedule_id) REFERENCES public.listening_schedules(id) ON DELETE RESTRICT;

-- ---------- coaching plans ----------

-- The Coaching tab presented a "תוכנית פעולה" card with a target score and a
-- "next manager meeting" date that were recomputed from scratch on every
-- render (today + 3 or 7 days) and never stored anywhere. A manager could
-- reasonably believe a plan had been set and a meeting booked; neither was
-- true and no follow-up would ever happen. This is where a real one lives.
CREATE TABLE IF NOT EXISTS public.coaching_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representative_id uuid NOT NULL REFERENCES public.representatives(id) ON DELETE CASCADE,
  target_score integer NOT NULL,
  review_on date NOT NULL,
  focus_sections text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  -- The listening session booked for the review, when the manager chose to
  -- book one. ON DELETE SET NULL: cancelling the meeting must not delete the
  -- plan, it just leaves the plan without a booked review.
  review_schedule_id uuid REFERENCES public.listening_schedules(id) ON DELETE SET NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coaching_plans_target_score_range CHECK (target_score >= 0 AND target_score <= 100),
  -- One current plan per representative. Superseding a plan is an update, so
  -- "the plan" is always unambiguous rather than a pile of stale drafts.
  UNIQUE (representative_id)
);

CREATE INDEX IF NOT EXISTS coaching_plans_review_on_idx ON public.coaching_plans (review_on);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coaching_plans TO authenticated;
GRANT ALL ON public.coaching_plans TO service_role;
ALTER TABLE public.coaching_plans ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER coaching_plans_updated BEFORE UPDATE ON public.coaching_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Same shape as representative_goals: staff who manage the rep may write;
-- the representative may read their own plan (it is about them, and the
-- target/review date is something they should be able to see).
CREATE POLICY "coaching_plans read" ON public.coaching_plans FOR SELECT TO authenticated
  USING (private.can_manage_rep(representative_id) OR private.rep_is_self(representative_id));
CREATE POLICY "coaching_plans staff write" ON public.coaching_plans FOR ALL TO authenticated
  USING (private.can_manage_rep(representative_id)) WITH CHECK (private.can_manage_rep(representative_id));

COMMENT ON TABLE public.coaching_plans IS
  'Persisted coaching plan per representative: agreed target score, review date, focus areas, and optionally the listening session booked for the review. Replaces the previous render-time-only "action plan" that was recomputed on every page load and never stored.';
