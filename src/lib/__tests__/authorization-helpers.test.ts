import { describe, it, expect } from "vitest";
import {
  decideFromGrants,
  heldCapabilities,
  accountableAssignments,
  hasSystemCapability,
  isAccountableFor,
  type ActorContext,
  type ActorAssignment,
  type RepresentativeGrant,
} from "@/lib/authorization";
import {
  CAPABILITY_CATALOG,
  CAPABILITY_KEYS,
  capabilitiesExceeding,
  isCapabilitySubset,
  isKnownCapability,
  unknownCapabilities,
  isSystemCapability,
  capabilitiesOnAxis,
  capabilitiesInFamily,
  impliesAccountability,
  LINE_MANAGEMENT_CAPABILITIES,
  FUNCTIONAL_MANAGEMENT_CAPABILITIES,
  LINE_OWNERSHIP_CAPABILITIES,
  OBSERVER_CAPABILITIES,
  ACCOUNTABILITY_CAPABILITY,
} from "@/lib/capability-domain";

const assignment = (over: Partial<ActorAssignment> = {}): ActorAssignment => ({
  assignmentId: "a1",
  scopeId: "s1",
  scopeKind: "team",
  scopeDisplayName: "צוות רכב",
  accountable: false,
  validFrom: "2026-01-01",
  validTo: null,
  label: null,
  cadence: "daily",
  capabilities: ["observe.performance"],
  ...over,
});

const actor = (over: Partial<ActorContext> = {}): ActorContext => ({
  personId: "person-1",
  isAdmin: false,
  assignments: [assignment()],
  ...over,
});

const grant = (
  capabilityKey: string,
  accountable = false,
  assignmentId = "a1",
): RepresentativeGrant => ({
  capabilityKey,
  assignmentId,
  accountable,
});

// ---------------------------------------------------------------------------
// The core decision
// ---------------------------------------------------------------------------

