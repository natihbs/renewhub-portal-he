-- Pulse v2 — Sprint 0 / PR #1: Domain Foundation (tables)
--
-- Additive only. Nothing existing is dropped, renamed or re-pointed. v1 keeps
-- every table, policy and helper it has; this migration adds the domain model
-- that every v2 feature depends on, alongside it.
--
-- WHAT IS NEW AND WHY, in the order the PRD's entity table lists them:
--
--   work_types    the eight dimensions that make one product serve more than
--                 one operation. Declared as data so adding an operation is
--                 configuration, not a migration (PRD FR-40).
--   work_items    the unit of work. Nothing in v2 — coverage, ranking,
--                 capacity, loss decomposition — is computable without an
--                 enumerable inventory, so this is the foundation row.
--   outcomes      append-only record of what happened. Corrections supersede,
--                 they never overwrite; the same immutability stance as
--                 feedback_revisions in the Feedback sprint.
--   scopes        a resolvable set of subjects, by enumeration, by team, or by
--                 a closed rule. This is what lets a manager cover a colleague
--                 or hold two teams without editing the org chart.
--   assignments   person x scope x capabilities x validity period. The single
--                 mechanism behind both "what may I see" and "what may I do".
--   capabilities  a verb over a subject type, in one of four families
--                 (observe / intervene / define / answer), on one of two axes
--                 (organizational / system).
--   commitments   a dated promise with a review date. Used by every role.
--
-- RELATIONSHIP TO v1. teams.manager_id remains the live authorization
-- mechanism for every existing table and policy in this release. The next
-- migration backfills an accountable assignment per managed team so the two
-- models agree from day one rather than drifting; nothing reads the new model
-- in preference to the old one yet.
--
-- REPRESENTATIVE IS THE SUBJECT ATOM. Scopes resolve to sets of
-- public.representatives, not to sets of profiles, because every operational
-- fact in this schema already hangs off representative_id. A manager is
-- reachable as a subject through the representative row they own, when they
-- have one; manager-of-manager visibility is derived in migration 2 from the
-- accountable chain rather than stored separately.

-- btree_gist gives GiST an equality operator for uuid, which the accountable
-- exclusion constraint on assignments needs in order to combine
-- "same scope" with "overlapping validity" in one index.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ===========================================================================
-- work_types
-- ===========================================================================
--
-- The eight dimensions are NOT NULL with no defaults on purpose. A work type
-- that has not declared how its work arrives, whether the operator selects it,
-- or how long its outcome must survive to count is not configured — and a
-- silent default here would be exactly the class of defect this program has
-- spent its previous sprints removing (a column nothing writes, read through a
-- `?? 0`, presenting as a fact).

CREATE TABLE IF NOT EXISTS public.work_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  display_name text NOT NULL,

  -- How work comes into existence. Determines whether forward capacity
  -- planning is arithmetic (scheduled), statistics (forecast) or a decision
  -- (generated).
  arrival text NOT NULL CHECK (arrival IN ('scheduled', 'forecast', 'generated', 'continuous')),

  -- Who chooses the next item. 'queue' = the operator picks; 'flow' = the item
  -- is assigned or arrives. The largest fork in the operator experience.
  selection text NOT NULL CHECK (selection IN ('queue', 'flow')),

  -- How value erodes with time. Drives the urgency term of every ranking.
  decay text NOT NULL CHECK (decay IN ('hard_deadline', 'sla', 'soft_aging', 'none')),

  outcome_shape text NOT NULL CHECK (outcome_shape IN ('binary', 'graded', 'staged')),
  value_model text NOT NULL CHECK (value_model IN ('immediate', 'recurring', 'recovered', 'avoided', 'proxy')),
  synchrony text NOT NULL CHECK (synchrony IN ('synchronous', 'asynchronous')),
  discretion text NOT NULL CHECK (discretion IN ('none', 'low', 'medium', 'high')),

  -- Days after resolution at which the outcome is re-checked. 0 means the
  -- operation genuinely has no reversal path; it does not mean "unknown".
  durability_horizon_days integer NOT NULL CHECK (durability_horizon_days >= 0),

  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.work_types IS
  'Configuration of one operation across the eight dimensions that vary between renewals, sales, collections, service, appointments and claims. Adding an operation writes a row here; it does not require a schema change (PRD FR-40).';
