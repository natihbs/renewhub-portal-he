CREATE TABLE public.representatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  team_key text NOT NULL DEFAULT 'car',
  monthly_target integer NOT NULL DEFAULT 0,
  current_result integer NOT NULL DEFAULT 0,
  external_ref text,
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  deactivated_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT representatives_team_key_check CHECK (team_key IN ('car','home'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.representatives TO authenticated;
GRANT ALL ON public.representatives TO service_role;

ALTER TABLE public.representatives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "representatives admin all"
ON public.representatives FOR ALL TO authenticated
USING (private.is_admin(auth.uid()))
WITH CHECK (private.is_admin(auth.uid()));

CREATE POLICY "representatives manager reads team"
ON public.representatives FOR SELECT TO authenticated
USING (
  private.is_manager(auth.uid())
  AND EXISTS (SELECT 1 FROM public.teams t WHERE t.id = representatives.team_id AND t.manager_id = auth.uid())
);

CREATE POLICY "representatives manager updates team"
ON public.representatives FOR UPDATE TO authenticated
USING (
  private.is_manager(auth.uid())
  AND EXISTS (SELECT 1 FROM public.teams t WHERE t.id = representatives.team_id AND t.manager_id = auth.uid())
)
WITH CHECK (
  private.is_manager(auth.uid())
  AND EXISTS (SELECT 1 FROM public.teams t WHERE t.id = representatives.team_id AND t.manager_id = auth.uid())
);

CREATE POLICY "representatives self read"
ON public.representatives FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE INDEX representatives_team_id_idx ON public.representatives (team_id);
CREATE INDEX representatives_user_id_idx ON public.representatives (user_id);

CREATE TRIGGER representatives_set_updated_at
BEFORE UPDATE ON public.representatives
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();