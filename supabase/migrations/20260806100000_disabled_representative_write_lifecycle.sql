-- Representatives Operational Hardening (P1-2): a deactivated representative
-- could still self-write through RLS. private.rep_is_self(_rep) only checks
-- r.user_id = auth.uid() — it never looks at representatives.active — and it
-- is reused across every "can this rep see their own X" READ policy AND the
-- one self-WRITE policy that exists today ("rep tasks self update" on
-- rep_tasks, the only rep-authored write path in the schema: rep_notes has
-- no self-write policy, only staff write). A rep whose representative row
-- had been deactivated could still toggle/edit their own tasks indefinitely.
--
-- Fix: a new, separate function — never modify rep_is_self itself, since
-- every one of its other callers is a READ policy (feedback, listening
-- schedules, rep_tasks, rep_notes, manager_calls, underwriting_issues,
-- representative_goals) and reads must stay available regardless of active
-- state — a deactivated rep must still be able to see their own historical
-- data. Only the write surface is gated.
CREATE OR REPLACE FUNCTION private.rep_is_self_active(_rep uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.representatives r WHERE r.id = _rep AND r.user_id = auth.uid() AND r.active);
$$;
REVOKE ALL ON FUNCTION private.rep_is_self_active(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.rep_is_self_active(uuid) TO authenticated;

DROP POLICY IF EXISTS "rep tasks self update" ON public.rep_tasks;
CREATE POLICY "rep tasks self update" ON public.rep_tasks FOR UPDATE TO authenticated
  USING (private.rep_is_self_active(representative_id)) WITH CHECK (private.rep_is_self_active(representative_id));

COMMENT ON FUNCTION private.rep_is_self_active(uuid) IS
  'Like private.rep_is_self, but also requires representatives.active — reserved for self-WRITE RLS policies only (currently just "rep tasks self update"). Never use this for a read policy; a deactivated representative must still be able to read their own historical data.';
