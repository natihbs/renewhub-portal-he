-- Remove the hardcoded car/home two-value restriction on representatives.team_key.
--
-- Team membership is now sourced exclusively from representatives.team_id
-- (FK -> teams.id), which supports any number of generically-named teams.
-- team_key is kept as a nullable, unconstrained legacy column for backward
-- compatibility with any external tooling that still reads it; the
-- application no longer reads, writes, filters, groups, or authorizes on it.
--
-- Follow-up (tracked separately, not done here): once nothing references
-- representatives.team_key, drop the column entirely in a later migration.

ALTER TABLE public.representatives
  DROP CONSTRAINT IF EXISTS representatives_team_key_check;

ALTER TABLE public.representatives
  ALTER COLUMN team_key DROP NOT NULL;

ALTER TABLE public.representatives
  ALTER COLUMN team_key DROP DEFAULT;

COMMENT ON COLUMN public.representatives.team_key IS
  'Deprecated legacy car/home tag. No longer read or written by the application. Team membership lives in team_id. Scheduled for removal.';
