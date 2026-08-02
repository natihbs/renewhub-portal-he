-- Additive KPI-values table for activity-specific metrics that don't belong on
-- representatives itself (starting with renewal opportunities/completed renewals).
--
-- Design choice: a dated values table, one row per representative per day,
-- rather than adding renewal_opportunities/completed_renewals columns directly to
-- representatives. Two reasons: (1) representatives.monthly_target/current_result
-- are cumulative, mutable "current state" fields with no history — a values table
-- lets renewal data carry a real date so a genuine daily/period figure can be
-- read later instead of always deriving from a cumulative total (see the KPI
-- Engine Architecture Audit's Communications/daily-summary requirements), and
-- (2) it avoids bolting an unbounded number of activity-specific fixed columns
-- onto representatives as more KPI types are added later — this table is scoped
-- to today's renewal fields but its shape (id/representative/team/date/*
-- metric columns/source_import_id) generalizes to a future generic KPI-values
-- table without another migration of representatives itself.
--
-- Existing target/result data and every migration before this one are untouched.
CREATE TABLE public.kpi_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representative_id uuid NOT NULL REFERENCES public.representatives(id) ON DELETE CASCADE,
  -- Denormalized alongside representative_id so RLS can scope by team without an
  -- extra join, and so a representative moved between teams keeps old values
  -- attributed to the team they were on when the value was recorded.
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  metric_date date NOT NULL,
  renewal_opportunities integer,
  completed_renewals integer,
  source_import_id uuid REFERENCES public.import_history(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kpi_values_opportunities_nonneg CHECK (renewal_opportunities IS NULL OR renewal_opportunities >= 0),
  CONSTRAINT kpi_values_completed_nonneg CHECK (completed_renewals IS NULL OR completed_renewals >= 0),
  -- One value row per representative per day: a re-import of the same day updates
  -- in place (upsert) instead of accumulating duplicate rows.
  UNIQUE (representative_id, metric_date)
);

CREATE INDEX kpi_values_representative_id_idx ON public.kpi_values (representative_id);
CREATE INDEX kpi_values_team_id_idx ON public.kpi_values (team_id);
CREATE INDEX kpi_values_metric_date_idx ON public.kpi_values (metric_date);

CREATE TRIGGER kpi_values_set_updated_at
BEFORE UPDATE ON public.kpi_values
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- RLS ----------
ALTER TABLE public.kpi_values ENABLE ROW LEVEL SECURITY;

-- Non-recursive self-ownership helper, matching the private.manages_team /
-- private.my_team_id pattern already used for representatives/teams/profiles.
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

-- Managers need write access (not just read) here — the import flow that
-- populates this table is available to admin AND manager.
CREATE POLICY "kpi_values manager team" ON public.kpi_values
FOR ALL TO authenticated
USING (private.is_manager(auth.uid()) AND private.manages_team(team_id))
WITH CHECK (private.is_manager(auth.uid()) AND private.manages_team(team_id));

CREATE POLICY "kpi_values self read" ON public.kpi_values
FOR SELECT TO authenticated
USING (private.owns_representative(representative_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kpi_values TO authenticated;
GRANT ALL ON public.kpi_values TO service_role;

COMMENT ON TABLE public.kpi_values IS
  'Dated, activity-specific KPI values (starting with renewal opportunities/completed renewals). One row per representative per day. Never derive renewal rate from monthly_target/current_result — always read from here via completed_renewals/renewal_opportunities.';
