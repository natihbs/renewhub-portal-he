-- Pulse v2 — PR #2: Work Inventory Pipeline (operations)
--
-- The pipeline is five steps and each one is a separate call, because the
-- expensive middle step — staging a hundred thousand rows — cannot live inside
-- a single database function without holding one transaction open for the
-- whole load:
--
--   1. begin      claim the source, open a batch
--   2. stage      bulk-insert raw rows (done by the caller, in chunks)
--   3. finalize   count, checksum, freeze the staged set
--   4. validate   parse, run every check, decide
--   5. publish    promote into work_items in ONE transaction, or reject
--
-- Only step 5 touches live inventory, and it is atomic. Every failure before
-- it leaves the previous published inventory exactly as it was, which is what
-- "never publish partial inventory" means in practice rather than as an
-- aspiration.
--
-- ERROR CODES, continuing the existing scheme:
--   P0020  ingestion history is immutable (raised by the trigger in the
--          previous migration)
--   P0021  a batch for this source is already in flight
--   P0022  the batch is not in a state where this step is legal
--   P0023  source missing or inactive
--   P0024  publish attempted on a batch that did not pass validation

-- ===========================================================================
-- safe parsing
-- ===========================================================================
--
-- Casting untrusted text in a set-based statement is all-or-nothing: one bad
-- value aborts the statement and the batch dies with "invalid input syntax"
-- and no indication of which row. These return NULL instead, so a malformed
-- value becomes a row-level finding that can name its own row number and show
-- the operator what it actually received.
--
-- The caller distinguishes "absent" from "malformed" by checking whether the
-- raw text was non-empty, which is why these do not raise on empty input.

