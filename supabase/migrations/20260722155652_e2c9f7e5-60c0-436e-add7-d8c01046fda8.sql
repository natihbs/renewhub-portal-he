
-- Move SECURITY DEFINER role helpers out of the API-exposed public schema
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- Recreate helpers inside private schema
CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE OR REPLACE FUNCTION private.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT private.has_role(_user_id, 'admin'::public.app_role) $$;

CREATE OR REPLACE FUNCTION private.is_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT private.has_role(_user_id, 'manager'::public.app_role) $$;

CREATE OR REPLACE FUNCTION private.manages_user(_manager_id uuid, _target_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.teams t ON t.id = p.team_id
    WHERE p.id = _target_user_id AND t.manager_id = _manager_id
  )
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role),
                       private.is_admin(uuid),
                       private.is_manager(uuid),
                       private.manages_user(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role),
                          private.is_admin(uuid),
                          private.is_manager(uuid),
                          private.manages_user(uuid, uuid) TO authenticated, service_role;

-- Recreate policies to reference private.*
DROP POLICY IF EXISTS "teams admin all" ON public.teams;
CREATE POLICY "teams admin all" ON public.teams FOR ALL TO authenticated
  USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));

DROP POLICY IF EXISTS "profiles admin all" ON public.profiles;
CREATE POLICY "profiles admin all" ON public.profiles FOR ALL TO authenticated
  USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));

DROP POLICY IF EXISTS "profiles manager reads team members" ON public.profiles;
CREATE POLICY "profiles manager reads team members" ON public.profiles FOR SELECT TO authenticated
  USING (private.is_manager(auth.uid()) AND EXISTS (
    SELECT 1 FROM public.teams t WHERE t.id = profiles.team_id AND t.manager_id = auth.uid()
  ));

DROP POLICY IF EXISTS "user_roles admin all" ON public.user_roles;
CREATE POLICY "user_roles admin all" ON public.user_roles FOR ALL TO authenticated
  USING (private.is_admin(auth.uid())) WITH CHECK (private.is_admin(auth.uid()));

DROP POLICY IF EXISTS "audit_log admin read" ON public.audit_log;
CREATE POLICY "audit_log admin read" ON public.audit_log FOR SELECT TO authenticated
  USING (private.is_admin(auth.uid()));

-- Update dependent trigger function
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF private.is_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF NEW.manager_id IS DISTINCT FROM OLD.manager_id
     OR NEW.team_id IS DISTINCT FROM OLD.team_id
     OR NEW.representative_id IS DISTINCT FROM OLD.representative_id
     OR NEW.active IS DISTINCT FROM OLD.active
     OR NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Only admins may change privileged profile fields';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_profile_privileged_fields() FROM PUBLIC, anon, authenticated;

-- Drop the public schema helpers now that nothing references them
DROP FUNCTION IF EXISTS public.manages_user(uuid, uuid);
DROP FUNCTION IF EXISTS public.is_manager(uuid);
DROP FUNCTION IF EXISTS public.is_admin(uuid);
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
