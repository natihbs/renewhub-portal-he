-- Pulse v2 — Sprint 0 / PR #1: Assignment validation
--
-- Four rules, all enforced here rather than in a caller:
--
--   1. VALIDITY PERIOD    valid_to, when present, is on or after valid_from.
--   2. ACCOUNTABLE OVERLAP At most one accountable assignment may cover a
--                          representative on any given day.
--   3. ACCOUNTABILITY GAP  Ending an accountable assignment must not silently
--                          leave representatives with nobody answering for
--                          them.
--   4. DELEGATION LIMITS   A delegated assignment may not exceed its grantor
--                          in capability, in scope, or in time.
--
-- WHY RULE 2 NEEDS AN RPC AND NOT JUST A CONSTRAINT. The exclusion constraint
-- added in the first migration catches two accountable assignments on the SAME
-- scope. It cannot catch two accountable assignments on DIFFERENT scopes that
-- happen to resolve to an overlapping set of representatives — a team scope
-- and an enumerated cover scope containing one of the same people, say. That
-- is a set-intersection condition over rule-resolved membership, which no
-- Postgres constraint can express. So the constraint stays as the cheap first
-- line, and this function is the authoritative one.
--
-- WHY AN ADVISORY LOCK. Rule 2 is an invariant over a SET of rows, not over
-- one row, so row locks cannot serialize it: two concurrent inserts each see a
-- clean picture and both commit. A transaction-scoped advisory lock on a
-- single constant serializes every accountable write against every other one.
-- Assignments change a handful of times a week, so the contention cost is
-- nil and the alternative is a partition that is only usually true.
--
-- WHY GAPS ARE REJECTED ON END BUT NOT ON CREATE. A representative who has
-- just been created has no accountable assignment and that is not an error —
-- it is a fact awaiting an administrator. A representative who HAD one until
-- someone ended it is a different situation entirely, and it is the one that
-- silently breaks roll-ups. So gaps are rejected at the moment they are
-- created and reported (never rejected) everywhere else.
--
-- ERROR CODES. Continuing the scheme this codebase already uses, mapped to
-- Hebrew messages in src/lib/assignment.functions.ts:
--   P0010  accountable overlap
--   P0011  delegation exceeds its grantor
--   P0012  invalid validity period
--   P0013  unknown capability
--   P0014  scope missing or inactive
--   P0015  ending this assignment would orphan representatives
--   P0016  assignment not found

-- ===========================================================================
-- shared validation
-- ===========================================================================

/**
 * Representatives inside _scope_id who are already covered by a DIFFERENT
 * current accountable assignment overlapping [_valid_from, _valid_to].
 *
 * Returns the conflicting representative and the assignment that holds them,
 * so the caller can name the conflict instead of reporting a bare failure —
 * "this person is already covered, by that assignment" is actionable;
 * "constraint violated" is not.
 */
