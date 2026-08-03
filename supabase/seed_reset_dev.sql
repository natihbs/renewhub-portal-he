-- ============================================================================
--                    DEVELOPMENT / TEST ENVIRONMENTS ONLY
--
--   This script is DESTRUCTIVE and IRREVERSIBLE. It must NEVER be executed
--   against a production database, or against any database anyone depends
--   on for real data.
-- ============================================================================
--
-- Pulse — Dev Environment Reset
--
-- Truncates every operational/history table and deletes every login account
-- except the ONE admin you name below. Does not touch schema, migrations,
-- RLS policies, functions, or triggers — DML only, and the selected admin's
-- login/account is preserved throughout.
--
-- This file is a standalone, manual utility. It is not a migration, is not
-- run by any build/deploy/CI step, and is not referenced anywhere in the
-- application. It only ever runs if a human deliberately opens it and
-- executes it against a database they have explicitly chosen.
--
-- IMPORTANT — TRUNCATE ... CASCADE vs. a normal DELETE (read this):
-- A foreign key's ON DELETE action (SET NULL / CASCADE / RESTRICT) only
-- applies to row-level DELETE statements. TRUNCATE ... CASCADE ignores that
-- action entirely: it unconditionally empties every table that has ANY live
-- reference to the truncated table, full stop. Concretely: profiles.team_id
-- references teams(id) with ON DELETE SET NULL, which sounds like deleting a
-- team would just null out that column — but `TRUNCATE teams CASCADE` does
-- NOT null it out, it truncates the ENTIRE profiles table, including the
-- preserved admin's row. An earlier version of this script hit exactly this
-- bug: the admin's profile was silently wiped by the teams truncate and had
-- to be restored by hand. This version captures the preserved admin's data
-- BEFORE any destructive statement runs, and unconditionally re-upserts it
-- afterward (see steps 0 and 4 below) — restoration is automatic and is
-- verified by hard assertions before the transaction is allowed to commit,
-- so this class of bug can no longer pass silently.
--
-- Other tables referencing teams(id) — representatives.team_id and
-- kpi_values.team_id — are NOT at risk the same way: both are already
-- explicitly truncated earlier in step 1, in the same statement as every
-- other table that depends on them, so by the time `TRUNCATE teams CASCADE`
-- runs there is nothing left in either table for it to surprise us with.
-- profiles was the only table with a live reference to teams(id) that
-- wasn't already accounted for elsewhere in this script.
--
-- Usage:
--   1. Verify the target: confirm you are connected to the intended DEV/TEST
--      Supabase project, not production. Check the project URL/ref before
--      going any further.
--   2. Take a backup of the target database (a Supabase point-in-time
--      snapshot, or `pg_dump`) before running this, even in dev.
--   3. Edit keep_admin_email below to the exact email of the admin account
--      that should survive the reset. Their password/login is untouched —
--      their profile is captured before the reset and restored afterward on
--      a clean baseline (team_id/manager_id/representative_id = null,
--      active = true, must_change_password = false — see step 4 below).
--      Never leave this as the placeholder — there is no "guess the first
--      admin" fallback, by design.
--   4. Edit confirm_destructive_reset below to the exact literal value
--      'RESET_DEVELOPMENT_DATA'. This is a second, independent guard on top
--      of the admin email — both must be set correctly or the whole
--      transaction aborts with nothing changed.
--   5. Optionally flip keep_teams to true if you want to keep the current
--      team roster (names/managers) instead of wiping it along with
--      everything else. Defaults to false (full wipe) — a full clean reset,
--      including the existing team roster, is the intended default use.
--      Note: even with keep_teams = true, the preserved admin's OWN profile
--      still comes back with team_id = null (a clean, unaffiliated admin
--      baseline) — only the team rows themselves survive.
--   6. Run the pre-flight count first if you want to review it in isolation
--      (it also runs automatically as part of the script, before anything
--      is deleted — check the NOTICE output).
--   7. Review the selected admin one more time before executing — the
--      NOTICE line the guard prints ("Reset will preserve admin ...") is
--      your last checkpoint.
--   8. Execute ONLY from the Supabase SQL Editor or a direct psql/service-
--      role connection (a role that bypasses RLS):
--        psql "$DATABASE_URL" -f supabase/seed_reset_dev.sql
--   9. The script verifies its own result before committing (step 5, "Post-
--      reset assertions") — if anything is off, the whole transaction rolls
--      back and you'll see a RAISE EXCEPTION explaining what failed. A
--      script that reaches COMMIT has already proven the preserved admin is
--      intact and clean; you do not need to manually re-verify, but the
--      queries at the bottom of this file are there if you want to.
--
-- What this does NOT do:
--   - Reset any ID sequence. Every table in this schema uses a UUID primary
--     key (gen_random_uuid()) — there is no SERIAL/BIGSERIAL/IDENTITY column
--     anywhere in the schema, so there is nothing to reset. New rows already
--     get a fresh random id with no dependency on what existed before.
-- ============================================================================

BEGIN;

-- ---- Safety guards ------------------------------------------------------
-- Two independent, explicit confirmations are required. Either one left at
-- its placeholder value aborts the ENTIRE transaction — nothing is changed.
-- There is no default admin, no "first admin found" fallback, and no way
-- for this script to run destructively by accident.
DO $$
DECLARE
  keep_admin_email          text    := 'REPLACE_ME@yourcompany.com'; -- <-- set this first
  confirm_destructive_reset text    := 'REPLACE_ME';                 -- <-- must equal 'RESET_DEVELOPMENT_DATA'
  keep_teams                boolean := false;                        -- <-- optional: true to keep team roster
  keep_admin_id             uuid;
BEGIN
  IF confirm_destructive_reset IS DISTINCT FROM 'RESET_DEVELOPMENT_DATA' THEN
    RAISE EXCEPTION 'Set confirm_destructive_reset to the exact literal ''RESET_DEVELOPMENT_DATA'' before running this script. Nothing was changed.';
  END IF;

  IF keep_admin_email = 'REPLACE_ME@yourcompany.com' THEN
    RAISE EXCEPTION 'Set keep_admin_email to a real admin email before running this script. Nothing was changed.';
  END IF;

  SELECT u.id INTO keep_admin_id
  FROM auth.users u
  JOIN public.user_roles r ON r.user_id = u.id AND r.role = 'admin'
  WHERE u.email = keep_admin_email;

  IF keep_admin_id IS NULL THEN
    RAISE EXCEPTION 'No admin account found for %. Aborting — nothing was changed.', keep_admin_email;
  END IF;

  PERFORM set_config('pulse_reset.keep_admin_id', keep_admin_id::text, false);
  PERFORM set_config('pulse_reset.keep_admin_email', keep_admin_email, false);
  PERFORM set_config('pulse_reset.keep_teams', keep_teams::text, false);

  RAISE NOTICE 'Reset will preserve admin % (id=%). keep_teams=%.', keep_admin_email, keep_admin_id, keep_teams;
END $$;

-- ---- 0. Capture the preserved admin's data BEFORE anything is destroyed --
-- Snapshotted from auth.users, public.profiles, and public.user_roles while
-- the database is still fully intact — this is what step 4 restores from,
-- regardless of what any later TRUNCATE ... CASCADE turns out to touch. A
-- temp table survives TRUNCATE/DELETE on unrelated tables and is dropped
-- automatically when this transaction ends (COMMIT or ROLLBACK either way),
-- so it never leaves anything behind.
CREATE TEMP TABLE pulse_reset_admin_snapshot ON COMMIT DROP AS
SELECT
  u.id                                     AS user_id,
  u.email                                  AS user_email,
  p.full_name                              AS full_name,
  EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE r.user_id = u.id AND r.role = 'admin'
  )                                        AS had_admin_role
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE u.id = current_setting('pulse_reset.keep_admin_id')::uuid;

