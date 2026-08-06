// Pulse v2 — capability catalog and set algebra. Pure, dependency-free.
//
// The catalog here mirrors the seed in
// 20260808090000_v2_domain_foundation.sql. Both are needed: the database row
// is what a foreign key can point at, and the constant is what TypeScript can
// check a call site against. A test asserts they have not drifted, because a
// capability key that exists in one and not the other fails in the worst
// possible way — the assignment looks granted and behaves ungranted.
//
// The named configurations at the bottom are the point of the whole model:
// "Team Manager", "Call Center Manager" and "Activity Manager" are not types
// in this system. They are capability sets over a scope, and the difference
// between them is which verbs and how big the scope is.

import type { Capability, CapabilityAxis, CapabilityFamily } from "@/lib/domain-types";

export const CAPABILITY_CATALOG: readonly Capability[] = [
  {
    key: "observe.performance",
    family: "observe",
    subjectType: "representative",
    axis: "organizational",
    description: "Read a representative's results, KPI history and coverage",
  },
  {
    key: "observe.feedback",
    family: "observe",
    subjectType: "representative",
    axis: "organizational",
    description: "Read feedback and listening records about a representative",
  },
  {
    key: "observe.work_items",
    family: "observe",
    subjectType: "work_item",
    axis: "organizational",
    description: "Read the work inventory for a representative",
  },
  {
    key: "observe.team",
    family: "observe",
    subjectType: "team",
    axis: "organizational",
    description: "Read aggregate figures for a team",
  },
  {
    key: "intervene.coach",
    family: "intervene",
    subjectType: "representative",
    axis: "organizational",
    description: "Record feedback, coaching sessions and commitments about a representative",
  },
  {
    key: "intervene.assign_work",
    family: "intervene",
    subjectType: "work_item",
    axis: "organizational",
    description: "Reassign work items between representatives",
  },
  {
    key: "intervene.approve",
    family: "intervene",
    subjectType: "work_item",
    axis: "organizational",
    description: "Approve a concession or escalation on a work item",
  },
  {
    key: "define.targets",
    family: "define",
    subjectType: "team",
    axis: "organizational",
    description: "Set or override targets for a scope",
  },
  {
    key: "define.roster",
    family: "define",
    subjectType: "team",
    axis: "organizational",
    description: "Change team membership and representative records",
  },
  {
    key: "define.work_type",
    family: "define",
    subjectType: "organization",
    axis: "organizational",
    description: "Configure a work type's dimensions and outcome taxonomy",
  },
  {
    key: "answer.results",
    family: "answer",
    subjectType: "representative",
    axis: "organizational",
    description: "Be accountable for the subject's shortfall",
  },
  {
    key: "system.administer",
    family: "define",
    subjectType: "organization",
    axis: "system",
    description: "Administer Pulse: accounts, roles, integrations",
  },
  {
    key: "system.import",
    family: "define",
    subjectType: "organization",
    axis: "system",
    description: "Run and reverse data imports",
  },
  {
    key: "system.audit",
    family: "observe",
    subjectType: "organization",
    axis: "system",
    description: "Read the audit log",
  },
];

export const CAPABILITY_KEYS: readonly string[] = CAPABILITY_CATALOG.map((c) => c.key);

const BY_KEY = new Map(CAPABILITY_CATALOG.map((c) => [c.key, c] as const));

export function findCapability(key: string): Capability | undefined {
  return BY_KEY.get(key);
}

export function isKnownCapability(key: string): boolean {
  return BY_KEY.has(key);
}

/** Keys in the list that the catalog does not recognize. Empty means all known. */
export function unknownCapabilities(keys: readonly string[]): string[] {
  return keys.filter((k) => !BY_KEY.has(k));
}

export function capabilitiesOnAxis(keys: readonly string[], axis: CapabilityAxis): string[] {
  return keys.filter((k) => BY_KEY.get(k)?.axis === axis);
}

export function capabilitiesInFamily(keys: readonly string[], family: CapabilityFamily): string[] {
  return keys.filter((k) => BY_KEY.get(k)?.family === family);
}

/**
 * A system capability carries no scope. Passing one into a scope-based check
 * is a category error rather than a denial, so callers get a predicate to
 * separate them rather than a silent false.
 */
export function isSystemCapability(key: string): boolean {
  return BY_KEY.get(key)?.axis === "system";
}

// ---------------------------------------------------------------------------
// Set algebra — the delegation rule in one function
// ---------------------------------------------------------------------------

/** Keys in `child` that `parent` does not hold. Empty means the delegation is within bounds. */
export function capabilitiesExceeding(
  parent: readonly string[],
  child: readonly string[],
): string[] {
  const held = new Set(parent);
  return child.filter((k) => !held.has(k));
}

/** No assignment may grant more than its grantor holds. */
export function isCapabilitySubset(parent: readonly string[], child: readonly string[]): boolean {
  return capabilitiesExceeding(parent, child).length === 0;
}

// ---------------------------------------------------------------------------
// Named configurations
// ---------------------------------------------------------------------------
//
// Presets, not types. An administrator creating an assignment picks one of
// these and may then adjust it; nothing downstream branches on which one was
// picked. This is what makes a title a label rather than a behaviour.

/** Full line management over a scope: all four families, including accountability. */
export const LINE_MANAGEMENT_CAPABILITIES: readonly string[] = [
  "observe.performance",
  "observe.feedback",
  "observe.work_items",
  "observe.team",
  "intervene.coach",
  "intervene.assign_work",
  "intervene.approve",
  "define.targets",
  "define.roster",
  "answer.results",
];

/** Observe and intervene without answering. A quality reviewer, a functional manager. */
export const FUNCTIONAL_MANAGEMENT_CAPABILITIES: readonly string[] = [
  "observe.performance",
  "observe.feedback",
  "observe.work_items",
  "observe.team",
  "intervene.coach",
];

/** Owns the rules a population is measured by without managing the people. A line owner. */
export const LINE_OWNERSHIP_CAPABILITIES: readonly string[] = [
  "observe.performance",
  "observe.work_items",
  "observe.team",
  "define.targets",
  "define.work_type",
];

/** Read-only across a scope. An executive, an auditor. */
export const OBSERVER_CAPABILITIES: readonly string[] = [
  "observe.performance",
  "observe.team",
  "observe.work_items",
];

/**
 * Accountability is expressed twice — as the `accountable` column and as
 * `answer.results` — because the column is what the partition constraint can
 * index and the capability is what a permission check reads. This keeps them
 * from disagreeing.
 */
export const ACCOUNTABILITY_CAPABILITY = "answer.results";

export function impliesAccountability(keys: readonly string[]): boolean {
  return keys.includes(ACCOUNTABILITY_CAPABILITY);
}