describe("decideFromGrants", () => {
  it("denies when no grant carries the required capability", () => {
    const decision = decideFromGrants([grant("observe.performance")], "intervene.coach");
    expect(decision.allowed).toBe(false);
    expect(decision.viaAssignmentId).toBeNull();
    expect(decision.reason).toContain("intervene.coach");
  });

  it("denies against an empty grant set", () => {
    expect(decideFromGrants([], "observe.performance").allowed).toBe(false);
  });

  it("allows and names the assignment that granted access", () => {
    const decision = decideFromGrants(
      [grant("intervene.coach", false, "a-cover")],
      "intervene.coach",
    );
    expect(decision.allowed).toBe(true);
    expect(decision.viaAssignmentId).toBe("a-cover");
  });

  it("prefers the accountable grant when several apply, so the reason names the primary relationship", () => {
    const decision = decideFromGrants(
      [
        grant("observe.performance", false, "a-functional"),
        grant("observe.performance", true, "a-line"),
      ],
      "observe.performance",
    );
    expect(decision.viaAssignmentId).toBe("a-line");
    expect(decision.reason).toBe("אחריות ניהולית");
  });

  it("allows an admin regardless of grants, and says so", () => {
    const decision = decideFromGrants([], "define.roster", { isAdmin: true });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("הרשאת מנהל מערכת");
    // Admin access has no assignment behind it, and claiming one would make
    // "why can I see this?" answer with a lie.
    expect(decision.viaAssignmentId).toBeNull();
  });

  it("rejects a functional grant when the action demands accountability", () => {
    const decision = decideFromGrants([grant("intervene.coach", false)], "intervene.coach", {
      isAdmin: false,
      requireAccountable: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("אחריות ניהולית");
  });

  it("accepts an accountable grant when the action demands accountability", () => {
    const decision = decideFromGrants(
      [grant("intervene.coach", true, "a-line")],
      "intervene.coach",
      {
        isAdmin: false,
        requireAccountable: true,
      },
    );
    expect(decision.allowed).toBe(true);
    expect(decision.viaAssignmentId).toBe("a-line");
  });

  it("does not let a matching-but-functional grant satisfy an accountable requirement via another capability", () => {
    const decision = decideFromGrants(
      [grant("answer.results", true, "a-line"), grant("define.roster", false, "a-func")],
      "define.roster",
      { isAdmin: false, requireAccountable: true },
    );
    expect(decision.allowed).toBe(false);
  });

  it("reports accountability independently of any particular capability", () => {
    expect(isAccountableFor([grant("observe.performance", false)])).toBe(false);
    expect(
      isAccountableFor([grant("observe.performance", false), grant("answer.results", true)]),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

describe("actor context", () => {
  it("deduplicates and sorts capabilities across assignments", () => {
    const ctx = actor({
      assignments: [
        assignment({
          assignmentId: "a1",
          capabilities: ["observe.performance", "intervene.coach"],
        }),
        assignment({ assignmentId: "a2", capabilities: ["observe.performance", "define.targets"] }),
      ],
    });
    expect(heldCapabilities(ctx)).toEqual([
      "define.targets",
      "intervene.coach",
      "observe.performance",
    ]);
  });

  it("returns an empty capability list for an actor with no assignments", () => {
    expect(heldCapabilities(actor({ assignments: [] }))).toEqual([]);
  });

  it("separates accountable assignments from functional ones", () => {
    const ctx = actor({
      assignments: [
        assignment({ assignmentId: "a1", accountable: true }),
        assignment({ assignmentId: "a2", accountable: false }),
      ],
    });
    expect(accountableAssignments(ctx).map((a) => a.assignmentId)).toEqual(["a1"]);
  });
});

describe("system capabilities", () => {
  it("grants any system capability to a v1 admin", () => {
    expect(
      hasSystemCapability(actor({ isAdmin: true, assignments: [] }), "system.administer"),
    ).toBe(true);
  });

  it("denies a system capability the actor does not hold", () => {
    expect(hasSystemCapability(actor(), "system.administer")).toBe(false);
  });

  it("grants a system capability held through an assignment", () => {
    const ctx = actor({ assignments: [assignment({ capabilities: ["system.import"] })] });
    expect(hasSystemCapability(ctx, "system.import")).toBe(true);
  });

  it("never satisfies a system check with an organizational capability", () => {
    // The whole point of the two axes: a wide span must not become
    // database-level power. observe.team is held here and must not answer a
    // system question, even by accident.
    const ctx = actor({
      assignments: [assignment({ capabilities: ["observe.team", "define.roster"] })],
    });
    expect(hasSystemCapability(ctx, "observe.team")).toBe(false);
    expect(hasSystemCapability(ctx, "define.roster")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Capability catalog and set algebra
// ---------------------------------------------------------------------------

describe("capability catalog", () => {
  it("has unique keys", () => {
    expect(new Set(CAPABILITY_KEYS).size).toBe(CAPABILITY_KEYS.length);
  });

  it("keeps every system capability on the organization subject type", () => {
    // Mirrors capabilities_system_axis_is_org in the migration: a system
    // capability that claimed a representative subject would look scoped and
    // behave unscoped.
    for (const c of CAPABILITY_CATALOG) {
      if (c.axis === "system") expect(c.subjectType).toBe("organization");
    }
  });

  it("recognizes only catalog keys", () => {
    expect(isKnownCapability("observe.performance")).toBe(true);
    expect(isKnownCapability("observe.everything")).toBe(false);
  });

  it("reports unknown keys so they can be rejected before a round trip", () => {
    expect(unknownCapabilities(["observe.performance", "made.up", "also.fake"])).toEqual([
      "made.up",
      "also.fake",
    ]);
    expect(unknownCapabilities(CAPABILITY_KEYS)).toEqual([]);
  });

  it("classifies by axis and family", () => {
    expect(isSystemCapability("system.audit")).toBe(true);
    expect(isSystemCapability("observe.performance")).toBe(false);
    expect(capabilitiesOnAxis(["system.audit", "observe.team"], "system")).toEqual([
      "system.audit",
    ]);
    expect(capabilitiesInFamily(["observe.team", "intervene.coach"], "observe")).toEqual([
      "observe.team",
    ]);
  });

  it("treats an unknown key as belonging to no axis and no family", () => {
    expect(isSystemCapability("made.up")).toBe(false);
    expect(capabilitiesOnAxis(["made.up"], "organizational")).toEqual([]);
    expect(capabilitiesInFamily(["made.up"], "observe")).toEqual([]);
  });
});

describe("capability set algebra — the delegation rule", () => {
  it("treats an equal set as a subset", () => {
    expect(isCapabilitySubset(["a", "b"], ["a", "b"])).toBe(true);
    expect(capabilitiesExceeding(["a", "b"], ["a", "b"])).toEqual([]);
  });

  it("treats the empty set as a subset of anything", () => {
    expect(isCapabilitySubset(["a"], [])).toBe(true);
    expect(isCapabilitySubset([], [])).toBe(true);
  });

  it("reports exactly what exceeds the grantor", () => {
    expect(capabilitiesExceeding(["a", "b"], ["b", "c", "d"])).toEqual(["c", "d"]);
    expect(isCapabilitySubset(["a", "b"], ["b", "c"])).toBe(false);
  });

  it("never lets an empty grantor delegate anything", () => {
    expect(isCapabilitySubset([], ["a"])).toBe(false);
  });
});

describe("named configurations", () => {
  it("uses only real capability keys", () => {
    for (const preset of [
      LINE_MANAGEMENT_CAPABILITIES,
      FUNCTIONAL_MANAGEMENT_CAPABILITIES,
      LINE_OWNERSHIP_CAPABILITIES,
      OBSERVER_CAPABILITIES,
    ]) {
      expect(unknownCapabilities(preset)).toEqual([]);
    }
  });

  it("gives only line management the accountability capability", () => {
    expect(impliesAccountability(LINE_MANAGEMENT_CAPABILITIES)).toBe(true);
    expect(impliesAccountability(FUNCTIONAL_MANAGEMENT_CAPABILITIES)).toBe(false);
    expect(impliesAccountability(LINE_OWNERSHIP_CAPABILITIES)).toBe(false);
    expect(impliesAccountability(OBSERVER_CAPABILITIES)).toBe(false);
  });

  it("nests functional management and observation inside line management", () => {
    // The three titles are configurations of one concept, so the narrower ones
    // must be delegable from the wider one without a special case.
    expect(
      isCapabilitySubset(LINE_MANAGEMENT_CAPABILITIES, FUNCTIONAL_MANAGEMENT_CAPABILITIES),
    ).toBe(true);
    expect(isCapabilitySubset(LINE_MANAGEMENT_CAPABILITIES, OBSERVER_CAPABILITIES)).toBe(true);
  });

  it("does not nest line ownership inside line management — it defines rather than manages", () => {
    // define.work_type is an organization-level verb a team manager does not
    // hold, which is what makes a line owner a different configuration rather
    // than a smaller manager.
    expect(
      capabilitiesExceeding(LINE_MANAGEMENT_CAPABILITIES, LINE_OWNERSHIP_CAPABILITIES),
    ).toEqual(["define.work_type"]);
  });

  it("keeps every preset free of system capabilities", () => {
    for (const preset of [
      LINE_MANAGEMENT_CAPABILITIES,
      FUNCTIONAL_MANAGEMENT_CAPABILITIES,
      LINE_OWNERSHIP_CAPABILITIES,
      OBSERVER_CAPABILITIES,
    ]) {
      expect(capabilitiesOnAxis(preset, "system")).toEqual([]);
    }
  });

  it("names accountability with a catalog key", () => {
    expect(isKnownCapability(ACCOUNTABILITY_CAPABILITY)).toBe(true);
  });
});
