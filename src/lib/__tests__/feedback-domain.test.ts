import { describe, it, expect } from "vitest";
import { CRITERIA } from "@/lib/feedback-domain";
import * as seed from "@/lib/seed";

// Regression coverage: CRITERIA/CriterionValue/Feedback used to live inside seed.ts,
// mixed in with actual demo fixtures (SEED) — exactly the kind of co-location that let
// a real scoring bug (missing "knowledge"/"impression" criteria) go unnoticed. They now
// live in their own module; this pins that seed.ts stays a pure demo-fixtures file and
// doesn't quietly re-grow a real-config export.

describe("feedback domain / seed.ts separation", () => {
  it("CRITERIA is a non-empty, real configuration list", () => {
    expect(CRITERIA.length).toBeGreaterThan(0);
    for (const c of CRITERIA) {
      expect(c.key).toBeTruthy();
      expect(c.label).toBeTruthy();
    }
  });

  it("seed.ts no longer exports CRITERIA", () => {
    expect((seed as Record<string, unknown>).CRITERIA).toBeUndefined();
  });
});