COMMENT ON COLUMN public.work_types.durability_horizon_days IS
  'Days after resolution at which the outcome is re-verified. Reporting an outcome rate only at the moment of resolution overstates performance wherever an outcome can be undone, which is why this is NOT NULL with no default.';

GRANT SELECT ON public.work_types TO authenticated;
GRANT ALL ON public.work_types TO service_role;
ALTER TABLE public.work_types ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER work_types_updated BEFORE UPDATE ON public.work_types
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===========================================================================
-- capabilities
-- ===========================================================================
--
-- A closed catalog, not user-authored. The four families are the whole verb
-- vocabulary of the product:
--
--   observe    read facts about a subject
--   intervene  act on the subject
--   define     change the rules the subject is measured by
--   answer     be accountable for the subject's shortfall
--
-- The axis separation matters as much as the families: organizational
-- capabilities always carry a scope, system capabilities never do. Without it,
-- database-level power becomes a side effect of a promotion.

CREATE TABLE IF NOT EXISTS public.capabilities (
  key text PRIMARY KEY,
  family text NOT NULL CHECK (family IN ('observe', 'intervene', 'define', 'answer')),
  subject_type text NOT NULL CHECK (subject_type IN ('representative', 'team', 'work_item', 'organization')),
  axis text NOT NULL CHECK (axis IN ('organizational', 'system')),
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A system capability is about the software, not about a population, so it
  -- can only ever be about the organization as a whole.
  CONSTRAINT capabilities_system_axis_is_org CHECK (axis <> 'system' OR subject_type = 'organization')
);

COMMENT ON TABLE public.capabilities IS
  'Closed catalog of verbs. Organizational capabilities are always exercised over a scope; system capabilities are about administering Pulse itself and carry no scope. Seeded by migration, not user-authored.';

GRANT SELECT ON public.capabilities TO authenticated;
GRANT ALL ON public.capabilities TO service_role;
ALTER TABLE public.capabilities ENABLE ROW LEVEL SECURITY;

INSERT INTO public.capabilities (key, family, subject_type, axis, description) VALUES
  ('observe.performance',   'observe',   'representative', 'organizational', 'Read a representative''s results, KPI history and coverage'),
  ('observe.feedback',      'observe',   'representative', 'organizational', 'Read feedback and listening records about a representative'),
  ('observe.work_items',    'observe',   'work_item',      'organizational', 'Read the work inventory for a representative'),
  ('observe.team',          'observe',   'team',           'organizational', 'Read aggregate figures for a team'),
  ('intervene.coach',       'intervene', 'representative', 'organizational', 'Record feedback, coaching sessions and commitments about a representative'),
  ('intervene.assign_work', 'intervene', 'work_item',      'organizational', 'Reassign work items between representatives'),
  ('intervene.approve',     'intervene', 'work_item',      'organizational', 'Approve a concession or escalation on a work item'),
  ('define.targets',        'define',    'team',           'organizational', 'Set or override targets for a scope'),
  ('define.roster',         'define',    'team',           'organizational', 'Change team membership and representative records'),
  ('define.work_type',      'define',    'organization',   'organizational', 'Configure a work type''s dimensions and outcome taxonomy'),
  ('answer.results',        'answer',    'representative', 'organizational', 'Be accountable for the subject''s shortfall'),
  ('system.administer',     'define',    'organization',   'system',         'Administer Pulse: accounts, roles, integrations'),
  ('system.import',         'define',    'organization',   'system',         'Run and reverse data imports'),
  ('system.audit',          'observe',   'organization',   'system',         'Read the audit log')
ON CONFLICT (key) DO NOTHING;

-- ===========================================================================
-- scopes
-- ===========================================================================
--
-- Three kinds, deliberately closed:
--
--   team        every active representative on one team. The overwhelmingly
--               common case, and the one the v1 backfill produces.
--   enumerated  an explicit list, in scope_members. Covers a temporary
--               project, a task force, a hand-picked cover arrangement.
--   rule        a closed JSON shape resolved in SQL — currently a union of
--               teams, optionally narrowed by teams.kpi_profile. This is the
--               matrix case (a slice across centers) expressed with the two
--               orthogonal dimensions that exist in the schema today.
--
-- 'rule' is deliberately NOT a general query language. A scope whose meaning
-- cannot be read off its definition is a scope whose "why can I see this?"
-- answer is unrenderable, and PRD FR-28 requires that answer on every row.

