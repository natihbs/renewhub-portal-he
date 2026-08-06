# Pulse — Organization Architecture Review

**Document type:** Architecture Design Document
**Phase:** Phase 2 — Organization Architecture (design only)
**Status:** Proposed — awaiting engineering leadership decision
**Scope:** Design and architecture only. No implementation, no migrations, no schema changes.
**Audience:** Engineering leadership, product leadership, external architecture review

---

# Executive Summary

## The problem in one sentence

Pulse models a two-level management structure; Menora Mivtachim operates a four-level one, and the two middle layers of the organization have no seat, no data object, and no scope in the product.

## Recommended architecture

**A generic recursive organization tree as the structure of record, combined with denormalized, immutable unit lineage pinned onto every fact row at write time.**

The two halves solve different problems and are both necessary:

- **The tree** (`org_units`, self-referencing `parent_id`, soft-typed by a registry) means organizational change is a data change, not a schema migration. Menora can insert a "Region" layer, merge Activity Managers into Call Center Managers, or split a division, without an engineering project.
- **The pinned lineage** (every fact row records the full ancestor path of the unit that produced it, immutably, at write time) means row-level security predicates stay flat, non-recursive and auditable, aggregation never walks the tree at query time, and — most importantly — a reorganization can never rewrite history.

The governing invariant of the entire design:

> **The tree is mutable. History is not.** A fact records the unit lineage that produced it, at the moment it was produced, and no later reorganization may alter that record.

This is not a new principle. It is the generalization of the invariant already enforced by the `kpi_values_enforce_team_attribution` trigger shipped in the Performance hardening sprint, which pins `kpi_values.team_id` at insert and makes it immutable on update. That single-level guarantee is extended to the whole ancestor chain.

## Main decisions

| # | Decision area | Recommendation | Confidence |
|---|---|---|---|
| 1 | Domain model | Generic `org_units` + type registry with declared nesting rules — not named tables (`divisions`, `call_centers`) | High |
| 2 | Tree representation | Adjacency list (`parent_id`) as source of truth + trigger-maintained materialized path (text) for querying | High |
| 3 | Fact attribution | Pin immutable full lineage at write time; extends the existing `kpi_values.team_id` invariant | **Very high** |
| 4 | Authorization | Separate three orthogonal axes: functional **role** × organizational **scope** × **system capability** | **Very high** |
| 5 | Workspace | A node in the tree; URL-addressable; breadcrumb + drill-down | High |
| 6 | Targets | Independent object at any level, never derived, with an explicit reconciliation view; generalized period model | High |
| 7 | KPI roll-up | Declared per-metric aggregation algebra; percentages never aggregate | **Very high** |
| 8 | Migration | Four-phase expand → migrate → contract, with shadow verification at the RLS cutover | High |
| 9 | Multi-tenancy | Do not build; reserve the root unit as the boundary and add the column now while it is free | Medium |
| 10 | Temporal org structure | Defer; reserve nullable columns so the option stays open | Medium |

## Alternatives considered

Four hierarchy representations and three domain-modelling approaches were evaluated. The two serious competitors to the recommendation:

- **Fixed-depth denormalized columns** (`division_id`, `center_id`, `activity_id`, `team_id` on every relevant table). Dramatically simpler, faster, and it preserves the current flat RLS predicates *exactly as written and audited*. Rejected as the primary model because adding or removing an organizational level becomes a schema migration plus backfill plus RLS rewrite plus every aggregation call site — but its best property (flat predicates) is deliberately stolen and incorporated via pinned lineage.
- **Closure table.** Handles reparenting more gracefully than a materialized path and needs no derived string. Rejected because it introduces a second representation of the same tree that must be kept consistent with the first, and inconsistency between two representations of one truth is precisely the class of bug that stays invisible until it corrupts a report.

Full analysis with advantages, disadvantages and rejection rationale is in **Section 4**.

## Biggest risks

1. **RLS regression during the authorization cutover** — *Critical*. Four hardening sprints produced row-level security policies that are flat, readable and proven by live-database replay testing. A subtree authorization model is a different shape of predicate. The helper function resolving a caller's permitted path prefixes becomes new, central and load-bearing; if it is wrong, it is wrong everywhere simultaneously.
2. **Derived state drift** — *High*. `org_units.path` and `facts.org_unit_path` are computed. Computed state drifts. The current schema does not have this class of bug; this design adds it.
3. **Backfill misattribution** — *High*. Historical rows will be backfilled with *today's* structure because we never recorded yesterday's. This is unavoidable and must be documented rather than hidden.
4. **Organizational data entry is the long pole** — *High, non-engineering*. Populating the tree accurately — which centers, which activity managers, who reports to whom — is a business exercise. If it stalls, the schema ships and nothing improves.
5. **Product risk exceeds technical risk** — *High*. Pulse has exactly one proven dashboard (Team Manager). This design authorizes building three more for roles whose daily workflow has not been observed. In particular, the Call Center Manager's actual job is service level, staffing, occupancy and adherence — and Pulse holds none of that data.
6. **Permission surface growth** — *Medium*. Today's matrix is 3 roles × 2 scopes. The proposed matrix is 5 roles × N units × 4 capabilities.

## Migration strategy

Four phases, each independently shippable and independently revertible:

- **Phase 2A — Structure, dormant.** Create the tables, backfill each existing team as a leaf unit *reusing its existing UUID* so every foreign key survives untouched. Nothing reads the tree. Zero user-visible change. Revertible by dropping three tables.
- **Phase 2B — Pinned lineage, dual-write.** Add lineage columns to fact tables, backfill, begin pinning on new writes. Reads still use `team_id`. Revertible by dropping columns.
- **Phase 2C — Authorization cutover.** New RLS policies alongside old, behind a per-user flag, with shadow verification comparing returned row sets before enabling. The dangerous phase.
- **Phase 2D — Contract.** Retire `team_id` reads, convert or drop `teams`. The commitment point; should be an explicit decision, not a default.

Old teams survive unchanged throughout phases 2A–2C. Both models genuinely coexist, which is the point of the sequencing.

## Final recommendation

**Approve the architecture. Scope the next sprint to Phase 2A only.**

Phase 2A is structure-only, dormant, fully revertible, and carries no user-visible risk. It de-risks everything after it, and — critically — it forces the organizational-chart data question to the front, where it belongs, before any engineering depends on it.

Do not sell Phase 2 internally as "executive dashboards". It is *the structure that makes executive dashboards possible*. The dashboards themselves are a separate product decision that depends on observing how Activity Managers and Call Center Managers actually work, and on resolving whether Pulse ingests contact-center operational data at all.

**One question should be answered before committing:** how many Activity Managers and Call Center Managers exist, and how stable has that structure been? If the answer is "3 and 6, unchanged in four years", the fixed-depth alternative becomes materially more attractive. That is a judgement about the business, not a fact derivable from the schema, and it is worth ten minutes of the VP's time.

---

# 1. Current State

## 1.1 Organizational reality

Menora Mivtachim operates the following hierarchy:

```
Vice President (Division Manager)
  └── Activity Managers
        └── Call Center Managers
              └── Team Managers
                    └── Representatives
```

Five levels; four of them management.

## 1.2 What Pulse models today

| Concept | Current implementation |
|---|---|
| **Roles** | `app_role` PostgreSQL enum with exactly three values: `admin`, `manager`, `representative` |
| **Structure** | `teams` table — flat list. Columns: `id`, `name`, `manager_id`, `active`, `kpi_profile`, `created_at`, `updated_at`. **No parent reference, no grouping, no nesting.** |
| **Scope** | Workspace context is a two-value discriminated union: `{ type: 'org' } \| { type: 'team', teamId, teamName }` |
| **Representative attachment** | `representatives.team_id` → `teams.id`, `ON DELETE SET NULL` |
| **Targets** | Two tables: `team_goals` and `representative_goals`. Both keyed by `goal_month date` with a `CHECK (goal_month = date_trunc('month', goal_month)::date)` constraint — **monthly periods only** |
| **Measurement** | `kpi_values`: `representative_id`, `team_id`, `metric_date`, `renewal_opportunities`, `completed_renewals`, `source_import_id`. Daily-dated. `UNIQUE (representative_id, metric_date)` |
| **Team attribution** | `kpi_values.team_id` is derived by the `kpi_values_enforce_team_attribution` trigger on INSERT and pinned immutably on UPDATE — a caller cannot choose it |
| **Quality** | `feedback` with `criteria jsonb`, server-derived `score`, `published`/`published_at`, append-only `feedback_revisions` |
| **Coaching** | `coaching_plans` (one per representative), `listening_schedules`, `rep_tasks`, `rep_notes` |

## 1.3 Current authorization model

Row-level security is enforced through `SECURITY DEFINER` helper functions in the `private` schema, revoked from `PUBLIC`/`anon` and granted to `authenticated`:

| Helper | Semantics |
|---|---|
| `private.is_admin(uuid)` | Holds the `admin` role |
| `private.is_manager(uuid)` | Holds the `manager` role |
| `private.is_staff()` | `is_admin(auth.uid()) OR is_manager(auth.uid())` |
| `private.rep_is_self(rep)` | The representative is linked to the calling user |
| `private.rep_is_self_active(rep)` | As above, and the representative record is active (write gate) |
| `private.rep_in_my_team(rep)` | The representative's team is managed by the caller |
| `private.can_manage_rep(rep)` | `is_admin(auth.uid()) OR (is_manager(auth.uid()) AND rep_in_my_team(rep))` |
| `private.manages_team(team_id)` | `teams.manager_id = auth.uid()` for the given team |
| `private.my_team_id()` | The caller's own team |

