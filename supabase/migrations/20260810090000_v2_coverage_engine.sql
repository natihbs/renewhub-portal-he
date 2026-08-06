-- Pulse v2 — PR #3: Coverage Engine
--
-- Additive only. Nothing from PR #1 or PR #2 changes.
--
-- Coverage is engaged / eligible. Three definitions carry the whole metric and
-- each one is a decision rather than an obvious reading:
--
--   ELIGIBLE          a non-voided work item whose DEADLINE falls inside the
--                     period. Deadline-based, not creation-based: the question
--                     is "what was due in this window", because that is what a
--                     manager can still act on and what is lost if they do not.
--
--   ENGAGED           an eligible item with at least one outcome recorded AT OR
--                     BEFORE its deadline. In time is the whole point — a
--                     touch after expiry is a record, not coverage, and
--                     counting it would make the metric report the opposite of
--                     what it exists to expose.
--
--   EXPIRED_UNWORKED  an eligible item whose deadline has passed with no
--                     outcome recorded before it. DERIVED, never recorded.
--                     Silent loss is silent precisely because nobody types it
--                     in; a disposition someone has to enter is a disposition
--                     nobody enters.
--
-- engaged + expired_unworked + pending = eligible, always, on both count and
-- value. Enforced by a CHECK constraint on metric_facts, because a
-- decomposition that does not add up invites people to trust one term.
--
-- ERROR CODES, continuing the scheme:
--   P0030  scope missing or inactive
--   P0031  work type missing
--   P0032  period invalid

-- ===========================================================================
-- metric_facts
-- ===========================================================================
--
-- Pre-aggregated so a read is an index lookup rather than a scan over the
-- inventory. At the PRD's ≤ 2 s p95 that is not an optimisation, it is the
-- design: PR #2 measured 2 s merely to DIFF 100,000 rows, so a live scan per
-- dashboard open was never going to hold.
--
-- SCOPE LINEAGE IS PINNED. A scope is a live query — move a representative
-- between teams and yesterday's team scope resolves to a different set of
-- people today. Storing what it resolved to AT COMPUTATION TIME is what stops
-- last month's coverage from silently changing whenever the org chart does.
--
-- COMPONENTS, NOT RATIOS. There is no percentage column here on purpose.
-- Ratios are recomputed from summed numerators and denominators at read time;
-- storing one would let an aggregate average them, which is the single most
-- common way a roll-up starts lying.

CREATE TABLE IF NOT EXISTS public.metric_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  metric_key text NOT NULL CHECK (metric_key IN ('coverage')),
  scope_id uuid NOT NULL REFERENCES public.scopes(id) ON DELETE RESTRICT,
  work_type_id uuid NOT NULL REFERENCES public.work_types(id) ON DELETE RESTRICT,

  period_start date NOT NULL,
  period_end date NOT NULL,
  granularity text NOT NULL DEFAULT 'day' CHECK (granularity IN ('day', 'week', 'month')),

  eligible_count bigint NOT NULL DEFAULT 0 CHECK (eligible_count >= 0),
  engaged_count bigint NOT NULL DEFAULT 0 CHECK (engaged_count >= 0),
  expired_unworked_count bigint NOT NULL DEFAULT 0 CHECK (expired_unworked_count >= 0),
  pending_count bigint NOT NULL DEFAULT 0 CHECK (pending_count >= 0),

  eligible_value numeric(16, 2) NOT NULL DEFAULT 0 CHECK (eligible_value >= 0),
  engaged_value numeric(16, 2) NOT NULL DEFAULT 0 CHECK (engaged_value >= 0),
  expired_unworked_value numeric(16, 2) NOT NULL DEFAULT 0 CHECK (expired_unworked_value >= 0),
  pending_value numeric(16, 2) NOT NULL DEFAULT 0 CHECK (pending_value >= 0),

  -- What the scope resolved to when this was computed.
  scope_lineage jsonb NOT NULL,

  -- The inventory's freshness at computation time, so a reader can tell a
  -- figure computed against a current book from one computed against a book
  -- that had already stopped arriving.
  freshness_state text NOT NULL CHECK (freshness_state IN ('fresh', 'warning', 'critical', 'never')),
  source_batch_id uuid REFERENCES public.ingestion_batches(id) ON DELETE SET NULL,

  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT metric_facts_period_ordered CHECK (period_end >= period_start),

  -- The decomposition must add up. Both measures, and the value one to the
  -- cent because it is numeric(16,2).
  CONSTRAINT metric_facts_counts_balance
    CHECK (engaged_count + expired_unworked_count + pending_count = eligible_count),
  CONSTRAINT metric_facts_values_balance
    CHECK (abs((engaged_value + expired_unworked_value + pending_value) - eligible_value) < 0.01),

  UNIQUE (metric_key, scope_id, work_type_id, period_start, period_end, granularity)
);

