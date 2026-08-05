-- Teams Operational Hardening (P1): make team deletion safe at the database
-- level, independent of the application-level dependency check in
-- deleteTeam() (src/lib/team-admin.functions.ts).
--
-- Every FK referencing teams.id previously used a "silently detach or
-- destroy" ON DELETE behavior:
--   profiles.team_id          ON DELETE SET NULL   -- would silently unassign users
--   representatives.team_id   ON DELETE SET NULL   -- would silently unassign reps
--   kpi_values.team_id        ON DELETE SET NULL   -- would silently detach historical
--                                                      performance attribution (this
--                                                      column exists specifically so a
--                                                      rep moved between teams keeps old
--                                                      values attributed to the team they
--                                                      were on when recorded — see
--                                                      20260802150000_kpi_values.sql)
--   team_goals.team_id        ON DELETE CASCADE     -- would silently destroy team targets
--
-- None of these should ever fire as a side effect of a team delete: the
-- server function already refuses to delete a team with any dependency, but
-- this migration makes that a guarantee Postgres itself enforces, not just
-- application code. RESTRICT means the delete is rejected outright if any
-- dependent row still exists — this is the same "prefer RESTRICT/NO ACTION
-- where historical data must block deletion" principle applied uniformly
-- across all four references, not just team_goals.
--
-- This does not change any other schema behavior (columns, other FKs,
-- indexes, RLS policies are untouched).

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_team_id_fkey,
  ADD CONSTRAINT profiles_team_id_fkey
    FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE RESTRICT;

ALTER TABLE public.representatives
  DROP CONSTRAINT IF EXISTS representatives_team_id_fkey,
  ADD CONSTRAINT representatives_team_id_fkey
    FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE RESTRICT;

ALTER TABLE public.kpi_values
  DROP CONSTRAINT IF EXISTS kpi_values_team_id_fkey,
  ADD CONSTRAINT kpi_values_team_id_fkey
    FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE RESTRICT;

ALTER TABLE public.team_goals
  DROP CONSTRAINT IF EXISTS team_goals_team_id_fkey,
  ADD CONSTRAINT team_goals_team_id_fkey
    FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE RESTRICT;