These predicates are **flat** — no recursion, no tree traversal — which is a significant part of why they are auditable and fast.

## 1.4 Current module scoping (verified)

| Module / table | Read policy | Write policy | Effective scope |
|---|---|---|---|
| `announcements` | `USING (true)` | `is_staff()` | Organization-wide |
| `articles` | `USING (true)` | `is_staff()` | Organization-wide |
| `competitions` | `USING (true)` | `is_staff()` | Organization-wide |
| `competition_categories` | `USING (true)` | `is_staff()` | Organization-wide |
| `competition_scores` | `USING (true)` | `is_staff()` | Organization-wide |
| `comms_messages` | `is_staff()` | `is_staff()` | **Any manager reads all** |
| `comms_templates` | `is_staff()` | `is_staff()` | **Any manager reads all** |
| `import_history` | `is_staff()` | `is_staff()` | **Any manager reads all** |
| `feedback` | `can_manage_rep(rep) OR (published AND rep_is_self(rep))` | domain server functions only | Team-scoped |
| `listening_schedules` | `can_manage_rep OR rep_is_self` | domain server functions only | Team-scoped |
| `kpi_values` | `can_manage_rep(rep) OR manages_team(team_id)` | `can_manage_rep(rep)` | Team-scoped, with historical attribution read |
| `underwriting_issues` | `is_admin OR can_manage_rep OR rep_is_self` | `can_manage_rep` per command | Team-scoped (hardened in the Dashboard sprint) |
| `team_goals` / `representative_goals` | team/rep scoped | domain server functions | Team-scoped |
| `notifications` | `user_id = auth.uid()` | `user_id = auth.uid()` | Per-user |
| `audit_log` | `is_admin` | service role only | Admin only |
| `activity_events` | `is_admin` (retired) | none | Admin only, retired |

## 1.5 What four hardening sprints already established

The operational layer is stable and carries invariants this design must preserve:

1. **Server-derived business values.** Quality scores, KPI team attribution and achievement percentages are computed server-side; client-asserted values are ignored.
2. **Null is not zero.** A missing target is `null` and rendered as an honest absence. Summing children to manufacture a parent target is explicitly refused in code.
3. **Immutable attribution.** `kpi_values.team_id` is trigger-derived and cannot be rewritten by a later transfer.
4. **Append-only history.** `feedback_revisions` captures prior state in the same transaction as every change.
5. **Optimistic concurrency.** Edits carry the `updated_at` the caller believes it is editing; stale writes are rejected with `P0003`.
6. **Transactional multi-table writes.** `SECURITY DEFINER` PL/pgSQL functions provide atomicity; they contain zero internal authorization and are `service_role`-only, with all permission checks performed in TypeScript before invocation.
7. **No fire-and-forget writes.** Every mutation is awaited, refetched, and reports the real outcome.
8. **Loading ≠ error ≠ empty.** The four async states are distinct, and no claim of absence is made until the query that would disprove it has succeeded.
9. **Two aggregation semantics are named, not blurred.** `renewalTotalsForTeamHistorical` (immutable attribution) vs `renewalTotalsForCurrentRoster` (follows people) — with an explicit comment block warning that choosing wrong silently rewrites history.

---

# 2. Problems Identified

## 2.1 Two of five organizational layers have no representation

Activity Managers and Call Center Managers cannot be modelled at all. An Activity Manager responsible for six call centers can either view one team at a time or all 500 representatives at once. There is nothing in between, because the workspace union has exactly two members and `teams` has no parent.

Given `admin` or `manager`, neither fits:

- `manager` scopes to a single team — far too narrow for their span of control.
- `admin` scopes to everything — far too wide, and grants destructive user-administration powers they should not hold.

## 2.2 Performance above team level is not computable

`team_goals` and `representative_goals` are the only target objects. There is no goal for a call center or a division. Therefore "the division is at 82% of target" is not merely unbuilt — it has **no computable value**.

The obvious workaround (sum the team targets) is explicitly refused by the current code, and correctly so: not every team has a target, and summing would silently treat a missing target as zero. The refusal is right; the consequence is that executive achievement is unrepresentable until a target object exists at that level.

## 2.3 `admin` conflates system administration with organizational seniority

The `admin` role means two unrelated things simultaneously:

- *I can administer the system* — create users, delete representatives, run imports, manage teams.
- *I can see everything* — organization-wide visibility of all performance data.

A Vice President needs the second and must not have the first. There is currently no way to express that combination, so a VP either receives destructive capabilities inappropriate to their role, or a manager seat that shows them a single team.

## 2.4 The manager is not a measurable entity

Pulse can rank representatives and it can rank teams. It cannot measure the people accountable for them.

A VP and an Activity Manager manage *managers*. Their unit of management is the level directly beneath them. There is no manager-level performance object in the schema, so the primary decision-support instrument for the top two layers of the organization does not exist — even though every input it needs (team achievement, coaching coverage, data completeness, listening cadence) is already recorded.

## 2.5 Period model is month-only

Both goal tables carry `CHECK (goal_month = date_trunc('month', goal_month)::date)`. There is no week, quarter or year.

This wastes data that already exists: `kpi_values` is dated daily. A Team Manager runs a *day*, and can only see month-to-date. A VP commits to a *quarter*, and cannot express one.

## 2.6 Pulse holds no contact-center operational data

The complete measurement vocabulary is `renewal_opportunities` and `completed_renewals`, plus a coaching quality score. Verified absent from the entire codebase and schema:

- Average handle time (AHT)
- Service level, abandon rate, queue time
- Occupancy, adherence, shrinkage
- Shift, roster, staffing forecast
- Talk time, calls handled, login/availability time

Pulse is a **sales-performance and coaching product**, not a contact-center operations product. This is a defensible identity — but it means the role literally named "Call Center Manager" cannot be served without an explicit scope decision.

## 2.7 Content and communication modules have no scope concept

`announcements`, `articles`, `competitions`, `competition_scores` are `USING (true)` — every authenticated user reads every row. `comms_messages`, `comms_templates` and `import_history` are `is_staff()` — every manager reads every row, organization-wide.

At one company with one division this is merely coarse. Under a hierarchy it becomes wrong: a Call Center Manager should not necessarily see another center's internal communications, and a competition may be scoped to one center.

## 2.8 Workspace is not addressable and does not scale

The workspace is React state. Two consequences:

- **Sharing is broken.** An executive who sends a colleague a link sends them *their own* scope, silently. There is no way to link to "Center A's view".
- **The picker does not scale.** At 500 seats and ~10 representatives per team, there are roughly 50 teams. A flat dropdown of 50 entries is already unusable; the current admin dashboard also renders one card per team, producing a ~50-card grid.

---

# 3. Proposed Architecture

## 3.1 Shape of the recommendation

Three components, each solving a distinct problem:

### Component 1 — A generic organizational tree (structure of record)

```
org_unit_types    -- registry of level types (division, activity, center, team)
org_units         -- the tree itself; self-referencing parent_id
```

Organizational levels are **data**, not schema. The type registry declares the allowed nesting; a new layer is a registry row and a re-rank, not a migration.

### Component 2 — Pinned immutable lineage on facts (the load-bearing idea)

Every fact table gains two trigger-maintained, immutable-after-insert columns:

```
org_unit_id       -- the leaf unit at the moment of the write
org_unit_path     -- the FULL ancestor path at the moment of the write
```

This is the generalization of `kpi_values_enforce_team_attribution` from one level to the whole chain.

### Component 3 — Role × Scope × Capability authorization

Three orthogonal axes replacing the current three-value enum:

```
role_assignments  -- (user_id, role_code, org_unit_id)
```

## 3.2 Why pinned lineage is the pivotal decision

It buys three properties simultaneously, and each is individually sufficient to justify it:

**(a) Row-level security stays flat.** "Can I see this row?" becomes a prefix test of the row's stored `org_unit_path` against the caller's permitted prefixes. No recursive CTE evaluated per row, no join to the tree inside a policy. The security model remains as auditable as the current one — which matters enormously given that four sprints of hardening are encoded in those policies.

**(b) History becomes reorg-proof.** A center dissolved last year keeps its numbers. Today `kpi_values.team_id` already guarantees this at one level; this extends the guarantee up the whole ancestor chain, so a division restructure cannot retroactively move last quarter's production between divisions.

**(c) Aggregation never walks the tree.** `GROUP BY` on a path prefix rather than a recursive descent. At 5,000 representatives this is the difference between a report and a timeout.

The cost is denormalization plus storage: one path string per fact row. At approximately 6 million rows over five years at 500 seats, and ~60 bytes per path, this is negligible.

## 3.3 The unavoidable consequence: two legitimate aggregation semantics

Pinned history and current structure **will** diverge, and both answers are correct — to different questions:

| Question | Uses |
|---|---|
| "What did Center A produce in Q1?" | The **pinned path** — immutable attribution |
| "What are Center A's *current* people producing?" | The **live tree** — follows people |

