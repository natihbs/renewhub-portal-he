
-- Fix mutable search_path
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- Revoke execute from PUBLIC (covers anon + authenticated defaults) on all SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_manager(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.manages_user(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_last_login() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_profile_privileged_fields() FROM PUBLIC, anon, authenticated;

-- Trigger-only functions: no grants needed (triggers run as table owner)
-- Role helpers used inside RLS policies: policies still work because policies evaluate function calls with the policy owner's rights via SECURITY DEFINER; however PostgREST callers need EXECUTE to call them directly. Grant to authenticated only where the client legitimately calls them.
GRANT EXECUTE ON FUNCTION public.touch_last_login() TO authenticated;

-- Note: has_role/is_admin/is_manager/manages_user are only referenced inside RLS policies and other SECURITY DEFINER functions; they do not need direct client EXECUTE. Keeping them revoked closes the linter finding.
