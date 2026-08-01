-- Feedback & Listening production-readiness audit fixes:
--
-- 1. feedback had no draft/publish concept at all — every row was visible to
--    the representative (rep_is_self) the instant a manager saved it, with no
--    way to hold a work-in-progress review back. Add `published`, default
--    false so existing/new rows require an explicit publish action, and
--    tighten the read policy so a representative only ever sees their own
--    published feedback (managers/admins are unaffected — they can always
--    read draft and published feedback for reps they manage).
--
-- 2. Completing a scheduled listening session and saving its feedback were
--    two independent actions with no link between them, so a cancelled
--    feedback form could leave a schedule falsely marked "completed" with no
--    corresponding record. Add a nullable schedule_id so a feedback row can
--    reference the listening_schedules row it was produced from.

ALTER TABLE public.feedback
  ADD COLUMN published boolean NOT NULL DEFAULT false;

ALTER TABLE public.feedback
  ADD COLUMN schedule_id uuid REFERENCES public.listening_schedules(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS "feedback read" ON public.feedback;
CREATE POLICY "feedback read" ON public.feedback FOR SELECT TO authenticated
  USING (private.can_manage_rep(representative_id) OR (published AND private.rep_is_self(representative_id)));

-- 3. feedback.team_key carries the same hardcoded car/home assumption already
--    neutralized on representatives.team_key (see
--    20260801163005_drop_representatives_team_key_check.sql). The application
--    never reads or writes it; only the column default was still silently
--    stamping 'car' on every insert.
ALTER TABLE public.feedback
  ALTER COLUMN team_key DROP NOT NULL;

ALTER TABLE public.feedback
  ALTER COLUMN team_key DROP DEFAULT;

COMMENT ON COLUMN public.feedback.team_key IS
  'Deprecated legacy car/home tag. No longer read or written by the application. Scheduled for removal.';
