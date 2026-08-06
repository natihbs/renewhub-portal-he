-- Dashboard Operational Hardening (P2): manager-facing notifications
--
-- PROBLEM. public.notifications is scoped user_id = auth.uid() and its only
-- writers target the REPRESENTATIVE's linked account (the publish trigger,
-- plus the correction and article-assignment notifications added in the
-- Feedback sprint). No event anywhere produced a notification for a manager
-- or an admin, so the bell was permanently empty for exactly the people the
-- dashboard is built for. There was no signal for an import failing, a team
-- falling behind pace, a representative going unheard, or a competition
-- closing — every one of which is something a manager needs to be told rather
-- than expected to notice.
--
-- SCOPE. This is deliberately a small, fixed set of operational events, not a
-- rules engine. The generator runs on demand when a manager opens the
-- dashboard (evaluateManagerNotifications, src/lib/dashboard.functions.ts),
-- reads the same figures the dashboard renders, and writes at most one
-- notification per event per day. No scheduler, no subscriptions, no
-- user-authored rules — those are a later product phase, and building them
-- now would be speculative.
--
-- DEDUPLICATION is the whole safety story here, because the generator runs on
-- every dashboard open. A notification storm is worse than no notification:
-- a bell showing 340 unread items is ignored exactly like an empty one. The
-- dedupe_key below makes a repeat write a no-op at the DATABASE level rather
-- than relying on the generator to remember what it has already sent.

-- ---------- new kinds ----------

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_kind_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN (
    -- existing, representative-facing
    'performance', 'competition', 'knowledge', 'feedback',
    -- new, manager/admin-facing operational events
    'import', 'pace', 'listening', 'underwriting'
  ));

-- ---------- deduplication ----------

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_key text;

COMMENT ON COLUMN public.notifications.dedupe_key IS
  'Stable identity of the underlying event for generated operational notifications, e.g. "pace:<team_id>:2026-08-07". A partial unique index makes a repeat insert with the same key fail, so a generator that runs on every dashboard open cannot produce a storm. NULL for one-off notifications (feedback publish, article assignment), which are events in their own right and must never be deduplicated against each other.';

-- Partial: only generated notifications carry a key, and only those are
-- deduplicated. A NULL key never collides, so the existing
-- representative-facing writers are completely unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_key_idx
  ON public.notifications (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id, read, created_at DESC);

-- ---------- generated delivery ----------
--
-- SECURITY DEFINER because the acting session is a manager and the recipient
-- is themselves — but the generator also needs to notify an admin, and
-- "notifications own" only permits user_id = auth.uid() inserts. Same reason
-- notify_feedback_published is SECURITY DEFINER.
--
-- Returns whether a row was actually created, so the caller can report and
-- test real behavior instead of assuming.
DROP FUNCTION IF EXISTS public.deliver_operational_notification(uuid, text, text, text, text, text);
CREATE FUNCTION public.deliver_operational_notification(
  _user_id uuid,
  _kind text,
  _title text,
  _body text,
  _href text,
  _dedupe_key text
)
RETURNS TABLE (out_notification_id uuid, out_created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF _dedupe_key IS NULL OR _dedupe_key = '' THEN
    RAISE EXCEPTION 'התראה תפעולית חייבת לכלול מפתח מניעת כפילויות' USING ERRCODE = 'P0008';
  END IF;

  -- ON CONFLICT DO NOTHING against the partial unique index: the second call
  -- for the same event simply reports created = false.
  INSERT INTO public.notifications (user_id, kind, title, body, href, dedupe_key)
  VALUES (_user_id, _kind, _title, _body, _href, _dedupe_key)
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, (v_id IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.deliver_operational_notification(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deliver_operational_notification(uuid, text, text, text, text, text) TO service_role;

COMMENT ON FUNCTION public.deliver_operational_notification(uuid, text, text, text, text, text) IS
  'Delivers one generated operational notification, deduplicated at the database level by (user_id, dedupe_key). Returns created = false when the event was already delivered, so a generator running on every dashboard open is idempotent by construction rather than by convention. Requires a dedupe key (P0008). Callable only by service_role.';