DO $$
BEGIN
  IF (SELECT count(*) FROM pulse_reset_admin_snapshot) <> 1 THEN
    RAISE EXCEPTION 'Failed to snapshot the preserved admin before the reset. Aborting — nothing was changed.';
  END IF;
END $$;

-- ---- Pre-flight audit (row counts before anything is destroyed) -------
DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'kpi_values','feedback','listening_schedules','rep_notes','rep_tasks',
    'manager_calls','underwriting_issues','competition_scores',
    'competition_categories','competitions','comms_messages','comms_templates',
    'import_history','import_templates','notifications','morning_checklist',
    'morning_settings','activity_events','audit_log','announcements',
    'articles','ideas','representatives','teams'
  ]
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    RAISE NOTICE '  % : % row(s) will be removed', rpad(t, 24), n;
  END LOOP;
END $$;

-- ---- 1. Operational & history data (public schema) ---------------------
-- Explicit, reviewed list — not a blanket "every table in public". CASCADE
-- is a safety net for any FK relationship not already covered by this list,
-- not the primary mechanism (every table that should be wiped is named).
-- Schema, migrations, RLS policies, functions, and triggers are untouched —
-- this is DML only.
TRUNCATE TABLE
  public.kpi_values,
  public.feedback,
  public.listening_schedules,
  public.rep_notes,
  public.rep_tasks,
  public.manager_calls,
  public.underwriting_issues,
  public.competition_scores,
  public.competition_categories,
  public.competitions,
  public.comms_messages,
  public.comms_templates,
  public.import_history,
  public.import_templates,
  public.notifications,
  public.morning_checklist,
  public.morning_settings,
  public.activity_events,
  public.audit_log,
  public.announcements,
  public.articles,
  public.ideas,
  public.representatives
  CASCADE;

