-- ============================================================================
-- Teams attach to CENTERS only (additive + idempotent).
--
-- Live QA on the business hierarchy foundation: the real business model
-- attaches a team to a מוקד (center); the פעילות (activity) is inherited
-- through the center and is never a team's direct parent. This trigger
-- enforces that shape on every future write of teams.business_unit_id:
--   * NULL stays allowed (a team may be unattached);
--   * a center is accepted;
--   * an activity (or any non-center unit) is rejected with the product's
--     friendly Hebrew rule.
--
-- Deliberately NO data rewrite: a team already attached directly to an
-- activity keeps its row untouched; the admin UI warns about it and the
-- admin moves it to a center manually. Scope resolution keeps tolerating
-- (and covering) such legacy rows through private.team_in_business_scope,
-- so nothing disappears from anyone's scope until the admin fixes it.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.validate_team_business_unit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE unit_type_v text;
BEGIN
  IF NEW.business_unit_id IS NOT NULL THEN
    SELECT unit_type INTO unit_type_v FROM public.business_units WHERE id = NEW.business_unit_id;
    IF unit_type_v IS DISTINCT FROM 'center' THEN
      RAISE EXCEPTION 'צוות ניתן לשייך למוקד בלבד. הפעילות נקבעת דרך המוקד.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_teams_business_unit_center_only ON public.teams;
CREATE TRIGGER trg_teams_business_unit_center_only
  BEFORE INSERT OR UPDATE OF business_unit_id ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.validate_team_business_unit();