`kpi-values.ts` already models exactly this distinction at team level, with a documentation block explaining that choosing wrong silently rewrites history. **That pattern generalizes and must be enforced by naming at every level**: any function that aggregates by unit must state in its name which question it answers.

## 3.4 What explicitly does not change

- All pure domain primitives: `performance-domain.ts` (achievement, pace, gap, risk), `kpi-values.ts` (renewal totals, attribution semantics), `feedback-domain.ts` (score, queue priority, thresholds), `dashboard-domain.ts` (completeness, trend, freshness, view state). These are level-agnostic pure functions and survive unchanged.
- The `SECURITY DEFINER` RPC pattern: `service_role`-only, zero internal authorization, all checks performed in TypeScript before invocation.
- Append-only revision history, optimistic concurrency, audited domain write paths.
- The "workspace is a view filter, never an authorization boundary" principle.

---

# 4. Alternative Architectures

## 4.1 Alternative A — Named, typed tables per level

Introduce `divisions`, `activities`, `call_centers`, and keep `teams`, each with an explicit foreign key to its parent type.

**Advantages**

- The schema documents the business. Anyone reading it learns the org chart.
- Queries read naturally: `SELECT * FROM call_centers WHERE division_id = ...`
- Constraints are natural and enforced by the type system: a call center *must* belong to a division; the database refuses anything else.
- Every join is explicit and statically analyzable; no recursion anywhere.
- Straightforward, predictable query plans.

**Disadvantages**

- The org chart becomes schema. Any structural change is an engineering project.
- Inserting a level (e.g. "Region" between Division and Activity) requires: a new table, new foreign keys, new RLS policies, backfill, and edits to every aggregation call site.
- Merging levels (e.g. Activity Managers absorbed into Call Center Managers) requires the reverse.
- Cannot represent a partial or transitional structure — a center temporarily reporting elsewhere during a reorganization has no honest representation.
- Every generic operation ("show me this unit's children") needs a `CASE` over four tables.

**Why rejected**

Over a five-year horizon in an insurance division, structural change is not hypothetical — it is expected more than once. The cost of each change under this model is a multi-week engineering project touching security policy. The design brief explicitly asks to optimize for correctness over five years rather than minimal code change.

## 4.2 Alternative B — Fixed-depth denormalized columns

Place `division_id`, `activity_id`, `center_id`, `team_id` directly on `representatives` and on every fact table. No tree table at all.

**Advantages**

- **RLS stays flat and trivially simple** — `team_id IN (...)`, `center_id = X`. This preserves four sprints of hardened, replay-tested policies essentially as written.
- Aggregation is `GROUP BY center_id`. No recursive CTEs, no path operators, no PostgreSQL extension.
- Query plans are predictable at any scale; every access path is a plain B-tree index.
- A new engineer understands the entire model in ninety seconds.
- Fastest possible reads for the common case.
- No derived state, therefore no derived-state drift.

**Disadvantages**

- Adding or removing a level is a schema migration plus backfill plus RLS rewrite plus every aggregation site.
- Matrix reporting (a unit reporting into two structures) is unrepresentable.
- A transitional structure cannot be modelled without lying in a column.
- Generic tree operations ("all descendants of X") require knowing the depth in advance and writing level-specific SQL.
- The number of columns grows with organizational depth, and each is nullable-by-necessity for units that do not have that ancestor.

**Why rejected — with an important caveat**

Rejected as the *primary* structural model because it hard-codes organizational depth, which is exactly the property this phase exists to remove.

**However, this alternative deserves more respect than a straw man, and its central advantage is deliberately incorporated into the recommendation.** The pinned-lineage design (§3.2) exists specifically to recover the flat, fast, auditable RLS that Alternative B provides natively. If the business answers §14's first open question with "the structure is 3 activity managers and 6 centers, unchanged in four years", Alternative B becomes materially more attractive and should be reconsidered on its merits — it is simpler, faster, and lower-risk.

## 4.3 Alternative C — Adjacency list only (`parent_id`, no path, no closure)

The minimal tree: each unit stores its parent, and every subtree query uses a recursive CTE.

**Advantages**

- Simplest possible schema — one nullable self-referencing column.
- Reparenting is O(1): update one row.
- No derived state whatsoever.
- No extensions, no triggers.

**Disadvantages**

- **Every subtree query requires a recursive CTE.**
- Inside an RLS policy, that recursive CTE is evaluated in the context of row filtering, effectively per row or per statement with poor plan characteristics.
- Aggregation across a subtree requires the recursion before any grouping.
- Depth-unbounded queries are hard to reason about for performance.

**Why rejected**

Fatal in the authorization layer. The deciding constraint of this entire design is not query elegance — it is **whether RLS can express "is this row inside my subtree" without recursion per row**. At 5,000 representatives, a recursive CTE inside a policy is a production incident, not a performance note.

Adjacency list is nonetheless retained *as the source of truth for the parent relationship* in the recommendation, because it is the obvious thing an administrator edits — but it is never the query mechanism.

## 4.4 Alternative D — Closure table

Maintain a separate `org_unit_closure (ancestor_id, descendant_id, depth)` table containing one row per ancestor–descendant pair.

**Advantages**

- Subtree queries are a plain indexed join — fast, no extension, no string parsing.
- Handles reparenting more gracefully than a materialized path: no string rewriting.
- Purely relational; no derived text column; easy to reason about.
- Depth is available directly, which is convenient for level-aware queries.
- Well-understood, textbook pattern.

**Disadvantages**

- A second table representing the same tree as `parent_id`, which must be kept perfectly consistent with it.
- Reparenting rewrites O(subtree × depth) rows.
- Table size is O(n × depth) — trivial here, but it grows superlinearly with depth.
- Three operations (insert, reparent, delete) each need correct closure maintenance; a bug in any one silently corrupts authorization.

**Why rejected**

This was the closest call in the document. Rejected because it introduces a **second representation of one truth**. Inconsistency between two representations of the same tree is the class of bug that remains invisible until it corrupts a report or, worse, an authorization decision. One derived column maintained by one trigger is a smaller and more auditable surface than one derived table maintained by three code paths.

Closure table remains a legitimate fallback if materialized-path maintenance proves problematic in practice.

## 4.5 Alternative E — Nested sets (left/right bounds)

**Advantages**

- Extremely fast subtree reads via a simple range predicate.
- No recursion, no joins.

**Disadvantages**

- Any insert or move rewrites a large fraction of the table.
- Concurrent structural writes are effectively serialized.
- Bounds are opaque and undebuggable by eye.

**Why rejected**

Optimized for read-heavy, near-immutable trees. Our tree is explicitly mutable — enabling reorganization is the entire purpose of the phase.

## 4.6 Alternative F — Extend `teams` with `parent_team_id` ("team groups")

The minimal-change option: add a self-reference to the existing table.

**Advantages**

- Smallest possible diff; no new tables.
- Existing foreign keys unchanged.
- Ships fastest.

**Disadvantages**

- A Team and a Division are not the same kind of entity. A Team has a roster of representatives; a Division has child units and no direct roster.
- Every query needs `WHERE is_actually_a_team` or equivalent, or it will silently mix levels.
- `teams.manager_id` means something different at each level, with no way to express the difference.
- Team-specific attributes (`kpi_profile`) become meaningless at higher levels.

**Why rejected**

It does not model the problem; it postpones it by approximately one quarter, and does so by making every downstream query more fragile.

## 4.7 Comparison summary

| | Named tables | Fixed-depth cols | Adjacency only | Closure table | Nested sets | Team groups | **Recommended** |
|---|---|---|---|---|---|---|---|
| Structural change without migration | ✗ | ✗ | ✓ | ✓ | ✓ | Partial | **✓** |
| Flat, non-recursive RLS | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | **✓** |
| Fast subtree aggregation | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | **✓** |
| Cheap reparenting | ✓ | ✓ | ✓ | Moderate | ✗ | ✓ | **Moderate** |
| No derived state | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | **✗** |
| Single representation of truth | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | **✓** |
| Reorg-proof history | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **✓** |
| Schema documents the business | ✓ | Partial | ✗ | ✗ | ✗ | ✗ | **Via registry** |

---

# 5. Data Model

## 5.1 Hierarchy model — the core engineering decision

The deciding factor is **not** query elegance. It is whether row-level security can express "is this row inside my subtree" without a recursive query per row. At 5,000 representatives that single consideration determines the design.

| Approach | Subtree read | Reparent cost | RLS viability | Verdict |
|---|---|---|---|---|
| Adjacency list only | Recursive CTE | O(1) | **Fatal** — recursive CTE inside a policy | Rejected as sole mechanism |
| Materialized path | Index-backed prefix match | O(subtree), one UPDATE | Good | **Recommended** |
| Closure table | Index-backed join | O(subtree × depth) rows | Good | Strong alternative |
| Nested sets | Range query | O(n) | Poor for a mutable tree | Rejected |

**Recommendation:** adjacency list (`parent_id`) as the authoritative parent relationship, plus a **trigger-maintained materialized path** for querying.

- `parent_id` is the human-obvious relationship and the thing an administrator edits.
- `path` is derived state, maintained by trigger on insert and on reparent, **never written by application code**.

### Path encoding: `ltree` vs text