CREATE INDEX IF NOT EXISTS metric_facts_lookup_idx
  ON public.metric_facts (metric_key, scope_id, work_type_id, period_end DESC);
CREATE INDEX IF NOT EXISTS metric_facts_period_idx
  ON public.metric_facts (period_start, period_end);

COMMENT ON TABLE public.metric_facts IS
  'Pre-aggregated metric components per scope per period. Deliberately stores no percentage: ratios are recomputed from summed numerators and denominators at read time, because a stored ratio is a ratio an aggregate can average, and averaging ratios is the most common way a roll-up starts lying.';
COMMENT ON COLUMN public.metric_facts.scope_lineage IS
  'What the scope resolved to at computation time. A scope is a live query; without this pin, last month''s coverage changes silently whenever someone moves between teams.';

GRANT SELECT ON public.metric_facts TO authenticated;
GRANT ALL ON public.metric_facts TO service_role;
ALTER TABLE public.metric_facts ENABLE ROW LEVEL SECURITY;

-- Read follows the scope. No client write policy — facts are computed by
-- service_role and a client that could write one could write itself a
-- flattering number.
DROP POLICY IF EXISTS "metric_facts read" ON public.metric_facts;
CREATE POLICY "metric_facts read" ON public.metric_facts
  FOR SELECT TO authenticated
  USING (private.is_admin(auth.uid()) OR private.can_observe_scope(scope_id));

