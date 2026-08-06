-- Pulse v2 — PR #2: Work Inventory Pipeline (tables)
--
-- Additive only. Nothing from PR #1 is altered except the addition of a
-- foreign key from work_items.ingestion_batch_id, which was already present as
-- an unconstrained uuid awaiting this table.
--
-- THE SHAPE, AND WHY IT IS STAGE-THEN-PUBLISH.
--
-- "Never publish partial inventory" cannot be satisfied by a pipeline that
-- writes rows into work_items as it reads them, because a failure halfway
-- through has already published half a book. So every import lands in a
-- staging table first, is validated as a whole, and is then either promoted
-- into work_items in ONE transaction or rejected without touching the live
-- inventory at all. The previous published inventory survives every failure
-- mode by construction rather than by cleanup.
--
-- STAGING HOLDS TEXT. Every incoming field is stored exactly as received and
-- parsed during validation, not at insert time. Three reasons:
--
--   1. A malformed date must be DETECTABLE as a corrupted row. If the column
--      were timestamptz the insert would fail and the batch would die with an
--      opaque database error instead of a validation result naming the row.
--   2. The row checksum is then over immutable text, so it can be a generated
--      column rather than trigger-maintained state that can drift.
--   3. The raw value survives for a human to look at when a row is rejected.
--      "row 8,412: due_at '31/09/2026'" is diagnosable; "invalid input syntax
--      for type timestamp with time zone" is not.
--
-- CHECKSUMS ARE ORDER-INDEPENDENT. The batch checksum aggregates the row
-- checksums in sorted order, so the same content delivered in a different row
-- order produces the same checksum. Duplicate detection is about the CONTENT
-- being a repeat, not about the file being byte-identical.

-- ===========================================================================
-- ingestion_sources
-- ===========================================================================
--
-- One row per feed. Holds the thresholds that decide whether a batch is
-- publishable, because "abnormal" is a property of a particular feed: a
-- renewals expiry book varies by a few percent day to day, a campaign lead
-- list varies by an order of magnitude, and one global threshold would either
-- pass everything or block everything.
--
-- ingestion_mode is the other per-feed fact that cannot be guessed. A snapshot
-- feed sends the whole book every time, so an item's ABSENCE is meaningful and
-- means it left the book. An incremental feed sends only what changed, so
-- absence means nothing at all. Reading the second as the first would void the
-- entire inventory on the first incremental run.

CREATE TABLE IF NOT EXISTS public.ingestion_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  work_type_id uuid NOT NULL REFERENCES public.work_types(id) ON DELETE RESTRICT,

  ingestion_mode text NOT NULL DEFAULT 'snapshot'
    CHECK (ingestion_mode IN ('snapshot', 'incremental')),

  -- A batch smaller than this share of the trailing median is rejected. 80 is
  -- the PRD's figure; a feed with genuinely lumpy volume raises it here rather
  -- than the pipeline lowering its standards everywhere.
  volume_floor_pct integer NOT NULL DEFAULT 80
    CHECK (volume_floor_pct BETWEEN 0 AND 100),

  -- How many previous published batches the median is taken over. A MEDIAN,
  -- not a mean: one anomalous batch that did get published must not drag the
  -- floor down far enough to admit the next bad one.
  volume_baseline_batches integer NOT NULL DEFAULT 7
    CHECK (volume_baseline_batches BETWEEN 1 AND 60),

  -- Share of rows allowed to be unparseable before the whole batch is
  -- rejected. Zero by default: "never publish partial inventory" read
  -- strictly. Raising it is a deliberate per-source decision with a visible
  -- consequence, not a default that erodes quietly.
  max_invalid_row_pct numeric(5, 2) NOT NULL DEFAULT 0
    CHECK (max_invalid_row_pct BETWEEN 0 AND 100),

  -- Beyond this, the inventory from this source is stale and every consumer
  -- must say so rather than render the last figures as current.
  freshness_warning_hours integer NOT NULL DEFAULT 26 CHECK (freshness_warning_hours > 0),
  freshness_critical_hours integer NOT NULL DEFAULT 50 CHECK (freshness_critical_hours > 0),

  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ingestion_sources_freshness_ordered
    CHECK (freshness_critical_hours >= freshness_warning_hours)
);

