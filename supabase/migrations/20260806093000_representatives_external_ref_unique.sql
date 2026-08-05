-- Representatives Operational Hardening (P0-4 follow-up): external_ref decision
-- external_ref ("מזהה נציג (לייבוא נתונים)") is presented to admins as a
-- stable per-representative business identifier, and collectBlockers /
-- resolveBusinessIdentifier (team-admin.functions.ts) cross-reference a
-- representative to legacy profiles.representative_id values through it. A
-- duplicate external_ref across two representatives would make that
-- cross-reference ambiguous: collectBlockers could attribute another
-- representative's linked profiles as delete blockers, and
-- resolveBusinessIdentifier could display the wrong representative's id.
--
-- Decision: make external_ref unique among non-null values, matching how the
-- UI already presents it — a per-representative identifier, not a free-text
-- label duplicates are expected to share. NULL (no external_ref set) remains
-- unrestricted, since most representatives never set one.
--
-- If any duplicate external_ref values already exist in this environment,
-- this migration fails to apply rather than silently leaving the ambiguity
-- in place — that is the intended, safe failure mode. Duplicates must be
-- resolved manually (clear or disambiguate one of the conflicting values)
-- before this constraint can be added.
CREATE UNIQUE INDEX representatives_external_ref_unique_idx
  ON public.representatives (external_ref)
  WHERE external_ref IS NOT NULL;
