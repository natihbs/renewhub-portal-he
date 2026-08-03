-- The Notification Bell (NotificationBell.tsx / ux-store.tsx) is a fully built,
-- fully wired UI reading from public.notifications, but nothing anywhere ever
-- inserted a row into that table: publishing a rep's feedback (single publish in
-- feedback.tsx, or the admin bulk-publish flow in feedback-admin.functions.ts) was
-- a silent, one-sided action, with no signal ever reaching the rep that new
-- coaching feedback exists for them to read.
--
-- Client-side insert is not an option: "notifications own" RLS requires
-- user_id = auth.uid(), so a manager's session can never insert a notification row
-- for the rep it concerns. A SECURITY DEFINER trigger is the correct way to bridge
-- that gap, and it fires regardless of which code path performs the publish, so
-- there is exactly one place this can go stale.
CREATE OR REPLACE FUNCTION public.notify_feedback_published()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF NEW.published AND NOT OLD.published THEN
    SELECT user_id INTO v_user_id FROM public.representatives WHERE id = NEW.representative_id;
    -- A representative with no linked login account has nowhere for a
    -- notification to land; nothing to do until one is linked.
    IF v_user_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, kind, title, body, href)
      VALUES (
        v_user_id,
        'feedback',
        'משוב חדש זמין',
        'משוב על שיחה מתאריך ' || to_char(NEW.feedback_date, 'DD/MM/YYYY') || ' פורסם עבורך.',
        '/feedback'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_feedback_notify_published
  AFTER UPDATE ON public.feedback
  FOR EACH ROW EXECUTE FUNCTION public.notify_feedback_published();

COMMENT ON FUNCTION public.notify_feedback_published() IS
  'Inserts a notifications row for the owning representative''s linked user account when feedback.published flips false->true. SECURITY DEFINER because the acting session (a manager) is never the rep and RLS on notifications only allows user_id = auth.uid() inserts.';