COMMENT ON TABLE public.ingestion_sources IS
  'One row per inbound feed, holding the thresholds that decide whether a batch may be published. Thresholds live per source because "abnormal volume" is a property of a particular feed, and one global number would either pass everything or block everything.';
COMMENT ON COLUMN public.ingestion_sources.ingestion_mode IS
  'snapshot: the feed sends the whole book, so an item''s absence means it left the book and it is voided. incremental: the feed sends only changes, so absence means nothing. Reading an incremental feed as a snapshot would void the entire inventory on its first run.';
COMMENT ON COLUMN public.ingestion_sources.max_invalid_row_pct IS
  'Zero by default. "Never publish partial inventory" read strictly: one unparseable row rejects the batch. Raising it is a per-source decision that must be made deliberately.';

GRANT SELECT ON public.ingestion_sources TO authenticated;
GRANT ALL ON public.ingestion_sources TO service_role;
ALTER TABLE public.ingestion_sources ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER ingestion_sources_updated BEFORE UPDATE ON public.ingestion_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===========================================================================
-- ingestion_batches
-- ===========================================================================
--
-- IMMUTABLE ONCE TERMINAL. A batch that has been published or rejected is a
-- historical fact, and the whole point of keeping this history is to be able
-- to answer "what did the inventory look like on the 14th, and where did it
-- come from". A trigger enforces it, for the same reason outcomes has one:
-- a convention that everyone agrees to is not a guarantee.
--
-- The row counts are stored rather than derived because staging rows are
-- purged after a retention window, and a batch summary that stops being
-- answerable once its detail ages out is not a history.

