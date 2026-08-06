-- Pulse v2 — Sprint 0 / PR #1: Authorization primitives + RLS
--
-- Visibility and permission become one mechanism:
--
--     person x scope x capabilities x validity period
--
-- "Can I see this" is not a separate question from "can I do this" — seeing is
-- a verb (observe.*) in the same list as acting (intervene.*, define.*). Where
-- the two are separate mechanisms they drift, and the product ends up
-- rendering a row the user cannot act on, or acting on a subject the user
-- cannot see. v1 has a mild case of exactly that: the underwriting list
-- rendered rows whose representative name resolved to "—", because visibility
-- came from one rule and the name lookup from another.
--
-- ADDITIVE, AND DELIBERATELY NOT AUTHORITATIVE YET. Every v1 policy still
-- gates on private.can_manage_rep / private.manages_team and is untouched by
-- this migration. The helpers below are the v2 mechanism; the union helpers
-- (private.can_observe_rep and friends) return legacy OR assignment-derived so
-- that during coexistence the two models can never disagree in the direction
-- that matters — nobody loses access they have today, and the new model only
-- ever adds.
--
-- NON-RECURSION. Every helper is SECURITY DEFINER, which bypasses RLS on the
-- tables it reads. That is what lets an RLS policy on public.assignments call
-- a function that reads public.assignments without recursing — the same
-- technique private.manages_team already uses for teams/profiles.

-- ===========================================================================
-- scope resolution
-- ===========================================================================
--
-- A scope answers exactly one question: which representatives are in it.
--
-- Deliberately NOT filtered by representatives.active. v1's rep_in_my_team
-- does not filter either, and a manager must keep reading the feedback,
-- history and goals of someone who has since left their team — otherwise
-- deactivating a representative silently destroys their manager's access to
-- the record of their own past work.
--
-- Rule scopes resolve a closed shape:
--
--     {"team_ids": ["…"], "kpi_profiles": ["renewals"]}
--
-- Keys present are ANDed; values inside a key are ORed. A rule with NEITHER
-- key resolves to the EMPTY SET, never to "every representative". An
-- unrecognized rule is an unconfigured rule, and the safe reading of an
-- unconfigured permission is none.

