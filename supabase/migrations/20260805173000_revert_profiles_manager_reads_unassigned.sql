-- Reverts the broad "profiles manager reads team members" policy applied by
-- 20260805171500_profiles_manager_reads_unassigned.sql, which has already
-- been merged to main and applied. That migration widened a manager's SELECT
-- visibility on public.profiles to:
--
--   private.manages_team(team_id) OR team_id IS NULL
--
-- which let every manager read every unassigned profile in the organization
-- — including administrators, other managers, and unrelated accounts, not
-- just eligible unassigned representatives. This was flagged in code review
-- as an authorization/privacy regression and must not remain live.
--
-- This migration does NOT pretend 20260805171500 never happened — it stays
-- in migration history exactly as applied. This is a new, forward-only
-- migration that explicitly restores the original, narrower policy from
-- 20260801160229_0e4bd288-7692-4d53-991a-7a472814f377.sql:
--
--   private.manages_team(team_id)   -- (no "OR team_id IS NULL")
--
-- The legitimate need the reverted migration was trying to solve — a manager
-- being able to see an unassigned, eligible representative account to add to
-- their team — is now served correctly by a permission-checked server
-- function instead of a broadened RLS policy: listTeamAssignmentCandidates
-- (src/lib/team-admin.functions.ts), which uses the service-role client only
-- after assertCanManageTeam passes, returns only the minimal fields the
-- picker needs, and restricts a manager's eligible candidates to active
-- representative-linked accounts that are unassigned or already on a team
-- that same manager manages — never an admin, another manager, or anyone on
-- a team they don't manage.

DROP POLICY IF EXISTS "profiles manager reads team members" ON public.profiles;
CREATE POLICY "profiles manager reads team members" ON public.profiles
FOR SELECT TO authenticated
USING (private.is_manager(auth.uid()) AND private.manages_team(team_id));
