-- 20260801220000_feedback_publish_state.sql
ALTER TABLE public.feedback
  ADD COLUMN published boolean NOT NULL DEFAULT false;

ALTER TABLE public.feedback
  ADD COLUMN schedule_id uuid REFERENCES public.listening_schedules(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS "feedback read" ON public.feedback;
CREATE POLICY "feedback read" ON public.feedback FOR SELECT TO authenticated
  USING (private.can_manage_rep(representative_id) OR (published AND private.rep_is_self(representative_id)));

ALTER TABLE public.feedback ALTER COLUMN team_key DROP NOT NULL;
ALTER TABLE public.feedback ALTER COLUMN team_key DROP DEFAULT;

COMMENT ON COLUMN public.feedback.team_key IS
  'Deprecated legacy car/home tag. No longer read or written by the application. Scheduled for removal.';

-- 20260801221500_feedback_score_and_schedule_status_constraints.sql
UPDATE public.feedback
  SET score = LEAST(GREATEST(score, 0), 100)
  WHERE score < 0 OR score > 100;

ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_score_range_check CHECK (score >= 0 AND score <= 100);

UPDATE public.listening_schedules
  SET status = 'planned'
  WHERE status NOT IN ('planned', 'completed', 'cancelled');

ALTER TABLE public.listening_schedules
  ADD CONSTRAINT listening_schedules_status_check
  CHECK (status IN ('planned', 'completed', 'cancelled'));

-- 20260802120000_teams_kpi_profile.sql
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS kpi_profile text NOT NULL DEFAULT 'generic_sales';

ALTER TABLE public.teams
  ADD CONSTRAINT teams_kpi_profile_check CHECK (kpi_profile IN ('generic_sales', 'renewals'));

COMMENT ON COLUMN public.teams.kpi_profile IS
  'Which KPI behavior this team uses. generic_sales (default): target/result achievement only. renewals: also eligible for a real completed/opportunities renewal rate once that data is imported. Never inferred from team name — set explicitly per team.';

-- 20260802120100_morning_settings_achievement_pct.sql
ALTER TABLE public.morning_settings
  ADD COLUMN IF NOT EXISTS yesterday_achievement_pct numeric NOT NULL DEFAULT 0;

ALTER TABLE public.morning_settings
  ADD COLUMN IF NOT EXISTS monthly_avg_achievement_pct numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.morning_settings.yesterday_renewal_pct IS
  'Deprecated: mislabeled as a renewal rate but always held plain target achievement. Replaced by yesterday_achievement_pct. No longer read or written by the application.';

COMMENT ON COLUMN public.morning_settings.monthly_avg_renewal_pct IS
  'Deprecated: mislabeled as a renewal rate but always held plain target achievement. Replaced by monthly_avg_achievement_pct. No longer read or written by the application.';

-- 20260802150000_kpi_values.sql
CREATE TABLE public.kpi_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representative_id uuid NOT NULL REFERENCES public.representatives(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  metric_date date NOT NULL,
  renewal_opportunities integer,
  completed_renewals integer,
  source_import_id uuid REFERENCES public.import_history(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kpi_values_opportunities_nonneg CHECK (renewal_opportunities IS NULL OR renewal_opportunities >= 0),
  CONSTRAINT kpi_values_completed_nonneg CHECK (completed_renewals IS NULL OR completed_renewals >= 0),
  UNIQUE (representative_id, metric_date)
);

CREATE INDEX kpi_values_representative_id_idx ON public.kpi_values (representative_id);
CREATE INDEX kpi_values_team_id_idx ON public.kpi_values (team_id);
CREATE INDEX kpi_values_metric_date_idx ON public.kpi_values (metric_date);

CREATE TRIGGER kpi_values_set_updated_at
BEFORE UPDATE ON public.kpi_values
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kpi_values TO authenticated;
GRANT ALL ON public.kpi_values TO service_role;

ALTER TABLE public.kpi_values ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.owns_representative(_rep_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.representatives r WHERE r.id = _rep_id AND r.user_id = auth.uid())
$$;
REVOKE ALL ON FUNCTION private.owns_representative(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.owns_representative(uuid) TO authenticated;

CREATE POLICY "kpi_values admin all" ON public.kpi_values
FOR ALL TO authenticated
USING (private.is_admin(auth.uid()))
WITH CHECK (private.is_admin(auth.uid()));

CREATE POLICY "kpi_values manager team" ON public.kpi_values
FOR ALL TO authenticated
USING (private.is_manager(auth.uid()) AND private.manages_team(team_id))
WITH CHECK (private.is_manager(auth.uid()) AND private.manages_team(team_id));

CREATE POLICY "kpi_values self read" ON public.kpi_values
FOR SELECT TO authenticated
USING (private.owns_representative(representative_id));

COMMENT ON TABLE public.kpi_values IS
  'Dated, activity-specific KPI values (starting with renewal opportunities/completed renewals). One row per representative per day. Never derive renewal rate from monthly_target/current_result — always read from here via completed_renewals/renewal_opportunities.';