**`ltree`** is purpose-built: GiST index, native `<@` descendant operator, precise semantics. Its labels are restricted to `[A-Za-z0-9_]`, so UUIDs require transformation and paths become unreadable in logs.

**Text path** of the form `/root/div-a/center-3/team-17/` with a `text_pattern_ops` B-tree index and `LIKE 'prefix%'` matching is debuggable by eye — an engineer can read a path in a log line and immediately know where they are.

At ~600 units and ~6M fact rows the performance difference is irrelevant. **Recommendation: text path, for operability.** This is a low-stakes decision either way and can be revisited without affecting the rest of the design.

## 5.2 Tables

### `org_unit_types` — level registry

| Column | Type | Notes |
|---|---|---|
| `code` | text | **PK**. e.g. `division`, `activity`, `center`, `team` |
| `label` | text | Display name (Hebrew), e.g. `מרכז שירות` |
| `depth_rank` | integer | **UNIQUE**. Declares nesting order |
| `is_leaf_container` | boolean | Whether representatives may attach to units of this type |
| `active` | boolean | |

The registry makes organizational levels data. Inserting a "Region" layer is a registry row plus a re-rank, not a migration.

### `org_units` — the tree

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK**, `DEFAULT gen_random_uuid()` |
| `parent_id` | uuid | **FK** → `org_units(id)` `ON DELETE RESTRICT` |
| `type_code` | text | **FK** → `org_unit_types(code)` |
| `name` | text | NOT NULL |
| `manager_user_id` | uuid | The unit's owning manager (nullable) |
| `active` | boolean | NOT NULL DEFAULT true |
| `path` | text | **Derived**, trigger-maintained, NOT NULL |
| `depth` | integer | **Derived**, trigger-maintained |
| `effective_from` | date | Reserved for future temporal support; nullable, unused |
| `effective_to` | date | Reserved; nullable, unused |
| `created_at`, `updated_at` | timestamptz | |

**Constraints**

- `CHECK (parent_id IS NOT NULL OR depth = 0)` — exactly one root per tree
- `UNIQUE (parent_id, name)` — no duplicate siblings
- Type-rank constraint: a unit's `type_code.depth_rank` must be exactly one greater than its parent's. This keeps the tree well-formed without hard-coding five levels.
- Leaf-container constraint: `representatives.org_unit_id` may only reference units whose type has `is_leaf_container = true`. Prevents attaching a representative directly to a Division.

**`ON DELETE RESTRICT` is deliberate.** Deleting a unit that has children or history must be impossible — consistent with the delete-blocker pattern already established for representatives and teams, where destructive deletes are refused in favour of deactivation.

**Cycle prevention.** A `BEFORE UPDATE` trigger rejects any reparent where the proposed new parent's path contains the moving unit's own id. Cheap; the alternative is discovering a cycle when a query hangs.

### `role_assignments` — authorization

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `user_id` | uuid | **FK** → `auth.users(id)` |
| `role_code` | text | **FK** → role registry |
| `org_unit_id` | uuid | **FK** → `org_units(id)` — the scope |
| `active` | boolean | |
| `granted_by`, `granted_at` | uuid, timestamptz | Attribution |
| | | `UNIQUE (user_id, role_code, org_unit_id)` |

### `targets` — unified target object

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `org_unit_id` | uuid | **FK**, nullable |
| `representative_id` | uuid | **FK**, nullable |
| `metric_code` | text | e.g. `renewals`, `renewal_rate` |
| `period_type` | text | `day` \| `week` \| `month` \| `quarter` \| `year` |
| `period_start` | date | |
| `target_value` | numeric | |
| `status` | text | `draft` \| `committed` \| `superseded` |
| `created_by`, `updated_by` | uuid | |
| | | `CHECK` exactly one of `org_unit_id`, `representative_id` is non-null |
| | | `UNIQUE (org_unit_id, representative_id, metric_code, period_type, period_start)` |

Generalizes `team_goals` and `representative_goals` into one table with an explicit period model, replacing the month-only `date_trunc` constraint.

### Fact table extensions

Every table that today pins `team_id` or references a representative gains:

| Column | Type | Notes |
|---|---|---|
| `org_unit_id` | uuid | Leaf unit at the moment of the write |
| `org_unit_path` | text | **Full ancestor path** at the moment of the write, **immutable** |

Applies to: `kpi_values`, `feedback`, `listening_schedules`, `rep_tasks`, `rep_notes`, `coaching_plans`, `underwriting_issues`, `manager_calls`, `team_achievement_snapshots`, `competition_scores`.

Both are derived by trigger from the representative's current unit at insert, and pinned immutably on update — the exact pattern `kpi_values_enforce_team_attribution` already implements, generalized.

## 5.3 Relationships (ER explanation)

```
org_unit_types 1 ──────< org_units          (type_code)
org_units      1 ──────< org_units          (parent_id, self-referencing)
org_units      1 ──────< representatives    (org_unit_id, leaf containers only)
org_units      1 ──────< role_assignments   (org_unit_id = scope)
org_units      1 ──────< targets            (org_unit_id, XOR representative_id)
auth.users     1 ──────< role_assignments   (user_id)
auth.users     1 ──────< org_units          (manager_user_id)

representatives 1 ─────< kpi_values          (+ pinned org_unit_id, org_unit_path)
representatives 1 ─────< feedback            (+ pinned lineage)
representatives 1 ─────< listening_schedules (+ pinned lineage)
representatives 1 ─────< rep_tasks, rep_notes, coaching_plans, underwriting_issues
feedback        1 ─────< feedback_revisions  (append-only)
```

**Reading the diagram.** The tree is one table pointing at itself. Representatives attach only at leaf-container level. Authorization is a triple joining users to the tree. Targets attach to *either* a unit *or* a representative, never both. Fact tables continue to hang off representatives exactly as today, but each row additionally carries a frozen copy of where in the tree it was produced — which is what makes both security and aggregation fast, and history immutable.

## 5.4 Indexes

| Table | Index | Purpose |
|---|---|---|
| `org_units` | `(parent_id)` | Children lookup, reparent validation |
| `org_units` | `(path text_pattern_ops)` | **Subtree prefix matching — the critical index** |
| `org_units` | `(type_code, active)` | Level-filtered listings |
| `org_units` | `(manager_user_id)` | "Which units does this person own" |
| `role_assignments` | `(user_id, active)` | Permission resolution per request |
| `role_assignments` | `(org_unit_id)` | "Who has authority here" |
| `targets` | `(org_unit_id, metric_code, period_type, period_start)` | Target lookup |
| `targets` | `(representative_id, metric_code, period_type, period_start)` | Personal target lookup |
| Every fact table | `(org_unit_path text_pattern_ops)` | **Subtree aggregation and RLS** |
| Every fact table | `(org_unit_id, <date column>)` | Unit-scoped time-range queries |

## 5.5 Temporal structure — deliberately deferred

Should `org_units` be bitemporal, answering "what did the org chart look like in March"?

**Recommendation: no, not in Phase 2.**

Pinned lineage on facts already answers every *reporting* question without versioning the tree. Full temporal structure would additionally answer "which manager owned this team in March" — an HR question, not an operating one.

Add `effective_from` / `effective_to` as nullable, unused columns now so the option remains open at zero cost; do not build the machinery, the queries, or the UI.

---

# 6. Authorization Model

## 6.1 The three axes

Today's model has one axis with three values. The proposal has three orthogonal axes.

### Axis 1 — Functional role

*What kind of work does this person do?* Drives dashboard responsibility, default widgets, and the capability template.

| Role code | Meaning |
|---|---|
| `vp` | Division Manager |
| `activity_manager` | Activity Manager |
| `center_manager` | Call Center Manager |
| `team_manager` | Team Manager |
| `representative` | Representative |

### Axis 2 — Organizational scope

*Over which part of the tree?* An `org_unit_id`. Authority extends to that unit **and everything beneath it**.

### Axis 3 — System capability

*Orthogonal, additive, sparingly granted.*

| Capability | Grants |
|---|---|
| `user_admin` | Create, invite, deactivate, delete user accounts |
| `data_import` | Run and undo data imports |
| `org_admin` | Modify the organizational tree itself |
| `audit_read` | Read the audit log |

**This axis is the fix for problem §2.3.** A VP holds `role = vp`, `scope = division`, and **no system capabilities**. An IT administrator holds `user_admin` and **no organizational role** — and therefore sees no performance data at all.

## 6.2 Assignment model

An assignment is the triple `(user_id, role_code, org_unit_id)`. A user may hold several simultaneously.

This falls out naturally and covers cases the current model cannot express at all:

| Scenario | Representation |
|---|---|
| VP covering an Activity Manager during leave | Add a second assignment; remove it on return |
| Team Manager running two teams | Two assignments (awkward and partially broken today) |
| Center Manager promoted mid-month | Add the new assignment, deactivate the old; history intact |
| IT administrator | `user_admin` capability, zero organizational roles |
| Manager on temporary secondment | Assignment at the seconded unit, original deactivated |

## 6.3 Permission inheritance

**Downward, through the tree, by scope.** A role assignment at unit *U* confers authority over *U* and all descendants of *U*.

**Never upward.** A Team Manager sees nothing about their center, their activity, or the division. Not because it is secret, but because it is not their responsibility, and showing it produces a dashboard that answers questions they cannot act on.