CREATE OR REPLACE FUNCTION private.accountable_conflicts(
  _scope_id uuid,
  _valid_from date,
  _valid_to date,
  _exclude_assignment_id uuid
)
RETURNS TABLE (representative_id uuid, conflicting_assignment_id uuid, conflicting_person_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.representative_id, a.id, a.person_id
  FROM private.scope_representative_ids(_scope_id) s
  JOIN public.assignments a
    ON a.accountable
   AND a.revoked_at IS NULL
   AND (_exclude_assignment_id IS NULL OR a.id <> _exclude_assignment_id)
   AND a.validity && daterange(_valid_from, _valid_to, '[]')
  WHERE private.rep_in_scope(a.scope_id, s.representative_id);
$$;

REVOKE ALL ON FUNCTION private.accountable_conflicts(uuid, date, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.accountable_conflicts(uuid, date, date, uuid) TO service_role;

/**
 * Representatives who would be left with no accountable assignment at all if
 * _assignment_id stopped covering them on _effective_from.
 *
 * "No accountable assignment at all" is the deliberate reading, rather than
 * "no assignment on the day after". A representative covered by a second,
 * overlapping accountable assignment is impossible by rule 2; a representative
 * covered by a LATER one that has not started yet is a real gap, and one that
 * a manager handing over should be told about.
 */
CREATE OR REPLACE FUNCTION private.accountability_gaps_if_ended(
  _assignment_id uuid,
  _effective_from date
)
RETURNS TABLE (representative_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.representative_id
  FROM public.assignments a
  JOIN private.scope_representative_ids(a.scope_id) s ON true
  WHERE a.id = _assignment_id
    AND a.accountable
    AND NOT EXISTS (
      SELECT 1 FROM public.assignments other
      WHERE other.accountable
        AND other.revoked_at IS NULL
        AND other.id <> _assignment_id
        AND (other.valid_to IS NULL OR other.valid_to >= _effective_from)
        AND private.rep_in_scope(other.scope_id, s.representative_id)
    );
$$;

REVOKE ALL ON FUNCTION private.accountability_gaps_if_ended(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.accountability_gaps_if_ended(uuid, date) TO service_role;

-- ===========================================================================
-- create_assignment
-- ===========================================================================

DROP FUNCTION IF EXISTS public.create_assignment(uuid, uuid, boolean, uuid, date, date, text, text, text[], uuid);
CREATE FUNCTION public.create_assignment(
  _person_id uuid,
  _scope_id uuid,
  _accountable boolean,
  _granted_by_assignment_id uuid,
  _valid_from date,
  _valid_to date,
  _cadence text,
  _label text,
  _capabilities text[],
  _created_by uuid
)
RETURNS TABLE (out_assignment_id uuid, out_capability_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_scope_active boolean;
  v_unknown text;
  v_conflict record;
  v_parent record;
  v_missing text;
  v_count integer;
BEGIN
  -- ---------- rule 1: validity period ----------
  IF _valid_from IS NULL THEN
    RAISE EXCEPTION 'תאריך תחילת השיוך חסר' USING ERRCODE = 'P0012';
  END IF;
  IF _valid_to IS NOT NULL AND _valid_to < _valid_from THEN
    RAISE EXCEPTION 'תאריך סיום השיוך מוקדם מתאריך ההתחלה' USING ERRCODE = 'P0012';
  END IF;

  -- ---------- scope ----------
  SELECT s.active INTO v_scope_active FROM public.scopes s WHERE s.id = _scope_id;
  IF v_scope_active IS NULL THEN
    RAISE EXCEPTION 'תחום האחריות לא נמצא' USING ERRCODE = 'P0014';
  END IF;
  IF NOT v_scope_active THEN
    RAISE EXCEPTION 'תחום האחריות מושבת — לא ניתן ליצור עליו שיוך חדש' USING ERRCODE = 'P0014';
  END IF;

  -- ---------- capabilities exist ----------
  -- An unknown capability key is a silent no-op at permission-check time: the
  -- assignment would look granted and behave ungranted. Rejected up front.
  SELECT k INTO v_unknown
  FROM unnest(COALESCE(_capabilities, ARRAY[]::text[])) AS k
  WHERE NOT EXISTS (SELECT 1 FROM public.capabilities c WHERE c.key = k)
  LIMIT 1;
  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'הרשאה לא מוכרת: %', v_unknown USING ERRCODE = 'P0013';
  END IF;

  -- Serialize every accountable write against every other one. Taken before
  -- the conflict scan so the scan's answer is still true at COMMIT.
  IF _accountable THEN
    PERFORM pg_advisory_xact_lock(hashtext('pulse.assignments.accountable'));

    SELECT * INTO v_conflict
    FROM private.accountable_conflicts(_scope_id, _valid_from, _valid_to, NULL)
    LIMIT 1;

    IF v_conflict.representative_id IS NOT NULL THEN
      RAISE EXCEPTION
        'לנציג % כבר קיים שיוך אחריות חופף (שיוך %) — יש לסיים אותו לפני יצירת שיוך אחריות חדש',
        v_conflict.representative_id, v_conflict.conflicting_assignment_id
        USING ERRCODE = 'P0010';
    END IF;
  END IF;

  -- ---------- rule 4: delegation limits ----------
  IF _granted_by_assignment_id IS NOT NULL THEN
    SELECT a.id, a.person_id, a.scope_id, a.valid_from, a.valid_to, a.revoked_at
      INTO v_parent
    FROM public.assignments a WHERE a.id = _granted_by_assignment_id
    FOR UPDATE;

    IF v_parent.id IS NULL THEN
      RAISE EXCEPTION 'השיוך המאציל לא נמצא' USING ERRCODE = 'P0016';
    END IF;
    IF v_parent.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'לא ניתן להאציל משיוך שבוטל' USING ERRCODE = 'P0011';
    END IF;

    -- Time: a delegation may not start before, nor outlive, its grantor.
    IF _valid_from < v_parent.valid_from THEN
      RAISE EXCEPTION 'האצלה אינה יכולה להתחיל לפני השיוך המאציל' USING ERRCODE = 'P0011';
    END IF;
    IF v_parent.valid_to IS NOT NULL AND (_valid_to IS NULL OR _valid_to > v_parent.valid_to) THEN
      RAISE EXCEPTION 'האצלה אינה יכולה להסתיים אחרי השיוך המאציל' USING ERRCODE = 'P0011';
    END IF;

    -- Scope: every representative the delegation covers must already be
    -- covered by the grantor. Delegating people you do not hold is how a
    -- permission model quietly becomes decorative.
    SELECT child.representative_id::text INTO v_missing
    FROM private.scope_representative_ids(_scope_id) child
    WHERE NOT private.rep_in_scope(v_parent.scope_id, child.representative_id)
    LIMIT 1;
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION 'האצלה כוללת נציג (%) שאינו בתחום האחריות של השיוך המאציל', v_missing
        USING ERRCODE = 'P0011';
    END IF;

    -- Capability: a strict subset check, including the accountable bit, which
    -- is a capability in everything but name.
    SELECT k INTO v_missing
    FROM unnest(COALESCE(_capabilities, ARRAY[]::text[])) AS k
    WHERE NOT EXISTS (
      SELECT 1 FROM public.assignment_capabilities ac
      WHERE ac.assignment_id = _granted_by_assignment_id AND ac.capability_key = k
    )
    LIMIT 1;
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION 'האצלה כוללת הרשאה (%) שאינה קיימת בשיוך המאציל', v_missing
        USING ERRCODE = 'P0011';
    END IF;

    IF _accountable AND NOT EXISTS (
      SELECT 1 FROM public.assignments a
      WHERE a.id = _granted_by_assignment_id AND a.accountable
    ) THEN
      RAISE EXCEPTION 'לא ניתן להאציל אחריות משיוך שאינו שיוך אחריות' USING ERRCODE = 'P0011';
    END IF;
  END IF;

  INSERT INTO public.assignments
    (person_id, scope_id, accountable, granted_by_assignment_id, valid_from, valid_to, cadence, label, created_by)
  VALUES
    (_person_id, _scope_id, COALESCE(_accountable, false), _granted_by_assignment_id,
     _valid_from, _valid_to, COALESCE(_cadence, 'daily'), _label, _created_by)
  RETURNING id INTO v_id;

  INSERT INTO public.assignment_capabilities (assignment_id, capability_key)
  SELECT v_id, k FROM unnest(COALESCE(_capabilities, ARRAY[]::text[])) AS k
  ON CONFLICT DO NOTHING;

  SELECT count(*)::integer INTO v_count
  FROM public.assignment_capabilities WHERE assignment_id = v_id;

  RETURN QUERY SELECT v_id, v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.create_assignment(uuid, uuid, boolean, uuid, date, date, text, text, text[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_assignment(uuid, uuid, boolean, uuid, date, date, text, text, text[], uuid) TO service_role;

COMMENT ON FUNCTION public.create_assignment(uuid, uuid, boolean, uuid, date, date, text, text, text[], uuid) IS
  'Creates one assignment after enforcing the validity period, the accountable partition (across scopes, under an advisory lock), capability existence, and delegation limits in capability, scope and time. Callable only by service_role — the calling server function authorizes the actor first.';

-- ===========================================================================
-- end_assignment
-- ===========================================================================

DROP FUNCTION IF EXISTS public.end_assignment(uuid, date, boolean, text);
CREATE FUNCTION public.end_assignment(
  _assignment_id uuid,
  _valid_to date,
  _allow_gap boolean,
  _gap_reason text
)
RETURNS TABLE (out_assignment_id uuid, out_valid_to date, out_orphaned_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_orphans integer := 0;
  v_child_conflict uuid;
BEGIN
  SELECT a.id, a.accountable, a.valid_from, a.valid_to, a.revoked_at
    INTO v_row
  FROM public.assignments a WHERE a.id = _assignment_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'השיוך לא נמצא' USING ERRCODE = 'P0016';
  END IF;
  IF v_row.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'השיוך כבר בוטל' USING ERRCODE = 'P0016';
  END IF;
  IF _valid_to IS NULL THEN
    RAISE EXCEPTION 'יש לציין תאריך סיום' USING ERRCODE = 'P0012';
  END IF;
  IF _valid_to < v_row.valid_from THEN
    RAISE EXCEPTION 'תאריך הסיום מוקדם מתאריך תחילת השיוך' USING ERRCODE = 'P0012';
  END IF;

  -- A delegation may not outlive its grantor, so shortening the grantor must
  -- not leave a child hanging past the new end date. Reported rather than
  -- silently cascaded: ending someone's cover arrangement early is a decision
  -- about the people they delegated to, and it should be made deliberately.
  SELECT child.id INTO v_child_conflict
  FROM public.assignments child
  WHERE child.granted_by_assignment_id = _assignment_id
    AND child.revoked_at IS NULL
    AND (child.valid_to IS NULL OR child.valid_to > _valid_to)
  LIMIT 1;
  IF v_child_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'קיימת האצלה (%) שתאריך סיומה מאוחר מהתאריך המבוקש — יש לסיים אותה תחילה', v_child_conflict
      USING ERRCODE = 'P0011';
  END IF;

  IF v_row.accountable THEN
    PERFORM pg_advisory_xact_lock(hashtext('pulse.assignments.accountable'));

    SELECT count(*)::integer INTO v_orphans
    FROM private.accountability_gaps_if_ended(_assignment_id, _valid_to + 1);

    IF v_orphans > 0 AND NOT COALESCE(_allow_gap, false) THEN
      RAISE EXCEPTION
        'סיום השיוך ישאיר % נציגים ללא אחריות ניהולית — יש ליצור שיוך אחריות חלופי, או לאשר את הפער במפורש',
        v_orphans
        USING ERRCODE = 'P0015';
    END IF;
    IF v_orphans > 0 AND (_gap_reason IS NULL OR btrim(_gap_reason) = '') THEN
      RAISE EXCEPTION 'אישור פער אחריות מחייב נימוק' USING ERRCODE = 'P0015';
    END IF;
  END IF;

  UPDATE public.assignments SET valid_to = _valid_to WHERE id = _assignment_id;

  RETURN QUERY SELECT _assignment_id, _valid_to, v_orphans;
END;
$$;

REVOKE ALL ON FUNCTION public.end_assignment(uuid, date, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_assignment(uuid, date, boolean, text) TO service_role;

COMMENT ON FUNCTION public.end_assignment(uuid, date, boolean, text) IS
  'Sets an end date on an assignment. Refuses to leave representatives with no accountable assignment unless the gap is explicitly acknowledged with a reason (P0015), and refuses to outlive-orphan a delegation granted from it (P0011).';

-- ===========================================================================
-- revoke_assignment
-- ===========================================================================
--
-- Revocation is for a mistake — an assignment that should never have existed.
-- Ending is for a fact: the arrangement is over. They are different actions
-- and they leave different history, which is why this is not a flag on
-- end_assignment.
--
-- Revocation DOES cascade to delegations, because a delegation whose grantor
-- never legitimately held the scope was never legitimate either.

DROP FUNCTION IF EXISTS public.revoke_assignment(uuid, text);
CREATE FUNCTION public.revoke_assignment(_assignment_id uuid, _reason text)
RETURNS TABLE (out_assignment_id uuid, out_revoked_children integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
  v_children integer := 0;
BEGIN
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'ביטול שיוך מחייב נימוק' USING ERRCODE = 'P0012';
  END IF;

  SELECT true INTO v_exists FROM public.assignments a
  WHERE a.id = _assignment_id AND a.revoked_at IS NULL
  FOR UPDATE;

  IF v_exists IS NULL THEN
    RAISE EXCEPTION 'השיוך לא נמצא או שכבר בוטל' USING ERRCODE = 'P0016';
  END IF;

  WITH RECURSIVE descendants AS (
    SELECT a.id FROM public.assignments a WHERE a.granted_by_assignment_id = _assignment_id AND a.revoked_at IS NULL
    UNION ALL
    SELECT c.id FROM public.assignments c
    JOIN descendants d ON c.granted_by_assignment_id = d.id
    WHERE c.revoked_at IS NULL
  )
  UPDATE public.assignments a
  SET revoked_at = now(), revoked_reason = 'בוטל בעקבות ביטול השיוך המאציל'
  FROM descendants d
  WHERE a.id = d.id;
  GET DIAGNOSTICS v_children = ROW_COUNT;

  UPDATE public.assignments
  SET revoked_at = now(), revoked_reason = btrim(_reason)
  WHERE id = _assignment_id;

  RETURN QUERY SELECT _assignment_id, v_children;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_assignment(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_assignment(uuid, text) TO service_role;

COMMENT ON FUNCTION public.revoke_assignment(uuid, text) IS
  'Revokes an assignment created in error, cascading to every delegation granted from it. Distinct from end_assignment, which records that a legitimate arrangement finished.';

-- ===========================================================================
-- reporting: current accountability gaps
-- ===========================================================================
--
-- Read-only, and never used to reject anything. A representative with no
-- accountable assignment is a real operational state — a new hire this
-- morning, a team between managers — and the product's job is to make it
-- visible, not to make it unrepresentable.

DROP FUNCTION IF EXISTS public.accountability_gaps();
CREATE FUNCTION public.accountability_gaps()
RETURNS TABLE (representative_id uuid, representative_name text, team_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.name, r.team_id
  FROM public.representatives r
  WHERE r.active
    AND NOT EXISTS (
      SELECT 1 FROM public.assignments a
      WHERE a.accountable
        AND a.revoked_at IS NULL
        AND a.valid_from <= current_date
        AND (a.valid_to IS NULL OR a.valid_to >= current_date)
        AND private.rep_in_scope(a.scope_id, r.id)
    );
$$;

REVOKE ALL ON FUNCTION public.accountability_gaps() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accountability_gaps() TO service_role;

COMMENT ON FUNCTION public.accountability_gaps() IS
  'Active representatives with nobody currently accountable for them. Reporting only — a gap is an operational fact to surface, never a reason to reject an unrelated write.';

-- ===========================================================================
-- commitment lapse
-- ===========================================================================
--
-- FR-22. No scheduler is introduced in this PR; this is the operation a
-- scheduler will call, and it is idempotent so calling it twice on the same
-- day is harmless.

DROP FUNCTION IF EXISTS public.lapse_stale_commitments(integer);
CREATE FUNCTION public.lapse_stale_commitments(_stale_after_days integer)
RETURNS TABLE (out_lapsed integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF _stale_after_days IS NULL OR _stale_after_days < 1 THEN
    RAISE EXCEPTION 'סף התיישנות חייב להיות לפחות יום אחד' USING ERRCODE = 'P0012';
  END IF;

  UPDATE public.commitments
  SET resolution = 'lapsed', resolved_at = now(),
      resolution_note = 'נסגר אוטומטית לאחר ' || _stale_after_days || ' ימים ללא הכרעה'
  WHERE resolution IS NULL
    AND due_on < current_date - _stale_after_days;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN QUERY SELECT v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.lapse_stale_commitments(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lapse_stale_commitments(integer) TO service_role;

COMMENT ON FUNCTION public.lapse_stale_commitments(integer) IS
  'Closes commitments left unresolved past a staleness threshold as ''lapsed'' so the surfaced list cannot grow without bound. Idempotent. No scheduler is wired in this release.';
