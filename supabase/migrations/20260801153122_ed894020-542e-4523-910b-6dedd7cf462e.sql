-- ============ helpers ============
CREATE OR REPLACE FUNCTION private.rep_is_self(_rep uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.representatives r WHERE r.id = _rep AND r.user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION private.rep_in_my_team(_rep uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.representatives r
    JOIN public.teams t ON t.id = r.team_id
    WHERE r.id = _rep AND t.manager_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION private.can_manage_rep(_rep uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.is_admin(auth.uid())
      OR (private.is_manager(auth.uid()) AND private.rep_in_my_team(_rep));
$$;

CREATE OR REPLACE FUNCTION private.is_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.is_admin(auth.uid()) OR private.is_manager(auth.uid());
$$;

REVOKE ALL ON FUNCTION private.rep_is_self(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.rep_in_my_team(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_manage_rep(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.rep_is_self(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.rep_in_my_team(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_manage_rep(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_staff() TO authenticated;

-- ============ shared content ============
CREATE TABLE public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  published_on date NOT NULL DEFAULT current_date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcements TO authenticated;
GRANT ALL ON public.announcements TO service_role;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "announcements read" ON public.announcements FOR SELECT TO authenticated USING (true);
CREATE POLICY "announcements staff write" ON public.announcements FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE TRIGGER announcements_updated BEFORE UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text NOT NULL,
  summary text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  read_minutes integer NOT NULL DEFAULT 3,
  important boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.articles TO authenticated;
GRANT ALL ON public.articles TO service_role;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "articles read" ON public.articles FOR SELECT TO authenticated USING (true);
CREATE POLICY "articles staff write" ON public.articles FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE TRIGGER articles_updated BEFORE UPDATE ON public.articles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text text NOT NULL,
  category text NOT NULL DEFAULT 'רעיון',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ideas TO authenticated;
GRANT ALL ON public.ideas TO service_role;
ALTER TABLE public.ideas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ideas own read" ON public.ideas FOR SELECT TO authenticated USING (created_by = auth.uid() OR private.is_staff());
CREATE POLICY "ideas insert" ON public.ideas FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "ideas own delete" ON public.ideas FOR DELETE TO authenticated USING (created_by = auth.uid() OR private.is_admin(auth.uid()));
CREATE TRIGGER ideas_updated BEFORE UPDATE ON public.ideas FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  text text NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.activity_events TO authenticated;
GRANT ALL ON public.activity_events TO service_role;
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "activity read" ON public.activity_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "activity insert" ON public.activity_events FOR INSERT TO authenticated WITH CHECK (actor_id = auth.uid());

-- ============ competitions ============
CREATE TABLE public.competitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_date date NOT NULL DEFAULT current_date,
  end_date date NOT NULL DEFAULT current_date,
  rules text NOT NULL DEFAULT '',
  prize text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.competitions TO authenticated;
GRANT ALL ON public.competitions TO service_role;
ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "competitions read" ON public.competitions FOR SELECT TO authenticated USING (true);
CREATE POLICY "competitions staff write" ON public.competitions FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE TRIGGER competitions_updated BEFORE UPDATE ON public.competitions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.competition_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  label text NOT NULL,
  points integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.competition_categories TO authenticated;
GRANT ALL ON public.competition_categories TO service_role;
ALTER TABLE public.competition_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comp cats read" ON public.competition_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "comp cats staff write" ON public.competition_categories FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE TRIGGER comp_cats_updated BEFORE UPDATE ON public.competition_categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.competition_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.competition_categories(id) ON DELETE CASCADE,
  representative_id uuid NOT NULL REFERENCES public.representatives(id) ON DELETE CASCADE,
  count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, category_id, representative_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.competition_scores TO authenticated;
GRANT ALL ON public.competition_scores TO service_role;
ALTER TABLE public.competition_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comp scores read" ON public.competition_scores FOR SELECT TO authenticated USING (true);
CREATE POLICY "comp scores staff write" ON public.competition_scores FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE TRIGGER comp_scores_updated BEFORE UPDATE ON public.competition_scores FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ rep-scoped operational data ============
CREATE TABLE public.feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representative_id uuid NOT NULL REFERENCES public.representatives(id) ON DELETE CASCADE,
  team_key text NOT NULL DEFAULT 'car',
  feedback_date date NOT NULL DEFAULT current_date,
  call_id text NOT NULL DEFAULT '',
  call_type text NOT NULL DEFAULT '',
  listener text NOT NULL DEFAULT '',
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  score integer NOT NULL DEFAULT 0,
  keep_doing text NOT NULL DEFAULT '',
  improve text NOT NULL DEFAULT '',
  manager_summary text NOT NULL DEFAULT '',
  next_task text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback TO authenticated;
GRANT ALL ON public.feedback TO service_role;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "feedback read" ON public.feedback FOR SELECT TO authenticated
  USING (private.can_manage_rep(representative_id) OR private.rep_is_self(representative_id));
CREATE POLICY "feedback staff write" ON public.feedback FOR ALL TO authenticated
  USING (private.can_manage_rep(representative_id)) WITH CHECK (private.can_manage_rep(representative_id));
CREATE TRIGGER feedback_updated BEFORE UPDATE ON public.feedback FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.listening_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representative_id uuid NOT NULL REFERENCES public.representatives(id) ON DELETE CASCADE,
  scheduled_on date NOT NULL DEFAULT current_date,
  scheduled_time text NOT NULL DEFAULT '09:00',
  topic text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'planned',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.listening_schedules TO authenticated;
GRANT ALL ON public.listening_schedules TO service_role;
ALTER TABLE public.listening_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "listening read" ON public.listening_schedules FOR SELECT TO authenticated
  USING (private.can_manage_rep(representative_id) OR private.rep_is_self(representative_id));
CREATE POLICY "listening staff write" ON public.listening_schedules FOR ALL TO authenticated
  USING (private.can_manage_rep(representative_id)) WITH CHECK (private.can_manage_rep(representative_id));
CREATE TRIGGER listening_updated BEFORE UPDATE ON public.listening_schedules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.rep_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representative_id uuid NOT NULL REFERENCES public.representatives(id) ON DELETE CASCADE,
  title text NOT NULL,
  due_on date,
  priority text NOT NULL DEFAULT 'medium',
  done boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rep_tasks TO authenticated;
GRANT ALL ON public.rep_tasks TO service_role;
ALTER TABLE public.rep_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rep tasks read" ON public.rep_tasks FOR SELECT TO authenticated
  USING (private.can_manage_rep(representative_id) OR private.rep_is_self(representative_id));
CREATE POLICY "rep tasks self update" ON public.rep_tasks FOR UPDATE TO authenticated
  USING (private.rep_is_self(representative_id)) WITH CHECK (private.rep_is_self(representative_id));
CREATE POLICY "rep tasks staff write" ON public.rep_tasks FOR ALL TO authenticated
  USING (private.can_manage_rep(representative_id)) WITH CHECK (private.can_manage_rep(representative_id));
CREATE TRIGGER rep_tasks_updated BEFORE UPDATE ON public.rep_tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.rep_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representative_id uuid NOT NULL REFERENCES public.representatives(id) ON DELETE CASCADE,
  author_id uuid,
  author_name text NOT NULL DEFAULT '',
  text text NOT NULL,
  is_private boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rep_notes TO authenticated;
GRANT ALL ON public.rep_notes TO service_role;
ALTER TABLE public.rep_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rep notes read" ON public.rep_notes FOR SELECT TO authenticated
  USING (private.can_manage_rep(representative_id) OR (NOT is_private AND private.rep_is_self(representative_id)));
CREATE POLICY "rep notes staff write" ON public.rep_notes FOR ALL TO authenticated
  USING (private.can_manage_rep(representative_id)) WITH CHECK (private.can_manage_rep(representative_id));
CREATE TRIGGER rep_notes_updated BEFORE UPDATE ON public.rep_notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.manager_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representative_id uuid REFERENCES public.representatives(id) ON DELETE SET NULL,
  subject text NOT NULL,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'planned',
  summary text,
  follow_up_at timestamptz,
  owner_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manager_calls TO authenticated;
GRANT ALL ON public.manager_calls TO service_role;
ALTER TABLE public.manager_calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manager calls read" ON public.manager_calls FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR private.is_admin(auth.uid())
    OR (representative_id IS NOT NULL AND private.rep_is_self(representative_id)));
CREATE POLICY "manager calls own write" ON public.manager_calls FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR private.is_admin(auth.uid()))
  WITH CHECK (owner_id = auth.uid() OR private.is_admin(auth.uid()));
CREATE TRIGGER manager_calls_updated BEFORE UPDATE ON public.manager_calls FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.underwriting_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  representative_id uuid REFERENCES public.representatives(id) ON DELETE SET NULL,
  subject text NOT NULL,
  priority text NOT NULL DEFAULT 'medium',
  opened_on date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'חדש',
  owner text NOT NULL DEFAULT '',
  due_on date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.underwriting_issues TO authenticated;
GRANT ALL ON public.underwriting_issues TO service_role;
ALTER TABLE public.underwriting_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "underwriting read" ON public.underwriting_issues FOR SELECT TO authenticated
  USING (private.is_staff() OR (representative_id IS NOT NULL AND private.rep_is_self(representative_id)));
CREATE POLICY "underwriting staff write" ON public.underwriting_issues FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE TRIGGER underwriting_updated BEFORE UPDATE ON public.underwriting_issues FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ communications ============
CREATE TABLE public.comms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comms_messages TO authenticated;
GRANT ALL ON public.comms_messages TO service_role;
ALTER TABLE public.comms_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comms messages staff" ON public.comms_messages FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE TRIGGER comms_messages_updated BEFORE UPDATE ON public.comms_messages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.comms_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  name text NOT NULL,
  body text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comms_templates TO authenticated;
GRANT ALL ON public.comms_templates TO service_role;
ALTER TABLE public.comms_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comms templates staff" ON public.comms_templates FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE TRIGGER comms_templates_updated BEFORE UPDATE ON public.comms_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ imports ============
CREATE TABLE public.import_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_templates TO authenticated;
GRANT ALL ON public.import_templates TO service_role;
ALTER TABLE public.import_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "import templates staff" ON public.import_templates FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE TRIGGER import_templates_updated BEFORE UPDATE ON public.import_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.import_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  imported_by uuid,
  imported_by_name text NOT NULL DEFAULT '',
  rows_processed integer NOT NULL DEFAULT 0,
  rows_updated integer NOT NULL DEFAULT 0,
  rows_created integer NOT NULL DEFAULT 0,
  rows_skipped integer NOT NULL DEFAULT 0,
  warnings integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'success',
  snapshot jsonb,
  error_report jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_history TO authenticated;
GRANT ALL ON public.import_history TO service_role;
ALTER TABLE public.import_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "import history staff" ON public.import_history FOR ALL TO authenticated
  USING (private.is_staff()) WITH CHECK (private.is_staff());
CREATE TRIGGER import_history_updated BEFORE UPDATE ON public.import_history FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ per-user ============
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  href text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications own" ON public.notifications FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER notifications_updated BEFORE UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.morning_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  checklist_date date NOT NULL DEFAULT current_date,
  task_key text NOT NULL,
  checked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, checklist_date, task_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.morning_checklist TO authenticated;
GRANT ALL ON public.morning_checklist TO service_role;
ALTER TABLE public.morning_checklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "morning checklist own" ON public.morning_checklist FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER morning_checklist_updated BEFORE UPDATE ON public.morning_checklist FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.morning_settings (
  user_id uuid PRIMARY KEY,
  saved_update_template text,
  last_refresh_at timestamptz,
  refresh_status text NOT NULL DEFAULT 'complete',
  data_as_of date,
  yesterday_renewal_pct integer NOT NULL DEFAULT 0,
  monthly_avg_renewal_pct integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.morning_settings TO authenticated;
GRANT ALL ON public.morning_settings TO service_role;
ALTER TABLE public.morning_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "morning settings own" ON public.morning_settings FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER morning_settings_updated BEFORE UPDATE ON public.morning_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();