-- ===========================================================================
-- the coverage computation
-- ===========================================================================
--
-- One statement over work_items, restricted to the representatives the scope
-- resolves to. Returns COMPONENTS only; no ratio is computed in SQL, so there
-- is nowhere for a percentage to be stored or averaged.
--
-- The engaged test is a correlated EXISTS with `occurred_at <= due_at`.
-- Written as EXISTS rather than a join because an item can carry several
-- outcomes and a join would multiply it into the counts.

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
      EXISTS (
        SELECT 1 FROM public.outcomes o
        WHERE o.work_item_id = w.id AND o.occurred_at <= w.due_at
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
    count(*) FILTER (WHERE NOT engaged_in_time AND due_at < _as_of)::bigint,
    count(*) FILTER (WHERE NOT engaged_in_time AND due_at >= _as_of)::bigint,
    COALESCE(sum(business_value), 0)::numeric,
    COALESCE(sum(business_value) FILTER (WHERE engaged_in_time), 0)::numeric,
    COALESCE(sum(business_value) FILTER (WHERE NOT engaged_in_time AND due_at < _as_of), 0)::numeric,
    COALESCE(sum(business_value) FILTER (WHERE NOT engaged_in_time AND due_at >= _as_of), 0)::numeric
  FROM scoped;
$$;

REVOKE ALL ON FUNCTION private.coverage_components(uuid, uuid, date, date, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.coverage_components(uuid, uuid, date, date, timestamptz) TO service_role;

COMMENT ON FUNCTION private.coverage_components(uuid, uuid, date, date, timestamptz) IS
  'Coverage components for one scope, one work type, one period. Engaged means an outcome recorded AT OR BEFORE the deadline — a touch after expiry is a record, not coverage. Returns no ratio; ratios are recomputed from components at read time.';

-- ---------------------------------------------------------------------------
-- scope lineage, captured at computation time
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.scope_lineage(_scope_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'scopeId', s.id,
    'scopeKey', s.key,
    'scopeKind', s.kind,
    'displayName', s.display_name,
    'representativeIds', COALESCE((
      SELECT jsonb_agg(r.representative_id ORDER BY r.representative_id)
      FROM private.scope_representative_ids(s.id) r), '[]'::jsonb),
    'teamIds', COALESCE((
      SELECT jsonb_agg(DISTINCT rep.team_id)
      FROM private.scope_representative_ids(s.id) r
      JOIN public.representatives rep ON rep.id = r.representative_id
      WHERE rep.team_id IS NOT NULL), '[]'::jsonb),
    'resolvedCount', (SELECT count(*) FROM private.scope_representative_ids(s.id)),
    'pinnedAt', now()
  )
  FROM public.scopes s WHERE s.id = _scope_id;
$$;

REVOKE ALL ON FUNCTION private.scope_lineage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.scope_lineage(uuid) TO service_role;

-- ===========================================================================
-- compute_coverage_fact — idempotent upsert for one scope/period
-- ===========================================================================
--
-- Idempotent by construction: re-running for the same key updates the same row
-- rather than appending. That is what makes it safe to trigger manually and
-- safe to trigger twice, which is the whole reason there is no scheduler in
-- this PR.

DROP FUNCTION IF EXISTS public.compute_coverage_fact(uuid, uuid, date, date, timestamptz);
CREATE FUNCTION public.compute_coverage_fact(
  _scope_id uuid,
  _work_type_id uuid,
  _period_start date,
  _period_end date,
  _as_of timestamptz DEFAULT now()
)
RETURNS TABLE (
  out_fact_id uuid, out_eligible_count bigint, out_engaged_count bigint,
  out_expired_unworked_count bigint, out_pending_count bigint,
  out_eligible_value numeric, out_engaged_value numeric,
  out_expired_unworked_value numeric, out_pending_value numeric,
  out_freshness_state text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_id uuid;
  v_fresh text;
  v_batch uuid;
  v_age numeric;
  v_warn integer;
  v_crit integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.scopes WHERE id = _scope_id AND active) THEN
    RAISE EXCEPTION 'תחום האחריות לא נמצא או מושבת' USING ERRCODE = 'P0030';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.work_types WHERE id = _work_type_id) THEN
    RAISE EXCEPTION 'סוג עבודה לא נמצא' USING ERRCODE = 'P0031';
  END IF;
  IF _period_end < _period_start THEN
    RAISE EXCEPTION 'תקופה לא חוקית' USING ERRCODE = 'P0032';
  END IF;

  SELECT * INTO c FROM private.coverage_components(_scope_id, _work_type_id, _period_start, _period_end, _as_of);

  -- Freshness of the feed behind this work type, recorded WITH the fact. A
  -- figure computed against a book that had already stopped arriving is not
  -- the same figure as one computed against a current book, and a reader must
  -- be able to tell them apart afterwards.
  SELECT f.out_age_seconds, f.out_warning_hours, f.out_critical_hours, f.out_last_batch_id
    INTO v_age, v_warn, v_crit, v_batch
  FROM public.ingestion_freshness() f
  JOIN public.work_types wt ON wt.key = f.out_work_type_key
  WHERE wt.id = _work_type_id
  LIMIT 1;

  v_fresh := CASE
    WHEN v_age IS NULL THEN 'never'
    WHEN v_age / 3600 >= v_crit THEN 'critical'
    WHEN v_age / 3600 >= v_warn THEN 'warning'
    ELSE 'fresh'
  END;

  INSERT INTO public.metric_facts (
    metric_key, scope_id, work_type_id, period_start, period_end, granularity,
    eligible_count, engaged_count, expired_unworked_count, pending_count,
    eligible_value, engaged_value, expired_unworked_value, pending_value,
    scope_lineage, freshness_state, source_batch_id, computed_at)
  VALUES (
    'coverage', _scope_id, _work_type_id, _period_start, _period_end, 'day',
    c.eligible_count, c.engaged_count, c.expired_unworked_count, c.pending_count,
    c.eligible_value, c.engaged_value, c.expired_unworked_value, c.pending_value,
    private.scope_lineage(_scope_id), v_fresh, v_batch, now())
  ON CONFLICT (metric_key, scope_id, work_type_id, period_start, period_end, granularity)
  DO UPDATE SET
    eligible_count = EXCLUDED.eligible_count,
    engaged_count = EXCLUDED.engaged_count,
    expired_unworked_count = EXCLUDED.expired_unworked_count,
    pending_count = EXCLUDED.pending_count,
    eligible_value = EXCLUDED.eligible_value,
    engaged_value = EXCLUDED.engaged_value,
    expired_unworked_value = EXCLUDED.expired_unworked_value,
    pending_value = EXCLUDED.pending_value,
    scope_lineage = EXCLUDED.scope_lineage,
    freshness_state = EXCLUDED.freshness_state,
    source_batch_id = EXCLUDED.source_batch_id,
    computed_at = now()
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, c.eligible_count, c.engaged_count, c.expired_unworked_count,
    c.pending_count, c.eligible_value, c.engaged_value, c.expired_unworked_value,
    c.pending_value, v_fresh;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_coverage_fact(uuid, uuid, date, date, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_coverage_fact(uuid, uuid, date, date, timestamptz) TO service_role;

-- ===========================================================================
-- compute_coverage_facts_for_date — the daily job, triggerable by hand
-- ===========================================================================
--
-- Every active scope × every active work type, for one day. No scheduler is
-- introduced; this is the operation a scheduler will call, and it is
-- idempotent so calling it twice on the same day is a no-op rather than a
-- duplicate.

DROP FUNCTION IF EXISTS public.compute_coverage_facts_for_date(date);
CREATE FUNCTION public.compute_coverage_facts_for_date(_as_of date)
RETURNS TABLE (out_facts_written integer, out_scopes integer, out_duration_ms integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz := clock_timestamp();
  v_facts integer := 0;
  v_scopes integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT s.id AS scope_id, wt.id AS work_type_id
    FROM public.scopes s
    CROSS JOIN public.work_types wt
    WHERE s.active AND wt.active
  LOOP
    PERFORM public.compute_coverage_fact(
      r.scope_id, r.work_type_id, _as_of, _as_of, (_as_of + 1)::timestamptz);
    v_facts := v_facts + 1;
  END LOOP;

  SELECT count(*)::integer INTO v_scopes FROM public.scopes WHERE active;

  RETURN QUERY SELECT v_facts, v_scopes,
    (extract(epoch FROM (clock_timestamp() - v_start)) * 1000)::integer;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_coverage_facts_for_date(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_coverage_facts_for_date(date) TO service_role;

COMMENT ON FUNCTION public.compute_coverage_facts_for_date(date) IS
  'Daily pre-aggregation for every active scope and work type. Idempotent — running it twice for the same date updates rather than duplicates, which is what makes it safe to trigger by hand while no scheduler exists.';

-- ===========================================================================
-- reads
-- ===========================================================================

/**
 * Live coverage for the scopes a person actually holds, computed now.
 *
 * The actor is passed explicitly and the scopes are derived from their
 * assignments — a caller cannot supply a scope. That is the whole
 * authorization story for coverage: there is no parameter to tamper with.
 */
DROP FUNCTION IF EXISTS public.coverage_for_actor(uuid, uuid, date, date);
CREATE FUNCTION public.coverage_for_actor(
  _person_id uuid,
  _work_type_id uuid,
  _period_start date,
  _period_end date
)
RETURNS TABLE (
  out_scope_id uuid, out_scope_key text, out_scope_kind text, out_display_name text,
  out_accountable boolean,
  out_eligible_count bigint, out_engaged_count bigint,
  out_expired_unworked_count bigint, out_pending_count bigint,
  out_eligible_value numeric, out_engaged_value numeric,
  out_expired_unworked_value numeric, out_pending_value numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (s.id)
    s.id, s.key, s.kind, s.display_name, m.accountable,
    c.eligible_count, c.engaged_count, c.expired_unworked_count, c.pending_count,
    c.eligible_value, c.engaged_value, c.expired_unworked_value, c.pending_value
  FROM private.person_current_assignments(_person_id) m
  JOIN public.scopes s ON s.id = m.scope_id AND s.active
  JOIN public.assignment_capabilities ac
    ON ac.assignment_id = m.assignment_id AND ac.capability_key = 'observe.work_items'
  CROSS JOIN LATERAL private.coverage_components(s.id, _work_type_id, _period_start, _period_end) c
  ORDER BY s.id, m.accountable DESC;
$$;

REVOKE ALL ON FUNCTION public.coverage_for_actor(uuid, uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coverage_for_actor(uuid, uuid, date, date) TO service_role;

COMMENT ON FUNCTION public.coverage_for_actor(uuid, uuid, date, date) IS
  'Live coverage for every scope a person holds observe.work_items over. Scopes are derived from assignments, never supplied — there is no parameter for a caller to tamper with. Requires the capability explicitly: reaching a representative is not the same right as reading their inventory.';

/**
 * One representative's own coverage — the operator read.
 *
 * Separate from the scope read because an operator's subject is themselves,
 * and constructing a synthetic one-person scope for every representative in
 * the organization to answer that would be a table of noise.
 */
DROP FUNCTION IF EXISTS public.coverage_for_representative(uuid, uuid, date, date);
CREATE FUNCTION public.coverage_for_representative(
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
    SELECT w.id, w.due_at, w.business_value,
      EXISTS (SELECT 1 FROM public.outcomes o
              WHERE o.work_item_id = w.id AND o.occurred_at <= w.due_at) AS engaged_in_time
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
    count(*) FILTER (WHERE NOT engaged_in_time AND due_at < now())::bigint,
    count(*) FILTER (WHERE NOT engaged_in_time AND due_at >= now())::bigint,
    COALESCE(sum(business_value), 0)::numeric,
    COALESCE(sum(business_value) FILTER (WHERE engaged_in_time), 0)::numeric,
    COALESCE(sum(business_value) FILTER (WHERE NOT engaged_in_time AND due_at < now()), 0)::numeric,
    COALESCE(sum(business_value) FILTER (WHERE NOT engaged_in_time AND due_at >= now()), 0)::numeric
  FROM scoped;
$$;

REVOKE ALL ON FUNCTION public.coverage_for_representative(uuid, uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coverage_for_representative(uuid, uuid, date, date) TO service_role;

/**
 * Coverage from stored facts, for a set of scopes over a date range.
 *
 * Returns the SUMMED COMPONENTS, never a ratio — the caller recomputes. This
 * is the aggregation contract in the one place it could be violated: a
 * function that returned avg(ratio) here would be undetectable downstream.
 */
DROP FUNCTION IF EXISTS public.coverage_facts_rollup(uuid[], uuid, date, date);
CREATE FUNCTION public.coverage_facts_rollup(
  _scope_ids uuid[],
  _work_type_id uuid,
  _period_start date,
  _period_end date
)
RETURNS TABLE (
  out_eligible_count bigint, out_engaged_count bigint,
  out_expired_unworked_count bigint, out_pending_count bigint,
  out_eligible_value numeric, out_engaged_value numeric,
  out_expired_unworked_value numeric, out_pending_value numeric,
  out_fact_count integer, out_worst_freshness text, out_oldest_computed_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(sum(f.eligible_count), 0)::bigint,
    COALESCE(sum(f.engaged_count), 0)::bigint,
    COALESCE(sum(f.expired_unworked_count), 0)::bigint,
    COALESCE(sum(f.pending_count), 0)::bigint,
    COALESCE(sum(f.eligible_value), 0)::numeric,
    COALESCE(sum(f.engaged_value), 0)::numeric,
    COALESCE(sum(f.expired_unworked_value), 0)::numeric,
    COALESCE(sum(f.pending_value), 0)::numeric,
    count(*)::integer,
    -- The worst freshness among the contributing facts, not the best: a
    -- roll-up is only as current as its stalest input, and reporting the
    -- freshest would make one good feed vouch for four dead ones.
    COALESCE(min(CASE f.freshness_state
      WHEN 'never' THEN '0never' WHEN 'critical' THEN '1critical'
      WHEN 'warning' THEN '2warning' ELSE '3fresh' END), '3fresh'),
    min(f.computed_at)
  FROM public.metric_facts f
  WHERE f.metric_key = 'coverage'
    AND f.scope_id = ANY(_scope_ids)
    AND f.work_type_id = _work_type_id
    AND f.period_start >= _period_start
    AND f.period_end <= _period_end;
$$;

REVOKE ALL ON FUNCTION public.coverage_facts_rollup(uuid[], uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coverage_facts_rollup(uuid[], uuid, date, date) TO service_role;

COMMENT ON FUNCTION public.coverage_facts_rollup(uuid[], uuid, date, date) IS
  'Sums stored fact components across scopes and days. Returns no ratio — the caller recomputes from the summed numerator and denominator. A function returning avg(ratio) here would be undetectable downstream, which is why the ratio does not exist at this layer at all.';

-- ===========================================================================
-- expired_unworked, persisted daily
-- ===========================================================================
--
-- The value that will be lost if nothing changes, per scope per day, kept as a
-- dated series. It is already a column on metric_facts; this view is the
-- read that later surfaces and the executive loss decomposition will want, and
-- naming it here means they do not each re-derive it.

CREATE OR REPLACE VIEW public.unworked_at_deadline_daily AS
SELECT
  f.scope_id,
  f.work_type_id,
  f.period_start AS on_date,
  f.expired_unworked_count,
  f.expired_unworked_value,
  f.eligible_count,
  f.eligible_value,
  f.freshness_state,
  f.scope_lineage ->> 'displayName' AS scope_name,
  f.computed_at
FROM public.metric_facts f
WHERE f.metric_key = 'coverage' AND f.granularity = 'day';

GRANT SELECT ON public.unworked_at_deadline_daily TO authenticated, service_role;

COMMENT ON VIEW public.unworked_at_deadline_daily IS
  'Daily value of work that reached its deadline untouched, per scope. Derived from metric_facts, never recorded by a user — a disposition someone has to type is a disposition nobody types, which is precisely why this loss is invisible everywhere else.';
