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
-- Usage:
--   1. Verify the target: confirm you are connected to the intended DEV/TEST
--      Supabase project, not production. Check the project URL/ref before
--      going any further.
--   2. Take a backup of the target database (a Supabase point-in-time
--      snapshot, or `pg_dump`) before running this, even in dev.
--   3. Edit keep_admin_email below to the exact email of the admin account
--      that should survive the reset. Their password/login is untouched —
--      only their profile is reset to a clean baseline (see step 3 of the
--      script below). Never leave this as the placeholder — there is no
--      "guess the first admin" fallback, by design.
--   4. Edit confirm_destructive_reset below to the exact literal value
--      'RESET_DEVELOPMENT_DATA'. This is a second, independent guard on top
--      of the admin email — both must be set correctly or the whole
--      transaction aborts with nothing changed.
--   5. Optionally flip keep_teams to true if you want to keep the current
--      team roster (names/managers) instead of wiping it along with
--      everything else. Defaults to false (full wipe) — a full clean reset,
--      including the existing team roster, is the intended default use.
--   6. Run the pre-flight count first if you want to review it in isolation
--      (it also runs automatically as part of the script, before anything
--      is deleted — check the NOTICE output).
--   7. Review the selected admin one more time before executing — the
--      NOTICE line the guard prints ("Reset will preserve admin ...") is
--      your last checkpoint.
--   8. Execute ONLY from the Supabase SQL Editor or a direct psql/service-
--      role connection (a role that bypasses RLS):
--        psql "$DATABASE_URL" -f supabase/seed_reset_dev.sql
--   9. Afterwards, verify the post-reset state using the queries at the
--      bottom of this file (exactly one login, exactly one admin role,
--      zero representatives, etc.).
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
  PERFORM set_config('pulse_reset.keep_teams', keep_teams::text, false);

  RAISE NOTICE 'Reset will preserve admin % (id=%). keep_teams=%.', keep_admin_email, keep_admin_id, keep_teams;
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
-- team roster) unless keep_teams was set to true above.
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

-- ---- 3. Reset the preserved admin's profile to a clean baseline --------
-- team_id/manager_id are already NULL by this point (ON DELETE SET NULL
-- fired automatically when their team/manager, if any, was removed above).
-- representative_id is a legacy plain-text column with no FK — it needs an
-- explicit clear so it can't point at a representative that no longer
-- exists. must_change_password is left as-is so the preserved login keeps
-- working exactly as it does today.
UPDATE public.profiles
SET representative_id = NULL
WHERE id = current_setting('pulse_reset.keep_admin_id')::uuid;

COMMIT;

-- ---- Post-reset verification --------------------------------------------
-- Reconnect and confirm:
--   SELECT email FROM auth.users;                    -- exactly one row
--   SELECT * FROM public.user_roles;                  -- exactly one 'admin' row
--   SELECT count(*) FROM public.representatives;       -- 0
--   SELECT count(*) FROM public.teams;                 -- 0 (unless keep_teams was true)
