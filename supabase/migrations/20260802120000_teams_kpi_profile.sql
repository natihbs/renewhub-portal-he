-- Add an explicit, backward-compatible KPI profile per team so the app can stop
-- assuming every team's target/result ratio means "renewal rate". Additive only:
-- every existing team defaults to generic_sales (plain target achievement), so no
-- team's current behavior or displayed values change from this migration alone.
-- The profile is a plain configuration column — the app must never infer it from a
-- team's name/id (e.g. matching "רכב"/"דירה"/"חידושים").
--
-- 'renewals' marks a team as eligible for a real, separately-tracked renewal rate
-- (completed renewals / renewal opportunities — see src/lib/renewal-rate.ts) once
-- that data exists. It intentionally does not change today's target/achievement
-- values for that team.
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS kpi_profile text NOT NULL DEFAULT 'generic_sales';

ALTER TABLE public.teams
  ADD CONSTRAINT teams_kpi_profile_check CHECK (kpi_profile IN ('generic_sales', 'renewals'));

COMMENT ON COLUMN public.teams.kpi_profile IS
  'Which KPI behavior this team uses. generic_sales (default): target/result achievement only. renewals: also eligible for a real completed/opportunities renewal rate once that data is imported. Never inferred from team name — set explicitly per team.';
