-- Performance Operational Hardening (P1): kpi_values authorization + team attribution
--
-- PROBLEM 1 — forged-team authorization.
-- The previous manager policy was:
--     USING (private.is_manager(auth.uid()) AND private.manages_team(team_id))
-- team_id is a plain column the CALLER supplies. private.manages_team(_team_id)
-- only checks teams.manager_id = auth.uid() for whatever value it is handed —
-- it never looks at the representative. So a manager could write:
--     representative_id = <a rep on a team they do NOT manage>
--     team_id          = <a team they DO manage>
-- and pass RLS. Because every aggregation keys off representative_id, the
-- forged row then surfaced on the VICTIM's dashboards, and since kpi_values has
-- no created_by/audit trail it was unattributable. Worse, the table's
-- UNIQUE (representative_id, metric_date) means such a write silently
-- OVERWRITES a real historical renewal figure via upsert.
--
-- Every structurally identical table in this schema already derives manager
-- authorization from the real relationship instead — feedback,
-- listening_schedules and representative_goals all gate on
-- private.can_manage_rep(representative_id), which joins through
-- representatives.team_id. kpi_values was the one write path that did not.
--
-- FIX 1: manager write authorization now derives from
-- private.can_manage_rep(representative_id). The submitted team_id is never
-- consulted for authorization again.
--
-- PROBLEM 2 — team attribution was documented but never enforced.
-- kpi_values.team_id was introduced "so a representative moved between teams
-- keeps old values attributed to the team they were on when the value was
-- recorded", but nothing enforced that: the column was whatever the client
-- sent, and no aggregation ever read it. Transferring a representative
-- therefore moved 100% of their historical renewal contribution to the new
-- team in every UI.
--
-- FIX 2: team_id becomes a DB-derived, immutable attribution snapshot.
--   * On INSERT it is always taken from the representative's current team,
--     overwriting whatever the caller sent. A caller cannot attribute a KPI
--     row to a team of their choosing at all, by any path.
--   * On UPDATE it is pinned to its existing value. Correcting a value never
--     re-attributes the row, and a later transfer can never rewrite history.
--
-- Honest limitation, stated explicitly rather than implied: there is no
-- team-membership history table in this schema. "The team at the time of the
-- record" is therefore realized as "the representative's team at the moment
-- the row was first written". A backdated import row is attributed to the
-- representative's team as of the import, not as of the metric_date. That is
-- the strongest attribution the current schema supports; the invariant below
-- makes it consistent and tamper-proof rather than advisory.
--
-- Read access is split from write access accordingly: a manager keeps reading
-- rows ATTRIBUTED to a team they manage even after the representative has been
-- transferred away — that history belongs to their team's numbers — while
-- writes stay strictly bound to the current representative relationship.
-- This read widening is only safe because team_id is now DB-derived and
-- immutable; it would have been a hole under the old client-supplied column.

-- ---------- attribution invariant ----------

CREATE OR REPLACE FUNCTION private.kpi_values_enforce_team_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Always derived, never accepted from the caller.
    SELECT r.team_id INTO NEW.team_id
    FROM public.representatives r
    WHERE r.id = NEW.representative_id;
  ELSE
    -- Attribution is immutable once recorded.
    NEW.team_id := OLD.team_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.kpi_values_enforce_team_attribution() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS kpi_values_team_attribution ON public.kpi_values;
CREATE TRIGGER kpi_values_team_attribution
BEFORE INSERT OR UPDATE ON public.kpi_values
FOR EACH ROW EXECUTE FUNCTION private.kpi_values_enforce_team_attribution();

COMMENT ON FUNCTION private.kpi_values_enforce_team_attribution() IS
  'Makes kpi_values.team_id a DB-derived, immutable attribution snapshot: taken from the representative''s current team on INSERT (ignoring any caller-supplied value) and pinned to its prior value on UPDATE. Guarantees a representative transfer can never rewrite historical team attribution, and that no caller can attribute a KPI row to a team of their choosing.';

-- Rows written before this migration may have a NULL team_id (the import path
-- passed the CSV row's team, which was null for a row with no team column).
-- A NULL has no attribution to preserve, so filling it with the best value
-- available today is strictly an improvement and never rewrites a real
-- historical attribution. Non-null existing values are deliberately left
-- untouched.
UPDATE public.kpi_values k
SET team_id = r.team_id
FROM public.representatives r
WHERE k.representative_id = r.id
  AND k.team_id IS NULL
  AND r.team_id IS NOT NULL;

-- ---------- authorization ----------

DROP POLICY IF EXISTS "kpi_values manager team" ON public.kpi_values;

-- READ: the representative relationship OR the immutable attribution snapshot.
-- The second arm is what lets a manager keep seeing the history their team
-- actually produced after a representative moves on.
CREATE POLICY "kpi_values manager read" ON public.kpi_values
FOR SELECT TO authenticated
USING (private.can_manage_rep(representative_id) OR private.manages_team(team_id));

-- WRITE: strictly the real, current representative relationship. team_id is
-- not consulted — it cannot be, it is trigger-derived.
CREATE POLICY "kpi_values manager insert" ON public.kpi_values
FOR INSERT TO authenticated
WITH CHECK (private.can_manage_rep(representative_id));

CREATE POLICY "kpi_values manager update" ON public.kpi_values
FOR UPDATE TO authenticated
USING (private.can_manage_rep(representative_id))
WITH CHECK (private.can_manage_rep(representative_id));

CREATE POLICY "kpi_values manager delete" ON public.kpi_values
FOR DELETE TO authenticated
USING (private.can_manage_rep(representative_id));

-- "kpi_values admin all" and "kpi_values self read" are intentionally left
-- exactly as they were — admin behavior and representative self-read are
-- unchanged by this migration.

COMMENT ON COLUMN public.kpi_values.team_id IS
  'Immutable historical attribution: the representative''s team at the moment this row was first written, derived by the kpi_values_team_attribution trigger and never accepted from a caller. Historical per-team KPI totals aggregate by THIS column; per-representative totals aggregate by representative_id. A representative transfer does not move already-recorded history.';
