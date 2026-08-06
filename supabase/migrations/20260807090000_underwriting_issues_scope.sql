-- Dashboard Operational Hardening (P0 SECURITY): scope underwriting issues
--
-- PROBLEM. Both policies on underwriting_issues gated on private.is_staff(),
-- which is "admin OR manager" with no team predicate at all:
--
--   CREATE POLICY "underwriting read"        ... USING (private.is_staff() OR rep_is_self)
--   CREATE POLICY "underwriting staff write" ... USING (private.is_staff())
--
-- So ANY manager could read, re-status and DELETE every underwriting issue in
-- the organization, including issues belonging to representatives on teams
-- they have nothing to do with. It was visible in the product: Morning
-- Routine renders the unfiltered list, and another team's rows showed up with
-- "—" in the representative column, because the name lookup runs against the
-- workspace-scoped rep list while the issue list was not scoped at all. The
-- "נושאי חיתום פתוחים" priority counter was org-wide for the same reason,
-- sitting in a row of otherwise team-scoped counters.
--
-- Every structurally identical rep-linked table in this schema already derives
-- manager authorization from the real relationship — feedback,
-- listening_schedules, representative_goals, rep_tasks and (since the
-- Performance sprint) kpi_values all gate on
-- private.can_manage_rep(representative_id). This one did not.
--
-- FIX. Authorization derives from the representative, exactly like its peers.
--
-- The representative_id NULL case is deliberate and called out rather than
-- left implicit: the column is nullable, and a general (unassigned) issue has
-- no representative to derive scope from. Those are treated as
-- organization-level and restricted to admins — a manager cannot see or touch
-- an issue that is not about one of their people. This is the conservative
-- reading; widening it later is a policy change, not a security fix.

-- ---------- read ----------

DROP POLICY IF EXISTS "underwriting read" ON public.underwriting_issues;

CREATE POLICY "underwriting read" ON public.underwriting_issues
FOR SELECT TO authenticated
USING (
  private.is_admin(auth.uid())
  OR (representative_id IS NOT NULL AND private.can_manage_rep(representative_id))
  -- A representative may read issues about themselves. Unchanged from before.
  OR (representative_id IS NOT NULL AND private.rep_is_self(representative_id))
);

-- ---------- write ----------
--
-- Split per-command rather than FOR ALL, so the INSERT check is expressed on
-- the row being created and a representative can never write at all (reading
-- an issue about yourself is not the same as re-statusing or deleting it).

DROP POLICY IF EXISTS "underwriting staff write" ON public.underwriting_issues;

CREATE POLICY "underwriting insert" ON public.underwriting_issues
FOR INSERT TO authenticated
WITH CHECK (
  private.is_admin(auth.uid())
  OR (representative_id IS NOT NULL AND private.can_manage_rep(representative_id))
);

CREATE POLICY "underwriting update" ON public.underwriting_issues
FOR UPDATE TO authenticated
USING (
  private.is_admin(auth.uid())
  OR (representative_id IS NOT NULL AND private.can_manage_rep(representative_id))
)
WITH CHECK (
  private.is_admin(auth.uid())
  OR (representative_id IS NOT NULL AND private.can_manage_rep(representative_id))
);

CREATE POLICY "underwriting delete" ON public.underwriting_issues
FOR DELETE TO authenticated
USING (
  private.is_admin(auth.uid())
  OR (representative_id IS NOT NULL AND private.can_manage_rep(representative_id))
);

CREATE INDEX IF NOT EXISTS underwriting_issues_representative_idx
  ON public.underwriting_issues (representative_id);

COMMENT ON TABLE public.underwriting_issues IS
  'Underwriting items tracked from Morning Routine. Authorization derives from the representative the issue is about (private.can_manage_rep), never from a bare staff role — a manager can only ever see and change issues about their own representatives. Issues with no representative are organization-level and admin-only. Writes go through underwriting server functions in src/lib/dashboard.functions.ts so every create/update/delete is audited.';
