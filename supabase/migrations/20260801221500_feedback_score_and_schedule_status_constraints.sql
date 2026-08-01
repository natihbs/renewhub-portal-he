-- Production-safety constraints for feedback.score and listening_schedules.status.
--
-- Both columns were free-form (int / text) with correctness enforced only by
-- client code, so a manual write or a future code path could silently insert an
-- out-of-range score or an unsupported status. Before adding either CHECK
-- constraint, existing rows are normalized so the migration itself cannot fail
-- on data that predates the constraint.

-- 1. feedback.score must be an integer percentage in [0, 100]. Clamp any
--    existing out-of-range value into range rather than reject/delete it —
--    a clamped historical score is still meaningful; deleting it would not be.
UPDATE public.feedback
  SET score = LEAST(GREATEST(score, 0), 100)
  WHERE score < 0 OR score > 100;

ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_score_range_check CHECK (score >= 0 AND score <= 100);

-- 2. listening_schedules.status only ever has three supported values in the
--    application (see SCHEDULE_STATUSES in src/lib/listening-store.tsx):
--    'planned' | 'completed' | 'cancelled'. Any row holding something else
--    (bad data, a future removed status, manual edits) is normalized back to
--    'planned' — the same safe default the column already uses — rather than
--    guessed at or dropped.
UPDATE public.listening_schedules
  SET status = 'planned'
  WHERE status NOT IN ('planned', 'completed', 'cancelled');

ALTER TABLE public.listening_schedules
  ADD CONSTRAINT listening_schedules_status_check
  CHECK (status IN ('planned', 'completed', 'cancelled'));
