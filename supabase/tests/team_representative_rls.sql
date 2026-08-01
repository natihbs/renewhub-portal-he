-- Regression coverage for scenarios 1-6 and 9 of the team/representative fix
-- (see the PR description). This is a plain-SQL assertion script — no pgTAP
-- extension required — meant to run against a real (local or staging)
-- Supabase/Postgres project with the full migration history applied.
--
-- NOT executed as part of this change: this sandbox has no reachable
-- Supabase/Postgres instance (no `supabase` CLI, no local stack running).
-- Run it with:
--   psql "$DATABASE_URL" -f supabase/tests/team_representative_rls.sql
--
-- It creates its own throwaway auth.users/teams/representatives rows and
-- cleans them up at the end, so it's safe to run against a scratch/staging DB
-- (do NOT run against production data).

begin;

-- ---------- fixtures: two managers, one representative account, one team ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'manager-a@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'manager-b@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'rep-account@test.local')
on conflict (id) do nothing;

insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'manager'),
  ('00000000-0000-0000-0000-0000000000a2', 'manager'),
  ('00000000-0000-0000-0000-0000000000a3', 'representative')
on conflict do nothing;

-- Scenario 1: admin creates a new, generically-named team (no car/home in sight).
insert into public.teams (id, name, manager_id, active)
values ('00000000-0000-0000-0000-0000000000b1', 'Retention Squad North', '00000000-0000-0000-0000-0000000000a1', true)
on conflict (id) do nothing;

-- Scenario 2: admin creates a representative assigned to that team via team_id
-- (team_key intentionally omitted — it's deprecated, see migration
-- 20260801163005_drop_representatives_team_key_check.sql).
insert into public.representatives (id, name, team_id, monthly_target, current_result, user_id, active)
values ('00000000-0000-0000-0000-0000000000c1', 'Test Rep', '00000000-0000-0000-0000-0000000000b1', 100, 0, '00000000-0000-0000-0000-0000000000a3', true)
on conflict (id) do nothing;

update public.profiles set team_id = '00000000-0000-0000-0000-0000000000b1'
where id = '00000000-0000-0000-0000-0000000000a3';

-- Scenario 3: "refresh" == re-select from a fresh transaction-local read; the
-- row must be there with team_id intact (nothing in this fix should have made
-- team_id transient).
do $$
declare v_team_id uuid;
begin
  select team_id into v_team_id from public.representatives where id = '00000000-0000-0000-0000-0000000000c1';
  if v_team_id is distinct from '00000000-0000-0000-0000-0000000000b1' then
    raise exception 'FAIL scenario 3: representative.team_id did not persist (%).', v_team_id;
  end if;
  raise notice 'PASS scenario 1-3: team created, rep created with team_id, persists on reselect';
end $$;

-- Scenario 4: the assigned manager (manager-a) can see the representative via RLS.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
set local role authenticated;
do $$
declare v_count int;
begin
  select count(*) into v_count from public.representatives where id = '00000000-0000-0000-0000-0000000000c1';
  if v_count <> 1 then
    raise exception 'FAIL scenario 4: manager-a (assigned to the team) cannot see the representative via RLS.';
  end if;
  raise notice 'PASS scenario 4: assigned manager sees the representative';
end $$;
reset role;

-- Scenario 5: a DIFFERENT manager (manager-b, not assigned to this team) must NOT see it.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
set local role authenticated;
do $$
declare v_count int;
begin
  select count(*) into v_count from public.representatives where id = '00000000-0000-0000-0000-0000000000c1';
  if v_count <> 0 then
    raise exception 'FAIL scenario 5: manager-b (NOT assigned to this team) can see the representative — RLS leak.';
  end if;
  raise notice 'PASS scenario 5: unrelated manager cannot see the representative';
end $$;
reset role;

-- Scenario 6: the representative's own account sees only its own row.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
set local role authenticated;
do $$
declare v_count int; v_other_count int;
begin
  select count(*) into v_count from public.representatives where id = '00000000-0000-0000-0000-0000000000c1';
  if v_count <> 1 then
    raise exception 'FAIL scenario 6: representative cannot see its own row.';
  end if;
  select count(*) into v_other_count from public.representatives where id <> '00000000-0000-0000-0000-0000000000c1';
  if v_other_count <> 0 then
    raise exception 'FAIL scenario 6: representative can see OTHER representatives'' rows — RLS leak.';
  end if;
  raise notice 'PASS scenario 6: representative sees only its own row';
end $$;
reset role;

-- Scenario 9: "another authenticated session sees the updated value" — simulated
-- here as: an update committed by one role is immediately visible to another
-- role's SELECT within the same DB (this is inherent to Postgres MVCC once the
-- writing transaction commits; the real end-to-end version of this scenario —
-- Performance/Import writes going through updateRepresentativeMetrics and a
-- second browser session polling listRepresentatives — needs to be verified
-- against a running app, not just SQL).
update public.representatives set current_result = 42 where id = '00000000-0000-0000-0000-0000000000c1';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
set local role authenticated;
do $$
declare v_result int;
begin
  select current_result into v_result from public.representatives where id = '00000000-0000-0000-0000-0000000000c1';
  if v_result <> 42 then
    raise exception 'FAIL scenario 9: updated current_result not visible to a different authenticated role.';
  end if;
  raise notice 'PASS scenario 9: update is visible cross-session at the DB layer';
end $$;
reset role;

rollback; -- never commit the fixtures
