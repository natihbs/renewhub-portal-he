-- Performance Operational Hardening (P1): concurrency-safe task toggle
--
-- PROBLEM. RepWorkspace's toggleTask (rep-workspace.tsx) decided the new value
-- on the CLIENT, from the React Query cache:
--     const current = tasks.rows.find((t) => t.id === taskId);
--     void tasks.update(taskId, { done: !current?.done });
-- Three distinct defects follow from that one line:
--   1. Stale-write race. Two managers (or two tabs) holding a 15s-stale cache
--      both compute the inverse of the SAME observed value and issue two
--      unconditional writes. The last write wins; neither actor is told their
--      action was overridden, and the final state matches no one's intent.
--   2. Unknown-state coercion. If `current` is undefined — row not yet in
--      cache, or already deleted — `!current?.done` evaluates to TRUE, so the
--      task is forced to "done" regardless of its real state, including for a
--      task that no longer exists.
--   3. No truthful failure. A write against a deleted task simply affects 0
--      rows and reports success.
--
-- FIX. The new value is never supplied by the caller at all. This function
-- row-locks the task (SELECT ... FOR UPDATE, which serializes concurrent
-- callers on the same row) and flips `done` from the value the DATABASE
-- currently holds, then returns the committed state so the client renders
-- what actually happened rather than what it predicted.
--
-- Two concurrent toggles therefore compose honestly — they serialize into
-- two flips (on -> off -> on) instead of racing to the same value — and a
-- missing task raises rather than silently no-op'ing.
--
-- Authorization is NOT performed here. Exactly like
-- set_representative_active_with_profile_sync and link_representative_to_user,
-- this is reachable only via service_role and trusts its caller completely;
-- toggleRepresentativeTask (rep-admin.functions.ts) performs every permission
-- check — including the inactive-representative self-write lifecycle gate
-- that mirrors private.rep_is_self_active — BEFORE this is ever invoked.
CREATE OR REPLACE FUNCTION public.toggle_rep_task_done(_task_id uuid)
RETURNS TABLE (
  task_id uuid,
  representative_id uuid,
  title text,
  previous_done boolean,
  done boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rep_id uuid;
  v_title text;
  v_previous boolean;
BEGIN
  SELECT t.representative_id, t.title, t.done
  INTO v_rep_id, v_title, v_previous
  FROM public.rep_tasks t
  WHERE t.id = _task_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'המשימה לא נמצאה — ייתכן שנמחקה' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.rep_tasks
  SET done = NOT v_previous
  WHERE id = _task_id;

  RETURN QUERY SELECT _task_id, v_rep_id, v_title, v_previous, NOT v_previous;
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_rep_task_done(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_rep_task_done(uuid) TO service_role;

COMMENT ON FUNCTION public.toggle_rep_task_done(uuid) IS
  'Flips rep_tasks.done from the value currently committed in the database, under a row lock (FOR UPDATE) so concurrent toggles serialize instead of racing on a stale client-side value. The caller never supplies the new value. Raises P0002 for a missing/deleted task instead of silently affecting zero rows. Returns the committed state. Callable only by service_role; all authorization happens in toggleRepresentativeTask before this is called.';