CREATE TABLE IF NOT EXISTS public.ingestion_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.ingestion_sources(id) ON DELETE RESTRICT,

  -- The source system's own identifier for this delivery, when it has one.
  -- Lets an operator tie a Pulse batch back to a file or a job run.
  external_batch_ref text,

  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'staged', 'validated', 'published', 'rejected', 'failed')),

  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  checksum text,

  -- Outcome counts, filled at publish. Rejected rows are counted at validation
  -- and survive rejection, which is what makes a rejected batch diagnosable.
  rows_inserted integer NOT NULL DEFAULT 0,
  rows_updated integer NOT NULL DEFAULT 0,
  rows_unchanged integer NOT NULL DEFAULT 0,
  rows_rejected integer NOT NULL DEFAULT 0,
  rows_voided integer NOT NULL DEFAULT 0,

  started_at timestamptz NOT NULL DEFAULT now(),
  staged_at timestamptz,
  validated_at timestamptz,
  completed_at timestamptz,
  duration_ms integer,

  -- Every check that ran, whether it passed, and the numbers it saw. Stored so
  -- a rejection can be explained months later without re-deriving it from
  -- thresholds that have since changed.
  validation_result jsonb,
  rejection_code text,
  rejection_detail text,

  triggered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  /** 'scheduled' when a job started it, 'manual' when a person did. */
  trigger_kind text NOT NULL DEFAULT 'scheduled' CHECK (trigger_kind IN ('scheduled', 'manual')),

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ingestion_batches_rejection_paired
    CHECK ((status <> 'rejected') OR (rejection_code IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ingestion_batches_source_started_idx
  ON public.ingestion_batches (source_id, started_at DESC);
-- The freshness read and the volume baseline both want "recent published
-- batches for this source", which is the whole hot path of this table.
CREATE INDEX IF NOT EXISTS ingestion_batches_published_idx
  ON public.ingestion_batches (source_id, completed_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS ingestion_batches_checksum_idx
  ON public.ingestion_batches (source_id, checksum) WHERE status = 'published';

COMMENT ON TABLE public.ingestion_batches IS
  'One immutable record per import attempt, successful or not. Row counts are stored rather than derived because staging detail is purged on a retention window, and a batch history that stops being answerable once its detail ages out is not a history.';

GRANT SELECT ON public.ingestion_batches TO authenticated;
GRANT ALL ON public.ingestion_batches TO service_role;
ALTER TABLE public.ingestion_batches ENABLE ROW LEVEL SECURITY;

-- A published or rejected batch is a historical fact. Applies to service_role
-- as well — the only way to change what history says is to run another import.
CREATE OR REPLACE FUNCTION public.ingestion_batches_block_terminal_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('published', 'rejected') THEN
      RAISE EXCEPTION 'לא ניתן למחוק אצווה שהושלמה — היסטוריית הקליטה היא בלתי ניתנת לשינוי'
        USING ERRCODE = 'P0020';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status IN ('published', 'rejected') THEN
    RAISE EXCEPTION 'לא ניתן לשנות אצווה שהושלמה (סטטוס %) — יש להריץ קליטה חדשה', OLD.status
      USING ERRCODE = 'P0020';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ingestion_batches_immutable_trg ON public.ingestion_batches;
CREATE TRIGGER ingestion_batches_immutable_trg
  BEFORE UPDATE OR DELETE ON public.ingestion_batches
  FOR EACH ROW EXECUTE FUNCTION public.ingestion_batches_block_terminal_mutation();

-- work_items.ingestion_batch_id was declared in PR #1 as a bare uuid awaiting
-- this table. RESTRICT rather than CASCADE: deleting a batch must never take
-- inventory with it, and the trigger above already forbids deleting a
-- published one.
ALTER TABLE public.work_items
  DROP CONSTRAINT IF EXISTS work_items_ingestion_batch_id_fkey;
ALTER TABLE public.work_items
  ADD CONSTRAINT work_items_ingestion_batch_id_fkey
  FOREIGN KEY (ingestion_batch_id) REFERENCES public.ingestion_batches(id) ON DELETE RESTRICT;

-- ===========================================================================
-- ingestion_staging_rows
-- ===========================================================================
--
-- Untrusted input, held as text, validated as a set, then promoted or thrown
-- away. Nothing here is ever read by a feature; it exists so that validation
-- has something to validate and so a rejected batch can be explained row by
-- row.

CREATE TABLE IF NOT EXISTS public.ingestion_staging_rows (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES public.ingestion_batches(id) ON DELETE CASCADE,
  row_number integer NOT NULL,

  -- ---- as received ----
  external_ref text,
  subject_ref text,
  subject_label text,
  owner_external_ref text,
  due_at_raw text,
  eligible_from_raw text,
  business_value_raw text,

  -- ---- as parsed, during validation ----
  owner_representative_id uuid,
  due_at timestamptz,
  eligible_from timestamptz,
  business_value numeric(14, 2),

  valid boolean,
  error_code text,
  error_detail text,

  -- Immutable over text, so it can be generated rather than trigger-maintained.
  -- Deliberately does NOT include subject_label: a cosmetic rename in the
  -- source system must not make an otherwise identical delivery look like new
  -- content.
  row_checksum text GENERATED ALWAYS AS (
    md5(
      coalesce(external_ref, '') || '|' ||
      coalesce(subject_ref, '') || '|' ||
      coalesce(owner_external_ref, '') || '|' ||
      coalesce(due_at_raw, '') || '|' ||
      coalesce(eligible_from_raw, '') || '|' ||
      coalesce(business_value_raw, '')
    )
  ) STORED,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ingestion_staging_rows_batch_idx
  ON public.ingestion_staging_rows (batch_id);
-- Duplicate-key detection within a batch, and the publish-time join to
-- work_items, both scan this.
CREATE INDEX IF NOT EXISTS ingestion_staging_rows_batch_ref_idx
  ON public.ingestion_staging_rows (batch_id, external_ref);
CREATE INDEX IF NOT EXISTS ingestion_staging_rows_invalid_idx
  ON public.ingestion_staging_rows (batch_id) WHERE valid IS FALSE;

COMMENT ON TABLE public.ingestion_staging_rows IS
  'Untrusted import rows, held as received text and parsed during validation. Text rather than typed columns so that a malformed value is a DETECTABLE corrupted row naming its own row number, rather than an insert failure that kills the batch with an opaque database error.';
COMMENT ON COLUMN public.ingestion_staging_rows.row_checksum IS
  'Excludes subject_label deliberately: a cosmetic rename upstream must not make an otherwise identical delivery register as new content.';

-- No SELECT for authenticated at all. Staging can hold customer references for
-- the whole organization before any of it is scoped to an owner, so there is
-- no correct row-level predicate to write — the answer is that clients never
-- read it.
GRANT ALL ON public.ingestion_staging_rows TO service_role;
ALTER TABLE public.ingestion_staging_rows ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- ingestion_events
-- ===========================================================================
--
-- The admin-facing record of what the pipeline did and refused to do.
--
-- Separate from audit_log because audit_log records what a PERSON did, keyed
-- by actor and target user, and is shaped for user administration. A batch
-- rejected at 04:12 by a scheduled job has no actor and no target user, and
-- filing it there would either distort that table's shape or hide the event
-- among role changes. Data Health (PRD S-23) reads this.

CREATE TABLE IF NOT EXISTS public.ingestion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES public.ingestion_sources(id) ON DELETE SET NULL,
  batch_id uuid REFERENCES public.ingestion_batches(id) ON DELETE SET NULL,

  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  event_code text NOT NULL,
  message text NOT NULL,
  detail jsonb,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ingestion_events_created_idx
  ON public.ingestion_events (created_at DESC);
CREATE INDEX IF NOT EXISTS ingestion_events_source_idx
  ON public.ingestion_events (source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ingestion_events_severity_idx
  ON public.ingestion_events (severity, created_at DESC) WHERE severity <> 'info';

COMMENT ON TABLE public.ingestion_events IS
  'Admin-facing pipeline events — rejections, volume anomalies, staleness. Separate from audit_log, which records what a person did and is keyed by actor and target user; a batch rejected at 04:12 by a scheduled job has neither.';

GRANT SELECT ON public.ingestion_events TO authenticated;
GRANT ALL ON public.ingestion_events TO service_role;
ALTER TABLE public.ingestion_events ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- RLS
-- ===========================================================================
--
-- Ingestion metadata is organization-level: it describes the health of a feed,
-- not the performance of a person, so there is no representative to derive
-- scope from. Read is gated on the system.audit capability rather than on any
-- organizational assignment — a wide span of control is not a reason to see
-- pipeline internals.
--
-- No client write policy anywhere. Every write goes through a service_role
-- RPC called by an authorized server function.

DROP POLICY IF EXISTS "ingestion_sources read" ON public.ingestion_sources;
CREATE POLICY "ingestion_sources read" ON public.ingestion_sources
  FOR SELECT TO authenticated
  USING (private.has_system_capability('system.audit') OR private.has_system_capability('system.import'));

DROP POLICY IF EXISTS "ingestion_batches read" ON public.ingestion_batches;
CREATE POLICY "ingestion_batches read" ON public.ingestion_batches
  FOR SELECT TO authenticated
  USING (private.has_system_capability('system.audit') OR private.has_system_capability('system.import'));

DROP POLICY IF EXISTS "ingestion_events read" ON public.ingestion_events;
CREATE POLICY "ingestion_events read" ON public.ingestion_events
  FOR SELECT TO authenticated
  USING (private.has_system_capability('system.audit') OR private.has_system_capability('system.import'));

-- ===========================================================================
-- seed: the renewals source
-- ===========================================================================
--
-- Idempotent, and only when the renewals work type already exists — PR #1
-- created the table but seeded no work types, so a fresh environment gets
-- nothing here and an environment with renewals configured gets its feed.

INSERT INTO public.ingestion_sources (key, display_name, work_type_id, ingestion_mode)
SELECT 'renewals-core', 'ספר חידושים — מערכת ליבה', wt.id, 'snapshot'
FROM public.work_types wt
WHERE wt.key = 'renewals'
  AND NOT EXISTS (SELECT 1 FROM public.ingestion_sources s WHERE s.key = 'renewals-core');