CREATE OR REPLACE FUNCTION private.try_timestamptz(_v text)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF _v IS NULL OR btrim(_v) = '' THEN RETURN NULL; END IF;
  RETURN btrim(_v)::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.try_numeric(_v text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF _v IS NULL OR btrim(_v) = '' THEN RETURN NULL; END IF;
  RETURN btrim(_v)::numeric;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.try_timestamptz(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.try_numeric(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.try_timestamptz(text) TO service_role;
GRANT EXECUTE ON FUNCTION private.try_numeric(text) TO service_role;

-- ===========================================================================
-- work item identity is immutable
-- ===========================================================================
--
-- Re-ingestion may update owner, business value, due signal and eligibility
-- window. It may not change what the item IS, and it may not resurrect an
-- item that has already concluded.
--
-- Reopening a resolved item is the dangerous one and the reason this is a
-- trigger rather than a convention: a feed that keeps sending a policy after
-- it was renewed would, without this, silently flip it back to open on every
-- run, and the outcome recorded against it would stop matching the item's
-- state. Every rate computed from either would then be wrong, in opposite
-- directions.

CREATE OR REPLACE FUNCTION public.work_items_protect_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.work_type_id IS DISTINCT FROM OLD.work_type_id THEN
    RAISE EXCEPTION 'לא ניתן לשנות את סוג העבודה של פריט קיים' USING ERRCODE = 'P0020';
  END IF;
  IF NEW.external_ref IS DISTINCT FROM OLD.external_ref THEN
    RAISE EXCEPTION 'לא ניתן לשנות את המזהה החיצוני של פריט קיים' USING ERRCODE = 'P0020';
  END IF;
  IF OLD.state = 'resolved' AND NEW.state = 'open' THEN
    RAISE EXCEPTION 'לא ניתן להחזיר פריט שהוכרע למצב פתוח' USING ERRCODE = 'P0020';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_items_protect_identity_trg ON public.work_items;
CREATE TRIGGER work_items_protect_identity_trg
  BEFORE UPDATE ON public.work_items
  FOR EACH ROW EXECUTE FUNCTION public.work_items_protect_identity();

COMMENT ON FUNCTION public.work_items_protect_identity() IS
  'Re-ingestion may change owner, value, due signal and eligibility window; it may not change what an item is, nor reopen one that already concluded. A feed that keeps sending a renewed policy would otherwise flip it back to open on every run, leaving the recorded outcome disagreeing with the item state and every rate derived from either one wrong.';

-- ===========================================================================
-- step 1 — begin
-- ===========================================================================

DROP FUNCTION IF EXISTS public.ingestion_begin_batch(text, text, uuid, text);
CREATE FUNCTION public.ingestion_begin_batch(
  _source_key text,
  _external_batch_ref text,
  _triggered_by uuid,
  _trigger_kind text
)
RETURNS TABLE (out_batch_id uuid, out_source_id uuid, out_work_type_id uuid, out_ingestion_mode text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source record;
  v_inflight uuid;
  v_id uuid;
BEGIN
  SELECT s.id, s.work_type_id, s.ingestion_mode, s.active
    INTO v_source
  FROM public.ingestion_sources s WHERE s.key = _source_key;

  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'מקור קליטה לא נמצא: %', _source_key USING ERRCODE = 'P0023';
  END IF;
  IF NOT v_source.active THEN
    RAISE EXCEPTION 'מקור הקליטה % מושבת', _source_key USING ERRCODE = 'P0023';
  END IF;

  -- One import per source at a time. Two concurrent snapshot imports would
  -- each void what the other just published; the advisory lock makes the
  -- in-flight check below true at COMMIT and not merely at the moment it ran.
  PERFORM pg_advisory_xact_lock(hashtext('pulse.ingestion.' || _source_key));

  SELECT b.id INTO v_inflight
  FROM public.ingestion_batches b
  WHERE b.source_id = v_source.id
    AND b.status IN ('open', 'staged', 'validated')
  LIMIT 1;

  IF v_inflight IS NOT NULL THEN
    RAISE EXCEPTION 'קיימת אצווה פעילה (%) עבור מקור זה — יש להשלים או לדחות אותה תחילה', v_inflight
      USING ERRCODE = 'P0021';
  END IF;

  INSERT INTO public.ingestion_batches (source_id, external_batch_ref, triggered_by, trigger_kind, status)
  VALUES (v_source.id, _external_batch_ref, _triggered_by, COALESCE(_trigger_kind, 'scheduled'), 'open')
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_source.id, v_source.work_type_id, v_source.ingestion_mode;
END;
$$;

REVOKE ALL ON FUNCTION public.ingestion_begin_batch(text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingestion_begin_batch(text, text, uuid, text) TO service_role;

-- ===========================================================================
-- step 3 — finalize staging
-- ===========================================================================
--
-- Freezes what was staged: counts it and computes the batch checksum.
--
-- The checksum aggregates ROW checksums in sorted order, so the same content
-- delivered in a different row order yields the same value. Duplicate
-- detection is about the content being a repeat, not about the file being
-- byte-identical — a source that sorts differently between runs would
-- otherwise defeat the check entirely.

DROP FUNCTION IF EXISTS public.ingestion_finalize_staging(uuid);
CREATE FUNCTION public.ingestion_finalize_staging(_batch_id uuid)
RETURNS TABLE (out_row_count integer, out_checksum text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_count integer;
  v_checksum text;
BEGIN
  SELECT b.status INTO v_status FROM public.ingestion_batches b WHERE b.id = _batch_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'אצווה לא נמצאה' USING ERRCODE = 'P0022';
  END IF;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'לא ניתן לסגור העלאה של אצווה בסטטוס %', v_status USING ERRCODE = 'P0022';
  END IF;

  SELECT count(*)::integer, md5(coalesce(string_agg(r.row_checksum, '' ORDER BY r.row_checksum), ''))
    INTO v_count, v_checksum
  FROM public.ingestion_staging_rows r WHERE r.batch_id = _batch_id;

  UPDATE public.ingestion_batches
  SET row_count = v_count, checksum = v_checksum, status = 'staged', staged_at = now()
  WHERE id = _batch_id;

  RETURN QUERY SELECT v_count, v_checksum;
END;
$$;

REVOKE ALL ON FUNCTION public.ingestion_finalize_staging(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingestion_finalize_staging(uuid) TO service_role;

-- ===========================================================================
-- step 4 — validate
-- ===========================================================================
--
-- Parses every staged row, then runs five checks over the batch as a whole.
-- The batch passes only if all five pass; there is no partial pass and no
-- "publish the good rows" path.
--
-- The full result — every check, whether it passed, and the numbers it saw —
-- is stored on the batch. A rejection has to remain explainable months later,
-- after the thresholds that produced it have been changed, and a boolean
-- cannot do that.

DROP FUNCTION IF EXISTS public.ingestion_validate_batch(uuid);
CREATE FUNCTION public.ingestion_validate_batch(_batch_id uuid)
RETURNS TABLE (out_passed boolean, out_validation_result jsonb, out_rejection_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch record;
  v_source record;
  v_invalid integer;
  v_invalid_pct numeric;
  v_dup_refs integer;
  v_dup_batch uuid;
  v_baseline numeric;
  v_floor numeric;
  v_checks jsonb := '[]'::jsonb;
  v_passed boolean := true;
  v_code text := NULL;
  v_detail text := NULL;
BEGIN
  SELECT b.* INTO v_batch FROM public.ingestion_batches b WHERE b.id = _batch_id FOR UPDATE;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'אצווה לא נמצאה' USING ERRCODE = 'P0022';
  END IF;
  IF v_batch.status <> 'staged' THEN
    RAISE EXCEPTION 'לא ניתן לאמת אצווה בסטטוס %', v_batch.status USING ERRCODE = 'P0022';
  END IF;

  SELECT * INTO v_source FROM public.ingestion_sources WHERE id = v_batch.source_id;

  -- ---------- parse and classify ----------
  --
  -- ONE pass. It was three — parse, classify, flag — which read better but
  -- rewrote every staged row three times. At a hundred thousand rows that is
  -- three full table rewrites plus index maintenance on each, and measurement
  -- put it at roughly 9 seconds where the parsing itself accounts for about
  -- 0.3 (private.try_timestamptz costs ~1.5us per call, not the 30 the
  -- subtransaction in its EXCEPTION block might suggest).
  --
  -- So the classification recomputes the parsers inside its CASE arms rather
  -- than reading the columns the same statement is setting. That is more
  -- function calls and far less I/O, and I/O is what this statement is bound
  -- by.
  --
  -- The arm order is a precedence order: a row missing its key reports
  -- missing_external_ref even when its date is also malformed, because that is
  -- what an operator fixes first. One error per row, chosen deliberately
  -- rather than by whichever check happened to run last.
  -- The owner lookup is a JOIN, not a correlated subquery. As a subquery the
  -- planner ran it once per staged row — a sequential scan of the roster,
  -- 100,000 times, which measured at 3.2 seconds by itself and was the single
  -- largest cost in the pipeline. As a join it is one hash build over a few
  -- hundred representatives. Safe because external_ref is UNIQUE, so the join
  -- cannot multiply rows.
  WITH parsed AS (
    SELECT
      r.id,
      rep.id AS owner_id,
      private.try_timestamptz(r.due_at_raw) AS due_at,
      private.try_timestamptz(r.eligible_from_raw) AS eligible_from,
      private.try_numeric(r.business_value_raw) AS business_value,
      r.external_ref, r.due_at_raw, r.eligible_from_raw,
      r.business_value_raw, r.owner_external_ref
    FROM public.ingestion_staging_rows r
    LEFT JOIN public.representatives rep
      ON btrim(coalesce(r.owner_external_ref, '')) <> ''
     AND rep.external_ref = btrim(r.owner_external_ref)
    WHERE r.batch_id = _batch_id
  ), classified AS (
    SELECT p.*,
      CASE
        WHEN p.external_ref IS NULL OR btrim(p.external_ref) = '' THEN 'missing_external_ref'
        WHEN btrim(coalesce(p.due_at_raw, '')) <> '' AND p.due_at IS NULL THEN 'malformed_due_at'
        WHEN btrim(coalesce(p.eligible_from_raw, '')) <> '' AND p.eligible_from IS NULL THEN 'malformed_eligible_from'
        WHEN btrim(coalesce(p.business_value_raw, '')) <> '' AND p.business_value IS NULL THEN 'malformed_business_value'
        WHEN p.business_value < 0 THEN 'negative_business_value'
        WHEN btrim(coalesce(p.owner_external_ref, '')) <> '' AND p.owner_id IS NULL THEN 'unknown_owner'
        WHEN p.due_at IS NOT NULL AND p.eligible_from IS NOT NULL AND p.due_at < p.eligible_from THEN 'window_inverted'
        ELSE NULL
      END AS error_code
    FROM parsed p
  )
  UPDATE public.ingestion_staging_rows r
  SET owner_representative_id = c.owner_id,
      due_at = c.due_at,
      eligible_from = c.eligible_from,
      business_value = c.business_value,
      error_code = c.error_code,
      error_detail = CASE c.error_code
        WHEN 'malformed_due_at' THEN left(c.due_at_raw, 100)
        WHEN 'malformed_eligible_from' THEN left(c.eligible_from_raw, 100)
        WHEN 'malformed_business_value' THEN left(c.business_value_raw, 100)
        WHEN 'negative_business_value' THEN left(c.business_value_raw, 100)
        WHEN 'unknown_owner' THEN left(c.owner_external_ref, 100)
        ELSE NULL
      END,
      valid = (c.error_code IS NULL)
  FROM classified c
  WHERE r.id = c.id;

  -- ---------- check 1: non-empty ----------
  --
  -- Always fatal, and never a threshold question. A feed that delivered
  -- nothing has failed, and publishing it in snapshot mode would void the
  -- entire book.
  IF v_batch.row_count = 0 THEN
    v_passed := false;
    v_code := COALESCE(v_code, 'empty_batch');
    v_detail := COALESCE(v_detail, 'האצווה אינה מכילה שורות כלל');
  END IF;
  v_checks := v_checks || jsonb_build_object(
    'check', 'non_empty', 'passed', v_batch.row_count > 0,
    'detail', jsonb_build_object('row_count', v_batch.row_count));

  -- ---------- check 2: row integrity ----------
  SELECT count(*)::integer INTO v_invalid
  FROM public.ingestion_staging_rows WHERE batch_id = _batch_id AND valid IS FALSE;

  v_invalid_pct := CASE WHEN v_batch.row_count = 0 THEN 0
                        ELSE round(v_invalid::numeric * 100 / v_batch.row_count, 2) END;

  IF v_invalid_pct > v_source.max_invalid_row_pct THEN
    v_passed := false;
    v_code := COALESCE(v_code, 'corrupted_rows');
    v_detail := COALESCE(v_detail,
      v_invalid || ' שורות פגומות (' || v_invalid_pct || '%) — מעל הסף ' || v_source.max_invalid_row_pct || '%');
  END IF;
  v_checks := v_checks || jsonb_build_object(
    'check', 'row_integrity', 'passed', v_invalid_pct <= v_source.max_invalid_row_pct,
    'detail', jsonb_build_object(
      'invalid_rows', v_invalid, 'invalid_pct', v_invalid_pct,
      'threshold_pct', v_source.max_invalid_row_pct,
      'top_errors', COALESCE((
        SELECT jsonb_agg(e) FROM (
          SELECT jsonb_build_object('error_code', error_code, 'count', count(*), 'example', min(error_detail)) AS e
          FROM public.ingestion_staging_rows
          WHERE batch_id = _batch_id AND valid IS FALSE
          GROUP BY error_code ORDER BY count(*) DESC LIMIT 5
        ) t), '[]'::jsonb)));

  -- ---------- check 3: duplicate keys within the batch ----------
  --
  -- Two rows claiming the same external_ref make the publish non-deterministic
  -- — whichever the upsert happens to apply last wins, and it may differ
  -- between runs of identical input. Rejected rather than silently resolved.
  SELECT count(*)::integer INTO v_dup_refs FROM (
    SELECT external_ref FROM public.ingestion_staging_rows
    WHERE batch_id = _batch_id AND external_ref IS NOT NULL AND btrim(external_ref) <> ''
    GROUP BY external_ref HAVING count(*) > 1
  ) d;

  IF v_dup_refs > 0 THEN
    v_passed := false;
    v_code := COALESCE(v_code, 'duplicate_keys');
    v_detail := COALESCE(v_detail, v_dup_refs || ' מזהים חיצוניים מופיעים יותר מפעם אחת באצווה');
  END IF;
  v_checks := v_checks || jsonb_build_object(
    'check', 'duplicate_keys', 'passed', v_dup_refs = 0,
    'detail', jsonb_build_object('duplicate_external_refs', v_dup_refs));

  -- ---------- check 4: duplicate batch ----------
  --
  -- The same content already published for this source. Rejected, not treated
  -- as a harmless no-op, because publishing it would move last_successful_
  -- import forward and make the inventory look freshly refreshed when in fact
  -- nothing new arrived. A freshness figure that reports a re-send as a
  -- refresh is worse than no freshness figure.
  SELECT b.id INTO v_dup_batch
  FROM public.ingestion_batches b
  WHERE b.source_id = v_batch.source_id
    AND b.status = 'published'
    AND b.checksum = v_batch.checksum
  ORDER BY b.completed_at DESC LIMIT 1;

  IF v_dup_batch IS NOT NULL THEN
    v_passed := false;
    v_code := COALESCE(v_code, 'duplicate_batch');
    v_detail := COALESCE(v_detail, 'תוכן זהה כבר נקלט באצווה ' || v_dup_batch);
  END IF;
  v_checks := v_checks || jsonb_build_object(
    'check', 'duplicate_batch', 'passed', v_dup_batch IS NULL,
    'detail', jsonb_build_object('checksum', v_batch.checksum, 'matches_batch', v_dup_batch));

  -- ---------- check 5: volume ----------
  --
  -- MEDIAN of the trailing published batches, not mean. One anomalous batch
  -- that did get through must not drag the floor down far enough to admit the
  -- next one — which is precisely how a feed degrades silently over a week
  -- instead of failing loudly on day one.
  --
  -- The first batch for a source has no baseline and is not blocked. There is
  -- nothing to compare it against, and refusing to start is not a safer answer
  -- than starting.
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY b.row_count) INTO v_baseline
  FROM (
    SELECT row_count FROM public.ingestion_batches
    WHERE source_id = v_batch.source_id AND status = 'published'
    ORDER BY completed_at DESC
    LIMIT v_source.volume_baseline_batches
  ) b;

  v_floor := CASE WHEN v_baseline IS NULL THEN NULL
                  ELSE round(v_baseline * v_source.volume_floor_pct / 100, 0) END;

  IF v_floor IS NOT NULL AND v_batch.row_count < v_floor THEN
    v_passed := false;
    v_code := COALESCE(v_code, 'volume_drop');
    v_detail := COALESCE(v_detail,
      v_batch.row_count || ' שורות מול חציון ' || v_baseline || ' — מתחת לסף ' || v_floor);
  END IF;
  v_checks := v_checks || jsonb_build_object(
    'check', 'volume', 'passed', v_floor IS NULL OR v_batch.row_count >= v_floor,
    'detail', jsonb_build_object(
      'row_count', v_batch.row_count, 'trailing_median', v_baseline,
      'floor', v_floor, 'threshold_pct', v_source.volume_floor_pct,
      'baseline_batches', v_source.volume_baseline_batches));

  -- ---------- decide ----------
  UPDATE public.ingestion_batches
  SET status = CASE WHEN v_passed THEN 'validated' ELSE 'rejected' END,
      validated_at = now(),
      validation_result = jsonb_build_object('passed', v_passed, 'checks', v_checks),
      rows_rejected = v_invalid,
      rejection_code = CASE WHEN v_passed THEN NULL ELSE v_code END,
      rejection_detail = CASE WHEN v_passed THEN NULL ELSE v_detail END,
      completed_at = CASE WHEN v_passed THEN NULL ELSE now() END,
      duration_ms = CASE WHEN v_passed THEN NULL
                         ELSE (extract(epoch FROM (now() - v_batch.started_at)) * 1000)::integer END
  WHERE id = _batch_id;

  INSERT INTO public.ingestion_events (source_id, batch_id, severity, event_code, message, detail)
  VALUES (
    v_batch.source_id, _batch_id,
    CASE WHEN v_passed THEN 'info' ELSE 'error' END,
    CASE WHEN v_passed THEN 'batch_validated' ELSE 'batch_rejected' END,
    CASE WHEN v_passed
      THEN 'האצווה עברה אימות (' || v_batch.row_count || ' שורות)'
      ELSE 'האצווה נדחתה: ' || COALESCE(v_detail, v_code) END,
    jsonb_build_object('passed', v_passed, 'checks', v_checks, 'rejection_code', v_code));

  RETURN QUERY SELECT v_passed, jsonb_build_object('passed', v_passed, 'checks', v_checks), v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.ingestion_validate_batch(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingestion_validate_batch(uuid) TO service_role;

COMMENT ON FUNCTION public.ingestion_validate_batch(uuid) IS
  'Parses every staged row and runs five whole-batch checks: non-empty, row integrity, duplicate keys, duplicate batch, volume against the trailing MEDIAN. Passes only if all five pass — there is no partial pass and no publish-the-good-rows path. Stores the full result so a rejection stays explainable after the thresholds change.';

-- ===========================================================================
-- step 5 — publish
-- ===========================================================================
--
-- One transaction. Everything below either commits together or does not
-- happen, so the previously published inventory is never partially replaced.
--
-- Three outcomes per staged row and one for the rows that are absent:
--   inserted   no work item with this key existed
--   updated    it existed and at least one mutable field differs
--   unchanged  it existed and nothing differs — the common case for a daily
--              snapshot, and worth counting because a batch that updates
--              nothing is a signal in itself
--   voided     snapshot mode only: an open item that this batch did NOT send,
--              meaning it left the book
--
-- Only four columns are ever written on an existing row. Outcome history and
-- audit history are not touched by any statement here, and could not be:
-- outcomes is append-only by trigger and this function never references it.

DROP FUNCTION IF EXISTS public.ingestion_publish_batch(uuid);
CREATE FUNCTION public.ingestion_publish_batch(_batch_id uuid)
RETURNS TABLE (
  out_rows_inserted integer, out_rows_updated integer,
  out_rows_unchanged integer, out_rows_voided integer, out_duration_ms integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch record;
  v_source record;
  v_matched integer;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_voided integer := 0;
  v_duration integer;
BEGIN
  SELECT b.* INTO v_batch FROM public.ingestion_batches b WHERE b.id = _batch_id FOR UPDATE;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'אצווה לא נמצאה' USING ERRCODE = 'P0022';
  END IF;
  IF v_batch.status <> 'validated' THEN
    RAISE EXCEPTION 'לא ניתן לפרסם אצווה בסטטוס % — רק אצווה שעברה אימות ניתנת לפרסום', v_batch.status
      USING ERRCODE = 'P0024';
  END IF;

  SELECT * INTO v_source FROM public.ingestion_sources WHERE id = v_batch.source_id;

  -- How many staged keys already exist. Taken before any write, so
  -- unchanged = matched - updated is arithmetic rather than a second scan.
  SELECT count(*)::integer INTO v_matched
  FROM public.ingestion_staging_rows r
  JOIN public.work_items w
    ON w.work_type_id = v_source.work_type_id AND w.external_ref = r.external_ref
  WHERE r.batch_id = _batch_id AND r.valid;

  -- ---------- update ----------
  --
  -- IS DISTINCT FROM on all four, so a row that changed nothing is not
  -- rewritten. That keeps updated_at meaningful and keeps the row count
  -- honest: "12 of 100,000 items moved today" is the operationally
  -- interesting fact, and an unconditional UPDATE would report 100,000.
  UPDATE public.work_items w
  SET owner_representative_id = r.owner_representative_id,
      business_value = COALESCE(r.business_value, 0),
      due_at = r.due_at,
      eligible_from = r.eligible_from,
      ingestion_batch_id = _batch_id,
      ingested_at = now()
  FROM public.ingestion_staging_rows r
  WHERE r.batch_id = _batch_id
    AND r.valid
    AND w.work_type_id = v_source.work_type_id
    AND w.external_ref = r.external_ref
    AND (
      w.owner_representative_id IS DISTINCT FROM r.owner_representative_id
      OR w.business_value IS DISTINCT FROM COALESCE(r.business_value, 0)
      OR w.due_at IS DISTINCT FROM r.due_at
      OR w.eligible_from IS DISTINCT FROM r.eligible_from
    );
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  v_unchanged := v_matched - v_updated;

  -- ---------- insert ----------
  INSERT INTO public.work_items (
    work_type_id, external_ref, subject_ref, subject_label,
    owner_representative_id, eligible_from, due_at, business_value,
    ingestion_batch_id, ingested_at)
  SELECT
    v_source.work_type_id, r.external_ref, r.subject_ref, r.subject_label,
    r.owner_representative_id, r.eligible_from, r.due_at, COALESCE(r.business_value, 0),
    _batch_id, now()
  FROM public.ingestion_staging_rows r
  WHERE r.batch_id = _batch_id AND r.valid
  ON CONFLICT (work_type_id, external_ref) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- ---------- void what the snapshot omitted ----------
  --
  -- Snapshot mode only. In incremental mode absence carries no information at
  -- all, and treating it as departure would void the entire inventory on the
  -- first run.
  --
  -- Only 'open' items. A resolved item is history and is not the snapshot's to
  -- withdraw; the identity trigger would refuse the transition anyway.
  IF v_source.ingestion_mode = 'snapshot' THEN
    UPDATE public.work_items w
    SET state = 'voided',
        voided_reason = 'לא נכלל בקליטה מלאה מיום ' || to_char(now(), 'YYYY-MM-DD')
    WHERE w.work_type_id = v_source.work_type_id
      AND w.state = 'open'
      AND NOT EXISTS (
        SELECT 1 FROM public.ingestion_staging_rows r
        WHERE r.batch_id = _batch_id AND r.valid AND r.external_ref = w.external_ref
      );
    GET DIAGNOSTICS v_voided = ROW_COUNT;
  END IF;

  v_duration := (extract(epoch FROM (now() - v_batch.started_at)) * 1000)::integer;

  UPDATE public.ingestion_batches
  SET status = 'published',
      rows_inserted = v_inserted, rows_updated = v_updated,
      rows_unchanged = v_unchanged, rows_voided = v_voided,
      completed_at = now(), duration_ms = v_duration
  WHERE id = _batch_id;

  INSERT INTO public.ingestion_events (source_id, batch_id, severity, event_code, message, detail)
  VALUES (v_batch.source_id, _batch_id, 'info', 'batch_published',
    'נקלטו ' || v_inserted || ' פריטים חדשים, עודכנו ' || v_updated || ', ללא שינוי ' || v_unchanged
      || CASE WHEN v_voided > 0 THEN ', בוטלו ' || v_voided ELSE '' END,
    jsonb_build_object('inserted', v_inserted, 'updated', v_updated,
      'unchanged', v_unchanged, 'voided', v_voided, 'duration_ms', v_duration));

  RETURN QUERY SELECT v_inserted, v_updated, v_unchanged, v_voided, v_duration;
END;
$$;

REVOKE ALL ON FUNCTION public.ingestion_publish_batch(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingestion_publish_batch(uuid) TO service_role;

COMMENT ON FUNCTION public.ingestion_publish_batch(uuid) IS
  'Promotes a validated batch into work_items in one transaction. Writes only owner, business value, due signal and eligibility window on existing rows; never touches outcome or audit history. In snapshot mode, open items the batch omitted are voided — in incremental mode absence means nothing and nothing is voided.';

-- ===========================================================================
-- reject
-- ===========================================================================
--
-- For abandoning a batch that failed outside validation — the source went away
-- mid-load, the caller crashed, an operator cancelled it. Validation rejects
-- its own batches inline; this is for everything else.

DROP FUNCTION IF EXISTS public.ingestion_reject_batch(uuid, text, text);
CREATE FUNCTION public.ingestion_reject_batch(_batch_id uuid, _code text, _detail text)
RETURNS TABLE (out_batch_id uuid, out_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch record;
BEGIN
  IF _code IS NULL OR btrim(_code) = '' THEN
    RAISE EXCEPTION 'דחיית אצווה מחייבת קוד סיבה' USING ERRCODE = 'P0022';
  END IF;

  SELECT b.* INTO v_batch FROM public.ingestion_batches b WHERE b.id = _batch_id FOR UPDATE;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'אצווה לא נמצאה' USING ERRCODE = 'P0022';
  END IF;
  IF v_batch.status IN ('published', 'rejected') THEN
    RAISE EXCEPTION 'האצווה כבר הושלמה (%)', v_batch.status USING ERRCODE = 'P0022';
  END IF;

  UPDATE public.ingestion_batches
  SET status = 'rejected', rejection_code = _code, rejection_detail = _detail,
      completed_at = now(),
      duration_ms = (extract(epoch FROM (now() - v_batch.started_at)) * 1000)::integer
  WHERE id = _batch_id;

  INSERT INTO public.ingestion_events (source_id, batch_id, severity, event_code, message, detail)
  VALUES (v_batch.source_id, _batch_id, 'error', 'batch_rejected',
    'האצווה נדחתה: ' || COALESCE(_detail, _code),
    jsonb_build_object('rejection_code', _code, 'stage', v_batch.status));

  RETURN QUERY SELECT _batch_id, 'rejected'::text;
END;
$$;

REVOKE ALL ON FUNCTION public.ingestion_reject_batch(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingestion_reject_batch(uuid, text, text) TO service_role;

-- ===========================================================================
-- freshness
-- ===========================================================================
--
-- Three facts per source, and the age is returned rather than a rendered
-- label: a consumer must be able to say WHEN, not merely "recent". The
-- classification into fresh/warning/critical lives in ingestion-domain.ts so
-- it is unit-testable, but the thresholds travel with the row so the two
-- cannot disagree about which numbers they were applied to.
--
-- A source that has NEVER published successfully returns a row with nulls
-- rather than no row at all. An absent row would be indistinguishable from a
-- source that does not exist, and "we have never received anything from this
-- feed" is the single most important thing this function can say.

DROP FUNCTION IF EXISTS public.ingestion_freshness();
CREATE FUNCTION public.ingestion_freshness()
RETURNS TABLE (
  out_source_key text,
  out_source_name text,
  out_work_type_key text,
  out_last_published_at timestamptz,
  out_last_batch_id uuid,
  out_last_row_count integer,
  out_age_seconds numeric,
  out_last_attempt_at timestamptz,
  out_last_attempt_status text,
  out_consecutive_failures integer,
  out_warning_hours integer,
  out_critical_hours integer,
  out_open_item_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.key,
    s.display_name,
    wt.key,
    pub.completed_at,
    pub.id,
    pub.row_count,
    CASE WHEN pub.completed_at IS NULL THEN NULL
         ELSE extract(epoch FROM (now() - pub.completed_at)) END,
    att.started_at,
    att.status,
    COALESCE((
      -- Failures since the last success. Counted here rather than stored,
      -- because a stored counter is state that can drift from the history it
      -- claims to summarize.
      SELECT count(*)::integer FROM public.ingestion_batches b
      WHERE b.source_id = s.id
        AND b.status IN ('rejected', 'failed')
        AND (pub.completed_at IS NULL OR b.started_at > pub.completed_at)
    ), 0),
    s.freshness_warning_hours,
    s.freshness_critical_hours,
    COALESCE((
      SELECT count(*)::integer FROM public.work_items w
      WHERE w.work_type_id = s.work_type_id AND w.state = 'open'
    ), 0)
  FROM public.ingestion_sources s
  JOIN public.work_types wt ON wt.id = s.work_type_id
  LEFT JOIN LATERAL (
    SELECT b.id, b.completed_at, b.row_count FROM public.ingestion_batches b
    WHERE b.source_id = s.id AND b.status = 'published'
    ORDER BY b.completed_at DESC LIMIT 1
  ) pub ON true
  LEFT JOIN LATERAL (
    SELECT b.started_at, b.status FROM public.ingestion_batches b
    WHERE b.source_id = s.id
    ORDER BY b.started_at DESC LIMIT 1
  ) att ON true
  WHERE s.active
  ORDER BY s.key;
$$;

REVOKE ALL ON FUNCTION public.ingestion_freshness() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingestion_freshness() TO service_role;

COMMENT ON FUNCTION public.ingestion_freshness() IS
  'Three facts per source — what, when, from where — plus the thresholds to judge them by. A source that has never published returns a row with nulls rather than no row: an absent row is indistinguishable from a source that does not exist, and "we have never received anything from this feed" is the most important thing this can say.';

-- ===========================================================================
-- staging retention
-- ===========================================================================
--
-- Staging rows are the detail behind a batch summary and are worth keeping
-- only while someone might investigate a rejection. At 100k rows per daily
-- batch they are also, by a wide margin, the largest thing this pipeline
-- writes. The batch summary survives the purge, which is why the counts are
-- stored on the batch rather than derived from these rows.

DROP FUNCTION IF EXISTS public.ingestion_purge_staging(integer);
CREATE FUNCTION public.ingestion_purge_staging(_older_than_days integer)
RETURNS TABLE (out_batches_purged integer, out_rows_purged bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batches integer;
  v_rows bigint;
BEGIN
  IF _older_than_days IS NULL OR _older_than_days < 1 THEN
    RAISE EXCEPTION 'תקופת שמירה חייבת להיות לפחות יום אחד' USING ERRCODE = 'P0022';
  END IF;

  SELECT count(DISTINCT r.batch_id)::integer, count(*)::bigint INTO v_batches, v_rows
  FROM public.ingestion_staging_rows r
  JOIN public.ingestion_batches b ON b.id = r.batch_id
  WHERE b.status IN ('published', 'rejected')
    AND b.completed_at < now() - make_interval(days => _older_than_days);

  DELETE FROM public.ingestion_staging_rows r
  USING public.ingestion_batches b
  WHERE b.id = r.batch_id
    AND b.status IN ('published', 'rejected')
    AND b.completed_at < now() - make_interval(days => _older_than_days);

  RETURN QUERY SELECT COALESCE(v_batches, 0), COALESCE(v_rows, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.ingestion_purge_staging(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingestion_purge_staging(integer) TO service_role;
