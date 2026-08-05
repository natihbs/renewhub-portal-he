-- Representatives Operational Hardening (P0): setRepresentativeActive
-- (rep-admin.functions.ts) previously issued two independent REST calls —
-- UPDATE representatives, then (conditionally) UPDATE profiles — with no
-- transaction. The permission check for the second write ran AFTER the first
-- write had already committed, so a rejected/failed second write still left
-- the representative deactivated with no rollback and a misleading client
-- error. This RPC makes both writes one atomic unit: either every requested
-- change commits, or none does.
--
-- Permission checks (who may deactivate, who may also touch the linked
-- profile) are NOT re-implemented here — exactly like
-- set_user_team_with_representative_sync, this function trusts its caller
-- completely and is reachable only via service_role from
-- setRepresentativeActive, which performs every authorization check BEFORE
-- ever calling this function. _sync_profile must never be passed true by a
-- caller that hasn't already verified the actor is an admin.
--
-- SELECT ... FOR UPDATE row-locks the representative for the duration of the
-- transaction, so two concurrent deactivate/reactivate calls on the same
-- representative serialize instead of racing.
CREATE OR REPLACE FUNCTION public.set_representative_active_with_profile_sync(
  _rep_id uuid,
  _active boolean,
  _sync_profile boolean
)
RETURNS TABLE (
  rep_id uuid,
  rep_name text,
  previous_active boolean,
  rep_active boolean,
  rep_deactivated_at timestamptz,
  linked_user_id uuid,
  profile_synced boolean,
  profile_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_name text;
  v_previous_active boolean;
  v_deactivated_at timestamptz;
  v_did_sync boolean := false;
  v_profile_active boolean := NULL;
BEGIN
  SELECT user_id, name, active INTO v_user_id, v_name, v_previous_active
  FROM public.representatives
  WHERE id = _rep_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'הנציג לא נמצא' USING ERRCODE = 'P0002';
  END IF;

  v_deactivated_at := CASE WHEN _active THEN NULL ELSE now() END;

  UPDATE public.representatives
  SET active = _active, deactivated_at = v_deactivated_at
  WHERE id = _rep_id;

  IF _sync_profile AND v_user_id IS NOT NULL THEN
    UPDATE public.profiles SET active = _active WHERE id = v_user_id;
    -- If this UPDATE fails for any reason, the exception aborts the whole
    -- transaction — the representatives UPDATE above is rolled back too.
    -- The representative is guaranteed to remain unchanged, never partially applied.
    v_did_sync := true;
    v_profile_active := _active;
  END IF;

  RETURN QUERY SELECT _rep_id, v_name, v_previous_active, _active, v_deactivated_at, v_user_id, v_did_sync, v_profile_active;
END;
$$;

REVOKE ALL ON FUNCTION public.set_representative_active_with_profile_sync(uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_representative_active_with_profile_sync(uuid, boolean, boolean) TO service_role;

COMMENT ON FUNCTION public.set_representative_active_with_profile_sync(uuid, boolean, boolean) IS
  'Atomically sets representatives.active/deactivated_at and, only when _sync_profile is true, the linked profile''s active flag, in a single transaction — either both writes commit or neither does. Row-locks the representative (FOR UPDATE) for the duration. Callable only by service_role — reached exclusively through setRepresentativeActive''s permission checks, which must run to completion before this is ever called; this function performs no authorization of its own.';