-- Teams are wiped by default (full "pristine" reset, including the existing
-- team roster) unless keep_teams was set to true above. This is the one
-- statement in the script that can cascade into public.profiles (see the
-- "IMPORTANT" note at the top) — step 4 unconditionally repairs that.
DO $$
BEGIN
  IF NOT current_setting('pulse_reset.keep_teams')::boolean THEN
    TRUNCATE TABLE public.teams CASCADE;
  ELSE
    RAISE NOTICE 'keep_teams=true — team roster left untouched.';
  END IF;
END $$;

-- ---- 2. Non-preserved login accounts -----------------------------------
-- Deleting from auth.users (not public.profiles) is the only correct way to
-- remove a login account — it cascades to public.profiles and
-- public.user_roles (ON DELETE CASCADE) AND to Supabase's own
-- auth.identities/auth.sessions/auth.refresh_tokens, which a delete scoped
-- to public.profiles alone would never touch, leaving orphaned auth state.
-- The selected admin's own row is excluded and left completely untouched.
DELETE FROM auth.users
WHERE id <> current_setting('pulse_reset.keep_admin_id')::uuid;

-- ---- 3. Restore the admin role, in case it was ever affected -----------
-- user_roles is never touched by any TRUNCATE CASCADE in this script (it
-- only references auth.users, not teams or representatives) and step 2's
-- DELETE explicitly excludes the preserved admin — so this is normally a
-- no-op. It exists purely as defense in depth: if the role is ever missing
-- for any reason, this puts it back rather than leaving a login with no
-- role and no automatic recovery.
INSERT INTO public.user_roles (user_id, role)
SELECT user_id, 'admin'::public.app_role
FROM pulse_reset_admin_snapshot
WHERE had_admin_role
ON CONFLICT (user_id, role) DO NOTHING;

-- ---- 4. Recreate/reset the preserved admin's profile — unconditionally -
-- Upsert, not UPDATE: an UPDATE ... WHERE id = ... is exactly what silently
-- did nothing in the bug this fixes, because by the time it ran the row no
-- longer existed — zero rows matched, zero rows updated, no error, no
-- signal anything was wrong. INSERT ... ON CONFLICT DO UPDATE is correct
-- whether the teams truncate removed the row (INSERT path) or the row
-- survived untouched, e.g. keep_teams = true (UPDATE path) — either way the
-- result is the same clean baseline. full_name/email come from the
-- pre-reset snapshot (step 0) so the admin's own display name and email
-- survive; every other field is the explicit clean baseline.
INSERT INTO public.profiles (
  id, full_name, email, representative_id, manager_id, team_id, active, must_change_password
)
SELECT
  user_id, full_name, user_email, NULL, NULL, NULL, true, false