CREATE TABLE IF NOT EXISTS public.scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE,
  display_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('team', 'enumerated', 'rule')),

  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  rule jsonb,

  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT scopes_team_kind_has_team CHECK (kind <> 'team' OR team_id IS NOT NULL),
  CONSTRAINT scopes_rule_kind_has_rule CHECK (kind <> 'rule' OR rule IS NOT NULL),
  CONSTRAINT scopes_non_team_kind_has_no_team CHECK (kind = 'team' OR team_id IS NULL)
);

COMMENT ON TABLE public.scopes IS
  'A resolvable set of representatives. Resolution is private.scope_representative_ids(). Rule scopes accept a closed shape only — {"team_ids": [...], "kpi_profiles": [...]} — so that the reason a subject is in scope is always renderable to the user (PRD FR-28).';
COMMENT ON COLUMN public.scopes.rule IS
  'Closed shape: {"team_ids": uuid[], "kpi_profiles": text[]}. Both keys optional; present keys are ANDed, values within a key are ORed. An empty or unrecognized rule resolves to the empty set, never to "everything".';

CREATE UNIQUE INDEX IF NOT EXISTS scopes_one_per_team_idx
  ON public.scopes (team_id) WHERE kind = 'team';

GRANT SELECT ON public.scopes TO authenticated;
GRANT ALL ON public.scopes TO service_role;
ALTER TABLE public.scopes ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER scopes_updated BEFORE UPDATE ON public.scopes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.scope_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id uuid NOT NULL REFERENCES public.scopes(id) ON DELETE CASCADE,
  representative_id uuid NOT NULL REFERENCES public.representatives(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_id, representative_id)
);

CREATE INDEX IF NOT EXISTS scope_members_representative_idx
  ON public.scope_members (representative_id);

COMMENT ON TABLE public.scope_members IS
  'Explicit membership for scopes of kind ''enumerated''. Ignored for ''team'' and ''rule'' scopes, which resolve from the representatives table instead.';

GRANT SELECT ON public.scope_members TO authenticated;
GRANT ALL ON public.scope_members TO service_role;
ALTER TABLE public.scope_members ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- assignments
-- ===========================================================================
--
-- Every organizational fact about who may do what is one row here.
--
-- THE PARTITION INVARIANT. Exactly one accountable assignment per
-- representative at a time. Without it, "the organization total" can
-- double-count and "my manager" is ambiguous — the two places the product
-- cannot tolerate ambiguity. The exclusion constraint below catches the
-- same-scope case at the database level; the cross-scope case (two different
-- scopes that both contain the same representative) cannot be expressed as a
-- constraint over a rule-resolved set and is enforced in the validation RPC
-- in migration 3, under a lock.
--
-- THERE IS NO PERMANENT ASSIGNMENT. valid_to NULL means "no end date known
-- yet", not "forever". Cover-for-leave, secondment, a project and a promotion
-- are then all the same operation, which is the point.

CREATE TABLE IF NOT EXISTS public.assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope_id uuid NOT NULL REFERENCES public.scopes(id) ON DELETE RESTRICT,

  -- The one bit that distinguishes line management from functional
  -- management. Load-bearing in exactly two places: the roll-up denominator,
  -- and who a representative sees as "my manager".
  accountable boolean NOT NULL DEFAULT false,

  -- Delegation provenance. A delegated assignment may never grant more than
  -- its grantor holds, nor outlive it (enforced in migration 3).
  granted_by_assignment_id uuid REFERENCES public.assignments(id) ON DELETE RESTRICT,

  valid_from date NOT NULL DEFAULT current_date,
  valid_to date,

  -- Which artifact this assignment implies: a surface, a review or a report.
  -- Stored rather than derived because span predicts cadence well but not
  -- perfectly — an org-wide quality owner still works daily.
  cadence text NOT NULL DEFAULT 'daily' CHECK (cadence IN ('continuous', 'daily', 'weekly', 'monthly')),

  label text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT assignments_period_ordered CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT assignments_revocation_has_reason
    CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CONSTRAINT assignments_not_self_granted
    CHECK (granted_by_assignment_id IS NULL OR granted_by_assignment_id <> id),

  -- Materialized so the exclusion constraint has something to index. '[]'
  -- because both endpoints are inclusive days: an assignment valid_to = today
  -- is still in force today.
  validity daterange GENERATED ALWAYS AS (daterange(valid_from, valid_to, '[]')) STORED
);

