-- Regression coverage for supabase/migrations/20260803210000_notify_feedback_published.sql:
--   1. Publishing feedback (published false -> true) for a rep WITH a linked
--      user account inserts exactly one notifications row for that user.
--   2. Updating an already-published row again does not insert a duplicate.
--   3. Publishing feedback for a rep with NO linked user account (user_id
--      NULL) does not error and inserts no notification (nowhere to land).
--
-- NOT executed as part of this change: this sandbox has no reachable
-- Supabase/Postgres instance. Run it with:
--   psql "$DATABASE_URL" -f supabase/tests/notify_feedback_published.sql
-- against a scratch/staging database (it inserts and rolls back its own
-- fixtures — do NOT run against production data).

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'notify-test-rep@test.local')
on conflict (id) do nothing;
insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'representative')
on conflict do nothing;

insert into public.teams (id, name, active)
values ('00000000-0000-0000-0000-0000000000a2', 'Notify Test Team', true)
on conflict (id) do nothing;

-- Rep with a linked account.
insert into public.representatives (id, name, team_id, user_id, active)
values ('00000000-0000-0000-0000-0000000000a3', 'Linked Rep', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', true)
on conflict (id) do nothing;

-- Rep with no linked account.
insert into public.representatives (id, name, team_id, user_id, active)
values ('00000000-0000-0000-0000-0000000000a4', 'Unlinked Rep', '00000000-0000-0000-0000-0000000000a2', null, true)
on conflict (id) do nothing;

insert into public.feedback (id, representative_id, score, call_id, listener, feedback_date, published)
values ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000a3', 80, 'NOTIFY-TEST-1', 'Tester', '2026-08-01', false)
on conflict (id) do update set published = false;

insert into public.feedback (id, representative_id, score, call_id, listener, feedback_date, published)
values ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000a4', 80, 'NOTIFY-TEST-2', 'Tester', '2026-08-01', false)
on conflict (id) do update set published = false;

-- Clean slate for the assertions below.
delete from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a1';

-- Step 1: publishing a linked rep's feedback inserts exactly one notification.
update public.feedback set published = true where id = '00000000-0000-0000-0000-0000000000a5';

do $$
declare v_count int;
begin
  select count(*) into v_count from public.notifications
    where user_id = '00000000-0000-0000-0000-0000000000a1' and kind = 'feedback';
  if v_count <> 1 then
    raise exception 'FAIL: expected exactly 1 notification after publish, found %', v_count;
  end if;
  raise notice 'PASS: publishing feedback for a linked rep inserted exactly one notification.';
end $$;

-- Step 2: re-saving an already-published row must not insert a duplicate.
update public.feedback set manager_summary = 'edited after publish' where id = '00000000-0000-0000-0000-0000000000a5';

do $$
declare v_count int;
begin
  select count(*) into v_count from public.notifications
    where user_id = '00000000-0000-0000-0000-0000000000a1' and kind = 'feedback';
  if v_count <> 1 then
    raise exception 'FAIL: expected still exactly 1 notification after a no-op re-save, found %', v_count;
  end if;
  raise notice 'PASS: editing an already-published row did not insert a duplicate notification.';
end $$;

-- Step 3: publishing feedback for a rep with no linked account must not error
-- and must insert nothing.
update public.feedback set published = true where id = '00000000-0000-0000-0000-0000000000a6';

do $$
declare v_count int;
begin
  select count(*) into v_count from public.notifications where kind = 'feedback' and body like '%NOTIFY-TEST-2%';
  if v_count <> 0 then
    raise exception 'FAIL: expected no notification for an unlinked rep, found %', v_count;
  end if;
  raise notice 'PASS: publishing feedback for an unlinked rep inserted no notification and did not error.';
end $$;

rollback; -- never commit the fixtures
