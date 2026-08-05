-- Teams Operational Hardening (P2b): a manager must be able to add an
-- unassigned user to their own team (see setUserTeam / the "add/transfer
-- user" picker in teams.tsx), but couldn't even see that an unassigned user
-- existed to pick them.
--
-- "profiles manager reads team members" (20260801160229) scopes a manager's
-- SELECT to private.manages_team(team_id), which is defined to return false
-- whenever team_id IS NULL — so an unassigned user's profile row was
-- invisible to every manager, admin excluded. This widens that same
-- read-only SELECT policy by exactly one additional case: team_id IS NULL.
--
-- This does NOT let a manager see another team's members (manages_team still
-- requires the row's team to be one they manage), and does not touch any
-- UPDATE/DELETE policy — a manager's ability to actually reassign a user's
-- team is enforced separately, server-side, in setUserTeam
-- (team-admin.functions.ts), which re-verifies via the RLS-scoped client
-- which teams the acting manager manages before writing anything.
DROP POLICY IF EXISTS "profiles manager reads team members" ON public.profiles;
CREATE POLICY "profiles manager reads team members" ON public.profiles
FOR SELECT TO authenticated
USING (private.is_manager(auth.uid()) AND (private.manages_team(team_id) OR team_id IS NULL));
