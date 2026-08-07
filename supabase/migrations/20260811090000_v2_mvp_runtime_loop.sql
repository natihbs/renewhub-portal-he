-- Pulse v2 — PR #4: MVP runtime loop
--
-- Additive only. Closes the loop the previous three PRs built the pieces of:
-- inventory arrives, an operator is handed the next item, records what
-- happened, and coverage reflects it.
--
-- ERROR CODES, continuing the scheme:
--   P0040  attempt to record a derived state
--   P0041  work item missing, voided, or already concluded
--   P0042  the actor is not the item's owner

-- ===========================================================================
-- record_work_item_outcome
-- ===========================================================================
--
-- The atomic act of the whole business, and the only write path to
-- public.outcomes.
--
-- APPEND-ONLY IS ALREADY ENFORCED by the trigger from PR #1 — this function
-- cannot update or delete an outcome even if it wanted to. What it adds is the
-- three things a bare INSERT would not do:
--
--   1. REJECT DERIVED STATES. 'expired_unworked' is not in the column's CHECK
--      constraint, so an insert would fail with a constraint violation naming
--      a column. It is rejected HERE, first, with a message saying why the
--      state does not exist — because a caller who tries it has misunderstood
--      the model, and a constraint error will not tell them that.
--
--   2. TRANSITION THE ITEM. A resolving outcome closes the work item in the
--      same transaction. Recording the outcome and leaving the item open would
--      make the queue hand it back out, and would make every rate derived from
--      either one disagree with the other.
--
--   3. LOCK. Two operators dispositioning the same item concurrently would
--      otherwise both succeed, producing two independent "what happened"
--      records for one event.
--
-- A CORRECTION supersedes rather than overwrites, which is why _supersedes_id
-- exists rather than an update path.

