-- Feedback & Listening Operational Hardening (P1): transactional write paths
--
-- Two operations in this module touched more than one table with no
-- transaction between them, and one of them mutated a row from a stale
-- client-side read. Both are fixed here with the primitive already used
-- throughout this codebase: a SECURITY DEFINER function body IS a Postgres
-- transaction, so either every write inside commits or none does.
--
-- Authorization is deliberately NOT re-implemented in these functions. They
-- are reachable only via service_role and trust their caller completely;
-- feedback.functions.ts performs every permission check BEFORE invoking them,
-- exactly like set_representative_active_with_profile_sync and
-- toggle_rep_task_done.

-- ---------- 1. create feedback (+ optionally close its listening session) ----------
--
-- PROBLEM. feedback.tsx did:
--     addFeedback({... scheduleId});          // write 1, fire-and-forget
--     if (scheduleId) completeSchedule(id);   // write 2, fire-and-forget
-- Two tables, no transaction, no ordering guarantee, no compensation — and
-- because both were `void`-ed, either could fail while the UI reported
-- success. That left either a session stuck on "planned" that was actually
-- completed (permanently inflating the manager's outstanding workload in
-- Morning Routine and the Dashboard), or a completed session with no
-- evaluation.
--
-- _score is computed by the SERVER from the submitted criteria before this is
-- called (see deriveFeedbackScore) — it is never the value the browser sent.
DROP FUNCTION IF EXISTS public.create_feedback_with_schedule_completion(uuid, date, text, text, text, jsonb, integer, text, text, text, text, uuid, uuid);
CREATE FUNCTION public.create_feedback_with_schedule_completion(
  _representative_id uuid,
  _feedback_date date,
  _call_id text,
  _call_type text,
  _listener text,
  _criteria jsonb,
  _score integer,
  _keep_doing text,
  _improve text,
  _manager_summary text,
  _next_task text,
  _schedule_id uuid,
  _created_by uuid
)
RETURNS TABLE (
  feedback_id uuid,
  schedule_completed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_feedback_id uuid;
  v_schedule_rep uuid;
  v_schedule_status text;
  v_completed boolean := false;
BEGIN
  IF _schedule_id IS NOT NULL THEN
    -- Row-lock the session first so two managers completing the same
    -- scheduled listening cannot both proceed.
    SELECT representative_id, status INTO v_schedule_rep, v_schedule_status
    FROM public.listening_schedules
    WHERE id = _schedule_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ההאזנה המתוזמנת לא נמצאה' USING ERRCODE = 'P0002';
    END IF;

    -- The session must belong to the representative being evaluated;
    -- otherwise the provenance link would be a lie.
    IF v_schedule_rep IS DISTINCT FROM _representative_id THEN
      RAISE EXCEPTION 'ההאזנה המתוזמנת שייכת לנציג אחר' USING ERRCODE = 'P0007';
    END IF;

    IF v_schedule_status = 'completed' THEN
      RAISE EXCEPTION 'ההאזנה המתוזמנת כבר סומנה כבוצעה על ידי פעולה אחרת' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  INSERT INTO public.feedback (
    representative_id, feedback_date, call_id, call_type, listener,
    criteria, score, keep_doing, improve, manager_summary, next_task,
    schedule_id, published, created_by
  ) VALUES (
    _representative_id, _feedback_date, _call_id, _call_type, _listener,
    _criteria, _score, _keep_doing, _improve, _manager_summary, _next_task,
    _schedule_id, false, _created_by
  )
  RETURNING id INTO v_feedback_id;

  IF _schedule_id IS NOT NULL THEN
    UPDATE public.listening_schedules SET status = 'completed' WHERE id = _schedule_id;
    v_completed := true;
  END IF;

  RETURN QUERY SELECT v_feedback_id, v_completed;
END;
$$;

REVOKE ALL ON FUNCTION public.create_feedback_with_schedule_completion(uuid, date, text, text, text, jsonb, integer, text, text, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_feedback_with_schedule_completion(uuid, date, text, text, text, jsonb, integer, text, text, text, text, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.create_feedback_with_schedule_completion(uuid, date, text, text, text, jsonb, integer, text, text, text, text, uuid, uuid) IS
  'Atomically inserts a feedback row and, when it was produced from a scheduled listening session, marks that session completed — one transaction, so the calendar can never disagree with the evaluations. Row-locks the session and rejects a session belonging to a different representative (P0007) or already completed (P0003). Always inserts as a DRAFT; publishing is a separate, separately audited act. Callable only by service_role.';

-- ---------- 2. update feedback with optimistic concurrency + revision ----------
--
-- PROBLEM. Editing went through the generic cloudUpdate: an unconditional
-- UPDATE ... WHERE id = $1 built from a React Query cache with a 15s
-- staleTime. Two team leads editing the same evaluation silently clobbered
-- one another, and nothing recorded what the record previously said.
--
-- This writes the prior state to feedback_revisions and applies the change in
-- the same transaction, rejecting outright if the row moved since the caller
-- read it. Either the history row and the change both land, or neither does —
-- a feedback row can never be modified without its revision.
DROP FUNCTION IF EXISTS public.update_feedback_with_revision(uuid, timestamptz, date, text, text, text, jsonb, integer, text, text, text, text, text, uuid);
CREATE FUNCTION public.update_feedback_with_revision(
  _feedback_id uuid,
  _expected_updated_at timestamptz,
  _feedback_date date,
  _call_id text,
  _call_type text,
  _listener text,
  _criteria jsonb,
  _score integer,
  _keep_doing text,
  _improve text,
  _manager_summary text,
  _next_task text,
  _reason text,
  _changed_by uuid
)
-- NB: output column names are deliberately NOT the table's own column names.
-- A RETURNS TABLE column shadows the table column of the same name inside the
-- body, which makes an unqualified read ambiguous at runtime.
RETURNS TABLE (
  out_feedback_id uuid,
  out_representative_id uuid,
  out_was_published boolean,
  out_new_updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rep_id uuid;
  v_updated_at timestamptz;
  v_published boolean;
  v_new_updated_at timestamptz;
BEGIN
  SELECT f.representative_id, f.updated_at, f.published
  INTO v_rep_id, v_updated_at, v_published
  FROM public.feedback f
  WHERE f.id = _feedback_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'המשוב לא נמצא' USING ERRCODE = 'P0002';
  END IF;

  -- Optimistic concurrency: the caller states what it believes it is editing.
  -- date_trunc to milliseconds because timestamptz round-trips through JSON
  -- at millisecond precision; comparing raw microseconds would reject every
  -- legitimate edit.
  IF _expected_updated_at IS NOT NULL
     AND date_trunc('milliseconds', v_updated_at) IS DISTINCT FROM date_trunc('milliseconds', _expected_updated_at) THEN
    RAISE EXCEPTION 'המשוב עודכן בינתיים על ידי משתמש אחר — יש לרענן ולנסות שוב' USING ERRCODE = 'P0003';
  END IF;

  -- Prior state first, in the same transaction as the change.
  INSERT INTO public.feedback_revisions (
    feedback_id, previous_criteria, previous_score, previous_keep_doing, previous_improve,
    previous_manager_summary, previous_next_task, previous_feedback_date,
    previous_call_id, previous_call_type, previous_listener, previous_published,
    reason, was_published_at_change, changed_by
  )
  SELECT
    f.id, f.criteria, f.score, f.keep_doing, f.improve,
    f.manager_summary, f.next_task, f.feedback_date,
    f.call_id, f.call_type, f.listener, f.published,
    COALESCE(_reason, ''), f.published, _changed_by
  FROM public.feedback f WHERE f.id = _feedback_id;

  UPDATE public.feedback f
  SET feedback_date = _feedback_date,
      call_id = _call_id,
      call_type = _call_type,
      listener = _listener,
      criteria = _criteria,
      score = _score,
      keep_doing = _keep_doing,
      improve = _improve,
      manager_summary = _manager_summary,
      next_task = _next_task
  WHERE f.id = _feedback_id
  RETURNING f.updated_at INTO v_new_updated_at;

  RETURN QUERY SELECT _feedback_id, v_rep_id, v_published, v_new_updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.update_feedback_with_revision(uuid, timestamptz, date, text, text, text, jsonb, integer, text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_feedback_with_revision(uuid, timestamptz, date, text, text, text, jsonb, integer, text, text, text, text, text, uuid) TO service_role;

COMMENT ON FUNCTION public.update_feedback_with_revision(uuid, timestamptz, date, text, text, text, jsonb, integer, text, text, text, text, text, uuid) IS
  'Applies a feedback edit under a row lock, rejecting a stale write via _expected_updated_at (P0003), and writes the full prior state to feedback_revisions in the same transaction. A feedback row therefore cannot change without its history. Does NOT change published state — publish/retract are separate. Callable only by service_role.';

-- ---------- 3. publication state changes ----------
--
-- Publishing is what makes an evaluation visible to the representative and
-- fires the notification trigger, so it is a distinct, separately audited act
-- rather than one more field on an edit form. Retraction is its inverse and
-- is deliberately recorded as a revision, because un-showing something a
-- person has already read is a material event.
DROP FUNCTION IF EXISTS public.set_feedback_published(uuid, boolean, text, uuid);
CREATE FUNCTION public.set_feedback_published(
  _feedback_id uuid,
  _published boolean,
  _reason text,
  _changed_by uuid
)
-- Output names prefixed for the same shadowing reason as above.
RETURNS TABLE (
  out_feedback_id uuid,
  out_representative_id uuid,
  out_previous_published boolean,
  out_now_published boolean,
  out_published_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rep_id uuid;
  v_prev boolean;
  v_published_at timestamptz;
BEGIN
  SELECT f.representative_id, f.published INTO v_rep_id, v_prev
  FROM public.feedback f WHERE f.id = _feedback_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'המשוב לא נמצא' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent: re-publishing an already-published record is a no-op rather
  -- than a second notification to the representative.
  IF v_prev = _published THEN
    SELECT f.published_at INTO v_published_at FROM public.feedback f WHERE f.id = _feedback_id;
    RETURN QUERY SELECT _feedback_id, v_rep_id, v_prev, _published, v_published_at;
    RETURN;
  END IF;

  IF NOT _published THEN
    -- Retraction is materially significant; capture the state at retraction.
    INSERT INTO public.feedback_revisions (
      feedback_id, previous_criteria, previous_score, previous_keep_doing, previous_improve,
      previous_manager_summary, previous_next_task, previous_feedback_date,
      previous_call_id, previous_call_type, previous_listener, previous_published,
      reason, was_published_at_change, changed_by
    )
    SELECT f.id, f.criteria, f.score, f.keep_doing, f.improve,
           f.manager_summary, f.next_task, f.feedback_date,
           f.call_id, f.call_type, f.listener, f.published,
           COALESCE(_reason, ''), true, _changed_by
    FROM public.feedback f WHERE f.id = _feedback_id;
  END IF;

  UPDATE public.feedback f
  SET published = _published,
      -- First publication stamps the moment; a later retraction clears it so
      -- published_at never claims a visibility that isn't current.
      published_at = CASE WHEN _published THEN COALESCE(f.published_at, now()) ELSE NULL END
  WHERE f.id = _feedback_id
  RETURNING f.published_at INTO v_published_at;

  RETURN QUERY SELECT _feedback_id, v_rep_id, v_prev, _published, v_published_at;
END;
$$;

REVOKE ALL ON FUNCTION public.set_feedback_published(uuid, boolean, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_feedback_published(uuid, boolean, text, uuid) TO service_role;

COMMENT ON FUNCTION public.set_feedback_published(uuid, boolean, text, uuid) IS
  'Flips feedback.published under a row lock and maintains published_at. Idempotent, so a double-click or a retry never sends the representative a second notification. Retraction writes a feedback_revisions row because un-showing an evaluation someone has already read is a material event. Callable only by service_role.';