-- Same scope, both accountable, overlapping days — always a conflict, and
-- cheap to reject here. The cross-scope case is the RPC's job.
ALTER TABLE public.assignments
  DROP CONSTRAINT IF EXISTS assignments_no_overlapping_accountable;
ALTER TABLE public.assignments
  ADD CONSTRAINT assignments_no_overlapping_accountable
  EXCLUDE USING gist (scope_id WITH =, validity WITH &&)
  WHERE (accountable AND revoked_at IS NULL);

CREATE INDEX IF NOT EXISTS assignments_person_idx ON public.assignments (person_id);
CREATE INDEX IF NOT EXISTS assignments_scope_idx ON public.assignments (scope_id);
CREATE INDEX IF NOT EXISTS assignments_granted_by_idx ON public.assignments (granted_by_assignment_id);
CREATE INDEX IF NOT EXISTS assignments_current_idx
  ON public.assignments (person_id, valid_from, valid_to) WHERE revoked_at IS NULL;

COMMENT ON TABLE public.assignments IS
  'Person x scope x capabilities x validity period. The single mechanism behind both visibility and permission. Exactly one accountable assignment may cover a representative at any moment; the exclusion constraint enforces the same-scope case and public.create_assignment enforces the cross-scope case under a lock.';
COMMENT ON COLUMN public.assignments.valid_to IS
  'NULL means no end date is known yet, not "permanent". Every assignment is temporary; making that the default is what turns cover-for-leave, secondment and promotion into one operation.';

GRANT SELECT ON public.assignments TO authenticated;
GRANT ALL ON public.assignments TO service_role;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER assignments_updated BEFORE UPDATE ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.assignment_capabilities (
  assignment_id uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  capability_key text NOT NULL REFERENCES public.capabilities(key) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, capability_key)
);

CREATE INDEX IF NOT EXISTS assignment_capabilities_key_idx
  ON public.assignment_capabilities (capability_key);

GRANT SELECT ON public.assignment_capabilities TO authenticated;
GRANT ALL ON public.assignment_capabilities TO service_role;
ALTER TABLE public.assignment_capabilities ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- work_items
-- ===========================================================================
--
-- team_id is denormalized from the owning representative on purpose: every
-- scope resolution and every coverage query filters by team, and joining
-- representatives on each one would put a second table inside a hot RLS
-- predicate. It is kept truthful by a trigger rather than by convention.

CREATE TABLE IF NOT EXISTS public.work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_type_id uuid NOT NULL REFERENCES public.work_types(id) ON DELETE RESTRICT,

  -- Identity in the source system. Re-ingestion updates by this key rather
  -- than inserting a duplicate.
  external_ref text NOT NULL,
  -- Opaque reference to the customer/account/policy in the system of record.
  -- Pulse is not a system of record (PRD NG1) and deliberately stores no
  -- customer detail beyond what is needed to rank the work.
  subject_ref text,
  subject_label text,

  owner_representative_id uuid REFERENCES public.representatives(id) ON DELETE SET NULL,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,

  eligible_from timestamptz,
  due_at timestamptz,
  business_value numeric(14, 2) NOT NULL DEFAULT 0 CHECK (business_value >= 0),

  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'resolved', 'voided')),
  voided_reason text,

  ingestion_batch_id uuid,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (work_type_id, external_ref),
  CONSTRAINT work_items_void_has_reason CHECK (state <> 'voided' OR voided_reason IS NOT NULL),
  CONSTRAINT work_items_window_ordered CHECK (eligible_from IS NULL OR due_at IS NULL OR due_at >= eligible_from)
);

CREATE INDEX IF NOT EXISTS work_items_team_due_idx ON public.work_items (team_id, due_at) WHERE state = 'open';
CREATE INDEX IF NOT EXISTS work_items_owner_due_idx ON public.work_items (owner_representative_id, due_at) WHERE state = 'open';
CREATE INDEX IF NOT EXISTS work_items_due_idx ON public.work_items (due_at) WHERE state = 'open';
CREATE INDEX IF NOT EXISTS work_items_batch_idx ON public.work_items (ingestion_batch_id);
CREATE INDEX IF NOT EXISTS work_items_type_idx ON public.work_items (work_type_id);

