-- Performance Operational Hardening (P1): atomic representative transfer
--
-- PROBLEM. updateRepresentativeMetrics (rep-admin.functions.ts) — the write
-- path behind Performance's row-edit dialog AND the Data Import wizard — did:
--     1. UPDATE representatives SET team_id = ...        (committed)
--     2. syncLinkedProfileTeam(...)  -> UPDATE profiles  (separate round trip)
-- with no transaction and no try/catch around step 2. If step 2 failed, the
-- representative had ALREADY moved teams, but the error propagated to the
-- client as a bare failure — so the manager saw "save failed" while the
-- transfer had in fact happened, and the linked login account was left
-- pointing at the old team and the old manager indefinitely, with no retry
-- and no reconciliation path. The linked user then appears under the old
-- team's "חברי הצוות" and the new team's "נציגים בצוות" simultaneously.
--
-- FIX. One SECURITY DEFINER function is one implicit Postgres transaction, so
-- every write below commits together or not at all — the same primitive
-- already used by set_user_team_with_representative_sync (which solves the
-- mirror-image problem, driven from the profile side) and by
-- set_representative_active_with_profile_sync.
--
-- This deliberately folds the METRIC fields (name / current_result /
-- monthly_target) into the same transaction rather than splitting transfer
-- into a separate canonical operation. The sprint spec allowed either; doing
-- it in one call is what keeps "preserve unrelated edits safely" true — a
-- failed transfer must not half-apply a rename that was submitted with it,
-- and vice versa.
--
-- Nullable fields that carry meaning when null (team_id NULL = unassigned)
-- use an explicit _apply_* flag rather than overloading NULL as "unchanged".
--
-- Inactive destination teams are rejected HERE as a backstop as well as in the
-- TypeScript caller, so no path can move a representative onto a deactivated
-- team. Reassigning TO NULL (unassign) stays allowed — that is cleanup, not
-- new operational activity, consistent with assertTeamIsActiveForNewAssignment.
CREATE OR REPLACE FUNCTION public.update_representative_metrics_with_team_sync(
  _rep_id uuid,
  _name text,
  _apply_name boolean,
  _current_result integer,
  _apply_current_result boolean,
  _monthly_target integer,
  _apply_monthly_target boolean,
  _team_id uuid,
  _apply_team boolean
)
RETURNS TABLE (
  rep_id uuid,
  rep_name text,
  previous_team_id uuid,
  new_team_id uuid,
  team_changed boolean,
  linked_user_id uuid,
  profile_synced boolean,
  previous_current_result integer,
  new_current_result integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_team_id uuid;
  v_prev_name text;
  v_prev_result integer;
  v_user_id uuid;
  v_dest_active boolean;
  v_dest_manager_id uuid;
  v_team_changed boolean := false;
  v_profile_synced boolean := false;
  v_new_team_id uuid;
  v_new_name text;
  v_new_result integer;
BEGIN
  SELECT r.team_id, r.name, r.current_result, r.user_id
  INTO v_prev_team_id, v_prev_name, v_prev_result, v_user_id
  FROM public.representatives r
  WHERE r.id = _rep_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'הנציג לא נמצא' USING ERRCODE = 'P0002';
  END IF;

  v_new_team_id := CASE WHEN _apply_team THEN _team_id ELSE v_prev_team_id END;
  v_new_name    := CASE WHEN _apply_name THEN _name ELSE v_prev_name END;
  v_new_result  := CASE WHEN _apply_current_result THEN _current_result ELSE v_prev_result END;

  v_team_changed := _apply_team AND (v_new_team_id IS DISTINCT FROM v_prev_team_id);

  IF v_team_changed AND v_new_team_id IS NOT NULL THEN
    SELECT t.active, t.manager_id INTO v_dest_active, v_dest_manager_id
    FROM public.teams t WHERE t.id = v_new_team_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'צוות היעד לא נמצא' USING ERRCODE = 'P0006';
    END IF;
    IF NOT v_dest_active THEN
      RAISE EXCEPTION 'לא ניתן לשייך לצוות מושבת' USING ERRCODE = 'P0005';
    END IF;
  END IF;

  UPDATE public.representatives
  SET
    name           = CASE WHEN _apply_name           THEN _name           ELSE name           END,
    current_result = CASE WHEN _apply_current_result THEN _current_result ELSE current_result END,
    monthly_target = CASE WHEN _apply_monthly_target THEN _monthly_target ELSE monthly_target END,
    team_id        = CASE WHEN _apply_team           THEN _team_id        ELSE team_id        END
  WHERE id = _rep_id;

  -- Linked login account follows the representative's team, in the SAME
  -- transaction. If this fails, the representative's move above rolls back
  -- too — there is no state where the two disagree.
  IF v_team_changed AND v_user_id IS NOT NULL THEN
    UPDATE public.profiles
    SET team_id = v_new_team_id, manager_id = v_dest_manager_id
    WHERE id = v_user_id;
    v_profile_synced := true;
  END IF;

  RETURN QUERY SELECT
    _rep_id, v_new_name, v_prev_team_id, v_new_team_id, v_team_changed,
    v_user_id, v_profile_synced, v_prev_result, v_new_result;
END;
$$;

REVOKE ALL ON FUNCTION public.update_representative_metrics_with_team_sync(uuid, text, boolean, integer, boolean, integer, boolean, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_representative_metrics_with_team_sync(uuid, text, boolean, integer, boolean, integer, boolean, uuid, boolean) TO service_role;

COMMENT ON FUNCTION public.update_representative_metrics_with_team_sync(uuid, text, boolean, integer, boolean, integer, boolean, uuid, boolean) IS
  'Atomically applies representative metric edits (name/current_result/monthly_target) and, when a team change is included, representatives.team_id plus the linked profile''s team_id/manager_id — all in one transaction, so a failure can never leave the representative on the new team with their login account on the old one. Rejects inactive destination teams (P0005) as a backstop. Row-locks the representative. Callable only by service_role; authorization happens in updateRepresentativeMetrics before this is called.';