FROM pulse_reset_admin_snapshot
ON CONFLICT (id) DO UPDATE SET
  full_name            = EXCLUDED.full_name,
  email                = EXCLUDED.email,
  representative_id    = NULL,
  manager_id           = NULL,
  team_id              = NULL,
  active               = true,
  must_change_password = false;

-- ---- 5. Post-reset assertions — abort the whole transaction if not clean
-- Every one of these must hold before the reset is allowed to commit. Any
-- failure here rolls back everything in this script, not just this step —
-- a partially-applied reset is worse than no reset at all.
DO $$
DECLARE
  keep_admin_id    uuid := current_setting('pulse_reset.keep_admin_id')::uuid;
  keep_admin_email text := current_setting('pulse_reset.keep_admin_email');
  user_count       bigint;
  profile_count    bigint;
  admin_role_count bigint;
  p                record;
BEGIN
  SELECT count(*) INTO user_count FROM auth.users;
  IF user_count <> 1 THEN
    RAISE EXCEPTION 'Post-reset assertion failed: expected exactly 1 auth.users row, found %. Rolling back.', user_count;
  END IF;

  SELECT count(*) INTO profile_count FROM public.profiles;
  IF profile_count <> 1 THEN
    RAISE EXCEPTION 'Post-reset assertion failed: expected exactly 1 profiles row, found %. Rolling back.', profile_count;
  END IF;

  SELECT count(*) INTO admin_role_count FROM public.user_roles WHERE role = 'admin';
  IF admin_role_count <> 1 THEN
    RAISE EXCEPTION 'Post-reset assertion failed: expected exactly 1 admin role, found %. Rolling back.', admin_role_count;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = keep_admin_id AND email = keep_admin_email) THEN
    RAISE EXCEPTION 'Post-reset assertion failed: the remaining auth.users row does not match the preserved admin (%). Rolling back.', keep_admin_email;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = keep_admin_id) THEN
    RAISE EXCEPTION 'Post-reset assertion failed: the remaining profiles row does not match the preserved admin (%). Rolling back.', keep_admin_email;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = keep_admin_id AND role = 'admin') THEN
    RAISE EXCEPTION 'Post-reset assertion failed: the remaining admin role does not belong to the preserved admin (%). Rolling back.', keep_admin_email;
  END IF;

  SELECT * INTO p FROM public.profiles WHERE id = keep_admin_id;
  IF p.active IS NOT TRUE THEN
    RAISE EXCEPTION 'Post-reset assertion failed: preserved admin profile is not active. Rolling back.';
  END IF;
  IF p.team_id IS NOT NULL OR p.manager_id IS NOT NULL OR p.representative_id IS NOT NULL THEN
    RAISE EXCEPTION 'Post-reset assertion failed: preserved admin profile still has a team/manager/representative link (team_id=%, manager_id=%, representative_id=%). Rolling back.',
      p.team_id, p.manager_id, p.representative_id;
  END IF;

  RAISE NOTICE 'Post-reset assertions passed: exactly one preserved admin (%) remains, with a clean, active profile.', keep_admin_email;
END $$;

COMMIT;

-- ---- Post-reset verification (optional — the script already asserted this
-- before allowing the COMMIT above; these are here for your own review) ---
--   SELECT email FROM auth.users;                       -- exactly one row
--   SELECT * FROM public.user_roles;                     -- exactly one 'admin' row
--   SELECT * FROM public.profiles;                       -- exactly one row: active, team_id/manager_id/representative_id all null
--   SELECT count(*) FROM public.representatives;         -- 0
--   SELECT count(*) FROM public.teams;                   -- 0 (unless keep_teams was true)
