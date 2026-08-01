DROP TRIGGER IF EXISTS trg_protect_profile_fields ON public.profiles;

CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  -- trusted server context (service role / no end-user session) or admin
  IF auth.uid() IS NULL OR private.is_admin(auth.uid()) THEN RETURN NEW; END IF;
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
$function$;