CREATE OR REPLACE FUNCTION private.scope_representative_ids(_scope_id uuid)
RETURNS TABLE (representative_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kind text;
  v_team uuid;
  v_rule jsonb;
  v_team_ids jsonb;
  v_profiles jsonb;
  -- Plain booleans rather than inline jsonb_typeof() comparisons. An absent
  -- key makes `v_rule -> 'key'` SQL NULL, jsonb_typeof(NULL) is NULL, and
  -- `NULL <> 'array'` is NULL — which then propagates through the OR below and
  -- filters out every row, silently resolving every rule scope to nobody.
  -- COALESCE collapses the three-valued logic before it can do that.
  v_has_teams boolean;
  v_has_profiles boolean;
BEGIN
  SELECT s.kind, s.team_id, s.rule INTO v_kind, v_team, v_rule
  FROM public.scopes s WHERE s.id = _scope_id AND s.active;

  IF v_kind IS NULL THEN
    RETURN;
  END IF;

  IF v_kind = 'team' THEN
    RETURN QUERY SELECT r.id FROM public.representatives r WHERE r.team_id = v_team;
    RETURN;
  END IF;

  IF v_kind = 'enumerated' THEN
    RETURN QUERY SELECT sm.representative_id FROM public.scope_members sm WHERE sm.scope_id = _scope_id;
    RETURN;
  END IF;

  -- kind = 'rule'
  v_team_ids := v_rule -> 'team_ids';
  v_profiles := v_rule -> 'kpi_profiles';
  v_has_teams := COALESCE(jsonb_typeof(v_team_ids), '') = 'array';
  v_has_profiles := COALESCE(jsonb_typeof(v_profiles), '') = 'array';

  IF NOT v_has_teams AND NOT v_has_profiles THEN
    RETURN;  -- unconfigured rule resolves to nothing, never to everything
  END IF;

  RETURN QUERY
    SELECT r.id
    FROM public.representatives r
    JOIN public.teams t ON t.id = r.team_id
    WHERE (NOT v_has_teams OR t.id::text IN (SELECT jsonb_array_elements_text(v_team_ids)))
      AND (NOT v_has_profiles OR t.kpi_profile IN (SELECT jsonb_array_elements_text(v_profiles)));
END;
$$;

COMMENT ON FUNCTION private.scope_representative_ids(uuid) IS
  'The set of representatives a scope resolves to. Not filtered by representatives.active, matching v1 rep_in_my_team, so deactivating a representative never removes their manager''s access to the record of their past work. A rule scope with no recognized key resolves to the empty set.';

-- Predicate form. Kept separate from the set-returning form because an RLS
-- policy wants EXISTS semantics, and materializing several hundred ids per row
-- check is the difference between a scoped query and a slow one.
CREATE OR REPLACE FUNCTION private.rep_in_scope(_scope_id uuid, _rep uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _rep IS NOT NULL AND EXISTS (
    SELECT 1 FROM private.scope_representative_ids(_scope_id) s WHERE s.representative_id = _rep
  );
$$;

-- ===========================================================================
-- current assignments
-- ===========================================================================
--
-- "Current" is three conditions, and all three are load-bearing: not revoked,
-- started on or before today, and not ended before today. valid_to is
-- inclusive — an assignment ending today is still in force today, which is how
-- a cover arrangement handed back at end of shift behaves.

CREATE OR REPLACE FUNCTION private.assignment_is_current(_assignment_id uuid, _on date DEFAULT current_date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.id = _assignment_id
      AND a.revoked_at IS NULL
      AND a.valid_from <= _on
      AND (a.valid_to IS NULL OR a.valid_to >= _on)
  );
$$;

/**
 * Every assignment a person currently holds. One row per assignment, with the
 * scope, so callers can join to capabilities without a second lookup.
 *
 * Person-parameterized rather than implicitly auth.uid(), because the same
 * question has to be answerable from two places: an RLS policy, where the
 * actor is the session, and a server function running under service_role,
 * where auth.uid() is null and the actor arrives as an argument. Every other
 * helper below is a thin wrapper over this one so the two paths can never
 * answer differently.
 */
CREATE OR REPLACE FUNCTION private.person_current_assignments(_person_id uuid)
RETURNS TABLE (assignment_id uuid, scope_id uuid, accountable boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.scope_id, a.accountable
  FROM public.assignments a
  WHERE _person_id IS NOT NULL
    AND a.person_id = _person_id
    AND a.revoked_at IS NULL
    AND a.valid_from <= current_date
    AND (a.valid_to IS NULL OR a.valid_to >= current_date);
$$;

CREATE OR REPLACE FUNCTION private.my_current_assignments()
RETURNS TABLE (assignment_id uuid, scope_id uuid, accountable boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM private.person_current_assignments(auth.uid());
$$;

-- ===========================================================================
-- capability checks
-- ===========================================================================

/**
 * Does the caller hold a named capability over this representative, right now,
 * through some current assignment whose scope contains them?
 *
 * This is the primitive. Everything else in this file is a named shorthand for
 * a particular capability, so that a policy reads as a sentence rather than as
 * a string literal.
 */
CREATE OR REPLACE FUNCTION private.person_has_capability_over_rep(_person_id uuid, _rep uuid, _capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _rep IS NOT NULL AND EXISTS (
    SELECT 1
    FROM private.person_current_assignments(_person_id) m
    JOIN public.assignment_capabilities ac
      ON ac.assignment_id = m.assignment_id AND ac.capability_key = _capability
    WHERE private.rep_in_scope(m.scope_id, _rep)
  );
$$;

CREATE OR REPLACE FUNCTION private.has_capability_over_rep(_rep uuid, _capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.person_has_capability_over_rep(auth.uid(), _rep, _capability);
$$;

/**
 * Exactly one person answers for a representative at any moment. This is what
 * makes roll-ups add up and what makes "my manager" a singular, answerable
 * question for the person it matters most to.
 */
CREATE OR REPLACE FUNCTION private.person_is_accountable_for_rep(_person_id uuid, _rep uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _rep IS NOT NULL AND EXISTS (
    SELECT 1 FROM private.person_current_assignments(_person_id) m
    WHERE m.accountable AND private.rep_in_scope(m.scope_id, _rep)
  );
$$;

CREATE OR REPLACE FUNCTION private.is_accountable_for_rep(_rep uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.person_is_accountable_for_rep(auth.uid(), _rep);
$$;

/**
 * System capabilities carry no scope — they are about administering Pulse, not
 * about a population. Kept on a separate axis from organizational capability
 * so that widening someone's span never widens their access to accounts,
 * imports or the audit log.
 *
 * The v1 admin role is honoured here so a single migration does not have to
 * move every administrator onto the new model in the same release.
 */
CREATE OR REPLACE FUNCTION private.has_system_capability(_capability text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.is_admin(auth.uid()) OR EXISTS (
    SELECT 1
    FROM private.my_current_assignments() m
    JOIN public.assignment_capabilities ac
      ON ac.assignment_id = m.assignment_id AND ac.capability_key = _capability
    JOIN public.capabilities c ON c.key = ac.capability_key AND c.axis = 'system'
  );
$$;

-- ===========================================================================
-- coexistence helpers
-- ===========================================================================
--
-- These are the functions v2 code calls. Each is legacy OR assignment-derived,
-- so that for the whole of the coexistence period the two models can only
-- agree or widen — never narrow. When v1's team-manager path is finally
-- retired, the private.can_manage_rep term drops out of each definition and
-- nothing else changes.

CREATE OR REPLACE FUNCTION private.can_observe_rep(_rep uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.can_manage_rep(_rep)
      OR private.has_capability_over_rep(_rep, 'observe.performance');
$$;

CREATE OR REPLACE FUNCTION private.can_intervene_rep(_rep uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.can_manage_rep(_rep)
      OR private.has_capability_over_rep(_rep, 'intervene.coach');
$$;

/** Do I hold any current assignment over this scope? */
CREATE OR REPLACE FUNCTION private.can_observe_scope(_scope_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _scope_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM private.my_current_assignments() m WHERE m.scope_id = _scope_id
  );
$$;

/**
 * Visibility of a work item follows the representative who owns it, exactly
 * like every other rep-linked table in this schema. An unowned item — ingested
 * before allocation — is organization-level and admin-only, the same
 * conservative reading the underwriting_issues fix applied to rep-less issues.
 */
CREATE OR REPLACE FUNCTION private.can_observe_work_item(_work_item_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.work_items w
    WHERE w.id = _work_item_id
      AND w.owner_representative_id IS NOT NULL
      AND (
        private.can_observe_rep(w.owner_representative_id)
        OR private.rep_is_self(w.owner_representative_id)
      )
  ) OR private.is_admin(auth.uid());
$$;

-- ---------- grants ----------

REVOKE ALL ON FUNCTION private.scope_representative_ids(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.rep_in_scope(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.assignment_is_current(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.person_current_assignments(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.my_current_assignments() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.person_has_capability_over_rep(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.has_capability_over_rep(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.person_is_accountable_for_rep(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_accountable_for_rep(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.has_system_capability(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_observe_rep(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_intervene_rep(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_observe_scope(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_observe_work_item(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.scope_representative_ids(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.rep_in_scope(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.assignment_is_current(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.person_current_assignments(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.my_current_assignments() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.person_has_capability_over_rep(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.has_capability_over_rep(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.person_is_accountable_for_rep(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_accountable_for_rep(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.has_system_capability(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_observe_rep(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_intervene_rep(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_observe_scope(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_observe_work_item(uuid) TO authenticated, service_role;

-- ===========================================================================
-- public entry points for the server authorization layer
-- ===========================================================================
--
-- src/lib/authorization.ts runs under service_role, where auth.uid() is null,
-- so it cannot use the session-implicit helpers above. These two wrappers take
-- the actor explicitly — the same shape create_assignment uses for _created_by
-- — and are granted only to service_role. The server function has already
-- authenticated the actor through requireSupabaseAuth before it calls them.
--
-- They are wrappers, not reimplementations. The decision lives in exactly one
-- place, which is the only way an RLS policy and a server function can be
-- guaranteed to agree.

DROP FUNCTION IF EXISTS public.actor_authorization_context(uuid);
CREATE FUNCTION public.actor_authorization_context(_person_id uuid)
RETURNS TABLE (
  out_assignment_id uuid,
  out_scope_id uuid,
  out_scope_kind text,
  out_scope_display_name text,
  out_accountable boolean,
  out_valid_from date,
  out_valid_to date,
  out_label text,
  out_cadence text,
  out_capabilities text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    a.id, s.id, s.kind, s.display_name, a.accountable,
    a.valid_from, a.valid_to, a.label, a.cadence,
    COALESCE(ARRAY(
      SELECT ac.capability_key FROM public.assignment_capabilities ac
      WHERE ac.assignment_id = a.id ORDER BY ac.capability_key
    ), ARRAY[]::text[])
  FROM private.person_current_assignments(_person_id) m
  JOIN public.assignments a ON a.id = m.assignment_id
  JOIN public.scopes s ON s.id = a.scope_id
  ORDER BY a.accountable DESC, s.display_name;
$$;

REVOKE ALL ON FUNCTION public.actor_authorization_context(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.actor_authorization_context(uuid) TO service_role;

COMMENT ON FUNCTION public.actor_authorization_context(uuid) IS
  'Every assignment a person currently holds, with its scope and capability set. The single read behind src/lib/authorization.ts. Callable only by service_role; the calling server function authenticates the actor first.';

DROP FUNCTION IF EXISTS public.actor_capabilities_over_rep(uuid, uuid);
CREATE FUNCTION public.actor_capabilities_over_rep(_person_id uuid, _rep uuid)
RETURNS TABLE (out_capability_key text, out_assignment_id uuid, out_accountable boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ac.capability_key, m.assignment_id, m.accountable
  FROM private.person_current_assignments(_person_id) m
  JOIN public.assignment_capabilities ac ON ac.assignment_id = m.assignment_id
  WHERE private.rep_in_scope(m.scope_id, _rep);
$$;

REVOKE ALL ON FUNCTION public.actor_capabilities_over_rep(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.actor_capabilities_over_rep(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.actor_capabilities_over_rep(uuid, uuid) IS
  'Which capabilities a person holds over one representative right now, and through which assignment. The assignment id is what lets a caller answer "why can I see this?" (PRD FR-28) rather than just "you can".';

DROP FUNCTION IF EXISTS public.actor_scope_representatives(uuid);
CREATE FUNCTION public.actor_scope_representatives(_person_id uuid)
RETURNS TABLE (out_representative_id uuid, out_assignment_id uuid, out_accountable boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.representative_id, m.assignment_id, m.accountable
  FROM private.person_current_assignments(_person_id) m
  JOIN private.scope_representative_ids(m.scope_id) s ON true;
$$;

REVOKE ALL ON FUNCTION public.actor_scope_representatives(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.actor_scope_representatives(uuid) TO service_role;

COMMENT ON FUNCTION public.actor_scope_representatives(uuid) IS
  'Every representative currently in reach of a person, with the assignment that puts them there. A representative reachable through two assignments appears twice, deliberately — collapsing them would lose the reason.';

-- ===========================================================================
-- RLS policies
-- ===========================================================================
--
-- No client WRITE policy on any of these tables. Every v2 write goes through a
-- server function under service_role which authorizes the caller first — the
-- pattern established across the Feedback, Performance and Dashboard sprints,
-- and the reason the GRANTs in the previous migration are SELECT-only for
-- authenticated. Commitments included: a promise recorded by a client that
-- could set its own owner_id is not a promise, it is a claim.

-- work_types and capabilities are configuration, readable by everyone who is
-- signed in. Neither contains anything about a person.
DROP POLICY IF EXISTS "work_types read" ON public.work_types;
CREATE POLICY "work_types read" ON public.work_types
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "capabilities read" ON public.capabilities;
CREATE POLICY "capabilities read" ON public.capabilities
  FOR SELECT TO authenticated USING (true);

-- A scope is visible to someone assigned to it, and to admins. Not to
-- everyone: the existence and membership of a scope is itself organizational
-- information.
DROP POLICY IF EXISTS "scopes read" ON public.scopes;
CREATE POLICY "scopes read" ON public.scopes
  FOR SELECT TO authenticated
  USING (private.is_admin(auth.uid()) OR private.can_observe_scope(id));

DROP POLICY IF EXISTS "scope_members read" ON public.scope_members;
CREATE POLICY "scope_members read" ON public.scope_members
  FOR SELECT TO authenticated
  USING (private.is_admin(auth.uid()) OR private.can_observe_scope(scope_id));

-- Your own assignments are always visible to you — PRD FR-28 requires the
-- product to answer "why can I see this?" with a named assignment, and that
-- answer is unrenderable if the assignment itself is hidden.
DROP POLICY IF EXISTS "assignments read" ON public.assignments;
CREATE POLICY "assignments read" ON public.assignments
  FOR SELECT TO authenticated
  USING (
    private.is_admin(auth.uid())
    OR person_id = auth.uid()
    OR private.can_observe_scope(scope_id)
  );

DROP POLICY IF EXISTS "assignment_capabilities read" ON public.assignment_capabilities;
CREATE POLICY "assignment_capabilities read" ON public.assignment_capabilities
  FOR SELECT TO authenticated
  USING (
    private.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.assignments a
      WHERE a.id = assignment_capabilities.assignment_id
        AND (a.person_id = auth.uid() OR private.can_observe_scope(a.scope_id))
    )
  );

DROP POLICY IF EXISTS "work_items read" ON public.work_items;
CREATE POLICY "work_items read" ON public.work_items
  FOR SELECT TO authenticated
  USING (
    private.is_admin(auth.uid())
    OR (owner_representative_id IS NOT NULL AND private.can_observe_rep(owner_representative_id))
    OR (owner_representative_id IS NOT NULL AND private.rep_is_self(owner_representative_id))
  );

DROP POLICY IF EXISTS "outcomes read" ON public.outcomes;
CREATE POLICY "outcomes read" ON public.outcomes
  FOR SELECT TO authenticated
  USING (private.can_observe_work_item(work_item_id));

DROP POLICY IF EXISTS "durability_checks read" ON public.durability_checks;
CREATE POLICY "durability_checks read" ON public.durability_checks
  FOR SELECT TO authenticated
  USING (
    private.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.outcomes o
      WHERE o.id = durability_checks.outcome_id
        AND private.can_observe_work_item(o.work_item_id)
    )
  );

-- A commitment is visible to the person who owes it, the person who asked for
-- it, and whoever can observe its subject. The third clause is what lets a
-- manager see the coaching commitments made about one of their people by
-- someone else — a functional reviewer, say — without which the accountable
-- manager is the last to know.
DROP POLICY IF EXISTS "commitments read" ON public.commitments;
CREATE POLICY "commitments read" ON public.commitments
  FOR SELECT TO authenticated
  USING (
    private.is_admin(auth.uid())
    OR owner_id = auth.uid()
    OR created_by = auth.uid()
    OR (subject_representative_id IS NOT NULL AND private.can_observe_rep(subject_representative_id))
    OR (subject_team_id IS NOT NULL AND private.manages_team(subject_team_id))
  );

-- ===========================================================================
-- backfill from the v1 org chart
-- ===========================================================================
--
-- The new model is worthless while it is empty: a helper that returns false
-- for everyone is indistinguishable from a helper that is wrong. This
-- reproduces today's org chart as assignments so the two models agree from the
-- moment they coexist.
--
-- One scope per team (whether or not it has a manager — the scope is a fact
-- about the team, not about who runs it), and one accountable assignment per
-- team that has one. Idempotent: re-running creates nothing new.

INSERT INTO public.scopes (key, display_name, kind, team_id)
SELECT 'team:' || t.id::text, t.name, 'team', t.id
FROM public.teams t
WHERE NOT EXISTS (
  SELECT 1 FROM public.scopes s WHERE s.kind = 'team' AND s.team_id = t.id
);

-- valid_from is the team's creation date, not today: the manager did not take
-- over this morning, and dating it today would make every historical question
-- ("who was accountable in March?") answer "nobody".
INSERT INTO public.assignments (person_id, scope_id, accountable, valid_from, cadence, label)
SELECT t.manager_id, s.id, true, t.created_at::date, 'daily', 'ראש צוות'
FROM public.teams t
JOIN public.scopes s ON s.kind = 'team' AND s.team_id = t.id
WHERE t.manager_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.scope_id = s.id AND a.person_id = t.manager_id AND a.revoked_at IS NULL
  );

-- The v1 team manager's capability set, stated explicitly rather than implied
-- by a role name. This is the "line management" configuration: all four
-- families over their own team.
INSERT INTO public.assignment_capabilities (assignment_id, capability_key)
SELECT a.id, c.key
FROM public.assignments a
JOIN public.scopes s ON s.id = a.scope_id AND s.kind = 'team'
CROSS JOIN (VALUES
  ('observe.performance'), ('observe.feedback'), ('observe.work_items'), ('observe.team'),
  ('intervene.coach'), ('intervene.assign_work'), ('intervene.approve'),
  ('define.targets'), ('define.roster'),
  ('answer.results')
) AS c(key)
WHERE a.accountable
ON CONFLICT (assignment_id, capability_key) DO NOTHING;