DROP FUNCTION IF EXISTS public.record_work_item_outcome(uuid, uuid, uuid, text, text, numeric, uuid, text, timestamptz);
CREATE FUNCTION public.record_work_item_outcome(
  _work_item_id uuid,
  _actor_id uuid,
  _actor_representative_id uuid,
  _canonical_state text,
  _reason_code text,
  _value_realized numeric,
  _supersedes_id uuid,
  _correction_reason text,
  _occurred_at timestamptz DEFAULT now()
)
RETURNS TABLE (
  out_outcome_id uuid,
  out_work_item_id uuid,
  out_item_state text,
  out_resolving boolean,
  out_touch_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item record;
  v_id uuid;
  v_resolving boolean;
  v_touches integer;
BEGIN
  -- The derived state, rejected before anything else. Deliberately a distinct
  -- code and message rather than letting the CHECK constraint fire: silent
  -- loss is DERIVED from the absence of a record, and a caller trying to
  -- record it has misunderstood the model rather than mistyped a value.
  IF _canonical_state = 'expired_unworked' THEN
    RAISE EXCEPTION 'לא ניתן לרשום ''לא טופל בזמן'' — זהו מצב נגזר, המחושב מהיעדר רישום עד למועד היעד'
      USING ERRCODE = 'P0040';
  END IF;

  IF _canonical_state NOT IN
     ('resolved_positive', 'resolved_negative', 'pending_internal', 'pending_external', 'unreachable') THEN
    RAISE EXCEPTION 'מצב תוצאה לא מוכר: %', _canonical_state USING ERRCODE = 'P0040';
  END IF;

  SELECT w.id, w.state, w.owner_representative_id, w.work_type_id
    INTO v_item
  FROM public.work_items w WHERE w.id = _work_item_id
  FOR UPDATE;

  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'פריט העבודה לא נמצא' USING ERRCODE = 'P0041';
  END IF;
  IF v_item.state = 'voided' THEN
    RAISE EXCEPTION 'לא ניתן לרשום תוצאה לפריט שבוטל' USING ERRCODE = 'P0041';
  END IF;
  -- A concluded item may still receive a CORRECTION, but not a fresh outcome.
  IF v_item.state = 'resolved' AND _supersedes_id IS NULL THEN
    RAISE EXCEPTION 'הפריט כבר הוכרע — תיקון מחייב הפניה לרשומה הקודמת' USING ERRCODE = 'P0041';
  END IF;

  -- Ownership. The calling server function has already authorized the actor;
  -- this is the second line, and it is here because an outcome attributed to
  -- the wrong representative corrupts both coverage and every per-person
  -- figure downstream, silently and permanently.
  IF _actor_representative_id IS NOT NULL
     AND v_item.owner_representative_id IS NOT NULL
     AND _actor_representative_id <> v_item.owner_representative_id THEN
    RAISE EXCEPTION 'הפריט אינו משויך לנציג הרושם' USING ERRCODE = 'P0042';
  END IF;

  IF _supersedes_id IS NOT NULL AND (_correction_reason IS NULL OR btrim(_correction_reason) = '') THEN
    RAISE EXCEPTION 'תיקון תוצאה מחייב נימוק' USING ERRCODE = 'P0040';
  END IF;

  INSERT INTO public.outcomes (
    work_item_id, actor_id, actor_representative_id, canonical_state,
    reason_code, value_realized, occurred_at, supersedes_id, correction_reason)
  VALUES (
    _work_item_id, _actor_id, COALESCE(_actor_representative_id, v_item.owner_representative_id),
    _canonical_state, _reason_code, _value_realized,
    COALESCE(_occurred_at, now()), _supersedes_id, _correction_reason)
  RETURNING id INTO v_id;

  v_resolving := _canonical_state IN ('resolved_positive', 'resolved_negative');

  -- Close the item in the same transaction. The identity trigger from PR #2
  -- makes this one-way: nothing can reopen it, including a later ingestion.
  IF v_resolving AND v_item.state = 'open' THEN
    UPDATE public.work_items SET state = 'resolved' WHERE id = _work_item_id;
  END IF;

  SELECT count(*)::integer INTO v_touches FROM public.outcomes WHERE work_item_id = _work_item_id;

  RETURN QUERY SELECT v_id, _work_item_id,
    CASE WHEN v_resolving THEN 'resolved' ELSE v_item.state END,
    v_resolving, v_touches;
END;
$$;

REVOKE ALL ON FUNCTION public.record_work_item_outcome(uuid, uuid, uuid, text, text, numeric, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_work_item_outcome(uuid, uuid, uuid, text, text, numeric, uuid, text, timestamptz) TO service_role;

COMMENT ON FUNCTION public.record_work_item_outcome(uuid, uuid, uuid, text, text, numeric, uuid, text, timestamptz) IS
  'The only write path to public.outcomes. Rejects the derived expired_unworked state with an explanation rather than a constraint error, closes the work item in the same transaction when the outcome resolves it, and locks the item so two concurrent dispositions cannot both succeed.';

-- ===========================================================================
-- the operator queue
-- ===========================================================================
--
-- MVP ordering, exactly three terms and no model behind them:
--
--   1. earliest due date       urgency, and the only term that reflects loss
--   2. highest business value  what is at stake among equally urgent items
--   3. fewest prior touches    so a difficult item cannot be worked forever
--                              while an untouched one expires beside it
--
-- Then item id, so the order is TOTAL. Without a final tiebreak two items
-- identical on all three terms could swap places between calls, and an
-- operator who reloads and sees a different "next" stops trusting the queue.
--
-- Returns the ordering terms alongside each row so the caller can build a
-- reason string from what actually decided the position rather than from a
-- guess. An unexplained ranking is an oracle, and operators work around
-- oracles — which restores the cherry-picking the queue exists to prevent.

DROP FUNCTION IF EXISTS public.next_work_items_for_representative(uuid, uuid, integer, timestamptz);
CREATE FUNCTION public.next_work_items_for_representative(
  _representative_id uuid,
  _work_type_id uuid,
  _limit integer DEFAULT 1,
  _as_of timestamptz DEFAULT now()
)
RETURNS TABLE (
  out_work_item_id uuid,
  out_external_ref text,
  out_subject_ref text,
  out_subject_label text,
  out_due_at timestamptz,
  out_eligible_from timestamptz,
  out_business_value numeric,
  out_touch_count integer,
  out_hours_to_due numeric,
  out_overdue boolean,
  out_position integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    w.id, w.external_ref, w.subject_ref, w.subject_label,
    w.due_at, w.eligible_from, w.business_value,
    t.touches::integer,
    CASE WHEN w.due_at IS NULL THEN NULL
         ELSE round(extract(epoch FROM (w.due_at - _as_of)) / 3600, 1) END,
    w.due_at IS NOT NULL AND w.due_at < _as_of,
    (row_number() OVER (
      ORDER BY w.due_at ASC NULLS LAST, w.business_value DESC, t.touches ASC, w.id
    ))::integer
  FROM public.work_items w
  CROSS JOIN LATERAL (
    SELECT count(*) AS touches FROM public.outcomes o WHERE o.work_item_id = w.id
  ) t
  WHERE w.owner_representative_id = _representative_id
    AND w.work_type_id = _work_type_id
    AND w.state = 'open'
    -- An item whose window has not opened is not workable yet. NULL means the
    -- work type has no window and the item is workable on arrival.
    AND (w.eligible_from IS NULL OR w.eligible_from <= _as_of)
  ORDER BY w.due_at ASC NULLS LAST, w.business_value DESC, t.touches ASC, w.id
  LIMIT GREATEST(COALESCE(_limit, 1), 1);
$$;

REVOKE ALL ON FUNCTION public.next_work_items_for_representative(uuid, uuid, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_work_items_for_representative(uuid, uuid, integer, timestamptz) TO service_role;

COMMENT ON FUNCTION public.next_work_items_for_representative(uuid, uuid, integer, timestamptz) IS
  'MVP queue: earliest due, then highest value, then fewest touches, then id for a total order. Overdue items sort first because their due date is in the past — deliberately, since an expired item is the one that is already costing money. Returns the ordering terms so the caller can state the real reason rather than a guess.';

-- Supports the queue's WHERE and ORDER BY in one index.
CREATE INDEX IF NOT EXISTS work_items_queue_idx
  ON public.work_items (owner_representative_id, work_type_id, due_at, business_value DESC)
  WHERE state = 'open';

-- ===========================================================================
-- coverage refresh after an outcome
-- ===========================================================================
--
-- Full recomputation of every scope that contains the representative, for the
-- affected date. Correctness over optimisation, deliberately: an incremental
-- update has to reason about which component the item moved between, and a
-- coverage figure that drifts from its own inventory is worse than one that
-- takes a moment longer to produce.
--
-- The date recomputed is the item's DUE date, not today. Coverage is
-- deadline-based, so an outcome recorded today about an item due last Tuesday
-- changes last Tuesday's coverage — and recomputing today's would leave the
-- figure that actually moved stale.

DROP FUNCTION IF EXISTS public.refresh_coverage_for_work_item(uuid);
CREATE FUNCTION public.refresh_coverage_for_work_item(_work_item_id uuid)
RETURNS TABLE (out_scopes_refreshed integer, out_on_date date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item record;
  v_date date;
  v_count integer := 0;
  r record;
BEGIN
  SELECT w.owner_representative_id, w.work_type_id, w.due_at
    INTO v_item
  FROM public.work_items w WHERE w.id = _work_item_id;

  IF v_item.owner_representative_id IS NULL OR v_item.due_at IS NULL THEN
    RETURN QUERY SELECT 0, NULL::date;
    RETURN;
  END IF;

  v_date := v_item.due_at::date;

  FOR r IN
    SELECT s.id FROM public.scopes s
    WHERE s.active AND private.rep_in_scope(s.id, v_item.owner_representative_id)
  LOOP
    PERFORM public.compute_coverage_fact(r.id, v_item.work_type_id, v_date, v_date);
    v_count := v_count + 1;
  END LOOP;

  RETURN QUERY SELECT v_count, v_date;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_coverage_for_work_item(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_coverage_for_work_item(uuid) TO service_role;

COMMENT ON FUNCTION public.refresh_coverage_for_work_item(uuid) IS
  'Recomputes coverage for every scope containing the item''s owner, on the item''s DUE date rather than today — coverage is deadline-based, so an outcome recorded today about an item due last week moves last week''s figure. Full recomputation by design: an incremental update that drifts from its own inventory is worse than one that takes longer.';

-- ===========================================================================
-- correction: coverage deadlines are DAY-granular
-- ===========================================================================
--
-- Found while wiring the runtime loop end to end. PR #3 defined engagement as
--
--     outcome.occurred_at <= work_item.due_at
--
-- which is a TIMESTAMP comparison. A due date arrives from the feed as a date
-- and lands at midnight, so an item due 1 August that was worked at 09:00 on
-- 1 August compared as LATE and was counted as expired_unworked — coverage
-- reported a loss on work that had actually been done, on the same day it was
-- done.
--
-- Everything else in the metric is already day-granular: eligibility buckets
-- by calendar day, facts are stored per day, and the operator's deadline in
-- the real business is the end of the expiry date, not its first instant. The
-- engagement test was the one place that read the timestamp literally.
--
-- Both comparisons move to end-of-day:
--
--   engaged   an outcome occurring at any point on or before the due DATE
--   expired   only once the due date has fully passed, so an item due today is
--             pending during today rather than already lost at 00:01
--
-- Forward-only: PR #3's definition is superseded here rather than edited,
-- because that migration has already been applied wherever this branch was
-- deployed.

CREATE OR REPLACE FUNCTION private.coverage_components(
  _scope_id uuid,
  _work_type_id uuid,
  _period_start date,
  _period_end date,
  _as_of timestamptz DEFAULT now()
)
RETURNS TABLE (
  eligible_count bigint, engaged_count bigint, expired_unworked_count bigint, pending_count bigint,
  eligible_value numeric, engaged_value numeric, expired_unworked_value numeric, pending_value numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH scoped AS (
    SELECT w.id, w.due_at, w.business_value,
      -- End of the due DAY, which is the operator's real deadline.
      (date_trunc('day', w.due_at) + interval '1 day') AS deadline,
      EXISTS (
        SELECT 1 FROM public.outcomes o
        WHERE o.work_item_id = w.id
          AND o.occurred_at < date_trunc('day', w.due_at) + interval '1 day'
      ) AS engaged_in_time
    FROM public.work_items w
    JOIN private.scope_representative_ids(_scope_id) s
      ON s.representative_id = w.owner_representative_id
    WHERE w.work_type_id = _work_type_id
      AND w.state <> 'voided'
      AND w.due_at IS NOT NULL
      AND w.due_at >= _period_start::timestamptz
      AND w.due_at < (_period_end + 1)::timestamptz
  )
  SELECT
    count(*)::bigint,
    count(*) FILTER (WHERE engaged_in_time)::bigint,
    count(*) FILTER (WHERE NOT engaged_in_time AND deadline <= _as_of)::bigint,
    count(*) FILTER (WHERE NOT engaged_in_time AND deadline > _as_of)::bigint,
    COALESCE(sum(business_value), 0)::numeric,
    COALESCE(sum(business_value) FILTER (WHERE engaged_in_time), 0)::numeric,
    COALESCE(sum(business_value) FILTER (WHERE NOT engaged_in_time AND deadline <= _as_of), 0)::numeric,
    COALESCE(sum(business_value) FILTER (WHERE NOT engaged_in_time AND deadline > _as_of), 0)::numeric
  FROM scoped;
$$;

COMMENT ON FUNCTION private.coverage_components(uuid, uuid, date, date, timestamptz) IS
  'Coverage components for one scope, one work type, one period. Engaged means an outcome recorded at any point on or before the due DATE — day-granular, matching how eligibility buckets and how the business reads a deadline. Returns no ratio; ratios are recomputed from components at read time.';

CREATE OR REPLACE FUNCTION public.coverage_for_representative(
  _representative_id uuid,
  _work_type_id uuid,
  _period_start date,
  _period_end date
)
RETURNS TABLE (
  out_eligible_count bigint, out_engaged_count bigint,
  out_expired_unworked_count bigint, out_pending_count bigint,
  out_eligible_value numeric, out_engaged_value numeric,
  out_expired_unworked_value numeric, out_pending_value numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH scoped AS (
    SELECT w.id, w.business_value,
      (date_trunc('day', w.due_at) + interval '1 day') AS deadline,
      EXISTS (SELECT 1 FROM public.outcomes o
              WHERE o.work_item_id = w.id
                AND o.occurred_at < date_trunc('day', w.due_at) + interval '1 day') AS engaged_in_time
    FROM public.work_items w
    WHERE w.owner_representative_id = _representative_id
      AND w.work_type_id = _work_type_id
      AND w.state <> 'voided'
      AND w.due_at IS NOT NULL
      AND w.due_at >= _period_start::timestamptz
      AND w.due_at < (_period_end + 1)::timestamptz
  )
  SELECT
    count(*)::bigint,
    count(*) FILTER (WHERE engaged_in_time)::bigint,
    count(*) FILTER (WHERE NOT engaged_in_time AND deadline <= now())::bigint,
    count(*) FILTER (WHERE NOT engaged_in_time AND deadline > now())::bigint,
    COALESCE(sum(business_value), 0)::numeric,
    COALESCE(sum(business_value) FILTER (WHERE engaged_in_time), 0)::numeric,
    COALESCE(sum(business_value) FILTER (WHERE NOT engaged_in_time AND deadline <= now()), 0)::numeric,
    COALESCE(sum(business_value) FILTER (WHERE NOT engaged_in_time AND deadline > now()), 0)::numeric
  FROM scoped;
$$;
