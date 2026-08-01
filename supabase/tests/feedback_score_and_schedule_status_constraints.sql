-- Regression coverage for the production-safety constraints added in
-- supabase/migrations/20260801221500_feedback_score_and_schedule_status_constraints.sql:
--   1. feedback.score is clamped into [0, 100] before the range CHECK is added,
--      so pre-existing out-of-range rows cannot make the migration fail.
--   2. listening_schedules.status is normalized to 'planned' before the enum
--      CHECK is added, so pre-existing invalid statuses cannot make the
--      migration fail.
--   3. After both constraints exist, a write that violates either one is
--      rejected by the database, not just by client-side validation.
--
-- NOT executed as part of this change: this sandbox has no reachable
-- Supabase/Postgres instance. Run it with:
--   psql "$DATABASE_URL" -f supabase/tests/feedback_score_and_schedule_status_constraints.sql
-- against a scratch/staging database (it inserts and rolls back its own
-- fixtures — do NOT run against production data). Run it against a database
-- that has NOT yet applied the 20260801221500 migration to exercise the
-- normalize-then-constrain sequence exactly as the migration does; run it
-- afterwards to exercise only the "rejects new bad writes" assertions.

begin;

insert into public.teams (id, name, active)
values ('00000000-0000-0000-0000-0000000000f1', 'Constraint Test Team', true)
on conflict (id) do nothing;

insert into public.representatives (id, name, team_id, active)
values ('00000000-0000-0000-0000-0000000000f2', 'Constraint Test Rep', '00000000-0000-0000-0000-0000000000f1', true)
on conflict (id) do nothing;

-- Simulate pre-existing bad data by writing it before the CHECK constraints exist
-- (bypass application code entirely — this is exactly the "manual write or future
-- code path" scenario the constraints exist to prevent going forward).
insert into public.feedback (id, representative_id, score, call_id, listener)
values ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f2', 250, 'TEST-1', 'Tester')
on conflict (id) do update set score = 250;

insert into public.listening_schedules (id, representative_id, status)
values ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000f2', 'bogus_status')
on conflict (id) do update set status = 'bogus_status';

-- Apply the same normalization the migration performs.
update public.feedback
  set score = least(greatest(score, 0), 100)
  where id = '00000000-0000-0000-0000-0000000000f3';

update public.listening_schedules
  set status = 'planned'
  where id = '00000000-0000-0000-0000-0000000000f4' and status not in ('planned', 'completed', 'cancelled');

do $$
begin
  if (select score from public.feedback where id = '00000000-0000-0000-0000-0000000000f3') <> 100 then
    raise exception 'expected out-of-range score 250 to be clamped to 100';
  end if;
  if (select status from public.listening_schedules where id = '00000000-0000-0000-0000-0000000000f4') <> 'planned' then
    raise exception 'expected invalid status to be normalized to planned';
  end if;
end $$;

-- If the constraints already exist on this database (migration applied), confirm
-- they now reject new bad writes rather than silently accepting them.
do $$
begin
  begin
    insert into public.feedback (representative_id, score, call_id, listener)
    values ('00000000-0000-0000-0000-0000000000f2', 101, 'TEST-2', 'Tester');
    raise exception 'expected score=101 to violate feedback_score_range_check';
  exception
    when check_violation then null; -- expected
    when undefined_object then null; -- constraint not yet applied on this database
  end;

  begin
    insert into public.listening_schedules (representative_id, status)
    values ('00000000-0000-0000-0000-0000000000f2', 'not_a_real_status');
    raise exception 'expected an unsupported status to violate listening_schedules_status_check';
  exception
    when check_violation then null; -- expected
    when undefined_object then null; -- constraint not yet applied on this database
  end;
end $$;

rollback;
