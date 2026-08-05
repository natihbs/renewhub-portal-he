-- Representatives Operational Hardening (P0): linkRepresentativeToUserCore
-- previously read representatives.user_id, then — after further application
-- logic (assertUserFree, etc.) — wrote a NEW user_id with no re-check that
-- the row hadn't changed in between. Two concurrent link attempts on the
-- SAME representative could silently clobber one another: the second write
-- would win with no error, and the first caller's link would vanish with no
-- audit trail explaining why.
--
-- This RPC makes "read the current link, verify it matches what the caller
-- expected, then write" one atomic, row-locked unit. SELECT ... FOR UPDATE
-- serializes concurrent calls on the same representative; the explicit
-- _expected_current_user_id comparison (when _check_expected is true) then
-- rejects outright if the row changed since the caller last looked, rather
-- than silently overwriting it.
--
-- representatives.user_id already has a UNIQUE constraint (see
-- 20260801150256_..._representatives.sql) — this function does not rely on
-- that alone (it gives an unfriendly raw constraint-violation error and
-- fires only after attempting the write); an explicit pre-check here
-- produces a clear Hebrew message while the UNIQUE constraint remains the
-- final, unconditional backstop.
CREATE OR REPLACE FUNCTION public.link_representative_to_user(
  _rep_id uuid,
  _user_id uuid,
  _expected_current_user_id uuid,
  _check_expected boolean
)
RETURNS TABLE (
  rep_id uuid,
  rep_name text,
  rep_team_id uuid,
  previous_user_id uuid,
  new_user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_user_id uuid;
  v_name text;
  v_team_id uuid;
BEGIN
  SELECT user_id, name, team_id INTO v_current_user_id, v_name, v_team_id
  FROM public.representatives
  WHERE id = _rep_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'הנציג לא נמצא' USING ERRCODE = 'P0002';
  END IF;

  IF _check_expected AND v_current_user_id IS DISTINCT FROM _expected_current_user_id THEN
    RAISE EXCEPTION 'שיוך הנציג השתנה בינתיים על ידי פעולה אחרת — יש לרענן ולנסות שוב' USING ERRCODE = 'P0003';
  END IF;

  IF _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.representatives WHERE user_id = _user_id AND id <> _rep_id
  ) THEN
    RAISE EXCEPTION 'חשבון המשתמש כבר מקושר לנציג אחר' USING ERRCODE = 'P0004';
  END IF;

  UPDATE public.representatives SET user_id = _user_id WHERE id = _rep_id;

  RETURN QUERY SELECT _rep_id, v_name, v_team_id, v_current_user_id, _user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_representative_to_user(uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_representative_to_user(uuid, uuid, uuid, boolean) TO service_role;

COMMENT ON FUNCTION public.link_representative_to_user(uuid, uuid, uuid, boolean) IS
  'Atomically reads-and-writes representatives.user_id under a row lock (FOR UPDATE), optionally rejecting the write outright if the row''s current link no longer matches what the caller expected (_check_expected) — closes the read-check-write race in linkRepresentativeToUserCore. Eligibility of the target account (role, active, not linked elsewhere) is checked by the TypeScript caller before this is invoked, using representatives.user_id''s existing UNIQUE constraint as the final backstop against the "linked elsewhere" case specifically. Callable only by service_role.';
