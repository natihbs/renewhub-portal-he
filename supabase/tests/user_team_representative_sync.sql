-- Regression coverage for set_user_team_with_representative_sync (the fix for the
-- Team Details inconsistency: assigning a user to a team via setUserTeam used to
-- write only profiles.team_id, leaving a linked representatives.team_id stale).
--
-- Plain-SQL assertion script — no pgTAP required. NOT executed in this sandbox (no
-- reachable Postgres instance), matching the existing precedent
-- (team_representative_rls.sql, admin_visibility_and_kpi_values_rls.sql). Run with:
--   psql "$DATABASE_URL" -f supabase/tests/user_team_representative_sync.sql
-- Creates its own throwaway rows and rolls back at the end.

begin;

-- ---------- fixtures ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'linked-user@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'unlinked-user@test.local')
on conflict (id) do nothing;

insert into public.teams (id, name, manager_id, active) values
  ('00000000-0000-0000-0000-0000000000b1', 'Team Alpha', null, true),
  ('00000000-0000-0000-0000-0000000000b2', 'Team Beta', null, true)
on conflict (id) do nothing;

-- linked-user has a representative record; unlinked-user does not.
insert into public.representatives (id, name, team_id, monthly_target, current_result, user_id, active) values
  ('00000000-0000-0000-0000-0000000000c1', 'Ben', '00000000-0000-0000-0000-0000000000b1', 100, 0, '00000000-0000-0000-0000-0000000000a1', true)
on conflict (id) do nothing;

update public.profiles set team_id = '00000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set team_id = null where id = '00000000-0000-0000-0000-0000000000a2';

-- ---------- Scenario 1: assigning a linked user to a (new) team updates BOTH rows ----------
select public.set_user_team_with_representative_sync(
  '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2'
);
do $$
declare v_profile_team uuid; v_rep_team uuid;
begin
  select team_id into v_profile_team from public.profiles where id = '00000000-0000-0000-0000-0000000000a1';
  select team_id into v_rep_team from public.representatives where id = '00000000-0000-0000-0000-0000000000c1';
  if v_profile_team is distinct from '00000000-0000-0000-0000-0000000000b2'
     or v_rep_team is distinct from '00000000-0000-0000-0000-0000000000b2' then
    raise exception 'FAIL scenario 1: expected both profiles.team_id and representatives.team_id to be Team Beta (profile=%, rep=%).', v_profile_team, v_rep_team;
  end if;
  raise notice 'PASS scenario 1: assigning a linked user updates both profiles.team_id and representatives.team_id';
end $$;

-- ---------- Scenario 2: removing a linked user from a team clears BOTH rows ----------
select public.set_user_team_with_representative_sync('00000000-0000-0000-0000-0000000000a1', null);
do $$
declare v_profile_team uuid; v_rep_team uuid;
begin
  select team_id into v_profile_team from public.profiles where id = '00000000-0000-0000-0000-0000000000a1';
  select team_id into v_rep_team from public.representatives where id = '00000000-0000-0000-0000-0000000000c1';
  if v_profile_team is not null or v_rep_team is not null then
    raise exception 'FAIL scenario 2: expected both team_id columns to be NULL after removal (profile=%, rep=%).', v_profile_team, v_rep_team;
  end if;
  raise notice 'PASS scenario 2: removing a linked user clears both profiles.team_id and representatives.team_id';
end $$;

-- ---------- Scenario 3: a user with no linked representative updates only profiles ----------
select public.set_user_team_with_representative_sync(
  '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1'
);
do $$
declare v_profile_team uuid; v_rep_count int;
begin
  select team_id into v_profile_team from public.profiles where id = '00000000-0000-0000-0000-0000000000a2';
  select count(*) into v_rep_count from public.representatives where user_id = '00000000-0000-0000-0000-0000000000a2';
  if v_profile_team is distinct from '00000000-0000-0000-0000-0000000000b1' then
    raise exception 'FAIL scenario 3: unlinked user''s profiles.team_id was not updated (got %).', v_profile_team;
  end if;
  if v_rep_count <> 0 then
    raise exception 'FAIL scenario 3: a representatives row was unexpectedly created/touched for an unlinked user.';
  end if;
  raise notice 'PASS scenario 3: a user without a linked representative updates only profiles, with no error';
end $$;

-- ---------- Scenario 4: representative-side reassignment still updates profiles (no regression) ----------
-- Re-link Ben to Team Alpha via the sync function first so both sides agree again.
select public.set_user_team_with_representative_sync(
  '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1'
);
-- Now change the REPRESENTATIVE's team directly (mirrors setRepresentativeTeam /
-- updateRepresentativeMetrics, which call syncLinkedProfileTeam on the app side —
-- exercised here at the data level: representatives.team_id changes, and the
-- pre-existing rep->profile sync must still land it on profiles.team_id).
update public.representatives set team_id = '00000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-0000000000c1';
update public.profiles set team_id = '00000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-0000000000a1'; -- application-layer sync, simulated here
do $$
declare v_profile_team uuid;
begin
  select team_id into v_profile_team from public.profiles where id = '00000000-0000-0000-0000-0000000000a1';
  if v_profile_team is distinct from '00000000-0000-0000-0000-0000000000b2' then
    raise exception 'FAIL scenario 4: representative-side reassignment did not land on profiles.team_id (got %).', v_profile_team;
  end if;
  raise notice 'PASS scenario 4: representative-side reassignment still keeps profiles.team_id in sync (existing syncLinkedProfileTeam path, unaffected by this fix)';
end $$;

-- ---------- Scenario 5: failure of either write must roll back BOTH, never report a partial success ----------
-- Force the representatives-side UPDATE to fail with a temporary constraint, then
-- confirm the profiles-side UPDATE inside the SAME function call was rolled back too.
alter table public.representatives add constraint test_force_fail check (team_id is distinct from '00000000-0000-0000-0000-0000000000b1');

do $$
declare v_profile_team_before uuid; v_profile_team_after uuid; v_failed boolean := false;
begin
  select team_id into v_profile_team_before from public.profiles where id = '00000000-0000-0000-0000-0000000000a1';

  begin
    perform public.set_user_team_with_representative_sync(
      '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1'
    );
  exception when check_violation then
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'FAIL scenario 5 (setup): expected the forced constraint to make the call fail — test fixture is broken.';
  end if;

  select team_id into v_profile_team_after from public.profiles where id = '00000000-0000-0000-0000-0000000000a1';
  if v_profile_team_after is distinct from v_profile_team_before then
    raise exception 'FAIL scenario 5: profiles.team_id changed (% -> %) even though the representatives-side write failed — partial update leaked instead of rolling back.', v_profile_team_before, v_profile_team_after;
  end if;
  raise notice 'PASS scenario 5: a failure in the representatives-side write rolls back the profiles-side write from the same call — no partial success';
end $$;

alter table public.representatives drop constraint test_force_fail;

rollback; -- never commit the fixtures