COMMENT ON TABLE public.work_items IS
  'The unit of work. Coverage, ranking, capacity planning and the loss decomposition are all arithmetic over this table; none of them exist without it. Written exclusively by the ingestion pipeline and by server functions under service_role — there is no client write policy.';
COMMENT ON COLUMN public.work_items.team_id IS
  'Denormalized from the owning representative and kept truthful by work_items_sync_team. Present so scope resolution and coverage do not need a join inside a hot predicate.';

GRANT SELECT ON public.work_items TO authenticated;
GRANT ALL ON public.work_items TO service_role;
ALTER TABLE public.work_items ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER work_items_updated BEFORE UPDATE ON public.work_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Keeps the denormalized team_id honest. Deriving it here rather than trusting
-- the caller is the same stance kpi_values_enforce_team_attribution takes:
-- a value that can be computed from a relationship is never accepted from
-- outside.
CREATE OR REPLACE FUNCTION public.work_items_sync_team()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_representative_id IS NULL THEN
    NEW.team_id := NULL;
  ELSE
    SELECT r.team_id INTO NEW.team_id
    FROM public.representatives r WHERE r.id = NEW.owner_representative_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.work_items_sync_team() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS work_items_sync_team_trg ON public.work_items;
CREATE TRIGGER work_items_sync_team_trg
  BEFORE INSERT OR UPDATE OF owner_representative_id ON public.work_items
  FOR EACH ROW EXECUTE FUNCTION public.work_items_sync_team();

-- ===========================================================================
-- outcomes
-- ===========================================================================
--
-- APPEND-ONLY. A correction inserts a new row pointing at the one it replaces;
-- nothing is ever updated or deleted. Every metric in v2 is an aggregate over
-- this table, and an aggregate over mutable history cannot be reconciled after
-- the fact.
--
-- 'expired_unworked' is deliberately absent from the canonical set. It is
-- derived — an open item past its due date with no outcome — and can never be
-- recorded by a user (PRD FR-9). Silent loss is silent precisely because
-- nobody types it in; making it a disposition would reintroduce the problem
-- the metric exists to expose.

CREATE TABLE IF NOT EXISTS public.outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE RESTRICT,

  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_representative_id uuid REFERENCES public.representatives(id) ON DELETE SET NULL,

  canonical_state text NOT NULL CHECK (canonical_state IN (
    'resolved_positive', 'resolved_negative', 'pending_internal', 'pending_external', 'unreachable'
  )),
  -- Work-type-specific detail. The taxonomy lives in work type configuration;
  -- the canonical state above is what every cross-operation metric uses.
  reason_code text,
  value_realized numeric(14, 2),

  occurred_at timestamptz NOT NULL DEFAULT now(),

  supersedes_id uuid UNIQUE REFERENCES public.outcomes(id) ON DELETE RESTRICT,
  correction_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT outcomes_correction_has_reason
    CHECK ((supersedes_id IS NULL) = (correction_reason IS NULL)),
  CONSTRAINT outcomes_not_self_superseding
    CHECK (supersedes_id IS NULL OR supersedes_id <> id)
);

