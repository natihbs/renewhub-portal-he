
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF private.is_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.manager_id IS DISTINCT FROM OLD.manager_id
     OR NEW.team_id IS DISTINCT FROM OLD.team_id
     OR NEW.representative_id IS DISTINCT FROM OLD.representative_id
     OR NEW.active IS DISTINCT FROM OLD.active
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.must_change_password IS DISTINCT FROM OLD.must_change_password THEN
    RAISE EXCEPTION 'Only admins may change privileged profile fields';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_privileged_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_privileged_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileged_fields();

DROP POLICY IF EXISTS "profiles self update" ON public.profiles;
CREATE POLICY "profiles self update" ON public.profiles
FOR UPDATE TO authenticated
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  AND manager_id IS NOT DISTINCT FROM (SELECT p.manager_id FROM public.profiles p WHERE p.id = auth.uid())
  AND team_id IS NOT DISTINCT FROM (SELECT p.team_id FROM public.profiles p WHERE p.id = auth.uid())
  AND representative_id IS NOT DISTINCT FROM (SELECT p.representative_id FROM public.profiles p WHERE p.id = auth.uid())
  AND active IS NOT DISTINCT FROM (SELECT p.active FROM public.profiles p WHERE p.id = auth.uid())
  AND email IS NOT DISTINCT FROM (SELECT p.email FROM public.profiles p WHERE p.id = auth.uid())
  AND must_change_password IS NOT DISTINCT FROM (SELECT p.must_change_password FROM public.profiles p WHERE p.id = auth.uid())
);
