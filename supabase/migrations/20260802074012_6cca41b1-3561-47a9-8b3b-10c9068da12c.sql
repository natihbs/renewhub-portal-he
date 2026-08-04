CREATE OR REPLACE FUNCTION public.set_user_team_with_representative_sync(
  _user_id uuid,
  _team_id uuid
)
RETURNS TABLE (
  previous_profile_team_id uuid,
  representative_id uuid,
  previous_representative_team_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manager_id uuid;
  v_prev_profile_team_id uuid;
  v_rep_id uuid;
  v_prev_rep_team_id uuid;
BEGIN
  IF _team_id IS NOT NULL THEN
    SELECT t.manager_id INTO v_manager_id FROM public.teams t WHERE t.id = _team_id;
  END IF;

  SELECT p.team_id INTO v_prev_profile_team_id FROM public.profiles p WHERE p.id = _user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'משתמש לא נמצא: %', _user_id;
  END IF;

  UPDATE public.profiles
  SET team_id = _team_id, manager_id = v_manager_id
  WHERE id = _user_id;

  SELECT r.id, r.team_id INTO v_rep_id, v_prev_rep_team_id
  FROM public.representatives r
  WHERE r.user_id = _user_id;

  IF v_rep_id IS NOT NULL THEN
    UPDATE public.representatives
    SET team_id = _team_id
    WHERE id = v_rep_id;
  END IF;

  RETURN QUERY SELECT v_prev_profile_team_id, v_rep_id, v_prev_rep_team_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_team_with_representative_sync(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_team_with_representative_sync(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.set_user_team_with_representative_sync(uuid, uuid) IS
  'Atomically sets a profile''s team (and derived manager) and, if that user has a linked representative, keeps representatives.team_id in sync in the same transaction. Callable only by service_role.';