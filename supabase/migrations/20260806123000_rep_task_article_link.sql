-- Feedback & Listening Operational Hardening (P2): real article assignment
--
-- PROBLEM. The Coaching tab rendered a "הקצאת מאמר" button next to every
-- recommended article. It had no onClick handler at all — a manager could
-- click it for every representative on the queue, see nothing happen, and
-- reasonably conclude the assignment had been recorded somewhere. Nothing was
-- ever written and no representative was ever told to read anything.
--
-- assignArticleToRepresentative (feedback.functions.ts) now creates a real
-- rep_tasks row and notifies the representative. This column is what makes
-- that assignment a durable relationship rather than a title string: it lets
-- the UI show what has already been assigned, prevents assigning the same
-- article to the same representative twice while it is still open, and keeps
-- the task meaningful if the article is later renamed.
--
-- ON DELETE SET NULL: deleting an article must not delete a task a
-- representative may already have completed. The task keeps its title text.
ALTER TABLE public.rep_tasks
  ADD COLUMN IF NOT EXISTS article_id uuid REFERENCES public.articles(id) ON DELETE SET NULL;

-- One OPEN assignment of a given article per representative. Re-assigning an
-- article the rep already finished is legitimate (a refresher), so the index
-- deliberately covers only tasks that are still open.
CREATE UNIQUE INDEX IF NOT EXISTS rep_tasks_open_article_assignment_idx
  ON public.rep_tasks (representative_id, article_id)
  WHERE article_id IS NOT NULL AND NOT done;

COMMENT ON COLUMN public.rep_tasks.article_id IS
  'Knowledge-base article this task was created from, when it came from the Coaching tab''s article assignment. NULL for ordinary manager-authored tasks. See assignArticleToRepresentative in src/lib/feedback.functions.ts.';
