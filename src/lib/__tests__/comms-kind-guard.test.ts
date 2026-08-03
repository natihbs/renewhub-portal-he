import { describe, expect, it } from "vitest";
import { COMMS_KINDS, isCommsKind } from "@/lib/comms-store";

describe("isCommsKind", () => {
  it("accepts every known kind", () => {
    for (const k of COMMS_KINDS) {
      expect(isCommsKind(k)).toBe(true);
    }
  });

  it("rejects an unrecognized, empty, or legacy kind value", () => {
    expect(isCommsKind("")).toBe(false);
    expect(isCommsKind("praise")).toBe(false);
    expect(isCommsKind("MORNING")).toBe(false);
    expect(isCommsKind("unknown_kind")).toBe(false);
  });
});
