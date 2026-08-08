-- ============================================================================
-- Business hierarchy foundation (additive + idempotent).
--
-- Models the business ladder above teams WITHOUT touching the technical role
-- enum (admin / manager / representative stay exactly as they are):
--
--   סמנכ"ל / מנהל ממ"ט  (executive, business-wide scope)
--     → פעילות  (business_units.unit_type = 'activity')
--       → מוקד  (business_units.unit_type = 'center', parent = an activity)
--         → צוות (public.teams, unchanged; optional teams.business_unit_id)
--           → נציג (representatives.team_id, unchanged)
--
-- teams.manager_id remains THE authoritative direct team-manager ownership.
-- Higher scopes are ADDITIVE viewing/management scopes granted per user in
-- user_business_scopes; a manager with no scope rows keeps exactly the
-- teams.manager_id behavior they have today. Admin remains the system
-- administrator ("מנהל מערכת") and is NOT modeled as a business executive.
--
-- Enforcement funnels through the two existing SECURITY DEFINER helpers every
-- team/representative-scoped policy already uses — private.manages_team and
-- private.rep_in_my_team — so extending them here makes reads AND writes
-- follow the resolved business scope across the whole data layer without
-- rewriting any table policy.
-- ============================================================================

-- ---------------------------------------------------------------- tables

CREATE TABLE IF NOT EXISTS public.business_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  unit_type text NOT NULL CHECK (unit_type IN ('activity', 'center')),
  parent_id uuid NULL REFERENCES public.business_units(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.business_units IS
  'Business hierarchy nodes: activity (פעילות) and center (מוקד). A center''s parent is an activity. Teams attach via teams.business_unit_id.';

-- A center hangs under an activity; an activity is a root. Enforced by
-- trigger (a CHECK cannot look at the parent row).
CREATE OR REPLACE FUNCTION public.validate_business_unit_parent()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_type text;
BEGIN
  IF NEW.unit_type = 'activity' AND NEW.parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'activity units cannot have a parent';
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id THEN
      RAISE EXCEPTION 'a business unit cannot be its own parent';
    END IF;
    SELECT unit_type INTO parent_type FROM public.business_units WHERE id = NEW.parent_id;
    IF parent_type IS DISTINCT FROM 'activity' THEN
      RAISE EXCEPTION 'a center''s parent must be an activity unit';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_business_units_parent ON public.business_units;
CREATE TRIGGER trg_business_units_parent
  BEFORE INSERT OR UPDATE ON public.business_units
  FOR EACH ROW EXECUTE FUNCTION public.validate_business_unit_parent();

DROP TRIGGER IF EXISTS trg_business_units_updated_at ON public.business_units;
CREATE TRIGGER trg_business_units_updated_at
  BEFORE UPDATE ON public.business_units
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.user_business_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('center', 'activity', 'executive')),
  business_unit_id uuid NULL REFERENCES public.business_units(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- executive is business-wide (no unit); center/activity must name their unit
  CONSTRAINT user_business_scopes_unit_shape CHECK (
    (scope_type = 'executive' AND business_unit_id IS NULL)
    OR (scope_type IN ('center', 'activity') AND business_unit_id IS NOT NULL)
  ),
  CONSTRAINT user_business_scopes_unique UNIQUE NULLS NOT DISTINCT (user_id, scope_type, business_unit_id)
);

