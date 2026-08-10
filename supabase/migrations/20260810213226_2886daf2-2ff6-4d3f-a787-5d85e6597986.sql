-- 1. Fix mutable search_path on remaining trigger functions
CREATE OR REPLACE FUNCTION public.validate_business_unit_parent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE parent_type text;
BEGIN
  IF NEW.unit_type = 'activity' AND NEW.parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'activity units cannot have a parent';
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id THEN
      RAISE EXCEPTION 'a business unit cannot be its own parent';
    END IF;
    SELECT unit_type INTO parent_type FROM public.business_units WHERE id = NEW.parent_id;
    IF parent_type IS DISTINCT FROM 'activity' THEN
      RAISE EXCEPTION 'a center''s parent must be an activity unit';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_team_business_unit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE unit_type_v text;
BEGIN
  IF NEW.business_unit_id IS NOT NULL THEN
    SELECT unit_type INTO unit_type_v FROM public.business_units WHERE id = NEW.business_unit_id;
    IF unit_type_v IS DISTINCT FROM 'center' THEN
      RAISE EXCEPTION 'צוות ניתן לשייך למוקד בלבד. הפעילות נקבעת דרך המוקד.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 2. audit_log: append-only via trusted server roles; no client writes at all
REVOKE ALL ON public.audit_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.audit_log FROM authenticated;
GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;

-- Explicit deny-by-default documentation policies (restrictive: nothing passes)
DROP POLICY IF EXISTS "audit_log no client insert" ON public.audit_log;
CREATE POLICY "audit_log no client insert" ON public.audit_log
  AS RESTRICTIVE FOR INSERT TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS "audit_log no client update" ON public.audit_log;
CREATE POLICY "audit_log no client update" ON public.audit_log
  AS RESTRICTIVE FOR UPDATE TO authenticated, anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "audit_log no client delete" ON public.audit_log;
CREATE POLICY "audit_log no client delete" ON public.audit_log
  AS RESTRICTIVE FOR DELETE TO authenticated, anon
  USING (false);

-- 3. manager_calls: ensure no anon access; reads stay owner/self/admin bound
REVOKE ALL ON public.manager_calls FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manager_calls TO authenticated;
GRANT ALL ON public.manager_calls TO service_role;
