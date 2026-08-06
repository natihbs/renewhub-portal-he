-- Pulse v2 — synthetic work inventory, generated in-database.
--
-- The SQL twin of src/lib/ingestion-synthetic.ts. Both exist on purpose: the
-- TypeScript generator feeds unit tests and anything that has to reason about
-- rows in application code, and this one feeds benchmarks at a scale where
-- shipping a hundred thousand rows over a client connection would measure the
-- connection rather than the pipeline.
--
-- They are shaped the same way, and shaped like a real renewals book rather
-- than like uniform noise:
--
--   * DUE DATES CLUSTER into waves, because policies renew on their sale
--     anniversary and selling is seasonal. Uniform expiries would make
--     coverage-versus-capacity look comfortable on every day of the year,
--     which is the one thing it never is.
--   * VALUE IS SKEWED, long tail of small premiums and a short head of large
--     ones. Uniform values would make value-weighted and count-weighted
--     aggregates agree, hiding the whole reason for weighting.
--   * OWNERSHIP IS UNEVEN. Equal books per representative would make every
--     per-owner figure identical and every later ranking benchmark
--     meaningless.
--
-- Usage:
--   \set team_count 12
--   \set item_count 100000
--   \i supabase/benchmarks/synthetic_inventory.sql

\set ON_ERROR_STOP on
\if :{?team_count} \else \set team_count 12 \endif
\if :{?item_count} \else \set item_count 100000 \endif

-- ---------------------------------------------------------------------------
-- org
-- ---------------------------------------------------------------------------

INSERT INTO public.teams (name, kpi_profile, created_at)
SELECT 'צוות סינתטי ' || g,
       CASE WHEN g % 3 = 0 THEN 'generic_sales' ELSE 'renewals' END,
       now() - interval '1 year'
FROM generate_series(1, :team_count) g
WHERE NOT EXISTS (SELECT 1 FROM public.teams WHERE name = 'צוות סינתטי ' || g);

-- 6-14 people per team, varying, so a capacity shortfall is demonstrable.
-- setseed makes the variation reproducible across runs.
SELECT setseed(0.20260809);

INSERT INTO public.representatives (name, team_id, external_ref)
SELECT
  'נציג ' || t.n || '-' || r,
  t.id,
  'synthetic-team-' || lpad(t.n::text, 3, '0') || '-rep-' || lpad(r::text, 2, '0')
FROM (
  SELECT id, row_number() OVER (ORDER BY name) AS n,
         6 + (abs(hashtext(id::text)) % 9) AS size
  FROM public.teams WHERE name LIKE 'צוות סינתטי %'
) t
CROSS JOIN LATERAL generate_series(1, t.size) r
WHERE NOT EXISTS (
  SELECT 1 FROM public.representatives x
  WHERE x.external_ref = 'synthetic-team-' || lpad(t.n::text, 3, '0') || '-rep-' || lpad(r::text, 2, '0')
);

-- ---------------------------------------------------------------------------
-- work type and source
-- ---------------------------------------------------------------------------

INSERT INTO public.work_types (
  key, display_name, arrival, selection, decay, outcome_shape,
  value_model, synchrony, discretion, durability_horizon_days)
SELECT 'renewals', 'חידושים', 'scheduled', 'queue', 'hard_deadline', 'binary',
       'recurring', 'synchronous', 'high', 30
WHERE NOT EXISTS (SELECT 1 FROM public.work_types WHERE key = 'renewals');

INSERT INTO public.ingestion_sources (key, display_name, work_type_id, ingestion_mode)
SELECT 'renewals-core', 'ספר חידושים — מערכת ליבה', wt.id, 'snapshot'
FROM public.work_types wt WHERE wt.key = 'renewals'
  AND NOT EXISTS (SELECT 1 FROM public.ingestion_sources WHERE key = 'renewals-core');

-- ---------------------------------------------------------------------------
-- the book, as staging rows
-- ---------------------------------------------------------------------------
--
-- A function rather than a script fragment so a benchmark can call it once per
-- batch with different parameters. Writes raw text into staging exactly as a
-- real feed would, so the benchmark measures the real parse path rather than a
-- shortcut around it.

CREATE OR REPLACE FUNCTION public.benchmark_stage_synthetic(
  _batch_id uuid,
  _item_count integer,
  _anchor date,
  _ref_prefix text DEFAULT 'POL',
  _first_index integer DEFAULT 1
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_inserted integer;
BEGIN
  INSERT INTO public.ingestion_staging_rows (
    batch_id, row_number, external_ref, subject_ref, subject_label,
    owner_external_ref, due_at_raw, eligible_from_raw, business_value_raw)
  SELECT
    _batch_id,
    g,
    _ref_prefix || '-' || lpad((g + _first_index - 1)::text, 7, '0'),
    'CUST-' || (1000000 + (abs(hashtext('s' || g)) % 4000000)),
    'לקוח ' || g,
    reps.external_ref,
    to_char(due.at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    to_char(due.at - make_interval(days => 30 + (abs(hashtext('e' || g)) % 31)), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    to_char(
      -- Squared uniform: long tail of small premiums, short head of large.
      round((350 + power((abs(hashtext('v' || g)) % 1000)::numeric / 1000, 2) * 24000)::numeric, 2),
      'FM9999999990.00')
  FROM generate_series(1, _item_count) g
  CROSS JOIN LATERAL (
    -- Biased pick: some representatives carry heavier books than others.
    SELECT r.external_ref FROM public.representatives r
    WHERE r.external_ref LIKE 'synthetic-team-%'
    ORDER BY r.external_ref
    -- LEAST against the last index. Without it the bias exponent can land the
    -- OFFSET exactly on the row count, the LATERAL returns nothing, and the
    -- CROSS JOIN silently DROPS that generated row — a fixture that quietly
    -- produces 99,806 rows when asked for 100,000, and therefore benchmark
    -- numbers that are not for the workload they claim to be for.
    OFFSET LEAST(
      (power((abs(hashtext('o' || g)) % 1000)::numeric / 1000, 1.4)
       * (SELECT count(*) FROM public.representatives WHERE external_ref LIKE 'synthetic-team-%')
      )::integer,
      (SELECT count(*) - 1 FROM public.representatives WHERE external_ref LIKE 'synthetic-team-%')
    )
    LIMIT 1
  ) reps
  CROSS JOIN LATERAL (
    -- Seven seasonal peaks with roughly normal spread around each.
    SELECT (_anchor
      + make_interval(days =>
          GREATEST(0,
            (ARRAY[12, 47, 96, 158, 219, 275, 331])[1 + (abs(hashtext('p' || g)) % 7)]
            + ((abs(hashtext('n' || g)) % 37) - 18))))::timestamptz AS at
  ) due;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.benchmark_stage_synthetic(uuid, integer, date, text, integer) IS
  'Stages a synthetic renewals book directly into ingestion_staging_rows. Benchmark fixture only — writes raw text exactly as a real feed would, so timings measure the real parse path rather than a shortcut around it.';
