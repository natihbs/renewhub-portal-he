-- Dashboard Operational Hardening (P1): activity_events visibility
--
-- PROBLEM. The SELECT policy was:
--     CREATE POLICY "activity read" ON public.activity_events
--       FOR SELECT TO authenticated USING (true);
--
-- Every authenticated user — including every representative — could read
-- every activity row in the organization. The rows that existed named
-- representatives ("משוב פורסם עבור <name>"), so coaching activity about
-- identifiable people was readable by their peers. The dashboard's
-- "פעילות אחרונה" card applied no scope either, because it read the feed
-- straight from the provider with no team predicate available to it.
--
-- The deeper problem was structural rather than about the two rows that
-- happened to exist: a table with USING (true) hands org-wide visibility to
-- every event kind anyone adds later, by default, silently.
--
-- DECISION. This table is retired as an application surface rather than
-- re-scoped and kept alongside a second one.
--
-- public.audit_log already records every material action in this product with
-- a real actor, a real timestamp and structured details — imports, KPI
-- writes, representative transfers, target changes, feedback publish and
-- retract, article assignment, coaching plans. activity_events recorded two
-- of those, from one file, through a fire-and-forget client insert. Keeping
-- both would mean maintaining two parallel activity systems where one is a
-- strict subset of the other and the subset is the one with no attribution.
--
-- So: the dashboard feed is now built from audit_log via
-- listDashboardActivity (src/lib/dashboard.functions.ts), which authorizes the
-- caller, scopes the rows server-side to what that caller may actually see,
-- and projects only a whitelisted set of actions into a safe shape. audit_log
-- keeps its admin-only RLS untouched — the server function never widens it,
-- it runs the scope itself under service_role after checking the caller.
--
-- This table is left in place (dropping it would destroy existing history)
-- but is locked to admin-only reads and no client writes at all, so it can
-- neither leak what it already holds nor grow new rows through the old path.

DROP POLICY IF EXISTS "activity read" ON public.activity_events;
DROP POLICY IF EXISTS "activity insert" ON public.activity_events;

-- Read: admins only. This is historical data with no team attribution, so
-- there is no correct way to scope it to a manager after the fact — and
-- guessing would be worse than restricting it.
CREATE POLICY "activity_events admin read" ON public.activity_events
FOR SELECT TO authenticated
USING (private.is_admin(auth.uid()));

-- No client write policy at all. Nothing in the application writes here any
-- more; service_role retains full access for any future backfill or export.
REVOKE INSERT ON public.activity_events FROM authenticated;

COMMENT ON TABLE public.activity_events IS
  'RETIRED as an application surface (Dashboard Operational Hardening). Previously readable org-wide by every authenticated user via USING (true), including representatives. Retained read-only for admins so existing history is not destroyed; no client may write to it. The dashboard activity feed is now derived from public.audit_log through listDashboardActivity, which scopes rows to the caller server-side. Do not add new writers here.';
