-- Representatives Operational Hardening (P0-5): representative_goals was the
-- one FK to representatives(id) that was both ON DELETE CASCADE and NOT
-- covered by collectBlockers (rep-admin.functions.ts) — every other cascading
-- table (feedback, listening_schedules, rep_notes, rep_tasks,
-- competition_scores, kpi_values) is already surfaced as a delete blocker, so
-- the application-layer check was the only thing standing between a delete
-- and silently destroying a representative's target history, and it had a
-- gap. Changing the constraint itself to RESTRICT adds a second, DB-level
-- guarantee: even if the application-layer check in collectBlockers is ever
-- bypassed or has a bug, Postgres itself will now refuse to delete a
-- representative that still has goals, the same safety net
-- deleteRepresentative's 23503 handler already anticipates for every other
-- table.
ALTER TABLE public.representative_goals
  DROP CONSTRAINT representative_goals_representative_id_fkey,
  ADD CONSTRAINT representative_goals_representative_id_fkey
    FOREIGN KEY (representative_id) REFERENCES public.representatives(id) ON DELETE RESTRICT;
