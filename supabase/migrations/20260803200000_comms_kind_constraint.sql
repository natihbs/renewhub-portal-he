-- Production-safety constraint for comms_messages.kind / comms_templates.kind.
--
-- Both columns are free-form text with correctness enforced only by client code
-- (see CommsKind in src/lib/comms-store.tsx) — a manual write, a future removed
-- kind, or partial/legacy data could hold a value outside the 6 kinds the UI
-- understands. The client already renders defensively for that case (unknown
-- kinds get a generic icon/label instead of crashing — see
-- src/routes/_authenticated/communications.tsx), but the database should not
-- rely on the client to keep this invariant. Before adding either CHECK
-- constraint, existing rows are normalized so the migration itself cannot fail
-- on data that predates the constraint.
--
-- 'morning' is used as the normalization target — it's the Generator's own
-- default kind (see Generator's useState<CommsKind>("morning")) — a real
-- message/template row is never deleted, only reclassified into a valid kind.

UPDATE public.comms_messages
  SET kind = 'morning'
  WHERE kind NOT IN ('morning', 'evening', 'competition', 'congrats', 'coaching', 'listening');

UPDATE public.comms_templates
  SET kind = 'morning'
  WHERE kind NOT IN ('morning', 'evening', 'competition', 'congrats', 'coaching', 'listening');

ALTER TABLE public.comms_messages
  ADD CONSTRAINT comms_messages_kind_check
  CHECK (kind IN ('morning', 'evening', 'competition', 'congrats', 'coaching', 'listening'));

ALTER TABLE public.comms_templates
  ADD CONSTRAINT comms_templates_kind_check
  CHECK (kind IN ('morning', 'evening', 'competition', 'congrats', 'coaching', 'listening'));
