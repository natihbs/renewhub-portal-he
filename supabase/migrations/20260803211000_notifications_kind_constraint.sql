-- Production-safety constraint for notifications.kind, matching the same
-- pattern already applied to comms_messages.kind / comms_templates.kind (see
-- 20260803200000_comms_kind_constraint.sql).
--
-- The column is free-form text with correctness enforced only by client code
-- (see Notification["kind"] and KIND_LABEL in NotificationBell.tsx) — a
-- manual write, a future removed kind, or a typo in a server-side insert
-- could hold a value outside the 4 kinds the UI understands, silently
-- rendering a blank badge instead of a label. Now that
-- notify_feedback_published() is the first writer into this table, the
-- database should not rely on every future writer to keep this invariant
-- correct on its own.
--
-- No pre-existing rows to normalize: this table has had no writer until this
-- sprint (see 20260803210000_notify_feedback_published.sql), so the
-- constraint can be added directly.
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('performance', 'competition', 'knowledge', 'feedback'));