**Read scope and write scope must be separable.** The current model does not separate them, and that is a defect.

| | Read | Write |
|---|---|---|
| **Rule** | Full subtree | Narrower, role-dependent, and type-constrained |
| **Example** | A VP reads everything beneath them | A VP sets *division* targets; they do **not** set a representative's personal target |
| **Example** | An Activity Manager reads all their centers | Coaching writes belong to the direct Team Manager |

**Proposed mechanism:** each capability declares the *unit types* it applies to, and the check becomes:

> Do I hold this capability at or above the row's unit, **and** is the row's unit type within the capability's applicable set?

This prevents the failure mode where seniority silently implies every permission — which is exactly how the current `admin` role behaves.

## 6.4 How RLS evaluates

A `STABLE SECURITY DEFINER` helper in the `private` schema resolves the caller's permitted path prefixes once per statement — the same shape as the existing `private.can_manage_rep`. Policies then become a prefix test of the row's stored `org_unit_path` against those prefixes.

**The critical property: policies stay flat and non-recursive**, because the recursion was paid at write time when the path was pinned. The existing helper conventions (functions in `private`, revoked from `PUBLIC`/`anon`, granted to `authenticated`) carry over unchanged.

## 6.5 Worked examples

**Example 1 — VP viewing a representative's feedback**
Assignment: `(vp, division-root)`. Row: `feedback` with `org_unit_path = /root/div-a/act-1/center-3/team-17/`. Permitted prefix `/root/div-a/`. Prefix matches → read allowed. Write refused: the `coaching_write` capability applies to unit type `team` and is not held at that level.

**Example 2 — Team Manager attempting cross-team access**
Assignment: `(team_manager, team-17)`. Permitted prefix `/root/div-a/act-1/center-3/team-17/`. A row from `team-18` does not match → invisible. Identical outcome to today's `can_manage_rep`, reached by a different route.

**Example 3 — Manager of two teams**
Two assignments produce two permitted prefixes; the policy tests against both. Today this case is partially supported and awkward.

**Example 4 — IT administrator**
Capability `user_admin`, no role assignment. No permitted prefixes → zero performance rows visible. Can administer accounts; cannot see a single number.

**Example 5 — Reorganization mid-period**
Center 3 moves from Activity 1 to Activity 2. `org_units.parent_id` changes; the trigger rewrites the subtree's paths. **Existing facts keep their old pinned paths** — Q1 production stays attributed to Activity 1. New facts pin the new path. Both are correct; the naming discipline in §3.3 keeps them distinguishable.

## 6.6 Acknowledged weakness

This model multiplies the permission surface: 5 roles × N units × 4 capabilities, against today's 3 × 2. That is a genuine increase in what must be tested and what can be misconfigured.

**Mitigations, both of which are part of the deliverable rather than follow-ups:**

1. **Role templates.** A role implies a fixed capability set. Individual capabilities are granted only by exception, and the exception is visible.
2. **Effective-permissions inspector.** An administrative screen answering "what can this person actually see and do, and why" — tracing from assignments through capabilities to concrete permitted prefixes.

Without the inspector, that question cannot be answered during an incident. It should not be deferred.

---

# 7. Workspace Model

## 7.1 Concept change

