-- Dashboard Operational Hardening (P2): checklist scope + concurrency
--
-- PROBLEM 1 — one checklist shared across a manager's teams. The unique key
-- was (user_id, checklist_date, task_key), so a manager who manages two teams
-- had ONE checklist per day. Ticking "תכנון האזנות" while in Team A's
-- workspace marked it done for Team B as well, and there was no way to tell
-- which team the morning routine had actually been completed for.
--
-- PROBLEM 2 — a stale-cache toggle. The client computed the new value as
--     !current?.checked
-- from a React Query cache with a 15s staleTime, then upserted it. Two tabs
-- (or a slow refetch) could both read the same value and write the same
-- result, silently losing a toggle — and a row missing from the cache
-- entirely was coerced to `true` rather than read from the database. This is
-- the identical defect fixed for rep_tasks in the Performance sprint, and it
-- gets the identical remedy: the DATABASE flips the value it holds, under a
-- row lock, and returns what actually committed.

-- ---------- team scope ----------

ALTER TABLE public.morning_checklist
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.morning_checklist.team_id IS
  'The workspace team this checklist belongs to. NULL means the organization-level checklist (an admin, or a manager with no team workspace) — deliberately a distinct scope rather than a catch-all.';

-- The old unique key cannot express "one checklist per team per day", and a
-- plain UNIQUE cannot either, because NULL never equals NULL in a unique
-- index — two org-level rows for the same task would both be allowed. Two
-- partial unique indexes cover the two cases exactly.
ALTER TABLE public.morning_checklist
  DROP CONSTRAINT IF EXISTS morning_checklist_user_id_checklist_date_task_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS morning_checklist_team_scope_idx
  ON public.morning_checklist (user_id, checklist_date, task_key, team_id)
  WHERE team_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS morning_checklist_org_scope_idx
  ON public.morning_checklist (user_id, checklist_date, task_key)
  WHERE team_id IS NULL;

-- ---------- concurrency-safe toggle ----------
--
-- Returns the committed state so the UI renders what the database actually
-- holds, never what the client guessed. Authorization is NOT re-implemented
-- here: the row is keyed by user_id and the calling server function passes
-- the authenticated caller's own id, exactly like every other RPC in this
-- codebase.
DROP FUNCTION IF EXISTS public.toggle_morning_checklist_item(uuid, date, text, uuid);
CREATE FUNCTION public.toggle_morning_checklist_item(
  _user_id uuid,
  _checklist_date date,
  _task_key text,
  _team_id uuid
)
RETURNS TABLE (out_task_key text, out_checked boolean, out_checklist_date date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_checked boolean;
BEGIN
  -- Row-lock the existing item, if any. Two concurrent toggles serialize
  -- here, and the second one reads the value the first one committed.
  SELECT c.id, c.checked INTO v_id, v_checked
  FROM public.morning_checklist c
  WHERE c.user_id = _user_id
    AND c.checklist_date = _checklist_date
    AND c.task_key = _task_key
    AND c.team_id IS NOT DISTINCT FROM _team_id
  FOR UPDATE;

  IF v_id IS NULL THEN
    -- No row yet: an absent item is unchecked, so toggling it makes it
    -- checked. Previously the client inferred this from a cache miss, which
    -- is the same answer for the wrong reason — it could not tell "not
    -- ticked" from "not loaded".
    INSERT INTO public.morning_checklist (user_id, checklist_date, task_key, team_id, checked)
    VALUES (_user_id, _checklist_date, _task_key, _team_id, true)
    RETURNING checked INTO v_checked;
  ELSE
    UPDATE public.morning_checklist
    SET checked = NOT v_checked
    WHERE id = v_id
    RETURNING checked INTO v_checked;
  END IF;

  RETURN QUERY SELECT _task_key, v_checked, _checklist_date;
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_morning_checklist_item(uuid, date, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_morning_checklist_item(uuid, date, text, uuid) TO service_role;

COMMENT ON FUNCTION public.toggle_morning_checklist_item(uuid, date, text, uuid) IS
  'Flips one morning-checklist item under a row lock and returns the committed state. Replaces a client-side !current?.checked computed from a 15s-stale cache, which lost concurrent toggles and treated a cache miss as "unchecked". Callable only by service_role; the calling server function supplies the authenticated caller''s own user id.';
