CREATE TABLE public.team_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  goal_month date NOT NULL,
  target_value integer NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, goal_month),
  CONSTRAINT team_goals_target_value_check CHECK (target_value >= 0),
  CONSTRAINT team_goals_goal_month_check CHECK (goal_month = date_trunc('month', goal_month)::date)
);

CREATE TABLE public.representative_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representative_id uuid NOT NULL REFERENCES public.representatives(id) ON DELETE CASCADE,
  goal_month date NOT NULL,
  target_value integer NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (representative_id, goal_month),
  CONSTRAINT representative_goals_target_value_check CHECK (target_value >= 0),
  CONSTRAINT representative_goals_goal_month_check CHECK (goal_month = date_trunc('month', goal_month)::date)
);

CREATE INDEX team_goals_team_id_idx ON public.team_goals (team_id);
CREATE INDEX team_goals_goal_month_idx ON public.team_goals (goal_month);
CREATE INDEX representative_goals_representative_id_idx ON public.representative_goals (representative_id);
CREATE INDEX representative_goals_goal_month_idx ON public.representative_goals (goal_month);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_goals TO authenticated;
GRANT ALL ON public.team_goals TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.representative_goals TO authenticated;
GRANT ALL ON public.representative_goals TO service_role;

ALTER TABLE public.team_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.representative_goals ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER team_goals_updated BEFORE UPDATE ON public.team_goals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER representative_goals_updated BEFORE UPDATE ON public.representative_goals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION private.my_rep_team_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT r.team_id FROM public.representatives r WHERE r.user_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION private.my_rep_team_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.my_rep_team_id() TO authenticated;

CREATE POLICY "team_goals read" ON public.team_goals FOR SELECT TO authenticated
  USING (private.is_admin(auth.uid()) OR private.manages_team(team_id) OR team_id = private.my_rep_team_id());
CREATE POLICY "team_goals staff write" ON public.team_goals FOR ALL TO authenticated
  USING (private.is_admin(auth.uid()) OR private.manages_team(team_id))
  WITH CHECK (private.is_admin(auth.uid()) OR private.manages_team(team_id));

CREATE POLICY "representative_goals read" ON public.representative_goals FOR SELECT TO authenticated
  USING (private.can_manage_rep(representative_id) OR private.rep_is_self(representative_id));
CREATE POLICY "representative_goals staff write" ON public.representative_goals FOR ALL TO authenticated
  USING (private.can_manage_rep(representative_id)) WITH CHECK (private.can_manage_rep(representative_id));