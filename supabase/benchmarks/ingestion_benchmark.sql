-- Pulse v2 — work inventory pipeline benchmark.
--
-- Times the four workloads the pipeline actually runs, at the volume the PRD
-- projects (roughly 100,000 open items for a 500-seat renewals operation):
--
--   1. INITIAL       an empty inventory receiving its first full book
--   2. INCREMENTAL   the realistic daily case — a full snapshot in which
--                    almost nothing moved. The expensive part is comparing
--                    100,000 rows to find the few hundred that changed, and a
--                    benchmark where everything changed would measure a
--                    workload the pipeline never sees.
--   3. DUPLICATE     the same content delivered twice, rejected at validation
--                    without touching the inventory
--   4. VOLUME DROP   an abnormally small delivery, rejected the same way
--
-- Each stage is timed separately, because they have different shapes: staging
-- is bulk insert, validation is three set-based passes over untrusted text,
-- and publish is a diff-and-upsert against the live table.
--
-- Prerequisites: PR #1 and PR #2 migrations applied, and
-- supabase/benchmarks/synthetic_inventory.sql loaded.
--
-- Usage:
--   \set item_count 100000
--   \i supabase/benchmarks/ingestion_benchmark.sql

\set ON_ERROR_STOP on
\if :{?item_count} \else \set item_count 100000 \endif
\timing off

CREATE TEMP TABLE IF NOT EXISTS benchmark_results (
  scenario text,
  stage text,
  rows integer,
  ms numeric,
  detail text
);

CREATE OR REPLACE FUNCTION pg_temp.run_scenario(
  _scenario text,
  _item_count integer,
  _anchor date,
  _mutate_pct numeric,
  _new_rows integer,
  _first_index integer
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_batch uuid;
  v_t0 timestamptz;
  v_staged integer;
  v_rows integer;
  v_passed boolean;
  v_code text;
  v_pub record;
BEGIN
  -- ---------- begin ----------
  SELECT out_batch_id INTO v_batch
  FROM public.ingestion_begin_batch('renewals-core', _scenario, NULL, 'scheduled');

  -- ---------- stage ----------
  v_t0 := clock_timestamp();
  v_staged := public.benchmark_stage_synthetic(v_batch, _item_count, _anchor, 'POL', _first_index);

  -- A share of rows repriced, standing in for the daily churn of a real book:
  -- a reallocation, a repricing or a date correction on a small minority while
  -- the rest arrives byte-identical to yesterday.
  IF _mutate_pct > 0 THEN
    UPDATE public.ingestion_staging_rows
    SET business_value_raw = to_char(
          (business_value_raw::numeric + 137.5)::numeric, 'FM9999999990.00')
    WHERE batch_id = v_batch
      AND (abs(hashtext(external_ref)) % 1000) < (_mutate_pct * 10);
  END IF;

  IF _new_rows > 0 THEN
    PERFORM public.benchmark_stage_synthetic(
      v_batch, _new_rows, _anchor, 'POL-NEW-' || _first_index, 1);
  END IF;

  INSERT INTO benchmark_results
  VALUES (_scenario, 'stage', v_staged + _new_rows,
          round(extract(epoch FROM (clock_timestamp() - v_t0)) * 1000, 1), NULL);

  -- ---------- finalize ----------
  v_t0 := clock_timestamp();
  SELECT out_row_count INTO v_rows FROM public.ingestion_finalize_staging(v_batch);
  INSERT INTO benchmark_results
  VALUES (_scenario, 'finalize (count + checksum)', v_rows,
          round(extract(epoch FROM (clock_timestamp() - v_t0)) * 1000, 1), NULL);

  -- ---------- validate ----------
  v_t0 := clock_timestamp();
  SELECT out_passed, out_rejection_code INTO v_passed, v_code
  FROM public.ingestion_validate_batch(v_batch);
  INSERT INTO benchmark_results
  VALUES (_scenario, 'validate', v_rows,
          round(extract(epoch FROM (clock_timestamp() - v_t0)) * 1000, 1),
          CASE WHEN v_passed THEN 'passed' ELSE 'REJECTED: ' || v_code END);

  IF NOT v_passed THEN
    RETURN;
  END IF;

  -- ---------- publish ----------
  v_t0 := clock_timestamp();
  SELECT * INTO v_pub FROM public.ingestion_publish_batch(v_batch);
  INSERT INTO benchmark_results
  VALUES (_scenario, 'publish', v_rows,
          round(extract(epoch FROM (clock_timestamp() - v_t0)) * 1000, 1),
          format('inserted %s, updated %s, unchanged %s, voided %s',
                 v_pub.out_rows_inserted, v_pub.out_rows_updated,
                 v_pub.out_rows_unchanged, v_pub.out_rows_voided));
END;
$$;

\echo ''
\echo '=== 1. INITIAL IMPORT — empty inventory, full book ==='
SELECT pg_temp.run_scenario('initial', :item_count, DATE '2026-08-09', 0, 0, 1);

\echo '=== 2. INCREMENTAL IMPORT — full snapshot, ~3% repriced, 3,000 new ==='
SELECT pg_temp.run_scenario('incremental', :item_count, DATE '2026-08-09', 3, 3000, 1);

\echo '=== 3. DUPLICATE IMPORT — identical content re-delivered ==='
SELECT pg_temp.run_scenario('duplicate', :item_count, DATE '2026-08-09', 3, 3000, 1);

\echo '=== 4. VOLUME DROP — abnormally small delivery ==='
SELECT pg_temp.run_scenario('volume_drop', (:item_count / 20)::integer, DATE '2026-08-09', 0, 0, 1);

\echo ''
\echo '=== RESULTS ==='
SELECT scenario, stage, rows, ms, coalesce(detail, '') AS detail
FROM benchmark_results
ORDER BY
  CASE scenario WHEN 'initial' THEN 1 WHEN 'incremental' THEN 2
                WHEN 'duplicate' THEN 3 ELSE 4 END,
  CASE stage WHEN 'stage' THEN 1 WHEN 'finalize (count + checksum)' THEN 2
             WHEN 'validate' THEN 3 ELSE 4 END;

\echo ''
\echo '=== TOTALS PER SCENARIO ==='
SELECT scenario, max(rows) AS rows, round(sum(ms), 1) AS total_ms,
       round(sum(ms) / NULLIF(max(rows), 0) * 1000, 2) AS us_per_row
FROM benchmark_results GROUP BY scenario
ORDER BY CASE scenario WHEN 'initial' THEN 1 WHEN 'incremental' THEN 2
                       WHEN 'duplicate' THEN 3 ELSE 4 END;

\echo ''
\echo '=== INVENTORY AFTER ==='
SELECT state, count(*) FROM public.work_items GROUP BY state ORDER BY state;
SELECT status, count(*), sum(rows_inserted) AS inserted, sum(rows_updated) AS updated,
       sum(rows_unchanged) AS unchanged, sum(rows_voided) AS voided
FROM public.ingestion_batches GROUP BY status ORDER BY status;
