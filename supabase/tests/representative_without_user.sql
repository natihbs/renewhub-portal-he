-- Regression coverage for: "representative without a user account does not
-- appear inside its assigned team." Exercises the full sequence end to end
-- against the real schema: create team, create representative with team_id
-- set and user_id NULL, verify membership, link a user, unlink it, and
-- confirm the team assignment never changes as a side effect of linking.
--
-- NOT executed as part of this change: this sandbox has no reachable
-- Supabase/Postgres instance. Run it with:
--   psql "$DATABASE_URL" -f supabase/tests/representative_without_user.sql
-- against a scratch/staging database (it inserts and rolls back its own
-- fixtures — do NOT run against production data).

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'rep-owner-account@test.local')
on conflict (id) do nothing;
insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'representative')
on conflict do nothing;

insert into public.teams (id, name, active)
values ('00000000-0000-0000-0000-0000000000e1', 'No-Account Rep Test Team', true)
on conflict (id) do nothing;

-- Step 1: create a representative with team_id set and user_id NULL — no
-- email, no auth account, exactly the reported repro case.
insert into public.representatives (id, name, team_id, monthly_target, current_result, user_id, active)
values ('00000000-0000-0000-0000-0000000000f1', 'No-Account Rep', '00000000-0000-0000-0000-0000000000e1', 100, 0, null, true)
on conflict (id) do nothing;

-- Step 2: verify team membership comes from representatives.team_id alone —
-- confirm there is deliberately NO profiles row backing this representative.
do $$
declare v_team_id uuid; v_profile_count int;
begin
  select team_id into v_team_id from public.representatives where id = '00000000-0000-0000-0000-0000000000f1';
  if v_team_id is distinct from '00000000-0000-0000-0000-0000000000e1' then
    raise exception 'FAIL: representative.team_id not saved for a rep with no user account.';
  end if;
  select count(*) into v_profile_count from public.profiles where representative_id = '00000000-0000-0000-0000-0000000000f1'::text;
  if v_profile_count <> 0 then
    raise exception 'FAIL (test setup broken): expected no profiles row for this rep.';
  end if;
  raise notice 'PASS: representative with user_id NULL has team_id set, and no profiles row exists (as expected).';
end $$;

-- Step 3: "refresh/re-fetch" — a fresh SELECT in the same session must still
-- return it (this is the exact query shape the fixed getTeamDetails uses).
do $$
declare v_count int;
begin
  select count(*) into v_count
  from public.representatives
  where team_id = '00000000-0000-0000-0000-0000000000e1' and id = '00000000-0000-0000-0000-0000000000f1';
  if v_count <> 1 then
    raise exception 'FAIL: representative not found when re-querying by team_id (this is exactly the app''s getTeamDetails/listTeams query shape).';
  end if;
  raise notice 'PASS: representative reselected successfully by team_id.';
end $$;

-- Step 4: link a user account. Team assignment must not change or duplicate.
update public.representatives set user_id = '00000000-0000-0000-0000-0000000000d1'
where id = '00000000-0000-0000-0000-0000000000f1';

do $$
declare v_team_id uuid; v_rep_count int;
begin
  select team_id into v_team_id from public.representatives where id = '00000000-0000-0000-0000-0000000000f1';
  if v_team_id is distinct from '00000000-0000-0000-0000-0000000000e1' then
    raise exception 'FAIL: linking a user account changed the team assignment.';
  end if;
  select count(*) into v_rep_count from public.representatives where team_id = '00000000-0000-0000-0000-0000000000e1';
  if v_rep_count <> 1 then
    raise exception 'FAIL: linking a user account duplicated the representative''s team membership (found % rows).', v_rep_count;
  end if;
  raise notice 'PASS: linking a user account left team_id unchanged, no duplication.';
end $$;

-- Step 5: unlink the user account. Team assignment must survive.
update public.representatives set user_id = null
where id = '00000000-0000-0000-0000-0000000000f1';

do $$
declare v_team_id uuid;
begin
  select team_id into v_team_id from public.representatives where id = '00000000-0000-0000-0000-0000000000f1';
  if v_team_id is distinct from '00000000-0000-0000-0000-0000000000e1' then
    raise exception 'FAIL: unlinking the user account removed the representative from its team.';
  end if;
  raise notice 'PASS: unlinking the user account left the team assignment unchanged.';
end $$;

rollback; -- never commit the fixtures
