-- Performance audit: Postgres does not automatically index foreign key
-- columns (only primary keys and UNIQUE constraints get one for free). Nearly
-- every RLS policy in this schema keys off exactly these columns —
-- private.can_manage_rep(representative_id), private.rep_is_self(representative_id),
-- private.manages_team(team_id), etc. — and the application layer filters on
-- them constantly (collectBlockers, feedback/kpi_values/rep_notes/rep_tasks
-- reads scoped to a rep or a set of reps, listUsers's team/manager lookups).
-- Without an index, every one of those reads is a full sequential scan of the
-- table, re-evaluated against the RLS predicate row by row — fine at demo
-- scale, a real and growing cost as feedback/competition/KPI history
-- accumulates. These are pure, additive read-path indexes; nothing about
-- existing query behavior changes.
--
-- Columns already covered by an existing index or a UNIQUE constraint whose
-- leading column matches are intentionally skipped:
--   representatives.team_id, representatives.user_id, kpi_values.representative_id,
--   kpi_values.team_id (existing single-column indexes)
--   user_roles.user_id (leading column of UNIQUE (user_id, role))
--   competition_scores.competition_id (leading column of
--     UNIQUE (competition_id, category_id, representative_id))

CREATE INDEX IF NOT EXISTS teams_manager_id_idx ON public.teams (manager_id);
CREATE INDEX IF NOT EXISTS profiles_team_id_idx ON public.profiles (team_id);
CREATE INDEX IF NOT EXISTS profiles_manager_id_idx ON public.profiles (manager_id);

CREATE INDEX IF NOT EXISTS competition_categories_competition_id_idx ON public.competition_categories (competition_id);
CREATE INDEX IF NOT EXISTS competition_scores_representative_id_idx ON public.competition_scores (representative_id);
CREATE INDEX IF NOT EXISTS competition_scores_category_id_idx ON public.competition_scores (category_id);

CREATE INDEX IF NOT EXISTS feedback_representative_id_idx ON public.feedback (representative_id);
CREATE INDEX IF NOT EXISTS feedback_schedule_id_idx ON public.feedback (schedule_id);
CREATE INDEX IF NOT EXISTS listening_schedules_representative_id_idx ON public.listening_schedules (representative_id);
CREATE INDEX IF NOT EXISTS rep_tasks_representative_id_idx ON public.rep_tasks (representative_id);
CREATE INDEX IF NOT EXISTS rep_notes_representative_id_idx ON public.rep_notes (representative_id);
CREATE INDEX IF NOT EXISTS manager_calls_representative_id_idx ON public.manager_calls (representative_id);
CREATE INDEX IF NOT EXISTS underwriting_issues_representative_id_idx ON public.underwriting_issues (representative_id);

CREATE INDEX IF NOT EXISTS kpi_values_source_import_id_idx ON public.kpi_values (source_import_id);