| | Today | Proposed |
|---|---|---|
| Type | `{ type: 'org' } \| { type: 'team', teamId }` | `{ orgUnitId }` |
| Values | 2 | N (constrained to the user's permitted subtree) |
| Uniformity | Special-cased | Uniform — "organization" is simply the root node |

The org/team distinction disappears entirely. This is a genuine simplification, not just a generalization.

## 7.2 Navigation — two motions

**Switch** — jump to any unit within the permitted subtree. Presented as a **tree**, not a flat list. At 50+ teams a flat dropdown is already unusable today; under a hierarchy it is untenable.

**Drill** — move down one level from the current position by clicking a row in a comparison table. This is the **primary** motion for executives and should require no picker interaction whatsoever.

**Breadcrumb of ancestors** replaces the current single-line scope label. Each crumb is a click target for moving back up. This is what makes drill-down navigable rather than a one-way trip.

## 7.3 Scope resolution rules

1. **Default workspace = the unit of the user's highest-ranked assignment.** A VP lands on their division; a Team Manager on their team. Nobody lands somewhere they must immediately navigate away from.
2. **Workspace is a view filter, never an authorization boundary.** This must remain explicit — it is documented as such in the current implementation and that documentation should survive verbatim. RLS remains the only real boundary.
3. **Workspace must be URL-addressable.** Executives share links. Today the workspace is React state, so a shared link silently shows the recipient their own scope. This is a real defect that the tree makes materially worse.
4. **Persist last workspace per user, and validate on load.** If a manager's units changed, fall back rather than displaying a unit they no longer own. The current implementation already does this for teams; the rule generalizes directly.
5. **Every page reads the same workspace.** The Dashboard hardening sprint made the admin home deliberately organization-wide with an explicit on-screen label, because a per-team admin home had no meaning under a flat model. **Under the tree model that exception should be retired** — with a real hierarchy, "the VP's division" *is* their workspace, and the special case dissolves.

## 7.4 Filtering

Filtering is a prefix test against the selected unit's path, applied uniformly:

- **Display filtering** — narrows what is shown, within what RLS already permits.
- **Aggregation scope** — the `GROUP BY` boundary for roll-ups.
- **Never an authorization decision** — a user cannot widen their scope by manipulating the workspace, because RLS has already filtered the row set before the workspace filter is applied.

---

# 8. Target Model

## 8.1 Requirements

1. Targets must exist at any hierarchy level.
2. Targets must never be silently derived.
3. Periods must extend beyond the month.
4. Reorganizations must not corrupt them.

## 8.2 Storage

A single `targets` table (schema in §5.2) replacing `team_goals` and `representative_goals`, with:

- `org_unit_id` XOR `representative_id` — a target belongs to a unit or a person, never both.
- `period_type` + `period_start` — replaces the month-only `date_trunc` constraint, unlocking day, week, quarter and year.
- `status` (`draft` / `committed` / `superseded`) — because target-setting is a negotiation with a lifecycle, not a single write.
- Full uniqueness on `(subject, metric, period_type, period_start)`.

## 8.3 Inheritance — independent, with reconciliation

Three models were considered:

**(a) Derived / roll-up** — a unit's target is the sum of its children's.
*Rejected.* A division's commitment is a **negotiated** number, deliberately and usually different from the sum of what its centers signed up for. Deriving it makes the executive commitment unrepresentable. It also breaks the moment one child lacks a target, and would reintroduce exactly the "silent zero" failure the Targets sprint removed.

**(b) Inherited / roll-down** — children inherit a share of the parent's target.
*Rejected as a default.* Allocation is a management act, not arithmetic. An equal split is almost always wrong, and a weighted split requires a weighting policy the system has no basis to choose.

**(c) Independent, with an explicit reconciliation view — RECOMMENDED.**
Every unit's target is its own object. The system **computes and displays** the gap between a unit's target and the sum of its children's targets, without resolving it.

## 8.4 Why reconciliation is the right answer

The gap is genuinely useful management information:

> "The division committed 10,000. The centers have committed 9,200. 800 units are unallocated."

That is precisely the conversation a VP wants to have with their Activity Managers. Deriving the total would hide it; enforcing equality would prevent the deliberate over- or under-commitment that is normal management practice.

This preserves the hard-won principle from the Targets sprint: **a missing target is `null`, never zero, and never a silent sum.** The current code explicitly refuses to sum representative targets into a team target for this reason. That refusal extends up the tree.

## 8.5 Mandatory?

**No — but absence must be loud.**

A unit without a committed target for an open period is a **structural exception**, surfaced in the parent's readiness view. The Dashboard hardening sprint already established this pattern for teams ("צוותים ללא יעד חודשי" in the admin readiness section); it generalizes to every level.

Enforcing targets via `NOT NULL` would simply produce placeholder zeros, which is strictly worse than an honest, visible gap.

## 8.6 Aggregation of targets

Targets aggregate for **display and reconciliation only**, never to manufacture a value:

- A unit's *own* target is used for its achievement calculation.
- The *sum of children's* targets is shown alongside it, labelled as such.
- If a unit has no target, its achievement is `null` — not the sum of its children's targets, and not zero.

## 8.7 Reorganization semantics

Scenario: a center moves from Activity A to Activity B mid-quarter. What happens to the quarter's targets?

**Recommendation: targets belong to the unit and travel with it. The parent's target does not change automatically.**

The reconciliation gap moves — Activity A becomes over-committed, Activity B under-committed — and a human resolves it. Any automatic rebalancing would silently rewrite a commitment, which is precisely the class of behaviour four hardening sprints have been removing.

---

# 9. KPI Aggregation Strategy

## 9.1 Why this section is load-bearing

This is where most hierarchy implementations quietly go wrong. Every metric needs a **declared aggregation algebra**, and it should live in one shared module in the way `performance-domain.ts` and `kpi-values.ts` do today.

## 9.2 The algebra table

| Metric | Leaf definition | Roll-up rule | Must never |
|---|---|---|---|
| **Completed renewals** | Count of completed renewals | **SUM** | — |
| **Opportunities** | Count of renewal opportunities | **SUM** | — |
| **Headcount** | Count of active representatives | **SUM** | Count inactive |
| **Renewal rate** | completed ÷ opportunities | **Ratio of sums**: Σcompleted ÷ Σopportunities | Average child rates |
| **Achievement** | actual ÷ target | Unit's **own committed target**; `null` if none | Sum children's targets to manufacture one |
| **Quality score** | Mean of scored criteria (excluding `na`) | **Weighted by evaluation count** | Mean of team means |
| **Coaching coverage** | reps listened ÷ reps | **Ratio of sums** | Average child coverage |
| **Data completeness** | reported ÷ total | **Ratio of sums** | Average child percentages |
| **Risk** | Categorical per representative | **Count by severity** (distribution) | Average a category |
| **Forecast** | Pace extrapolation | **Recompute at the display level** from that level's own actuals | Naïvely sum capped child forecasts |
| **Listening sessions** | Count | **SUM** | — |
| **Open underwriting** | Count by priority | **SUM** per priority | Collapse priorities into one number |
| **Tasks completed** | completed ÷ assigned | **Ratio of sums** | Average child rates |
| **Attrition** | departures ÷ average headcount | **Ratio of sums** over the period | Average child rates |

## 9.3 Reasoning — ratio of sums

**Percentages never aggregate. Their numerators and denominators aggregate, and the percentage is recomputed at the display level.**

Averaging child percentages produces Simpson's paradox. Worked example:

| Team | Reps | Listened | Coverage |
|---|---|---|---|
| A | 20 | 10 | 50% |
| B | 2 | 2 | 100% |

- **Correct** (ratio of sums): (10 + 2) ÷ (20 + 2) = **54.5%**
- **Wrong** (average of rates): (50% + 100%) ÷ 2 = **75%**

A **20-point error, biased favourably**, presented in a division review. This is not a theoretical concern; it is the single most common defect in rolled-up management reporting.

## 9.4 Reasoning — achievement

Achievement is `actual ÷ target`, and the target must be the unit's **own committed target**.

If the unit has no committed target, achievement is `null` and is rendered as an honest absence. It is **not** the sum of children's targets, because:

- Not every child has a target, so the sum would silently treat missing as zero.
- The parent's commitment is a negotiated number that deliberately differs from the sum (§8.4).

This is the direct extension of the existing rule that a team's target is never a sum of its representatives' targets.

## 9.5 Reasoning — quality score

Team A conducted 40 evaluations averaging 82. Team B conducted 3 evaluations averaging 95.

- **Correct** (weighted by evaluation count): (40×82 + 3×95) ÷ 43 = **82.9**
- **Wrong** (mean of means): (82 + 95) ÷ 2 = **88.5**

Team B's three evaluations must not carry the same weight as Team A's forty.

**Note on draft inclusion:** the Feedback hardening sprint established that draft (unpublished) evaluations *are* counted in manager analytics — the listening happened and the manager's assessment exists — and that the inclusion is **disclosed on screen**. That rule holds at every level of the hierarchy, and the disclosure must roll up with the number.

## 9.6 Reasoning — forecast

For **uncapped linear pace extrapolation**, summing children's forecasts and forecasting the sum are **mathematically identical**, because the operation is linear:

```
forecast = actual ÷ days_passed × days_total
Σ forecast(child) = forecast(Σ actual)     -- when uncapped and same day count
```

They diverge as soon as any child's forecast is capped, floored, or uses a different working-day count (e.g. a center on a different holiday calendar). Recomputing at the display level avoids compounding those artifacts, so it is the safer default **even though the two coincide in the simple case**. This is stated precisely because an implementer who assumes they always differ will over-engineer, and one who assumes they never differ will ship a bug.

## 9.7 Reasoning — risk

**Risk is not a number and must not become one.** "This center's average risk is 2.3" is meaningless and unactionable.

Risk rolls up as a **distribution**: 4 high, 11 medium, 60 low. This is also the form a manager can act on — they intervene on the four, not on the average.

## 9.8 Weighting policy

Any metric weighted by headcount must **state the weight**, and the weight must be the **contributing population**, not the roster.

A representative who joined yesterday should not dilute a coverage percentage on equal terms with one present all month. Correcting this properly requires a tenure/ramp concept, which is **deferred and flagged** rather than approximated — an approximate ramp adjustment is worse than none, because it produces a number nobody can reconstruct.

## 9.9 Implementation guidance

The algebra belongs in **one shared, pure, unit-tested module** — the same pattern as `performance-domain.ts`, `kpi-values.ts`, `feedback-domain.ts` and `dashboard-domain.ts`. Every consumer imports it; no screen re-derives an aggregation locally.

The existing cross-module consistency test fixture should be extended so that a controlled dataset is asserted to produce identical values at every hierarchy level, and so that the Simpson's-paradox case above is a permanent regression test.

---

# 10. Dashboard Strategy

**This section defines responsibility, not layout.** No UI is designed here.

## 10.0 The governing rule

> **A manager's unit of management is the level directly below them.**

A VP manages managers, not 500 representatives. Their dashboard should have **fewer** numbers than a Team Manager's, not more.

The most common failure mode of executive dashboards is giving the VP an organization-wide copy of the team view. This must be resisted explicitly, because it is the path of least engineering resistance.

---

## 10.1 Vice President (Division Manager)

**Purpose.** Decide where to place resources across the division, which units need intervention, and whether the division will meet its commitment.

**Primary KPI.** Division achievement against committed target, with month-end forecast.

**Secondary KPIs.** Division renewal rate; forecast-vs-commit gap in units; variance between centers; manager effectiveness; division attrition; coaching coverage across the division.

**KPIs owned exclusively by this role.** Division achievement; forecast vs commit; inter-unit variance; manager effectiveness index; division attrition; cost-per-renewal (if inputs exist).

**Required widgets**

1. **Division scorecard** — renewal rate, achievement, coaching coverage, one row, compared with the previous period.
2. **Unit comparison table** — one row per center: target, actual, pace, forecast, variance, headcount, coverage. Sortable by variance. **This is the VP's primary instrument.**
3. **Forecast vs commit** — projected month-end against the committed number, with the gap expressed in units, not percent.
4. **Manager scorecard** — one row per Team Manager: team achievement, coaching coverage, data completeness, listening cadence. *This is the missing object identified in §2.4.*
5. **Persistent-exception list** — units more than X% off pace for more than N **consecutive** days. Persistence is the signal; a single bad day is noise.
6. **Structural risk** — teams without a target, without a manager, or without data.

**Forbidden widgets**

- Individual representative leaderboards — three names out of 500 is noise at this altitude; it belongs to the Team Manager.
- Audit / recent-activity feed — an audit trail is a compliance instrument, not an executive one.
- Auto-generated "insights" — two generic sentences add nothing the comparison table does not deliver better.
- Knowledge-centre and competition navigation shortcut cards — navigation, not information, occupying prime space.
- Announcements — the executive authors these; showing them back is a mirror.
- A card-per-team grid — at ~50 teams this is unusable; replace with the comparison table.

**Actions from the dashboard.** Set or adjust division and unit targets; publish a division-wide announcement; escalate a unit to its Activity Manager with a note; export the division scorecard for a steering meeting.

**Alerts.** Unit crossing below the pace threshold for the Nth consecutive day; forecast falling below commit; a manager with zero coaching activity for two weeks; an import failure affecting a whole unit; a team operating without a target after the period has started.

**Drill-down path.** Division → Center → Team → Representative, **with the same metric at every rung**. If renewal rate is the headline, it must be renewal rate all the way down.

**Roll-up.** Nothing above this level — but the division number must be **reconcilable**: clicking a total must reveal the units composing it, summing exactly.

---

## 10.2 Activity Manager

**Purpose.** Allocate between the call centers they own; identify which centers need a management change; own the mid-period course correction.

**Primary KPI.** Variance between owned centers.

**Secondary KPIs.** Aggregate achievement across owned centers; consistency of coaching cadence; target-attainment **distribution** rather than the average — an Activity Manager cares whether 8 of 10 teams are near target, not what the mean is.

**KPIs owned exclusively by this role.** Inter-center variance; cross-center coaching-cadence consistency; attainment distribution.

**Required widgets**

1. **Center comparison table** — the same pattern as the VP's, one level down.
2. **Cross-center coaching coverage** — quality discipline lives or dies here, and Pulse already holds the data.
3. **Target reconciliation** — their committed number against the sum of their centers' commitments.
4. **Persistent-exception list**, scoped to their centers.

**Forbidden widgets**

- Individual representative detail by default (available via drill-down, never as a default panel).
- Organization-wide aggregates outside their scope.

**Actions.** Re-target a center mid-period; reassign a team between centers; escalate to the VP with context.

**Alerts.** One center diverging from its peers; a team whose manager changed recently — **leadership transition is the highest-risk moment in a call center**; target proposals awaiting their approval.

**Drill-down path.** Center → Team → Representative.

**Roll-up.** Their centers must aggregate into the VP's division view **identically**, or the two will argue about numbers in a meeting. This is a hard requirement on the shared algebra module, not a nicety.

---

## 10.3 Call Center Manager

**Purpose.** Depends entirely on an unresolved scope decision. See §14.

**The blocking issue.** The role does not exist in Pulse, and **even if it did, Pulse holds none of the data a Call Center Manager manages by**. Their morning is service level, calls in queue, abandon rate, staffing versus forecast, adherence, shrinkage and intraday pacing. Pulse holds renewals and coaching scores.

**Two honest options, and choosing is more valuable than any widget:**

**(a) Declare Pulse out of scope for contact-center operations.** State plainly that the Call Center Manager uses their ACD/WFM system for operations and Pulse for sales performance and coaching. Give them a scoped role with the *sales* view. Cheap, honest, immediately useful.

**(b) Ingest ACD data.** The import pipeline already exists, is audited, and has undo. Adding daily per-representative operational metrics is mechanically similar to what `kpi_values` does today. This is a programme, not a sprint.

**Recommendation: (a) now, with (b) as a separately funded decision.** Pretending otherwise produces a dashboard a Call Center Manager opens once.

**Under option (a):**

**Primary KPI.** Center achievement, with team spread.

**Required widgets.** Center scorecard; team comparison within the center; coaching coverage by team; data completeness by team (they are the ones who chase missing imports); competition standing for their center.

**KPIs owned exclusively by this role.** Center achievement and renewal rate; coverage — the share of representatives listened to this week; data completeness; team-to-team spread within the center.

**Actions.** Set team targets within their center; schedule a listening blitz; message all managers in the center.

**Alerts.** A team with no listening for a week; missing data past the daily import deadline; a team below pace three days running.

**Drill-down path.** Team → Representative.

**Roll-up.** Into the Activity Manager's comparison view, with identical definitions.

---

## 10.4 Team Manager

**Purpose.** Run the day: decide who to coach, who to call, what the daily push is.

**This is the one role Pulse already serves well.** The Morning Routine is purpose-built and, after the Dashboard hardening sprint, honest.

**Primary KPI.** Team pace to target, and who is off pace today.

**Secondary KPIs.** Per-representative pace and gap-to-close; listening coverage of their own team; response time on underwriting items; task completion rate.

**KPIs owned exclusively by this role.** Per-representative gap-to-close; own-team listening coverage; underwriting response time.

**Required widgets**

1. **Morning Routine** — retained essentially as-is; it is correct.
2. **Today's number** — yesterday's result and today so far. `kpi_values` is dated daily, so the data exists; the UI currently shows only month-to-date. **A Team Manager runs a day, not a month.**
3. **Per-representative coaching card** — last listening, score trend, open tasks, last 1:1 — opened directly from the coaching queue.
4. **Team standing among peers** — motivating and orienting; currently invisible.
5. **Who is on the floor** — if roster data ever exists. "5 reps below pace" means something different when two are on leave.

**Forbidden widgets**

- Division- or center-level aggregates — not their responsibility and not actionable at their level.
- Auto-generated "insights" — the coaching queue already names who needs attention, with reasons.
- Navigation shortcut cards.

**Actions.** The current set is good — schedule listening, record a manager call, assign an article, set the coaching plan, manage underwriting. **Add:** log a 1:1; mark a representative unavailable; adjust an individual target within a delegated band.

**Alerts.** Representative below pace three days running; nobody listened to in seven days; underwriting item breaching its due date; own team's target unset.

**Drill-down path.** Team → Representative → individual call/feedback record.

**Roll-up.** Their team into the center — **with the same definition of pace**, or the Team Manager and the Center Manager will disagree in a review.

---

## 10.5 Representative

**Purpose.** Know what to do today and how they are being coached.

**Primary KPI.** My gap to close today.

**Secondary KPIs.** Personal quality trend; task completion; month-to-date achievement.

**KPIs owned exclusively by this role.** Personal daily gap; personal quality trend.

**Required widgets**

1. **Daily strip** — today's result, the gap, days remaining. Currently only month-to-date is shown.
2. **Gap expressed as an action** — "you need 4 more today", not "78% of target".
3. **My quality trend** — their own score over time.
4. **My next scheduled listening** — currently invisible to them.
5. Existing: published feedback, tasks, articles, competitions.

**Forbidden widgets**

- Any management framing or control.
- Peer ranking by default — a cultural decision that must be made deliberately, not inherited from a leaderboard component.

**Actions.** Complete a task; mark an article read; acknowledge feedback; request a listening session.

**Alerts.** New feedback published; a task due today; a listening session scheduled for them; a competition ending.

**Drill-down path.** Into their own calls only.

**Roll-up.** Their number into the team. Nothing else.

---

# 11. Migration Strategy

## 11.1 Approach

**Expand → migrate → contract**, in four phases, each independently shippable and independently revertible.

## 11.2 Phase 2A — Structure, dormant

**Actions**

- Create `org_unit_types`, `org_units`, `role_assignments`.
- Populate the type registry with the four levels.
- Backfill: one root unit; one leaf unit per existing team, **reusing the existing `teams.id` as `org_units.id`** so every foreign key in the system survives untouched.
- Populate intermediate levels (activities, centers) manually with the business.
- Implement cycle prevention, path maintenance triggers, type-rank constraints.
- Build the effective-permissions inspector.

**Reads.** Nothing reads the tree. **User-visible change: zero.**

**Rollback.** Drop three tables. Complete and trivial.

**Note.** Populating the tree accurately is a **business deliverable**, not an engineering one, and it is the genuine long pole of the whole phase.

## 11.3 Phase 2B — Pinned lineage, dual-write

**Actions**

- Add `org_unit_id` + `org_unit_path` to all fact tables.
- Backfill from current team membership.
- Install triggers pinning lineage on new writes.
- Reads still use `team_id`.

**Documented limitation.** Backfilled history reflects **today's** structure, because yesterday's was never recorded. This must be stated in the schema comments and in any report covering pre-migration periods. It cannot be fixed, only disclosed.

**Verification gate.** A reconciliation query must prove that per-team totals computed via `team_id` and via `org_unit_path` are **identical for every historical period** before Phase 2C begins.

**Rollback.** Drop the columns and triggers.

## 11.4 Phase 2C — Authorization cutover

**Actions**

- Create new subtree-based RLS policies **alongside** the existing ones.
- Gate by a per-user feature flag.
- **Shadow verification:** for a representative sample of users across all roles, compare the row sets returned by old and new policies and assert they match exactly, before enabling for anyone.
- Enable progressively: engineering → one pilot team → one center → all.

**Risk.** This is the genuinely dangerous phase. Four sprints of security hardening are encoded in the current policies; a subtree model is a different shape of predicate.

**Rollback.** Per user via the flag; globally by dropping the new policies. Both are fast.

**Test methodology.** The live-Postgres replay methodology used in the last four sprints applies directly: build a scratch schema, apply migrations, run behavioural tests asserting cross-team denial and same-team access under each role, then drop.

## 11.5 Phase 2D — Contract

**Actions**

- Retire `team_id` reads.
- Convert `teams` to a compatibility view, or drop it.
- Remove dual-write triggers.

**Precondition.** Phase 2C has run clean for a **full reporting cycle** (one month minimum, ideally one quarter).

**Rollback.** Not cleanly revertible. This is the commitment point and should be an **explicit decision**, not a default consequence of the previous phase completing.

## 11.6 Compatibility

**Can both models coexist?** Yes, throughout Phases 2A–2C. That is the purpose of the sequencing.

**Do old teams survive unchanged?** Yes. Each becomes a leaf unit with the **same UUID**, so `representatives.team_id`, `kpi_values.team_id`, `team_goals.team_id` and every other reference remains valid without modification.

**Can the phases be paused?** Yes. Each phase is a stable resting state. The system can operate indefinitely at the end of 2A or 2B.

## 11.7 Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| RLS regression during 2C | **Critical** | Shadow verification; per-user flag; live-database replay testing; progressive rollout |
| Backfill misattributes history | High | Mandatory reconciliation query as a gate before 2C |
| Org data entry wrong or incomplete | High | Business deliverable; 2B cannot start until the tree is signed off by the VP |
| Trigger fails to pin lineage | High | `NOT NULL` on `org_unit_path` after backfill — a missing pin becomes a loud error, never a silent null |
| Reparent leaves stale paths | Medium | Trigger + scheduled consistency check comparing derived paths against `parent_id` |
| Permission misconfiguration | Medium | Role templates + effective-permissions inspector |
| Aggregation performance | Low | Measured; see §13 |
| Two aggregation semantics confuse users | Medium | Naming discipline + explicit UI affordance |

---

# 12. Module Impact

| Module | Changes required | Risk level |
|---|---|---|
| **Representatives** | `team_id` → `org_unit_id`; transfer must re-pin lineage; team picker becomes a tree picker. Identity, account linking, lifecycle, delete blockers and the activation RPC are unchanged. | **Medium** |
| **Performance** | Team filter → unit filter; aggregation must adopt the declared metric algebra. `performance-domain.ts` primitives (achievement, pace, gap, risk) are level-agnostic and unchanged. | **Medium** |
| **Dashboard** | Role-specific homes grow from 3 to 5; the admin organization-wide special case retires. `dashboard-domain.ts` primitives (completeness, trend, freshness, view state, thresholds) are level-agnostic and survive. Largely additive. | **High** |
| **Feedback & Listening** | Feedback must pin lineage; queue and heat map become unit-scoped. Revisions, publish/retract, optimistic concurrency, server-side score derivation and coaching plans are all unchanged. | **Low** |
| **Competitions** | Currently organization-wide (`USING (true)`). Requires a scope unit — or an explicit, documented decision to remain organization-wide. Scoring, categories and leaderboard logic unchanged. | **Medium**, or **None** if consciously kept org-wide |
| **Knowledge** | None. Articles are organization-wide by design and should stay so. | **None** |
| **Communications** | `is_staff()` means *any* manager reads all messages and templates. Under a hierarchy this must be scoped. Message/template model and kind constraints unchanged. | **Medium** |
| **Targets** | Two tables merge into one with a period model; new levels; reconciliation view is new. Null-not-zero principle, batch save and copy-with-preview all survive. **Largest single refactor.** | **High** |
| **Morning Routine** | Should exist per level, or explicitly not. Checklist is already team-scoped and becomes unit-scoped. Completeness, freshness, listening plan and awaited writes unchanged. | **Low** at team level; **new work** at higher levels |
| **Notifications** | Routing by level; thresholds owned by the level above; a VP must not be paged about one representative. The dedup mechanism (`dedupe_key` + partial unique index) generalizes cleanly. | **Low** |
| **Workspace** | Two-value union → tree node; tree picker; breadcrumb; URL addressability. **Full rewrite of the context.** The "view filter, never an authorization boundary" principle survives. | **High** |
| **Data Import** | Should record which unit an import affected; scoping by unit for center-level imports. Matching, undo, audit and truthfulness invariants unchanged. | **Low** |
| **Audit / Activity feed** | Scope resolution becomes subtree-based. Allow-list projection and server-side scoping unchanged. | **Low** |

## 12.1 Aggregate assessment

**The hardened operational layer survives almost entirely.** The pure domain primitives extracted during four sprints — `performance-domain`, `kpi-values`, `feedback-domain`, `dashboard-domain` — are level-agnostic pure functions that continue to work unchanged.

What changes is **scoping and navigation**, which is precisely the layer one would expect a hierarchy to change. That is a positive signal about the shape of the existing code and a reason for reasonable confidence in this plan.

**Three modules carry High risk:** Targets (structural merge), Dashboard (role multiplication), Workspace (full context rewrite). All three are additive rather than destructive, and none touches the transactional integrity guarantees.

---

# 13. Future Scalability

## 13.1 100 users (≈10 teams)

Tree depth 3–4, roughly 15–20 units. Entirely trivial. Every access path is an indexed lookup on a table of tens of rows. Flat pickers would still work at this size, though the tree picker costs nothing extra.

## 13.2 500 users (≈50 teams) — current target

- **Units:** ~60
- **Fact rows:** ~6M over five years (500 reps × ~250 working days × 5 years)
- **Monthly aggregate:** touches ~100k rows

Well within query-time aggregation. **No materialized roll-ups needed.**

Flat pickers **already fail** at this size — the tree picker is a requirement, not a nicety. The current admin dashboard renders one card per team, producing a ~50-card grid; this is why §10.1 forbids that widget for executives.

## 13.3 5,000 users (≈500 teams)

- **Units:** ~600
- **Fact rows:** ~60M over five years
- **Monthly division aggregate:** ~1M rows

Still tractable with the path index, but this is where **materialized period roll-ups** become worthwhile — a nightly job writing `unit × period × metric` into a summary table.

**The design supports that addition without schema change**, because the pinned path makes the roll-up trivially computable: `GROUP BY` a path prefix over a date range. **I would not build it now** — it is a straightforward addition when measurement shows it is needed, and building it early adds a staleness class of bug for no current benefit.

## 13.4 Multiple divisions

**Native.** Additional subtrees under the root. No schema change, no code change, no new concepts. This is the primary payoff of the generic tree.

## 13.5 Multiple companies

**This requires a decision now, even though the feature is not being built.**

The tree structurally supports it — a second company is a second root — and because *every* scoped query is a subtree prefix test rather than "all rows", isolation largely falls out of the design for free. That is a genuinely valuable property.

**But "largely" is doing work.** True multi-tenancy needs a tenant boundary on rows that are currently global. `articles`, `announcements`, `competitions` and `comms_templates` are all `USING (true)` today and would **leak across companies**.

Retrofitting a tenant column onto those tables later is a migration with a security cutover. Adding it now is nearly free.

**Recommendation:** do not build multi-tenancy, but **designate the root unit as the tenant boundary** and give the currently-global tables an `org_unit_id` referencing a unit, defaulting to the single root. Today it is a column everyone ignores. The day Menora acquires a second business, it is a filter rather than a project.

**This is the cheapest option value in the document.**

## 13.6 Scalability summary

| Dimension | Limit | Bottleneck | Mitigation available |
|---|---|---|---|
| Units | ~10,000 | None practical | — |
| Tree depth | ~10 | Path length, readability | Shorter unit identifiers |
| Representatives | ~50,000 | Fact-table aggregation | Materialized roll-ups |
| Fact rows | ~500M | Aggregation, index size | Roll-ups + partitioning by date |
| Concurrent reorganizations | Low | Path rewrite locks a subtree | Rare in practice; acceptable |
| Companies | Unbounded structurally | Global content tables | Reserve `org_unit_id` now |

---

# 14. Open Questions

These require **product or business decisions** and cannot be resolved from the schema.

## 14.1 How many Activity Managers and Call Center Managers exist, and how stable is that structure?

**Why it matters.** If the answer is "3 and 6, unchanged in four years", the fixed-depth alternative (§4.2) becomes materially more attractive: dramatically simpler, faster, and it preserves the audited RLS exactly. The generic tree is recommended because structural change over five years is *expected* — but that is a judgement about the business, not a fact derivable from code.

**Cost of asking:** ten minutes of the VP's time. **Cost of not asking:** potentially building a more complex system than needed for a stable org.

## 14.2 Does Pulse ingest contact-center operational data?

**Why it matters.** It determines whether the Call Center Manager role is serveable at all (§10.3). Without service level, staffing, adherence and abandon rate, a Call Center Manager's dashboard answers none of their actual questions.

**Sub-questions:** Is ACD/WFM data technically reachable? Who owns that system? Is there an existing export? Is this a Pulse responsibility or an integration?

## 14.3 Should competitions be scoped, and to what?

Organization-wide today. Under a hierarchy, should a center be able to run its own competition? A team? This changes the data model for `competitions` and is a product decision about how Menora motivates.

## 14.4 Should communications be scoped?

Any manager currently reads every message and template. Should a Call Center Manager see another center's internal communications? Probably not — but confirm before restricting, as some templates are deliberately shared assets.

## 14.5 Is peer ranking culturally acceptable at representative level?

The Team Manager view would benefit from "your team ranks 3rd of 12". Exposing rank to representatives is a **cultural decision**, not a technical one, and the Feedback sprint's removal of public naming from the WhatsApp broadcast suggests the organization leans away from public comparison. Confirm the intent.

## 14.6 What is the target-setting workflow?

The `status` field (`draft` / `committed` / `superseded`) implies a negotiation with approval. Who proposes? Who approves? Does a center target require Activity Manager sign-off? This determines whether an approval workflow is in scope.

## 14.7 What is the retention policy for organizational history?

Pinned lineage means history is permanent. Is there a regulatory retention requirement, or a deletion requirement? This affects whether pinned paths of deleted units need special handling.

## 14.8 Should the tenure/ramp concept be built?

Flagged in §9.8. New hires currently dilute team averages on equal terms with tenured staff. Fixing it properly needs a ramp curve per role. Worth doing, but it is a distinct piece of product design.

---

# Final Recommendation

## Approve the architecture

The recommended design — **generic recursive tree for structure, pinned immutable lineage on facts, role × scope × capability authorization** — is correct for a five-year horizon and preserves everything four hardening sprints established.

The pinned-lineage decision in particular is the one I would defend most strongly: it simultaneously delivers flat auditable security, fast aggregation, and reorganization-proof history, and it is the direct generalization of an invariant already proven in production for `kpi_values`.

## Scope the next sprint to Phase 2A only

**Phase 2A is structure-only, dormant, and fully revertible.**

- Create the tables and the type registry.
- Backfill existing teams as leaf units, reusing their UUIDs.
- Implement cycle prevention, path maintenance, and type-rank constraints.
- Build the effective-permissions inspector.
- Run the business exercise of mapping the real hierarchy.

**No RLS changes. No UI changes. No user-visible behaviour.**

This is a small, low-risk sprint that de-risks everything after it — and, critically, it forces the organizational-chart data question to the front, where it belongs, before any engineering work depends on it.

## Framing

**Do not sell Phase 2 internally as "executive dashboards."** It is the *structure that makes executive dashboards possible*. The dashboards themselves depend on:

1. Observing how Activity Managers and Call Center Managers actually work day to day.
2. Resolving whether Pulse ingests contact-center operational data (§14.2).

Building three new dashboards for roles whose workflow has not been observed is the highest product risk in this document — higher than any technical risk it contains.

## Before committing

Answer §14.1 — **how many Activity Managers and Call Center Managers, and how stable is that structure?** If the org is small and stable, reopen Alternative B (fixed-depth columns) on its merits. It is simpler, faster, lower-risk, and it preserves four sprints of audited security policy without modification.

The recommendation stands as written. But an architecture chosen without asking that question would be chosen on assumption rather than evidence, and this document should not be the reason that happens.

---

*End of document.*