COMMENT ON TABLE public.user_business_scopes IS
  'Additive business viewing/management scopes for manager users (מנהל מוקד / מנהל פעילות / סמנכ"ל-מנהל ממ"ט). Never replaces teams.manager_id; a user with no rows keeps plain team-manager scope.';

ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS business_unit_id uuid NULL REFERENCES public.business_units(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.teams.business_unit_id IS
  'Optional attachment of the team to a business unit (typically a center; an activity is also allowed). Never affects teams.manager_id ownership.';

CREATE INDEX IF NOT EXISTS idx_business_units_parent ON public.business_units (parent_id);
CREATE INDEX IF NOT EXISTS idx_user_business_scopes_user ON public.user_business_scopes (user_id);
CREATE INDEX IF NOT EXISTS idx_user_business_scopes_unit ON public.user_business_scopes (business_unit_id);
CREATE INDEX IF NOT EXISTS idx_teams_business_unit ON public.teams (business_unit_id);

-- ---------------------------------------------------------------- RLS

ALTER TABLE public.business_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_business_scopes ENABLE ROW LEVEL SECURITY;

-- Org structure metadata: readable by any authenticated user (labels need
-- it), writable by the system administrator only.
DROP POLICY IF EXISTS "business_units authenticated read" ON public.business_units;
CREATE POLICY "business_units authenticated read" ON public.business_units
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "business_units admin all" ON public.business_units;
CREATE POLICY "business_units admin all" ON public.business_units
  FOR ALL TO authenticated
  USING (private.is_admin(auth.uid()))
  WITH CHECK (private.is_admin(auth.uid()));

-- Scope grants: a user reads their own grants; the admin reads/writes all.
DROP POLICY IF EXISTS "user_business_scopes own read" ON public.user_business_scopes;
CREATE POLICY "user_business_scopes own read" ON public.user_business_scopes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.is_admin(auth.uid()));

DROP POLICY IF EXISTS "user_business_scopes admin all" ON public.user_business_scopes;
CREATE POLICY "user_business_scopes admin all" ON public.user_business_scopes
  FOR ALL TO authenticated
  USING (private.is_admin(auth.uid()))
  WITH CHECK (private.is_admin(auth.uid()));

-- ------------------------------------------------- scope-aware authorization

-- True when _user_id holds a business scope that covers _team_id:
--   executive           → every team (business-wide scope);
--   activity / center   → the team's unit is the scoped unit, or the team's
--                         unit is a center whose parent is the scoped activity.
-- A manager with no scope rows gets FALSE here — nothing changes for them.
--
-- HARDENING: grants are effective ONLY for users whose technical role is
-- manager (private.is_manager). Several existing policies consume
-- manages_team in an OR branch without their own is_manager guard
-- (team_goals read/write, one kpi_values read, snapshot reads), so a
-- user_business_scopes row accidentally created for a representative must
-- be inert — the role guard here makes it so at the single funnel point.
CREATE OR REPLACE FUNCTION private.team_in_business_scope(_team_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _team_id IS NOT NULL AND private.is_manager(_user_id) AND EXISTS (
    SELECT 1
    FROM public.user_business_scopes ubs
    WHERE ubs.user_id = _user_id
      AND (
        ubs.scope_type = 'executive'
        OR EXISTS (
          SELECT 1
          FROM public.teams t
          LEFT JOIN public.business_units tu ON tu.id = t.business_unit_id
          WHERE t.id = _team_id
            AND (t.business_unit_id = ubs.business_unit_id OR tu.parent_id = ubs.business_unit_id)
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION private.team_in_business_scope(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.team_in_business_scope(uuid, uuid) TO authenticated;

-- The single funnel every team-scoped policy already goes through.
-- teams.manager_id remains the first, authoritative clause; the business
-- scope is an ADDITIVE second clause.
CREATE OR REPLACE FUNCTION private.manages_team(_team_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _team_id IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.teams t WHERE t.id = _team_id AND t.manager_id = auth.uid()
    )
    OR private.team_in_business_scope(_team_id, auth.uid())
  );
$$;

-- The rep-level funnel (feedback, kpi RPCs, coaching…) now routes through
-- manages_team so both funnels agree on one definition of managed scope.
CREATE OR REPLACE FUNCTION private.rep_in_my_team(_rep uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.representatives r
    WHERE r.id = _rep AND private.manages_team(r.team_id)
  );
$$;

-- Managers with a business scope can also READ the covered team rows
-- themselves (the existing manager policy only covers manager_id = auth.uid()).
DROP POLICY IF EXISTS "teams business scope reads" ON public.teams;
CREATE POLICY "teams business scope reads" ON public.teams
  FOR SELECT TO authenticated
  USING (private.team_in_business_scope(id, auth.uid()));
