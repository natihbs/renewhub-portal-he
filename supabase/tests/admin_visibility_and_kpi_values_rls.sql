-- Regression coverage for:
--   (1) admin visibility across teams/representatives/kpi_values must never depend
--       on profiles.team_id — only on the admin role itself;
--   (2) manager visibility stays scoped to teams they manage;
--   (3) representative visibility stays scoped to their own row;
--   (4) kpi_values RLS mirrors the same three-tier model.
-- Plain-SQL assertion script — no pgTAP required. NOT executed in this sandbox (no
-- reachable Postgres instance). Run with:
--   psql "$DATABASE_URL" -f supabase/tests/admin_visibility_and_kpi_values_rls.sql
-- Creates its own throwaway rows and rolls back at the end.

begin;

-- ---------- fixtures ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'admin-no-team@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'manager-x@test.local'),
  ('00000000-0000-0000-0000-0000000000d3', 'manager-y@test.local'),
  ('00000000-0000-0000-0000-0000000000d4', 'rep-x@test.local')
on conflict (id) do nothing;

insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'admin'),
  ('00000000-0000-0000-0000-0000000000d2', 'manager'),
  ('00000000-0000-0000-0000-0000000000d3', 'manager'),
  ('00000000-0000-0000-0000-0000000000d4', 'representative')
on conflict do nothing;

-- The admin's own profile.team_id is explicitly left NULL — visibility must not
-- depend on it at all.
insert into public.teams (id, name, manager_id, active, kpi_profile) values
  ('00000000-0000-0000-0000-0000000000e1', 'Team X (renewals)', '00000000-0000-0000-0000-0000000000d2', true, 'renewals'),
  ('00000000-0000-0000-0000-0000000000e2', 'Team Y (generic)', '00000000-0000-0000-0000-0000000000d3', true, 'generic_sales')
on conflict (id) do nothing;

insert into public.representatives (id, name, team_id, monthly_target, current_result, user_id, active) values
  ('00000000-0000-0000-0000-0000000000f1', 'Rep X', '00000000-0000-0000-0000-0000000000e1', 100, 60, '00000000-0000-0000-0000-0000000000d4', true)
on conflict (id) do nothing;

insert into public.kpi_values (id, representative_id, team_id, metric_date, renewal_opportunities, completed_renewals) values
  ('00000000-0000-0000-0000-00000000ff01', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', '2026-08-01', 20, 15)
on conflict (id) do nothing;

-- ---------- Scenario 1: admin (profile.team_id IS NULL) sees ALL teams ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
set local role authenticated;
do $$
declare v_count int; v_team_id_null boolean;
begin
  select (team_id is null) into v_team_id_null from public.profiles where id = '00000000-0000-0000-0000-0000000000d1';
  if v_team_id_null is distinct from true then
    raise exception 'FIXTURE FAIL: expected the admin fixture profile.team_id to be NULL for this scenario to be meaningful.';
  end if;
  select count(*) into v_count from public.teams where id in ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2');
  if v_count <> 2 then
    raise exception 'FAIL scenario 1: admin with team_id IS NULL does not see all teams (saw %).', v_count;
  end if;
  raise notice 'PASS scenario 1: admin sees all teams regardless of profiles.team_id';
end $$;
reset role;

-- ---------- Scenario 2: admin sees the representative and its kpi_values row ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
set local role authenticated;
do $$
declare v_reps int; v_kpi int;
begin
  select count(*) into v_reps from public.representatives where id = '00000000-0000-0000-0000-0000000000f1';
  select count(*) into v_kpi from public.kpi_values where id = '00000000-0000-0000-0000-00000000ff01';
  if v_reps <> 1 or v_kpi <> 1 then
    raise exception 'FAIL scenario 2: admin cannot see the representative (%) or its kpi_values row (%).', v_reps, v_kpi;
  end if;
  raise notice 'PASS scenario 2: admin sees the representative and its kpi_values row';
end $$;
reset role;

-- ---------- Scenario 3: manager-x (manages Team X) sees Team X's kpi_values, not Team Y's ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', true);
set local role authenticated;
do $$
declare v_count int;
begin
  select count(*) into v_count from public.kpi_values where id = '00000000-0000-0000-0000-00000000ff01';
  if v_count <> 1 then
    raise exception 'FAIL scenario 3: manager-x (manages Team X) cannot see Team X''s kpi_values row.';
  end if;
  raise notice 'PASS scenario 3: manager sees their managed team''s kpi_values';
end $$;
reset role;

-- ---------- Scenario 4: manager-y (manages Team Y, NOT Team X) must NOT see Team X's kpi_values ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d3', true);
set local role authenticated;
do $$
declare v_count int;
begin
  select count(*) into v_count from public.kpi_values where id = '00000000-0000-0000-0000-00000000ff01';
  if v_count <> 0 then
    raise exception 'FAIL scenario 4: manager-y (unrelated team) can see Team X''s kpi_values — RLS leak.';
  end if;
  raise notice 'PASS scenario 4: unrelated manager cannot see another team''s kpi_values';
end $$;
reset role;

-- ---------- Scenario 5: the representative sees only their own kpi_values row ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d4', true);
set local role authenticated;
do $$
declare v_count int;
begin
  select count(*) into v_count from public.kpi_values where representative_id = '00000000-0000-0000-0000-0000000000f1';
  if v_count <> 1 then
    raise exception 'FAIL scenario 5: representative cannot see their own kpi_values row.';
  end if;
  raise notice 'PASS scenario 5: representative sees their own kpi_values row';
end $$;
reset role;

-- ---------- Scenario 6: manager-y cannot write to Team X's kpi_values ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d3', true);
set local role authenticated;
do $$
begin
  begin
    update public.kpi_values set completed_renewals = 999 where id = '00000000-0000-0000-0000-00000000ff01';
    if found then
      raise exception 'FAIL scenario 6: manager-y (unrelated team) was able to update Team X''s kpi_values row — RLS leak.';
    end if;
  exception when insufficient_privilege then
    null; -- also an acceptable rejection
  end;
  raise notice 'PASS scenario 6: unrelated manager cannot write another team''s kpi_values';
end $$;
reset role;

rollback; -- never commit the fixtures
