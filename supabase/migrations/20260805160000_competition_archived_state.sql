-- Competition lifecycle currently collapses to a single `active` flag, so a
-- closed competition ("completed") has no way to be distinguished from one
-- that's genuinely done-with and should stop showing up as current — and no
-- way back once it's there. `archived` adds that third, explicit state:
-- active=true -> Active; active=false, archived=false -> Completed (still
-- fully manageable); active=false, archived=true -> Archived (a frozen
-- historical record, only reachable via an explicit action, reversible).
ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.competitions.archived IS
  'Frozen historical record — set only via an explicit archive action on a completed (active=false) competition. Distinct from active: a competition can be closed (active=false) without being archived yet, and archiving never implies deletion.';
