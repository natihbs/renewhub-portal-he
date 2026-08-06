// Pulse v2 — shared domain types.
//
// One home for every v2 business concept, so that a rule about an assignment
// or an outcome is stated once and cannot drift between the module that
// validates it, the module that reads it and the module that renders it. This
// file holds SHAPES and the closed unions that constrain them; behaviour lives
// in the -domain modules next to it (assignment-domain, capability-domain,
// work-domain), which are pure and unit-tested.
//
// The unions here mirror the CHECK constraints in
// 20260808090000_v2_domain_foundation.sql exactly. That duplication is
// deliberate and is covered by a test: TypeScript cannot read a Postgres
// constraint, so the alternative is a `string` that compiles and then fails at
// the database — which is the same class of defect as a column nothing writes.
//
// These types describe the DOMAIN, not the wire format. Rows arriving from
// Supabase are typed by src/integrations/supabase/types.ts; the mappers are
// the boundary between the two and belong with whatever reads them.

// ---------------------------------------------------------------------------
// Work type — the eight dimensions
// ---------------------------------------------------------------------------

/** How work comes into existence. Determines whether forward planning is arithmetic, statistics or a decision. */
export type WorkArrival = "scheduled" | "forecast" | "generated" | "continuous";

/** Who chooses the next item. The largest fork in the operator experience. */
export type WorkSelection = "queue" | "flow";

/** How value erodes with time. Drives the urgency term of every ranking. */
export type WorkDecay = "hard_deadline" | "sla" | "soft_aging" | "none";

/** What "done" looks like. Graded and staged outcomes break simple conversion percentages. */
export type OutcomeShape = "binary" | "graded" | "staged";

/** How value is realized. `avoided` and `proxy` are the contested ones — their conversion factor must always be visible. */
export type ValueModel = "immediate" | "recurring" | "recovered" | "avoided" | "proxy";

/** Whether a human is waiting. Determines the interruption policy, which is a property of the work and not of the person. */
export type Synchrony = "synchronous" | "asynchronous";

/** How much latitude the frontline holds to commit the business. */
export type DiscretionLevel = "none" | "low" | "medium" | "high";

export const WORK_ARRIVALS: readonly WorkArrival[] = [
  "scheduled",
  "forecast",
  "generated",
  "continuous",
];
export const WORK_SELECTIONS: readonly WorkSelection[] = ["queue", "flow"];
export const WORK_DECAYS: readonly WorkDecay[] = ["hard_deadline", "sla", "soft_aging", "none"];
export const OUTCOME_SHAPES: readonly OutcomeShape[] = ["binary", "graded", "staged"];
export const VALUE_MODELS: readonly ValueModel[] = [
  "immediate",
  "recurring",
  "recovered",
  "avoided",
  "proxy",
];
export const SYNCHRONIES: readonly Synchrony[] = ["synchronous", "asynchronous"];
export const DISCRETION_LEVELS: readonly DiscretionLevel[] = ["none", "low", "medium", "high"];

export type WorkType = {
  id: string;
  key: string;
  displayName: string;
  arrival: WorkArrival;
  selection: WorkSelection;
  decay: WorkDecay;
  outcomeShape: OutcomeShape;
  valueModel: ValueModel;
  synchrony: Synchrony;
  discretion: DiscretionLevel;
  /**
   * Days after resolution at which the outcome is re-verified. 0 means the
   * operation genuinely has no reversal path — it never means "not decided".
   */
  durabilityHorizonDays: number;
  active: boolean;
};

// ---------------------------------------------------------------------------
// Work item and outcome
// ---------------------------------------------------------------------------

export type WorkItemState = "open" | "resolved" | "voided";
export const WORK_ITEM_STATES: readonly WorkItemState[] = ["open", "resolved", "voided"];

export type WorkItem = {
  id: string;
  workTypeId: string;
  /** Identity in the source system. Re-ingestion matches on this, never inserting a duplicate. */
  externalRef: string;
  /** Opaque reference into the system of record. Pulse holds no customer detail beyond what ranking needs. */
  subjectRef: string | null;
  subjectLabel: string | null;
  ownerRepresentativeId: string | null;
  teamId: string | null;
  /** ISO timestamp. Null means the item is workable as soon as it exists. */
  eligibleFrom: string | null;
  /** ISO timestamp. Null means the work type has no decay. */
  dueAt: string | null;
  businessValue: number;
  state: WorkItemState;
  ingestionBatchId: string | null;
  ingestedAt: string;
};

/**
 * The canonical five. Every work type's own taxonomy maps onto exactly one of
 * these, which is what lets one metric definition serve every operation.
 *
 * `expired_unworked` is deliberately NOT a member. It is derived — an open
 * item past its due date with no outcome — and can never be recorded by a
 * user. Silent loss is silent precisely because nobody types it in; making it
 * a disposition would hide the number the metric exists to expose.
 */
export type CanonicalOutcomeState =
  | "resolved_positive"
  | "resolved_negative"
  | "pending_internal"
  | "pending_external"
  | "unreachable";

export const CANONICAL_OUTCOME_STATES: readonly CanonicalOutcomeState[] = [
  "resolved_positive",
  "resolved_negative",
  "pending_internal",
  "pending_external",
  "unreachable",
];

