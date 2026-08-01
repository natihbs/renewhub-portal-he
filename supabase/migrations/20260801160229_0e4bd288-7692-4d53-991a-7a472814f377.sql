-- Non-recursive helpers (SECURITY DEFINER bypasses RLS on the tables they read)
CREATE OR REPLACE FUNCTION private.my_team_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT team_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION private.manages_team(_team_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _team_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.teams t WHERE t.id = _team_id AND t.manager_id = auth.uid()
  )
$$;

REVOKE ALL ON FUNCTION private.my_team_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.manages_team(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.my_team_id() TO authenticated;
GRANT EXECUTE ON FUNCTION private.manages_team(uuid) TO authenticated;

-- teams: remove the policy that queries profiles (profiles policy queries teams -> recursion)
DROP POLICY IF EXISTS "teams member reads own team" ON public.teams;
CREATE POLICY "teams member reads own team" ON public.teams
FOR SELECT TO authenticated
USING (id = private.my_team_id());

-- profiles: remove the policy that queries teams
DROP POLICY IF EXISTS "profiles manager reads team members" ON public.profiles;
CREATE POLICY "profiles manager reads team members" ON public.profiles
FOR SELECT TO authenticated
USING (private.is_manager(auth.uid()) AND private.manages_team(team_id));

-- profiles: self-update no longer self-queries profiles; trigger enforces privileged fields
DROP POLICY IF EXISTS "profiles self update" ON public.profiles;
CREATE POLICY "profiles self update" ON public.profiles
FOR UPDATE TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- representatives: stop querying teams inline
DROP POLICY IF EXISTS "representatives manager reads team" ON public.representatives;
CREATE POLICY "representatives manager reads team" ON public.representatives
FOR SELECT TO authenticated
USING (private.is_manager(auth.uid()) AND private.manages_team(team_id));

DROP POLICY IF EXISTS "representatives manager updates team" ON public.representatives;
CREATE POLICY "representatives manager updates team" ON public.representatives
FOR UPDATE TO authenticated
USING (private.is_manager(auth.uid()) AND private.manages_team(team_id))
WITH CHECK (private.is_manager(auth.uid()) AND private.manages_team(team_id));