CREATE INDEX IF NOT EXISTS outcomes_work_item_idx ON public.outcomes (work_item_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS outcomes_actor_rep_idx ON public.outcomes (actor_representative_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS outcomes_state_idx ON public.outcomes (canonical_state, occurred_at DESC);

COMMENT ON TABLE public.outcomes IS
  'Append-only record of what happened to a work item. Corrections insert a row with supersedes_id set; UPDATE and DELETE are blocked by trigger. ''expired_unworked'' is intentionally not a value here — it is derived from an open item past its due date, and must never be something a user can type.';

GRANT SELECT ON public.outcomes TO authenticated;
GRANT ALL ON public.outcomes TO service_role;
ALTER TABLE public.outcomes ENABLE ROW LEVEL SECURITY;

-- Same immutability mechanism as feedback_revisions: a trigger, not a
-- convention, and it applies to service_role too. The only way to change what
-- an outcome says is to supersede it, which leaves both rows in place.
CREATE OR REPLACE FUNCTION public.outcomes_block_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'רשומות תוצאה הן בלתי ניתנות לשינוי — יש לרשום תוצאה מתקנת המפנה לרשומה הקודמת'
    USING ERRCODE = 'P0009';
END;
$$;

DROP TRIGGER IF EXISTS outcomes_immutable_trg ON public.outcomes;
CREATE TRIGGER outcomes_immutable_trg
  BEFORE UPDATE OR DELETE ON public.outcomes
  FOR EACH ROW EXECUTE FUNCTION public.outcomes_block_mutation();

-- ===========================================================================
-- durability checks
-- ===========================================================================
--
-- The fourth loss term. An outcome that was right at the moment of resolution
-- and undone a fortnight later is not a success, and an operation that reports
-- only the same-day figure systematically overstates itself.

CREATE TABLE IF NOT EXISTS public.durability_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outcome_id uuid NOT NULL UNIQUE REFERENCES public.outcomes(id) ON DELETE RESTRICT,
  checked_at timestamptz NOT NULL DEFAULT now(),
  held boolean NOT NULL,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT durability_reversal_has_reason CHECK (held OR reversal_reason IS NOT NULL)
);

COMMENT ON TABLE public.durability_checks IS
  'Post-horizon verification of an outcome, one row per outcome at most. Drives the durability term of the loss decomposition and the second, honest outcome rate.';

GRANT SELECT ON public.durability_checks TO authenticated;
GRANT ALL ON public.durability_checks TO service_role;
ALTER TABLE public.durability_checks ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- commitments
-- ===========================================================================
--
-- One object for every promise in the product: an operator's callback, a team
-- manager's coaching commitment, an operations manager's intervention, a line
-- owner's experiment. The step that turns a dashboard into an operating loop
-- is the one that asks, on the date it said it would, whether the thing
-- happened.
--
-- Auto-lapse is not decoration. A commitment list that only grows becomes the
-- todo-app graveyard, and a list nobody clears is indistinguishable from no
-- list at all.

CREATE TABLE IF NOT EXISTS public.commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  subject_kind text NOT NULL CHECK (subject_kind IN ('representative', 'team', 'work_item', 'scope', 'self')),
  subject_representative_id uuid REFERENCES public.representatives(id) ON DELETE CASCADE,
  subject_team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  subject_work_item_id uuid REFERENCES public.work_items(id) ON DELETE CASCADE,
  subject_scope_id uuid REFERENCES public.scopes(id) ON DELETE CASCADE,

  body text NOT NULL CHECK (length(btrim(body)) > 0),
  due_on date NOT NULL,

  resolution text CHECK (resolution IN ('kept', 'not_kept', 'no_longer_relevant', 'lapsed')),
  resolution_note text,
  resolved_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT commitments_resolution_paired CHECK ((resolution IS NULL) = (resolved_at IS NULL)),
  -- Exactly the reference the subject_kind names, and no other.
  CONSTRAINT commitments_subject_matches_kind CHECK (
    (subject_kind = 'representative' AND subject_representative_id IS NOT NULL AND subject_team_id IS NULL AND subject_work_item_id IS NULL AND subject_scope_id IS NULL)
    OR (subject_kind = 'team' AND subject_team_id IS NOT NULL AND subject_representative_id IS NULL AND subject_work_item_id IS NULL AND subject_scope_id IS NULL)
    OR (subject_kind = 'work_item' AND subject_work_item_id IS NOT NULL AND subject_representative_id IS NULL AND subject_team_id IS NULL AND subject_scope_id IS NULL)
    OR (subject_kind = 'scope' AND subject_scope_id IS NOT NULL AND subject_representative_id IS NULL AND subject_team_id IS NULL AND subject_work_item_id IS NULL)
    OR (subject_kind = 'self' AND subject_representative_id IS NULL AND subject_team_id IS NULL AND subject_work_item_id IS NULL AND subject_scope_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS commitments_owner_due_idx
  ON public.commitments (owner_id, due_on) WHERE resolution IS NULL;
CREATE INDEX IF NOT EXISTS commitments_subject_rep_idx
  ON public.commitments (subject_representative_id, due_on DESC);
CREATE INDEX IF NOT EXISTS commitments_created_by_idx ON public.commitments (created_by);

COMMENT ON TABLE public.commitments IS
  'A dated promise with a review date, used by every role. Resolution is explicit; unresolved commitments past a staleness threshold are closed as ''lapsed'' by public.lapse_stale_commitments so the list cannot grow without bound.';

GRANT SELECT ON public.commitments TO authenticated;
GRANT ALL ON public.commitments TO service_role;
ALTER TABLE public.commitments ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER commitments_updated BEFORE UPDATE ON public.commitments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