/** The derived sixth state. Never written; only computed. */
export const DERIVED_EXPIRED_UNWORKED = "expired_unworked" as const;

export type Outcome = {
  id: string;
  workItemId: string;
  actorId: string | null;
  actorRepresentativeId: string | null;
  canonicalState: CanonicalOutcomeState;
  /** Work-type-specific detail. The canonical state above is what cross-operation metrics use. */
  reasonCode: string | null;
  valueRealized: number | null;
  occurredAt: string;
  /** Set when this record corrects an earlier one. Corrections supersede; they never overwrite. */
  supersedesId: string | null;
  correctionReason: string | null;
};

export type DurabilityCheck = {
  id: string;
  outcomeId: string;
  checkedAt: string;
  held: boolean;
  reversalReason: string | null;
};

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

export type ScopeKind = "team" | "enumerated" | "rule";
export const SCOPE_KINDS: readonly ScopeKind[] = ["team", "enumerated", "rule"];

/**
 * The closed shape a rule scope may take. Keys present are ANDed; values
 * within a key are ORed. A rule with neither key resolves to the EMPTY set,
 * never to "everyone" — an unconfigured permission reads as none.
 *
 * Deliberately not a general query language. A scope whose meaning cannot be
 * read off its definition cannot answer "why can I see this?", which the
 * product is required to answer on every row.
 */
export type ScopeRule = {
  teamIds?: string[];
  kpiProfiles?: string[];
};

export type Scope = {
  id: string;
  key: string | null;
  displayName: string;
  kind: ScopeKind;
  /** Set when kind is "team". */
  teamId: string | null;
  /** Set when kind is "rule". */
  rule: ScopeRule | null;
  active: boolean;
};

// ---------------------------------------------------------------------------
// Capability
// ---------------------------------------------------------------------------

/**
 * The four verb families. There is not a fifth:
 *
 *   observe    read facts about a subject
 *   intervene  act on the subject
 *   define     change the rules the subject is measured by
 *   answer     be accountable for the subject's shortfall
 */
export type CapabilityFamily = "observe" | "intervene" | "define" | "answer";
export const CAPABILITY_FAMILIES: readonly CapabilityFamily[] = [
  "observe",
  "intervene",
  "define",
  "answer",
];

export type CapabilitySubjectType = "representative" | "team" | "work_item" | "organization";

/**
 * Organizational capabilities always carry a scope. System capabilities never
 * do — they are about administering Pulse, not about a population. Keeping
 * them on separate axes is what stops database-level power from becoming a
 * side effect of a promotion.
 */
export type CapabilityAxis = "organizational" | "system";

export type Capability = {
  key: string;
  family: CapabilityFamily;
  subjectType: CapabilitySubjectType;
  axis: CapabilityAxis;
  description: string;
};

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

/**
 * Which artifact this assignment implies: a surface (daily), a review
 * (weekly), or a report (monthly). Stored rather than derived from scope size
 * because span predicts cadence well but not perfectly — an org-wide quality
 * owner still works daily.
 */
export type AssignmentCadence = "continuous" | "daily" | "weekly" | "monthly";
export const ASSIGNMENT_CADENCES: readonly AssignmentCadence[] = [
  "continuous",
  "daily",
  "weekly",
  "monthly",
];

export type Assignment = {
  id: string;
  personId: string;
  scopeId: string;
  /**
   * The one bit distinguishing line management from functional management.
   * Load-bearing in exactly two places: the roll-up denominator, and who a
   * representative sees as "my manager".
   */
  accountable: boolean;
  /** Provenance when this assignment was delegated from another. */
  grantedByAssignmentId: string | null;
  /** ISO date (YYYY-MM-DD). */
  validFrom: string;
  /** ISO date. Null means no end date is KNOWN yet — not "permanent". */
  validTo: string | null;
  cadence: AssignmentCadence;
  label: string | null;
  capabilities: string[];
  revokedAt: string | null;
  revokedReason: string | null;
};

/** The subset of an assignment the validation rules actually read. */
export type AssignmentPeriod = Pick<Assignment, "validFrom" | "validTo">;

// ---------------------------------------------------------------------------
// Commitment
// ---------------------------------------------------------------------------

export type CommitmentSubjectKind = "representative" | "team" | "work_item" | "scope" | "self";
export const COMMITMENT_SUBJECT_KINDS: readonly CommitmentSubjectKind[] = [
  "representative",
  "team",
  "work_item",
  "scope",
  "self",
];

/**
 * `lapsed` is set by the system, not by a person. The other three are explicit
 * human resolutions, and the difference matters: a lapse rate is a signal
 * about the product, a not-kept rate is a signal about the organization.
 */
export type CommitmentResolution = "kept" | "not_kept" | "no_longer_relevant" | "lapsed";
export const COMMITMENT_RESOLUTIONS: readonly CommitmentResolution[] = [
  "kept",
  "not_kept",
  "no_longer_relevant",
  "lapsed",
];

export type Commitment = {
  id: string;
  createdBy: string;
  ownerId: string;
  subjectKind: CommitmentSubjectKind;
  subjectRepresentativeId: string | null;
  subjectTeamId: string | null;
  subjectWorkItemId: string | null;
  subjectScopeId: string | null;
  body: string;
  /** ISO date. */
  dueOn: string;
  resolution: CommitmentResolution | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
};
